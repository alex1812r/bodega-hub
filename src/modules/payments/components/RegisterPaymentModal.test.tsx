import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";

import { VENEZUELAN_BANKS } from "@/shared/venezuela/banks";

import { RegisterPaymentModal } from "./RegisterPaymentModal";

const BANK = VENEZUELAN_BANKS[0];
// SHR-34: 220 caracteres sin un solo punto de corte, como el mensaje hostil del caos.
const UNBROKEN_MESSAGE = "ERR_UPSTREAM_".padEnd(220, "X");
// El boton que abre el modal lleva su titulo y el de envio depende del documento.
const OPEN_BUTTON = /^(Cobrar saldo|Pagar compra|Registrar pago)$/;
const SUBMIT_BUTTON = /^Registrar (cobro|pago)$/;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function renderModal(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("RegisterPaymentModal", () => {
  const fetchMock = jest.fn();
  let paymentResponse: Response;
  let enabledPaymentMethods: string[];
  // Lo ya pagado de sale-002 y la tasa del dia de la tienda, como los tiene el servidor.
  let salePaidVes: number;
  let currentRateVes: number | undefined;

  beforeEach(() => {
    salePaidVes = 3000;
    currentRateVes = undefined;
    paymentResponse = jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 1000 } });
    enabledPaymentMethods = [
      "efectivo_ves",
      "efectivo_usd",
      "pago_movil",
      "punto_venta",
      "transferencia",
    ];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return paymentResponse;
      }

      if (String(url).includes("/api/settings/payment-methods")) {
        return jsonResponse({
          data: {
            enabledPaymentMethods,
          },
        });
      }

      if (String(url).includes("/api/sales/")) {
        return jsonResponse({
          data: {
            customer: { id: "cont-customer", name: "Maria Perez" },
            id: "sale-002",
            invoiceNumber: "F-0002",
            paidVes: salePaidVes,
            refRateVes: 510,
            totalVes: 11475,
          },
        });
      }

      if (String(url).includes("/api/exchange-rates/current") && currentRateVes !== undefined) {
        return jsonResponse({ data: { id: "rate-today", rateVes: currentRateVes } });
      }

      if (String(url).includes("/api/purchases/")) {
        return jsonResponse({
          data: {
            id: "purchase-002",
            paidVes: 0,
            purchaseNumber: "C-0002",
            refRateVes: 500,
            supplier: { id: "cont-supplier", name: "Distribuidora Polar" },
            totalVes: 20200,
          },
        });
      }

      return jsonResponse({ data: null });
    });
    global.fetch = fetchMock;
  });

  async function openModal() {
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: OPEN_BUTTON }));

    const dialog = await screen.findByRole("dialog");

    await within(dialog).findByText(/Saldo pendiente actual/);

    return { dialog: within(dialog), user };
  }

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: SUBMIT_BUTTON }));
  }

  function postedBodies() {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      .map(([url, init]) => ({
        body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
        url: String(url),
      }));
  }

  async function expectSinglePost() {
    await waitFor(() => expect(postedBodies()).toHaveLength(1));

    return postedBodies()[0];
  }

  it("envia el payload de efectivo REF (USD) de una venta", async () => {
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
    await user.type(dialog.getByLabelText("Monto"), "12.5");
    await user.type(dialog.getByLabelText("Notas"), "  Abono en caja  ");
    await submit(user);

    const post = await expectSinglePost();

    expect(post.url).toContain("/api/payments");
    expect(post.body).toEqual({
      amount: 12.5,
      clientRequestId: expect.any(String),
      currency: "USD",
      method: "efectivo_usd",
      notes: "Abono en caja",
      saleId: "sale-002",
    });
    expect(
      await dialog.findByText(/Pago registrado\. Saldo pendiente:/),
    ).toBeInTheDocument();
  });

  it("envia el payload de pago movil en Bs con banco, telefono y referencia", async () => {
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "pago_movil");
    await user.type(dialog.getByLabelText("Monto"), "1500.75");
    await user.type(dialog.getByLabelText("Banco"), BANK.code);
    await user.click(await dialog.findByRole("button", { name: new RegExp(BANK.code) }));
    await user.type(dialog.getByLabelText("Numero telefonico"), "5551234");
    await user.type(dialog.getByLabelText("Referencia"), "1234");
    await submit(user);

    const post = await expectSinglePost();

    expect(post.body).toEqual({
      amount: 1500.75,
      bankName: BANK.label,
      clientRequestId: expect.any(String),
      currency: "VES",
      method: "pago_movil",
      phone: "04125551234",
      referenceCode: "1234",
      saleId: "sale-002",
    });
  });

  it("envia el payload de transferencia de una compra", async () => {
    renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "transferencia");
    await user.type(dialog.getByLabelText("Monto"), "20200");
    await user.type(dialog.getByLabelText("Banco"), BANK.code);
    await user.click(await dialog.findByRole("button", { name: new RegExp(BANK.code) }));
    await user.type(dialog.getByLabelText("Referencia"), " TRX-001 ");
    await submit(user);

    const post = await expectSinglePost();

    expect(post.body).toEqual({
      amount: 20200,
      bankName: BANK.label,
      clientRequestId: expect.any(String),
      currency: "VES",
      method: "transferencia",
      purchaseId: "purchase-002",
      referenceCode: "TRX-001",
    });
  });

  // SHR-09F: NumberInput redondea al salir del campo o al pulsar Enter, no al teclear.
  it("SHR-09F: un monto con 3 decimales se envia redondeado a 2 al hacer clic en Registrar pago", async () => {
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "12,345");
    await submit(user);

    const post = await expectSinglePost();

    expect(post.body).toEqual({
      amount: 12.35,
      clientRequestId: expect.any(String),
      currency: "VES",
      method: "efectivo_ves",
      saleId: "sale-002",
    });
  });

  it("SHR-09F: un monto con 3 decimales se envia redondeado a 2 al pulsar Enter en el monto", async () => {
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "1.005{Enter}");

    const post = await expectSinglePost();

    expect(post.body).toEqual({
      amount: 1.01,
      clientRequestId: expect.any(String),
      currency: "VES",
      method: "efectivo_ves",
      saleId: "sale-002",
    });
  });

  it("no envia nada y muestra las validaciones del metodo si faltan datos", async () => {
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "pago_movil");
    await submit(user);

    expect(await dialog.findByText("Indica un monto mayor a cero.")).toBeInTheDocument();
    expect(dialog.getByText("Indica el banco.")).toBeInTheDocument();
    expect(dialog.getByText("Indica el telefono.")).toBeInTheDocument();
    expect(dialog.getByText("Usa una referencia de 4 digitos.")).toBeInTheDocument();
    expect(postedBodies()).toHaveLength(0);
  });

  it("Completar saldo envia el saldo pendiente de la venta en Bs", async () => {
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await user.click(dialog.getByRole("button", { name: "Completar saldo" }));
    await submit(user);

    const post = await expectSinglePost();

    expect(post.body).toEqual({
      amount: 8475,
      clientRequestId: expect.any(String),
      currency: "VES",
      method: "efectivo_ves",
      saleId: "sale-002",
    });
  });

  describe("PAG-03b: sin modo generico", () => {
    it("con documento no hay selector de contexto ni campo donde teclear un ID", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog } = await openModal();

      expect(dialog.queryByLabelText("Contexto")).not.toBeInTheDocument();
      expect(dialog.queryByLabelText(/ID/)).not.toBeInTheDocument();
      expect(dialog.queryByPlaceholderText(/sale-|purchase-/)).not.toBeInTheDocument();
    });

    it("sin documento no deja elegirlo, no ofrece atajos de saldo y no envia nada", async () => {
      const user = userEvent.setup();

      renderModal(<RegisterPaymentModal />);
      await user.click(screen.getByRole("button", { name: OPEN_BUTTON }));

      const dialog = within(await screen.findByRole("dialog"));

      expect(dialog.queryByLabelText("Contexto")).not.toBeInTheDocument();
      expect(dialog.queryByLabelText(/ID/)).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Completar saldo" })).not.toBeInTheDocument();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(
        await dialog.findByText("El pago debe estar asociado solo a una venta o solo a una compra."),
      ).toBeInTheDocument();
      expect(postedBodies()).toHaveLength(0);
    });

    it("con venta y compra a la vez no envia nada", async () => {
      const user = userEvent.setup();

      renderModal(<RegisterPaymentModal purchaseId="purchase-002" saleId="sale-002" />);
      await user.click(screen.getByRole("button", { name: OPEN_BUTTON }));

      const dialog = within(await screen.findByRole("dialog"));

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(
        await dialog.findByText("El pago debe estar asociado solo a una venta o solo a una compra."),
      ).toBeInTheDocument();
      expect(postedBodies()).toHaveLength(0);
    });
  });

  it("si el metodo por defecto no esta habilitado usa el primero habilitado", async () => {
    enabledPaymentMethods = ["efectivo_usd", "transferencia"];
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await waitFor(() => expect(dialog.getByLabelText("Metodo")).toHaveValue("efectivo_usd"));
    await user.type(dialog.getByLabelText("Monto"), "3");
    await submit(user);

    const post = await expectSinglePost();

    expect(post.body).toEqual({
      amount: 3,
      clientRequestId: expect.any(String),
      currency: "USD",
      method: "efectivo_usd",
      saleId: "sale-002",
    });
  });

  describe("SHR-19 A1: pago en vuelo", () => {
    let resolvePost: (response: Response) => void;

    beforeEach(() => {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;

      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Promise<Response>((resolve) => {
            resolvePost = resolve;
          });
        }

        return defaultFetch(url, init);
      });
    });

    it("no se puede cerrar con Esc, X ni Cancelar mientras el POST sigue en curso", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);
      await waitFor(() => expect(postedBodies()).toHaveLength(1));

      expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
      expect(dialog.getByRole("button", { name: "Registrando..." })).toBeDisabled();

      await user.keyboard("{Escape}");
      await user.click(dialog.getByRole("button", { name: "Cerrar modal" }));
      await user.click(dialog.getByRole("button", { name: "Cancelar" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(dialog.getByLabelText("Monto")).toHaveValue("100");

      await act(async () => {
        resolvePost(paymentResponse);
      });

      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
      expect(postedBodies()).toHaveLength(1);

      // Ya sin petición en curso, el modal vuelve a cerrarse con normalidad.
      await user.click(dialog.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("dos envios del formulario en el mismo tick solo generan un POST", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await user.tab();

      const form = screen.getByRole("dialog").querySelector("form") as HTMLFormElement;

      await act(async () => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      await act(async () => {
        fireEvent.submit(form);
      });

      expect(postedBodies()).toHaveLength(1);

      await act(async () => {
        resolvePost(paymentResponse);
      });
      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
    });

    it("tras un rechazo del servidor el candado se libera y se puede reintentar", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);
      await waitFor(() => expect(postedBodies()).toHaveLength(1));
      await act(async () => {
        resolvePost(
          jsonResponse({ error: { code: "CONFLICT", message: "La caja esta cerrada." } }, 409),
        );
      });

      expect(await dialog.findByText("La caja esta cerrada.")).toBeInTheDocument();
      expect(dialog.getByRole("button", { name: "Cancelar" })).toBeEnabled();

      await submit(user);
      await waitFor(() => expect(postedBodies()).toHaveLength(2));
    });
  });

  // Saldo de sale-002: Bs 8.475 a tasa 510. Holgura de `register_payment` para una venta:
  // Bs 10 con metodos en Bs y 1 USD (Bs 510) con efectivo USD.
  describe("SHR-19 M3: monto mayor que el saldo", () => {
    it("no envia un monto que el servidor rechazaria por exceder el saldo de la venta", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "8485.01");
      await submit(user);

      expect(await dialog.findByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
      expect(dialog.getByLabelText("Monto")).toHaveAttribute("aria-invalid", "true");
      expect(postedBodies()).toHaveLength(0);
    });

    it("Completar saldo en Bs y pasar a efectivo USD no envia la misma cifra en USD", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.click(dialog.getByRole("button", { name: "Completar saldo" }));
      await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
      await submit(user);

      const post = await expectSinglePost();

      // 8475 / 510 = 16.62 (Bs 8.476,20: dentro de la holgura de 1 USD).
      expect(post.body).toEqual({
        amount: 16.62,
        clientRequestId: expect.any(String),
        currency: "USD",
        method: "efectivo_usd",
        saleId: "sale-002",
      });
    });

    it("dentro de la holgura de redondeo de la venta avisa pero envia", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "8485");
      expect(dialog.getByRole("status")).toHaveTextContent(/El monto supera el saldo pendiente/);
      await submit(user);

      expect((await expectSinglePost()).body).toMatchObject({ amount: 8485, currency: "VES" });
    });

    it("en efectivo USD la holgura de la venta es de 1 USD", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
      // 17.62 USD = Bs 8.986,20 > 8.475 + 510.
      await user.type(dialog.getByLabelText("Monto"), "17.62");
      await submit(user);

      expect(await dialog.findByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
      expect(postedBodies()).toHaveLength(0);
    });

    it("una compra en Bs no admite pasar del saldo", async () => {
      renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "20200.02");
      await submit(user);

      expect(await dialog.findByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
      expect(postedBodies()).toHaveLength(0);
    });

    it("una compra en USD sin tasa del dia disponible solo avisa: decide el servidor", async () => {
      renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
      const { dialog, user } = await openModal();

      await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
      await user.type(dialog.getByLabelText("Monto"), "45");
      expect(dialog.getByRole("status")).toHaveTextContent(/El monto supera el saldo pendiente/);
      await submit(user);

      expect((await expectSinglePost()).body).toMatchObject({ amount: 45, currency: "USD" });
    });

    // Saldo de purchase-002: Bs 20.200 (tasa de la compra 500). `register_payment`
    // convierte el USD de una compra con la tasa del dia y solo tolera Bs 0,01.
    describe("PAG-F1 A: compra en USD con la tasa del dia", () => {
      beforeEach(() => {
        currentRateVes = 520;
      });

      it.each(["45", "999999"])(
        "no envia %s USD: supera el saldo de la compra",
        async (amount) => {
          renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
          const { dialog, user } = await openModal();

          await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
          await user.type(dialog.getByLabelText("Monto"), amount);
          await submit(user);

          expect(await dialog.findByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
          });
          expect(dialog.getByLabelText("Monto")).toHaveAttribute("aria-invalid", "true");
          expect(postedBodies()).toHaveLength(0);
        },
      );

      it("convierte con la tasa del dia, no con la de la compra", async () => {
        renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
        const { dialog, user } = await openModal();

        await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
        // 39 USD: Bs 19.500 a la tasa de la compra, Bs 20.280 a la del dia (> 20.200,01).
        await user.type(dialog.getByLabelText("Monto"), "39");
        await submit(user);

        expect(await dialog.findByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
        expect(postedBodies()).toHaveLength(0);

        // 38.84 USD = Bs 20.196,80 a la tasa del dia: cabe en el saldo.
        await user.clear(dialog.getByLabelText("Monto"));
        await user.type(dialog.getByLabelText("Monto"), "38.84");
        await submit(user);

        expect((await expectSinglePost()).body).toMatchObject({
          amount: 38.84,
          currency: "USD",
          purchaseId: "purchase-002",
        });
      });

      it("Completar saldo en USD usa la tasa del dia y se envia", async () => {
        renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
        const { dialog, user } = await openModal();

        await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
        await user.click(dialog.getByRole("button", { name: "Completar saldo" }));
        await submit(user);

        expect((await expectSinglePost()).body).toMatchObject({ amount: 38.84, currency: "USD" });
      });

      it("mientras la tasa del dia carga no envia un pago en USD", async () => {
        const defaultFetch = fetchMock.getMockImplementation() as (
          url: string,
          init?: RequestInit,
        ) => Promise<Response>;
        let releaseRate: (response: Response) => void = () => undefined;

        fetchMock.mockImplementation((url: string, init?: RequestInit) =>
          String(url).includes("/api/exchange-rates/current")
            ? new Promise<Response>((resolve) => {
                releaseRate = resolve;
              })
            : defaultFetch(url, init),
        );
        renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
        const { dialog, user } = await openModal();

        await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
        await user.type(dialog.getByLabelText("Monto"), "45{Enter}");
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(postedBodies()).toHaveLength(0);
        expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeDisabled();

        await act(async () => {
          releaseRate(jsonResponse({ data: { id: "rate-today", rateVes: 520 } }));
        });
        await waitFor(() =>
          expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeEnabled(),
        );
        await submit(user);

        expect(await dialog.findByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
        expect(postedBodies()).toHaveLength(0);
      });

      it("una compra en Bs no espera a la tasa del dia", async () => {
        const defaultFetch = fetchMock.getMockImplementation() as (
          url: string,
          init?: RequestInit,
        ) => Promise<Response>;

        fetchMock.mockImplementation((url: string, init?: RequestInit) =>
          String(url).includes("/api/exchange-rates/current")
            ? new Promise<Response>(() => undefined)
            : defaultFetch(url, init),
        );
        renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
        const { dialog, user } = await openModal();

        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);

        expect((await expectSinglePost()).body).toMatchObject({ amount: 100, currency: "VES" });
      });
    });
  });

  // Caos pasada 2, N4: sin el saldo cargado no hay guarda de sobrepago en el cliente.
  describe("SHR-22 N4: saldo del documento sin cargar", () => {
    type DocumentReply = () => Promise<Response>;

    function replyToDocumentWith(path: string, reply: DocumentReply) {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;

      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        init?.method !== "POST" && String(url).includes(path) ? reply() : defaultFetch(url, init),
      );

      return () => fetchMock.mockImplementation(defaultFetch);
    }

    async function openModalWithoutBalance() {
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: OPEN_BUTTON }));

      return { dialog: within(await screen.findByRole("dialog")), user };
    }

    it.each([
      ["venta", "/api/sales/", <RegisterPaymentModal key="sale" saleId="sale-002" />],
      ["compra", "/api/purchases/", <RegisterPaymentModal key="purchase" purchaseId="purchase-002" />],
    ])(
      "mientras carga la %s avisa y no deja registrar ningun monto",
      async (_document, path, ui) => {
        let resolveDocument: (response: Response) => void = () => undefined;
        const loaded = await fetchMock.getMockImplementation()?.(`${path}doc`);

        replyToDocumentWith(
          path,
          () =>
            new Promise<Response>((resolve) => {
              resolveDocument = resolve;
            }),
        );
        renderModal(ui);
        const { dialog, user } = await openModalWithoutBalance();

        await user.type(dialog.getByLabelText("Monto"), "99999999{Enter}");
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(postedBodies()).toHaveLength(0);
        expect(dialog.getByText("Cargando saldo pendiente...")).toBeInTheDocument();
        expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeDisabled();

        await act(async () => {
          resolveDocument(loaded as Response);
        });

        expect(await dialog.findByText(/Saldo pendiente actual/)).toBeInTheDocument();
        expect(dialog.queryByText("Cargando saldo pendiente...")).not.toBeInTheDocument();
        expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeEnabled();

        // Con el saldo ya cargado vuelve la guarda de sobrepago de SHR-19.
        await submit(user);
        expect(await dialog.findByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
        expect(postedBodies()).toHaveLength(0);
      },
    );

    it("si la venta responde 500 avisa con el mensaje del fallo, deja reintentar y sigue dejando registrar", async () => {
      const restore = replyToDocumentWith("/api/sales/", async () =>
        jsonResponse(
          { error: { code: "INTERNAL", message: "No se pudo consultar la venta." } },
          500,
        ),
      );

      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModalWithoutBalance();

      const alert = await dialog.findByRole("alert");

      expect(alert).toHaveTextContent("No se pudo comprobar el saldo pendiente");
      expect(alert).toHaveTextContent("No se pudo consultar la venta.");
      expect(dialog.queryByText("Cargando saldo pendiente...")).not.toBeInTheDocument();
      expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeEnabled();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect((await expectSinglePost()).body).toEqual({
        amount: 100,
        clientRequestId: expect.any(String),
        currency: "VES",
        method: "efectivo_ves",
        saleId: "sale-002",
      });
      // El aviso sigue a la vista tras registrar: el saldo sigue sin comprobarse.
      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
      expect(dialog.getByRole("alert")).toHaveTextContent(
        "No se pudo comprobar el saldo pendiente",
      );

      restore();
      await user.click(dialog.getByRole("button", { name: "Reintentar" }));

      expect(await dialog.findByText(/Saldo pendiente actual/)).toBeInTheDocument();
      expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("PAG-F1 C: si la carga de la compra se corta lo avisa en español, sin el texto del navegador", async () => {
      replyToDocumentWith("/api/purchases/", async () => {
        throw new TypeError("Failed to fetch");
      });

      renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
      const { dialog } = await openModalWithoutBalance();

      const alert = await dialog.findByRole("alert");

      expect(alert).toHaveTextContent("No se pudo comprobar el saldo pendiente");
      expect(alert).toHaveTextContent("No se pudo conectar con el servidor.");
      expect(alert).not.toHaveTextContent("Failed to fetch");
      expect(dialog.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeEnabled();
    });

    // Caos pasada 3, B5: jsdom no calcula layout; se comprueban las clases de corte.
    it("SHR-34: un mensaje largo y sin espacios se pinta entero y con corte de linea en el aviso", async () => {
      replyToDocumentWith("/api/sales/", async () =>
        jsonResponse({ error: { code: "INTERNAL", message: UNBROKEN_MESSAGE } }, 500),
      );

      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog } = await openModalWithoutBalance();

      const message = within(await dialog.findByRole("alert")).getByText(
        `No se pudo comprobar el saldo pendiente: ${UNBROKEN_MESSAGE}`,
      );

      expect(message.tagName).toBe("P");
      expect(message).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
    });
  });

  it("SHR-34: un rechazo del servidor largo y sin espacios se pinta entero y con corte de linea", async () => {
    paymentResponse = jsonResponse(
      { error: { code: "BAD_REQUEST", message: UNBROKEN_MESSAGE } },
      400,
    );
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await submit(user);

    const message = await dialog.findByText(UNBROKEN_MESSAGE);

    expect(message.tagName).toBe("P");
    expect(message).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
  });

  // Caos pasada 2, N4: la tienda no tiene Efectivo Bs y sus metodos llegan con el monto
  // ya tecleado; el selector pasa solo a Efectivo USD.
  describe("SHR-24 N4: los metodos habilitados llegan tarde", () => {
    function holdPaymentMethods() {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;
      let release: (response: Response) => void = () => undefined;

      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        String(url).includes("/api/settings/payment-methods")
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : defaultFetch(url, init),
      );

      return (response: Response) => release(response);
    }

    const usdOnlyMethods = () =>
      jsonResponse({ data: { enabledPaymentMethods: ["efectivo_usd", "transferencia"] } });

    it("el monto tecleado en Bs no se envia como la misma cifra en USD", async () => {
      const releaseMethods = holdPaymentMethods();

      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      expect(dialog.getByLabelText("Metodo")).toHaveValue("efectivo_ves");
      await user.type(dialog.getByLabelText("Monto"), "50");

      await act(async () => {
        releaseMethods(usdOnlyMethods());
      });
      await waitFor(() => expect(dialog.getByLabelText("Metodo")).toHaveValue("efectivo_usd"));

      // Bs 50 a tasa 510 = 0.10 USD: la misma conversion que el cambio manual de metodo.
      expect(dialog.getByLabelText("Monto")).toHaveValue("0.1");

      await user.type(dialog.getByLabelText("Monto"), "{Enter}");

      expect((await expectSinglePost()).body).toEqual({
        amount: 0.1,
        clientRequestId: expect.any(String),
        currency: "USD",
        method: "efectivo_usd",
        saleId: "sale-002",
      });
    });

    it("sin tasa para convertir, el monto tecleado en Bs se vacia", async () => {
      const releaseMethods = holdPaymentMethods();
      const user = userEvent.setup();

      renderModal(<RegisterPaymentModal />);
      await user.click(screen.getByRole("button", { name: OPEN_BUTTON }));

      const dialog = within(await screen.findByRole("dialog"));

      await user.type(dialog.getByLabelText("Monto"), "50");
      await act(async () => {
        releaseMethods(usdOnlyMethods());
      });
      await waitFor(() => expect(dialog.getByLabelText("Metodo")).toHaveValue("efectivo_usd"));

      expect(dialog.getByLabelText("Monto")).toHaveValue("");
    });

    it("si los metodos fallan al cargar sigue ofreciendo todos y envia lo tecleado en Bs", async () => {
      const releaseMethods = holdPaymentMethods();

      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "50");
      await act(async () => {
        releaseMethods(
          jsonResponse({ error: { code: "INTERNAL", message: "Sin ajustes." } }, 500),
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(dialog.getByLabelText("Metodo")).toHaveValue("efectivo_ves");
      expect(dialog.getByLabelText("Monto")).toHaveValue("50");
      await submit(user);

      expect((await expectSinglePost()).body).toEqual({
        amount: 50,
        clientRequestId: expect.any(String),
        currency: "VES",
        method: "efectivo_ves",
        saleId: "sale-002",
      });
    });
  });

  describe("PAG-01a: contrato del modal", () => {
    function requestIds() {
      return postedBodies().map((post) => post.body.clientRequestId);
    }

    it("con una compra se titula Pagar compra, envia con Registrar pago y nombra la compra y el proveedor", async () => {
      renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Pagar compra" }));

      const dialog = await screen.findByRole("dialog", { name: "Pagar compra" });

      expect(
        await within(dialog).findByText("Compra C-0002 a Distribuidora Polar."),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Registrar pago" })).toBeInTheDocument();
      expect(dialog).not.toHaveTextContent("purchase-002");
    });

    it("con una venta se titula Cobrar saldo, envia con Registrar cobro y nombra la venta y el cliente", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Cobrar saldo" }));

      const dialog = await screen.findByRole("dialog", { name: "Cobrar saldo" });

      expect(await within(dialog).findByText("Venta F-0002 de Maria Perez.")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Registrar cobro" })).toBeInTheDocument();
      expect(dialog).not.toHaveTextContent("sale-002");
    });

    it("mientras el documento carga la descripcion no muestra ningun id", async () => {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;

      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        String(url).includes("/api/sales/")
          ? new Promise<Response>(() => undefined)
          : defaultFetch(url, init),
      );
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Cobrar saldo" }));

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText("Registra un cobro de esta venta.")).toBeInTheDocument();
      expect(dialog).not.toHaveTextContent("sale-002");
    });

    it("title y submitLabel sustituyen los textos por defecto", async () => {
      renderModal(
        <RegisterPaymentModal purchaseId="purchase-002" submitLabel="Pagar" title="Pagar ahora" />,
      );
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Pagar ahora" }));

      const dialog = await screen.findByRole("dialog", { name: "Pagar ahora" });

      expect(within(dialog).getByRole("button", { name: "Pagar" })).toBeInTheDocument();
    });

    it("con contexto fijo basta abrir, Completar saldo y registrar", async () => {
      renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
      const { dialog, user } = await openModal();

      expect(dialog.queryByLabelText(/^ID /)).not.toBeInTheDocument();
      await user.click(dialog.getByRole("button", { name: "Completar saldo" }));
      await user.click(dialog.getByRole("button", { name: "Registrar pago" }));

      expect((await expectSinglePost()).body).toEqual({
        amount: 20200,
        clientRequestId: expect.any(String),
        currency: "VES",
        method: "efectivo_ves",
        purchaseId: "purchase-002",
      });
    });

    describe("apertura controlada", () => {
      function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
        const [open, setOpen] = useState(false);

        return (
          <>
            <button onClick={() => setOpen(true)} type="button">
              Pagar ahora
            </button>
            <button onClick={() => setOpen(false)} type="button">
              Cerrar por codigo
            </button>
            <RegisterPaymentModal
              onOpenChange={(nextOpen) => {
                onOpenChange?.(nextOpen);
                setOpen(nextOpen);
              }}
              open={open}
              purchaseId="purchase-002"
            />
          </>
        );
      }

      it("no pinta boton propio y se abre y se cierra con open", async () => {
        const onOpenChange = jest.fn();
        const user = userEvent.setup();

        renderModal(<Harness onOpenChange={onOpenChange} />);

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Pagar compra" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Pagar ahora" }));

        const dialog = within(await screen.findByRole("dialog", { name: "Pagar compra" }));

        await dialog.findByText(/Saldo pendiente actual/);
        await user.click(dialog.getByRole("button", { name: "Cancelar" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(onOpenChange).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });

      it("al reabrirlo por codigo el formulario vuelve limpio, sin el error anterior", async () => {
        paymentResponse = jsonResponse(
          { error: { code: "BAD_REQUEST", message: "La caja esta cerrada." } },
          400,
        );
        const user = userEvent.setup();

        renderModal(<Harness />);
        await user.click(screen.getByRole("button", { name: "Pagar ahora" }));

        let dialog = within(await screen.findByRole("dialog"));

        await dialog.findByText(/Saldo pendiente actual/);
        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        expect(await dialog.findByText("La caja esta cerrada.")).toBeInTheDocument();

        // El padre cierra sin pasar por el modal (p. ej. al navegar).
        fireEvent.click(screen.getByRole("button", { hidden: true, name: "Cerrar por codigo" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Pagar ahora" }));
        dialog = within(await screen.findByRole("dialog"));

        expect(dialog.getByLabelText("Monto")).toHaveValue("");
        expect(dialog.queryByText("La caja esta cerrada.")).not.toBeInTheDocument();
      });

      it("con el pago en vuelo no pide cerrarse", async () => {
        const defaultFetch = fetchMock.getMockImplementation() as (
          url: string,
          init?: RequestInit,
        ) => Promise<Response>;
        let resolvePost: (response: Response) => void = () => undefined;

        fetchMock.mockImplementation((url: string, init?: RequestInit) =>
          init?.method === "POST"
            ? new Promise<Response>((resolve) => {
                resolvePost = resolve;
              })
            : defaultFetch(url, init),
        );
        const onOpenChange = jest.fn();
        const user = userEvent.setup();

        renderModal(<Harness onOpenChange={onOpenChange} />);
        await user.click(screen.getByRole("button", { name: "Pagar ahora" }));

        const dialog = within(await screen.findByRole("dialog"));

        await dialog.findByText(/Saldo pendiente actual/);
        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(1));

        await user.keyboard("{Escape}");
        await user.click(dialog.getByRole("button", { name: "Cerrar modal" }));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(onOpenChange).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        await act(async () => {
          resolvePost(paymentResponse);
        });
        expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
      });
    });

    it("onRegistered recibe el pago registrado, una vez, y el modal sigue abierto", async () => {
      const onRegistered = jest.fn();

      renderModal(<RegisterPaymentModal onRegistered={onRegistered} saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
      expect(onRegistered).toHaveBeenCalledWith({ id: "pay-new", pendingBalanceVes: 1000 });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("onRegistered no se llama si el servidor rechaza el pago", async () => {
      const onRegistered = jest.fn();

      paymentResponse = jsonResponse(
        { error: { code: "BAD_REQUEST", message: "La caja esta cerrada." } },
        400,
      );
      renderModal(<RegisterPaymentModal onRegistered={onRegistered} saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(await dialog.findByText("La caja esta cerrada.")).toBeInTheDocument();
      expect(onRegistered).not.toHaveBeenCalled();
    });

    describe("PAG-06: clave de idempotencia", () => {
      it("cada POST lleva un clientRequestId", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await openModal();

        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);

        const post = await expectSinglePost();

        expect(post.body.clientRequestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      });

      it.each([
        ["un 500", () => jsonResponse({ error: { code: "INTERNAL", message: "Fallo." } }, 500)],
        ["un 409", () => jsonResponse({ error: { code: "CONFLICT", message: "Fallo." } }, 409)],
      ])("el reintento tras %s reutiliza la clave", async (_name, failure) => {
        paymentResponse = failure();
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await openModal();

        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        expect(await dialog.findByText("Fallo.")).toBeInTheDocument();

        paymentResponse = jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 1000 } });
        await submit(user);
        expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

        const [first, second] = requestIds();

        expect(postedBodies()).toHaveLength(2);
        expect(second).toBe(first);
      });

      it("el reintento tras un corte de red reutiliza la clave", async () => {
        const defaultFetch = fetchMock.getMockImplementation() as (
          url: string,
          init?: RequestInit,
        ) => Promise<Response>;
        let failNext = true;

        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
          if (init?.method === "POST" && failNext) {
            failNext = false;
            throw new TypeError("Failed to fetch");
          }

          return defaultFetch(url, init);
        });
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await openModal();

        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        expect(await dialog.findByText(/No se pudo conectar con el servidor\./)).toBeInTheDocument();

        await submit(user);
        expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

        const [first, second] = requestIds();

        expect(second).toBe(first);
      });

      it("tras un pago registrado el siguiente lleva una clave nueva", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await openModal();

        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(2));

        const [first, second] = requestIds();

        expect(second).toEqual(expect.any(String));
        expect(second).not.toBe(first);
      });

      it("PAG-03b: si el documento cambia tras un fallo incierto, la clave vieja no viaja con el nuevo", async () => {
        const queryClient = new QueryClient({
          defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
        });
        const modalFor = (saleId: string) => (
          <QueryClientProvider client={queryClient}>
            <RegisterPaymentModal onOpenChange={() => undefined} open saleId={saleId} />
          </QueryClientProvider>
        );

        paymentResponse = jsonResponse({ error: { code: "INTERNAL", message: "Fallo." } }, 500);

        const { rerender } = render(modalFor("sale-002"));
        const user = userEvent.setup();
        const dialog = within(await screen.findByRole("dialog"));

        await dialog.findByText(/Saldo pendiente actual/);
        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        expect(await dialog.findByText("Fallo.")).toBeInTheDocument();

        // Mismo modal, otra venta: como en `/payments` al elegir otro documento.
        paymentResponse = jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 1000 } });
        rerender(modalFor("sale-003"));

        const nextDialog = within(await screen.findByRole("dialog"));

        await nextDialog.findByText(/Saldo pendiente actual/);
        expect(nextDialog.queryByText("Fallo.")).not.toBeInTheDocument();
        expect(nextDialog.getByLabelText("Monto")).toHaveValue("");
        await user.type(nextDialog.getByLabelText("Monto"), "100");
        await submit(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(2));

        const [first, second] = postedBodies().map((post) => post.body);

        expect(first.saleId).toBe("sale-002");
        expect(second.saleId).toBe("sale-003");
        expect(second.clientRequestId).toEqual(expect.any(String));
        expect(second.clientRequestId).not.toBe(first.clientRequestId);
      });

      it("tras un 400 definitivo, cambiar el monto estrena clave", async () => {
        paymentResponse = jsonResponse(
          { error: { code: "BAD_REQUEST", message: "Monto rechazado." } },
          400,
        );
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await openModal();

        await user.type(dialog.getByLabelText("Monto"), "100");
        await submit(user);
        expect(await dialog.findByText("Monto rechazado.")).toBeInTheDocument();

        await user.clear(dialog.getByLabelText("Monto"));
        await user.type(dialog.getByLabelText("Monto"), "90");
        await submit(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(2));

        const [first, second] = requestIds();

        expect(second).toEqual(expect.any(String));
        expect(second).not.toBe(first);
      });
    });
  });

  describe("PAG-F1 B: resultado incierto y clave por apertura", () => {
    /** El servidor guarda el cobro de la venta, pero la respuesta llega como 500. */
    function savePaymentButReplyWith500() {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;
      const savedKeys = new Set<string>();

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return defaultFetch(url, init);
        }

        const body = JSON.parse(String(init.body)) as { amount: number; clientRequestId: string };

        if (!savedKeys.has(body.clientRequestId)) {
          savedKeys.add(body.clientRequestId);
          salePaidVes += body.amount;
        }

        return jsonResponse({ error: { code: "INTERNAL", message: "Fallo." } }, 500);
      });
    }

    function saleRequests() {
      return fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/api/sales/") &&
          (init as RequestInit | undefined)?.method !== "POST",
      ).length;
    }

    async function closeModal(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }

    it("tras un 500 con el pago guardado vuelve a pedir la venta y muestra el saldo nuevo", async () => {
      savePaymentButReplyWith500();
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      expect(dialog.getByText(/Saldo pendiente actual: .*8\.475,00/)).toBeInTheDocument();
      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(await dialog.findByText("Fallo.")).toBeInTheDocument();
      expect(await dialog.findByText(/Saldo pendiente actual: .*8\.375,00/)).toBeInTheDocument();
      // El formulario sigue como estaba: el reintento sin cambios conserva la clave.
      expect(dialog.getByLabelText("Monto")).toHaveValue("100");
    });

    it("tras un corte de red al enviar tambien vuelve a pedir la venta", async () => {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          salePaidVes += 100;
          throw new TypeError("Failed to fetch");
        }

        return defaultFetch(url, init);
      });
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(await dialog.findByText(/Saldo pendiente actual: .*8\.375,00/)).toBeInTheDocument();
    });

    it("tras un 400 definitivo no vuelve a pedir la venta", async () => {
      paymentResponse = jsonResponse(
        { error: { code: "BAD_REQUEST", message: "Monto rechazado." } },
        400,
      );
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");

      const requestsBefore = saleRequests();

      await submit(user);
      expect(await dialog.findByText("Monto rechazado.")).toBeInTheDocument();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(saleRequests()).toBe(requestsBefore);
    });

    it("cada apertura vuelve a pedir el saldo", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      expect(dialog.getByText(/Saldo pendiente actual: .*8\.475,00/)).toBeInTheDocument();
      await closeModal(user);

      // Otro usuario cobra Bs 1.000 de la misma venta mientras el modal esta cerrado.
      salePaidVes = 4000;

      const reopened = await openModal();

      expect(
        await reopened.dialog.findByText(/Saldo pendiente actual: .*7\.475,00/),
      ).toBeInTheDocument();
      expect(reopened.dialog.queryByText(/8\.475,00/)).not.toBeInTheDocument();
    });

    it("500 con el pago guardado, cerrar y reabrir: saldo nuevo y clave nueva", async () => {
      savePaymentButReplyWith500();
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);
      expect(await dialog.findByText("Fallo.")).toBeInTheDocument();
      await closeModal(user);

      const reopened = await openModal();

      expect(
        await reopened.dialog.findByText(/Saldo pendiente actual: .*8\.375,00/),
      ).toBeInTheDocument();
      expect(reopened.dialog.queryByText("Fallo.")).not.toBeInTheDocument();

      await reopened.user.type(reopened.dialog.getByLabelText("Monto"), "120");
      await submit(reopened.user);
      await waitFor(() => expect(postedBodies()).toHaveLength(2));

      const [first, second] = postedBodies().map((post) => post.body);

      expect(first).toMatchObject({ amount: 100 });
      expect(second).toMatchObject({ amount: 120 });
      expect(second.clientRequestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      expect(second.clientRequestId).not.toBe(first.clientRequestId);
    });

    it("si el pago de resultado incierto saldo la venta, al reabrir no deja enviar otro", async () => {
      savePaymentButReplyWith500();
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.click(dialog.getByRole("button", { name: "Completar saldo" }));
      await submit(user);
      expect(await dialog.findByText("Fallo.")).toBeInTheDocument();
      expect(await dialog.findByText(/Saldo pendiente actual: \D*0,00/)).toBeInTheDocument();
      await closeModal(user);

      const reopened = await openModal();

      expect(
        await reopened.dialog.findByText(/Saldo pendiente actual: \D*0,00/),
      ).toBeInTheDocument();
      expect(
        reopened.dialog.queryByRole("button", { name: "Completar saldo" }),
      ).not.toBeInTheDocument();

      // Ni el saldo viejo ni un monto dentro de la holgura de redondeo (Bs 10) salen.
      for (const amount of ["8475", "5"]) {
        await reopened.user.clear(reopened.dialog.getByLabelText("Monto"));
        await reopened.user.type(reopened.dialog.getByLabelText("Monto"), `${amount}{Enter}`);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(reopened.dialog.getByText(/El monto supera el saldo pendiente/)).toBeInTheDocument();
      }

      expect(postedBodies()).toHaveLength(1);
    });
  });

  describe("PAG-F1 C: fallo de red", () => {
    it("un corte de red al enviar se explica en español, sin el texto del navegador", async () => {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          throw new TypeError("Failed to fetch");
        }

        return defaultFetch(url, init);
      });
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(
        await dialog.findByText(
          "No se pudo conectar con el servidor. Revisa la conexión y reintenta: el pago no se duplicará.",
        ),
      ).toBeInTheDocument();
      expect(dialog.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    });
  });

  it("muestra el mensaje de error de la API tal cual", async () => {
    paymentResponse = jsonResponse(
      {
        error: {
          code: "BAD_REQUEST",
          message: "El pago excede el saldo pendiente de la venta.",
        },
      },
      400,
    );
    renderModal(<RegisterPaymentModal saleId="sale-002" />);
    const { dialog, user } = await openModal();

    // SHR-19: un monto muy por encima del saldo ya no sale del cliente; dentro de la
    // holgura (Bs 10) decide el servidor, p. ej. si el saldo en pantalla quedo viejo.
    await user.type(dialog.getByLabelText("Monto"), "8480");
    await submit(user);

    expect(
      await dialog.findByText("El pago excede el saldo pendiente de la venta."),
    ).toBeInTheDocument();
  });
});
