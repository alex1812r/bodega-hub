import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";

import { VENEZUELAN_BANKS } from "@/shared/venezuela/banks";

import { STEP_CLICK_GUARD_MS } from "../hooks/useStepClickGuard";
import { RegisterPaymentModal } from "./RegisterPaymentModal";

// PAG-F6 U6: el guardia de proceso (`useProcessGuard`) usa el router de Next.
const mockRouter = { push: jest.fn(), replace: jest.fn() };

jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

const BANK = VENEZUELAN_BANKS[0];
// SHR-34: 220 caracteres sin un solo punto de corte, como el mensaje hostil del caos.
const UNBROKEN_MESSAGE = "ERR_UPSTREAM_".padEnd(220, "X");
// El boton que abre el modal lleva su titulo y el de envio depende del documento.
const OPEN_BUTTON = /^(Cobrar saldo|Pagar compra|Registrar pago)$/;
const SUBMIT_BUTTON = /^Registrar (cobro|pago)$/;
// PAG-F6 U4: aviso del intento de resultado incierto que sigue sin resolver.
const UNCONFIRMED_NOTICE =
  "No pudimos confirmar si el pago se registró. Reintenta: si ya entró, no se duplicará.";

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

// PAG-F10: los flujos que pulsan varios botones del pie esperan en tiempo real la guarda
// de doble clic (~700 ms por paso); con la suite completa en paralelo no caben en 5 s.
jest.setTimeout(20_000);

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

  /**
   * PAG-F8: tras cada envio las acciones del pie quedan deshabilitadas ~700 ms. Como
   * haria el usuario, se pulsa el boton cuando ya esta habilitado.
   */
  async function pressFooter(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
    const button = await screen.findByRole("button", { name });

    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
  }

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await pressFooter(user, SUBMIT_BUTTON);
  }

  /** PAG-F6 U4: con un intento por confirmar la accion principal es «Reintentar». */
  async function retry(user: ReturnType<typeof userEvent.setup>) {
    await pressFooter(user, "Reintentar");
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

      // PAG-F6 U4: un 409 es de resultado incierto; el reintento es el mismo envio.
      await retry(user);
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
        await retry(user);
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

        await retry(user);
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

    // PAG-F6: tras un rechazo (p. ej. sobrepago) el saldo en pantalla puede estar viejo.
    it("tras un 400 definitivo vuelve a pedir la venta y se sigue editando", async () => {
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

      await waitFor(() => expect(saleRequests()).toBe(requestsBefore + 1));
      // Rechazo definitivo: no queda intento por confirmar.
      expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument();
      expect(dialog.getByLabelText("Monto")).toBeEnabled();
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

    // PAG-F6 U4: antes la reapertura estrenaba clave y un abono parcial repetido entraba dos veces.
    it("500 con el pago guardado, cerrar y reabrir: saldo nuevo y el mismo intento por confirmar", async () => {
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
      expect(reopened.dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
      expect(reopened.dialog.getByLabelText("Monto")).toHaveValue("100");
      expect(reopened.dialog.getByLabelText("Monto")).toBeDisabled();
      expect(
        reopened.dialog.queryByRole("button", { name: SUBMIT_BUTTON }),
      ).not.toBeInTheDocument();

      await retry(reopened.user);
      await waitFor(() => expect(postedBodies()).toHaveLength(2));

      const [first, second] = postedBodies().map((post) => post.body);

      expect(second).toEqual(first);
      // El servidor no lo registra dos veces: el saldo sigue siendo el del primer envio.
      await waitFor(() => expect(salePaidVes).toBe(3100));
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

      // PAG-F6 U4: no hay formulario donde teclear otro pago; solo cabe repetir el mismo.
      expect(reopened.dialog.getByLabelText("Monto")).toBeDisabled();
      expect(
        reopened.dialog.queryByRole("button", { name: SUBMIT_BUTTON }),
      ).not.toBeInTheDocument();

      await retry(reopened.user);
      await waitFor(() => expect(postedBodies()).toHaveLength(2));

      const keys = postedBodies().map((post) => post.body.clientRequestId);

      expect(new Set(keys).size).toBe(1);
      expect(salePaidVes).toBe(11475);
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

  describe("PAG-F6 U4: intento por confirmar", () => {
    const failure = (status: number, message: string) =>
      jsonResponse({ error: { code: "ERROR", message } }, status);
    const success = () => jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 1000 } });

    function saleRequests() {
      return fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/api/sales/") &&
          (init as RequestInit | undefined)?.method !== "POST",
      ).length;
    }

    async function submitUncertain() {
      paymentResponse = failure(500, "Fallo.");

      const opened = await openModal();

      await opened.user.selectOptions(opened.dialog.getByLabelText("Metodo"), "efectivo_usd");
      await opened.user.type(opened.dialog.getByLabelText("Monto"), "2");
      await opened.user.type(opened.dialog.getByLabelText("Notas"), "Abono");
      await submit(opened.user);
      expect(await opened.dialog.findByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();

      return opened;
    }

    it("tras un 500 bloquea los campos con lo enviado, lo explica y ofrece Reintentar", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog } = await submitUncertain();

      expect(dialog.getByText("Fallo.")).toBeInTheDocument();
      expect(dialog.getByLabelText("Monto")).toHaveValue("2");
      expect(dialog.getByLabelText("Monto")).toBeDisabled();
      expect(dialog.getByLabelText("Metodo")).toHaveValue("efectivo_usd");
      expect(dialog.getByLabelText("Metodo")).toBeDisabled();
      expect(dialog.getByLabelText("Notas")).toBeDisabled();
      await waitFor(() => expect(dialog.getByRole("button", { name: "Reintentar" })).toBeEnabled());
      expect(dialog.queryByRole("button", { name: SUBMIT_BUTTON })).not.toBeInTheDocument();
      expect(dialog.getByRole("button", { name: "Cancelar" })).toBeEnabled();
    });

    it("Reintentar reenvia exactamente el mismo contenido con la misma clave y, si entra, sigue el flujo normal", async () => {
      const onRegistered = jest.fn();

      renderModal(<RegisterPaymentModal onRegistered={onRegistered} saleId="sale-002" />);
      const { dialog, user } = await submitUncertain();

      paymentResponse = success();
      await retry(user);

      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

      const [first, second] = postedBodies().map((post) => post.body);

      expect(postedBodies()).toHaveLength(2);
      expect(second).toEqual(first);
      expect(first.clientRequestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      expect(onRegistered).toHaveBeenCalledTimes(1);
      // Resuelto: formulario limpio y editable, con el boton de siempre.
      expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument();
      expect(dialog.getByLabelText("Monto")).toBeEnabled();
      expect(dialog.getByLabelText("Monto")).toHaveValue("");
      expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeInTheDocument();
    });

    it("un reintento que vuelve a fallar con 500 sigue por confirmar con la misma clave", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await submitUncertain();

      await retry(user);
      await waitFor(() => expect(postedBodies()).toHaveLength(2));
      await waitFor(() => expect(dialog.getByRole("button", { name: "Reintentar" })).toBeEnabled());
      expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();

      paymentResponse = success();
      await retry(user);
      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

      const keys = postedBodies().map((post) => post.body.clientRequestId);

      expect(keys).toHaveLength(3);
      expect(new Set(keys).size).toBe(1);
    });

    it("cerrar y reabrir muestra el intento pendiente, no un formulario limpio con clave nueva", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { user } = await submitUncertain();

      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      const reopened = await openModal();

      expect(reopened.dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
      expect(reopened.dialog.getByLabelText("Monto")).toHaveValue("2");
      expect(reopened.dialog.getByLabelText("Monto")).toBeDisabled();
      expect(reopened.dialog.getByLabelText("Metodo")).toHaveValue("efectivo_usd");

      paymentResponse = success();
      await retry(reopened.user);
      expect(
        await reopened.dialog.findByText(/Pago registrado\. Saldo pendiente:/),
      ).toBeInTheDocument();

      const [first, second] = postedBodies().map((post) => post.body);

      expect(second).toEqual(first);

      // Resuelto el intento, la siguiente apertura vuelve a ser un formulario limpio.
      await reopened.user.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      const clean = await openModal();

      expect(clean.dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument();
      expect(clean.dialog.getByLabelText("Monto")).toHaveValue("");
      expect(clean.dialog.getByLabelText("Monto")).toBeEnabled();
    });

    it("el intento es del documento: otro documento sale limpio y al volver al primero sigue pendiente", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
      });
      // Como en `/payments` o en Saldos: un solo modal al que se le cambia el documento.
      const modalFor = (saleId?: string) => (
        <QueryClientProvider client={queryClient}>
          <RegisterPaymentModal
            onOpenChange={() => undefined}
            open={saleId !== undefined}
            saleId={saleId}
          />
        </QueryClientProvider>
      );

      paymentResponse = failure(500, "Fallo.");

      const { rerender } = render(modalFor("sale-002"));
      const user = userEvent.setup();
      let dialog = within(await screen.findByRole("dialog"));

      await dialog.findByText(/Saldo pendiente actual/);
      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);
      expect(await dialog.findByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();

      // El consumidor cierra (documento `undefined`) y abre otra venta.
      rerender(modalFor(undefined));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      rerender(modalFor("sale-003"));
      dialog = within(await screen.findByRole("dialog"));
      await dialog.findByText(/Saldo pendiente actual/);
      expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument();
      expect(dialog.getByLabelText("Monto")).toHaveValue("");
      expect(dialog.getByLabelText("Monto")).toBeEnabled();

      rerender(modalFor(undefined));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      rerender(modalFor("sale-002"));
      dialog = within(await screen.findByRole("dialog"));
      await dialog.findByText(/Saldo pendiente actual/);
      expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
      expect(dialog.getByLabelText("Monto")).toHaveValue("100");
      expect(dialog.getByLabelText("Monto")).toBeDisabled();

      paymentResponse = success();
      await retry(user);
      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

      const [first, second] = postedBodies().map((post) => post.body);

      expect(postedBodies()).toHaveLength(2);
      expect(second).toEqual(first);
    });

    it.each([
      ["un 400", 400],
      ["un 409 de conflicto de clave", 409],
    ])(
      "%s en el reintento es definitivo: muestra el mensaje, refresca el saldo y vuelve a editar con clave nueva",
      async (_name, status) => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await submitUncertain();

        await dialog.findByText(/Saldo pendiente actual/);

        const requestsBefore = saleRequests();

        paymentResponse = failure(status, "El pago fue rechazado.");
        await retry(user);

        expect(await dialog.findByText("El pago fue rechazado.")).toBeInTheDocument();
        expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument();
        await waitFor(() => expect(saleRequests()).toBe(requestsBefore + 1));
        expect(dialog.getByLabelText("Monto")).toBeEnabled();
        expect(dialog.getByLabelText("Monto")).toHaveValue("2");
        expect(dialog.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();

        paymentResponse = success();
        await user.clear(dialog.getByLabelText("Monto"));
        await user.type(dialog.getByLabelText("Monto"), "3");
        await waitFor(() =>
          expect(dialog.getByRole("button", { name: SUBMIT_BUTTON })).toBeEnabled(),
        );
        await submit(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(3));

        const [first, second, third] = postedBodies().map((post) => post.body);

        expect(second.clientRequestId).toBe(first.clientRequestId);
        expect(third.amount).toBe(3);
        expect(third.clientRequestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
        expect(third.clientRequestId).not.toBe(first.clientRequestId);
      },
    );

    describe("PAG-F8 · N1c: descartar un intento por confirmar", () => {
      const DISCARD = "Descartar intento";

      /**
       * PAG-F9: recién abierta, la confirmación de descarte ignora ~700 ms el clic en su
       * botón de confirmar y no lo anuncia (es de `ConfirmActionModal`): se deja pasar.
       */
      async function discardGuardSettled() {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, STEP_CLICK_GUARD_MS));
        });
      }

      it("no se ofrece antes del primer reintento fallido; tras uno que sigue incierto, sí", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await submitUncertain();

        expect(dialog.queryByRole("button", { name: DISCARD })).not.toBeInTheDocument();

        await retry(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(2));

        expect(await dialog.findByRole("button", { name: DISCARD })).toBeInTheDocument();
        expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
        expect(dialog.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      });

      it("pide confirmación con documento y monto; al confirmar refresca el saldo y vuelve a editar con clave nueva", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await submitUncertain();

        await retry(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(2));

        const discard = await dialog.findByRole("button", { name: DISCARD });

        await waitFor(() => expect(discard).toBeEnabled());
        await user.click(discard);

        let confirm = within(await screen.findByRole("dialog", { name: DISCARD }));

        expect(confirm.getByText(/Venta F-0002/)).toHaveTextContent("ref 2.00");
        expect(confirm.getByText(/quedará duplicado/)).toBeInTheDocument();

        // Cancelar no descarta nada.
        await user.click(confirm.getByRole("button", { name: "Cancelar" }));
        await waitFor(() =>
          expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
        );
        expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
        expect(dialog.getByLabelText("Monto")).toBeDisabled();

        // El pago incierto sí había entrado: el saldo fresco ya lo descuenta.
        salePaidVes = 4020;

        const requestsBefore = saleRequests();

        await user.click(dialog.getByRole("button", { name: DISCARD }));
        confirm = within(await screen.findByRole("dialog", { name: DISCARD }));
        await discardGuardSettled();
        await user.click(confirm.getByRole("button", { name: DISCARD }));

        await waitFor(() =>
          expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
        );
        await waitFor(() => expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument());
        expect(dialog.queryByText("Fallo.")).not.toBeInTheDocument();
        expect(dialog.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
        expect(dialog.queryByRole("button", { name: DISCARD })).not.toBeInTheDocument();
        expect(dialog.getByLabelText("Monto")).toBeEnabled();
        expect(dialog.getByLabelText("Monto")).toHaveValue("");
        await waitFor(() => expect(saleRequests()).toBeGreaterThan(requestsBefore));
        expect(await dialog.findByText(/Saldo pendiente actual:.*7\.455/)).toBeInTheDocument();
        // Descartar no envía nada.
        expect(postedBodies()).toHaveLength(2);

        paymentResponse = success();
        await user.type(dialog.getByLabelText("Monto"), "3");
        await submit(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(3));

        const [first, , third] = postedBodies().map((post) => post.body);

        expect(third.amount).toBe(3);
        expect(third.clientRequestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
        expect(third.clientRequestId).not.toBe(first.clientRequestId);
      });

      it("descartado el intento, cerrar y reabrir da un formulario limpio y ya no hay guardia al salir", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await submitUncertain();

        await retry(user);
        await waitFor(() => expect(postedBodies()).toHaveLength(2));

        const discard = await dialog.findByRole("button", { name: DISCARD });

        await waitFor(() => expect(discard).toBeEnabled());
        await user.click(discard);

        const confirm = within(await screen.findByRole("dialog", { name: DISCARD }));

        await discardGuardSettled();
        await user.click(confirm.getByRole("button", { name: DISCARD }));
        await waitFor(() => expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument());

        await pressFooter(user, "Cancelar");
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        const reopened = await openModal();

        expect(reopened.dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument();
        expect(reopened.dialog.getByLabelText("Monto")).toHaveValue("");
        expect(reopened.dialog.getByLabelText("Monto")).toBeEnabled();
      });
    });

    describe("PAG-F9 · doble clic que ejecuta la acción del paso siguiente", () => {
      const DISCARD = "Descartar intento";

      afterEach(() => {
        act(() => {
          jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
      });

      /** Desde aquí el reloj lo mueve el test: la espera del doble clic se mide exacta. */
      function freezeClock() {
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
      }

      function advance(ms: number) {
        act(() => {
          jest.advanceTimersByTime(ms);
        });
      }

      /** Clic en el fondo del diálogo de arriba; el cierre del modal sale en el siguiente tick. */
      function pressOutside() {
        const overlays = document.querySelectorAll("div.fixed.inset-0");

        fireEvent.pointerDown(overlays[overlays.length - 1]);
        advance(1);
      }

      /** Intento por confirmar con «Descartar intento» a la vista y ya habilitado. */
      async function openOnDiscardable() {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);

        const opened = await submitUncertain();

        await retry(opened.user);
        await waitFor(() => expect(postedBodies()).toHaveLength(2));

        const discard = await opened.dialog.findByRole("button", { name: DISCARD });

        await waitFor(() => expect(discard).toBeEnabled());
        freezeClock();

        return { ...opened, discard };
      }

      it("F2: doble clic en «Descartar intento» deja la confirmación abierta y los campos bloqueados; pasada la espera sí descarta", async () => {
        const { dialog, discard } = await openOnDiscardable();

        fireEvent.click(discard);

        const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

        // El segundo clic cae en el botón de confirmar.
        fireEvent.click(confirm.getByRole("button", { name: DISCARD }));
        await act(async () => {
          await Promise.resolve();
        });

        expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
        expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
        expect(dialog.getByLabelText("Monto")).toBeDisabled();
        // El clic ignorado no deja el botón en «Procesando...».
        expect(confirm.getByRole("button", { name: DISCARD })).toBeEnabled();

        // 300 ms: la separación más larga que midió QA.
        advance(300);
        fireEvent.click(confirm.getByRole("button", { name: DISCARD }));
        await act(async () => {
          await Promise.resolve();
        });
        expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();

        // PAG-F10: el clic ignorado rearmó la espera; cuenta desde él.
        advance(STEP_CLICK_GUARD_MS);
        fireEvent.click(confirm.getByRole("button", { name: DISCARD }));

        await waitFor(() => expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument());
        expect(dialog.getByLabelText("Monto")).toBeEnabled();
        expect(postedBodies()).toHaveLength(2);
      });

      it("F3: el segundo clic cae fuera tras «Descartar intento»: la confirmación sigue abierta; pasada la espera, clic fuera la cierra sin descartar", async () => {
        const { dialog, discard } = await openOnDiscardable();

        fireEvent.click(discard);
        // La separación típica de un doble clic (QA: 120 ms).
        advance(120);
        pressOutside();

        expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();

        advance(STEP_CLICK_GUARD_MS);
        pressOutside();
        await waitFor(() =>
          expect(screen.queryByRole("dialog", { name: DISCARD })).not.toBeInTheDocument(),
        );
        expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
        expect(dialog.getByLabelText("Monto")).toBeDisabled();
      });

      it("F3: recién registrado al reintentar, el segundo clic cae fuera y el modal sigue abierto con «Pago registrado»; pasada la espera, clic fuera cierra", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog } = await submitUncertain();
        const retryButton = dialog.getByRole("button", { name: "Reintentar" });

        await waitFor(() => expect(retryButton).toBeEnabled());
        paymentResponse = success();
        freezeClock();

        fireEvent.click(retryButton);
        // Respuesta rápida: llega en pocos milisegundos, muy por debajo de la espera.
        await dialog.findByText(/Pago registrado\. Saldo pendiente:/, undefined, { interval: 5 });
        pressOutside();

        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(dialog.getByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

        advance(STEP_CLICK_GUARD_MS);
        pressOutside();
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });

      it("el pago en 3 clics (Pagar → Completar saldo → Registrar pago) no espera: abrir el modal no arma la espera", async () => {
        freezeClock();
        renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);

        fireEvent.click(screen.getByRole("button", { name: "Pagar compra" }));

        const dialog = within(await screen.findByRole("dialog", { name: "Pagar compra" }));
        const complete = await dialog.findByRole("button", { name: "Completar saldo" });
        const submitButton = dialog.getByRole("button", { name: "Registrar pago" });

        await waitFor(() => expect(submitButton).toBeEnabled());

        // Los dos clics siguientes, seguidos y sin que corra el reloj.
        fireEvent.click(complete);
        fireEvent.click(submitButton);
        await act(async () => {
          await Promise.resolve();
        });

        expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
        expect(postedBodies()).toHaveLength(1);
        expect(postedBodies()[0].body).toEqual(
          expect.objectContaining({ amount: 20200, purchaseId: "purchase-002" }),
        );
      });

      describe("PAG-F10 · la ráfaga de clics no atraviesa la guarda", () => {
        const SUCCESS = /Pago registrado\. Saldo pendiente:/;
        const EMPTY_AMOUNT = "Indica un monto mayor a cero.";

        /** Clic de ratón completo: la pulsación llega aunque el botón esté deshabilitado. */
        function click(element: HTMLElement) {
          fireEvent.pointerDown(element);
          fireEvent.click(element);
        }

        /** Enter sobre un botón como lo entrega el navegador: clic salvo que se cancele. */
        function pressEnter(element: HTMLElement, repeat = false) {
          if (fireEvent.keyDown(element, { key: "Enter", repeat })) {
            fireEvent.click(element);
          }
        }

        async function settle() {
          await act(async () => {
            await Promise.resolve();
          });
        }

        it("R2: doble clic a 450 ms en «Descartar intento» no descarta y rearma la espera; tras el lapso en calma sí descarta", async () => {
          const { dialog, discard } = await openOnDiscardable();

          click(discard);

          const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

          advance(450);
          click(confirm.getByRole("button", { name: DISCARD }));
          await settle();
          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(dialog.getByLabelText("Monto")).toBeDisabled();

          advance(450);
          click(confirm.getByRole("button", { name: DISCARD }));
          await settle();
          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(dialog.getByLabelText("Monto")).toBeDisabled();

          advance(STEP_CLICK_GUARD_MS);
          click(confirm.getByRole("button", { name: DISCARD }));

          await waitFor(() => expect(dialog.queryByText(UNCONFIRMED_NOTICE)).not.toBeInTheDocument());
          expect(dialog.getByLabelText("Monto")).toBeEnabled();
          expect(postedBodies()).toHaveLength(2);
        });

        it("R2: clics cada 200 ms sobre «Descartar intento»: ninguno descarta", async () => {
          const { dialog, discard } = await openOnDiscardable();

          click(discard);

          const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

          for (let extra = 0; extra < 6; extra += 1) {
            advance(200);
            click(confirm.getByRole("button", { name: DISCARD }));
            await settle();
          }

          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
          expect(dialog.getByLabelText("Monto")).toBeDisabled();
        });

        it("R3: el clic a 450 ms cae fuera de la confirmación de descarte y rearma: sigue abierta", async () => {
          const { discard } = await openOnDiscardable();

          click(discard);
          advance(450);
          pressOutside();
          advance(450);
          pressOutside();

          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
        });

        it("R5: Enter mantenido sobre el confirmar de descarte no descarta", async () => {
          const { dialog, discard } = await openOnDiscardable();

          pressEnter(discard);

          const confirm = within(screen.getByRole("dialog", { name: DISCARD }));

          for (let elapsed = 0; elapsed < 1000; elapsed += 30) {
            advance(30);
            pressEnter(confirm.getByRole("button", { name: DISCARD }), true);
          }

          await settle();
          expect(screen.getByRole("dialog", { name: DISCARD })).toBeInTheDocument();
          expect(dialog.getByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
        });

        it("R4: tras un cobro correcto, los clics a 450 ms no reenvían ni tapan «Pago registrado»; pasada la espera, enviar vacío muestra el error junto al aviso", async () => {
          renderModal(<RegisterPaymentModal saleId="sale-002" />);
          const { dialog, user } = await openModal();

          await user.type(dialog.getByLabelText("Monto"), "100");

          const submitButton = dialog.getByRole("button", { name: SUBMIT_BUTTON });

          await waitFor(() => expect(submitButton).toBeEnabled());
          freezeClock();

          fireEvent.click(submitButton);
          await dialog.findByText(SUCCESS, undefined, { interval: 5 });

          advance(450);
          click(submitButton);
          await settle();
          expect(dialog.getByText(SUCCESS)).toBeInTheDocument();
          expect(dialog.queryByText(EMPTY_AMOUNT)).not.toBeInTheDocument();

          // Rearmada desde la pulsación ignorada: otros 450 ms tampoco bastan.
          advance(450);
          click(submitButton);
          await settle();
          expect(dialog.getByText(SUCCESS)).toBeInTheDocument();
          expect(dialog.queryByText(EMPTY_AMOUNT)).not.toBeInTheDocument();

          advance(STEP_CLICK_GUARD_MS);
          await waitFor(() => expect(submitButton).toBeEnabled());
          click(submitButton);

          expect(await dialog.findByText(EMPTY_AMOUNT)).toBeInTheDocument();
          expect(dialog.getByText(SUCCESS)).toBeInTheDocument();
          expect(postedBodies()).toHaveLength(1);
        });

        it("R4: el aviso «Pago registrado» del pago anterior se retira al enviar el siguiente", async () => {
          renderModal(<RegisterPaymentModal saleId="sale-002" />);
          const { dialog, user } = await openModal();

          await user.type(dialog.getByLabelText("Monto"), "100");
          await submit(user);
          expect(await dialog.findByText(SUCCESS)).toBeInTheDocument();

          paymentResponse = jsonResponse(
            { error: { code: "TEST", message: "La venta ya no admite pagos." } },
            400,
          );
          await user.type(dialog.getByLabelText("Monto"), "50");
          await submit(user);

          expect(await dialog.findByText("La venta ya no admite pagos.")).toBeInTheDocument();
          expect(dialog.queryByText(SUCCESS)).not.toBeInTheDocument();
        });
      });
    });

    describe("PAG-F8 · bajo: doble clic con respuesta rápida", () => {
      it("recién registrado el pago al reintentar, el segundo clic no borra el éxito ni envía nada", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog, user } = await submitUncertain();

        paymentResponse = success();
        await retry(user);
        expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

        // El botón que ocupa el sitio de «Reintentar» nace deshabilitado.
        const submitButton = dialog.getByRole("button", { name: SUBMIT_BUTTON });

        expect(submitButton).toBeDisabled();
        await user.click(submitButton);
        fireEvent.submit(submitButton.closest("div[role=dialog]")!.querySelector("form")!);

        expect(dialog.getByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
        expect(dialog.queryByText("Indica un monto mayor a cero.")).not.toBeInTheDocument();
        expect(postedBodies()).toHaveLength(2);

        await waitFor(() => expect(submitButton).toBeEnabled());
      });

      it("tras un envío que queda por confirmar, «Reintentar» tarda un instante en aceptar clics; «Cancelar» no", async () => {
        renderModal(<RegisterPaymentModal saleId="sale-002" />);
        const { dialog } = await submitUncertain();

        expect(dialog.getByRole("button", { name: "Reintentar" })).toBeDisabled();
        // «Cancelar» no cambia de sitio ni de función: no espera.
        expect(dialog.getByRole("button", { name: "Cancelar" })).toBeEnabled();
        await waitFor(() => expect(dialog.getByRole("button", { name: "Reintentar" })).toBeEnabled());
      });
    });

    it("con el saldo sin poder comprobarse solo hay un «Reintentar»: el del pago", async () => {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;
      let networkDown = false;

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (networkDown) {
          throw new TypeError("Failed to fetch");
        }

        return defaultFetch(url, init);
      });
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      networkDown = true;
      await submit(user);

      expect(await dialog.findByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
      expect(
        await dialog.findByText(/No se pudo comprobar el saldo pendiente/),
      ).toBeInTheDocument();
      expect(dialog.getAllByRole("button", { name: "Reintentar" })).toHaveLength(1);

      networkDown = false;
      await retry(user);
      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
      expect(postedBodies()[1].body).toEqual(postedBodies()[0].body);
    });
  });

  describe("PAG-F6 U3: respuesta que nunca llega", () => {
    it("el POST viaja con senal de aborto y, si se aborta por tiempo limite, el modal queda por confirmar con la misma clave", async () => {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;
      const signals: Array<AbortSignal | null | undefined> = [];
      let timesOut = true;

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return defaultFetch(url, init);
        }

        signals.push(init.signal);

        if (timesOut) {
          // Lo que hace `fetch` cuando la senal del tiempo limite aborta la peticion.
          throw new DOMException("The operation was aborted.", "AbortError");
        }

        return defaultFetch(url, init);
      });
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(await dialog.findByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(dialog.queryByText(/aborted/)).not.toBeInTheDocument();
      // Ya no queda bloqueado: se puede cerrar o reintentar.
      expect(dialog.getByRole("button", { name: "Cancelar" })).toBeEnabled();

      timesOut = false;
      await retry(user);
      expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
      expect(postedBodies()[1].body).toEqual(postedBodies()[0].body);
    });
  });

  describe("PAG-F6 U6: salir con el pago en vuelo o por confirmar", () => {
    const LEAVE_DIALOG = "¿Salir sin terminar?";

    beforeEach(() => {
      mockRouter.push.mockReset();
    });

    /** Enlace interno fuera del modal, como el menu lateral. */
    function withLink(modal: ReactNode) {
      return (
        <>
          <a href="/otra-pantalla" onClick={(event) => event.preventDefault()}>
            Ir a ventas
          </a>
          {modal}
        </>
      );
    }

    function clickLink() {
      // Con el modal abierto el resto de la pagina no recibe el puntero de user-event.
      fireEvent.click(screen.getByRole("link", { hidden: true, name: "Ir a ventas" }));
    }

    it("regla 14: con el formulario limpio no pregunta al salir", async () => {
      renderModal(withLink(<RegisterPaymentModal saleId="sale-002" />));
      await openModal();

      clickLink();

      expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();
      expect(postedBodies()).toHaveLength(0);
    });

    it("regla 14: tras cerrar el modal sin intento pendiente no pregunta al salir", async () => {
      renderModal(withLink(<RegisterPaymentModal saleId="sale-002" />));
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      // CNF-15: con el monto tecleado, cerrar pregunta; «Salir» lo descarta y cierra.
      await user.click(
        within(await screen.findByRole("dialog", { name: LEAVE_DIALOG })).getByRole("button", {
          name: "Salir",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      clickLink();

      expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();
      expect(postedBodies()).toHaveLength(0);
    });

    it("regla 14: tras un pago con éxito no pregunta al salir, ni abierto ni ya cerrado", async () => {
      renderModal(withLink(<RegisterPaymentModal saleId="sale-002" />));
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);
      expect(await screen.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
      clickLink();
      expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      clickLink();

      expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();
    });

    it("CNF-15: con el formulario limpio no pregunta al salir; a medio llenar pregunta nombrando el cobro", async () => {
      renderModal(withLink(<RegisterPaymentModal saleId="sale-002" />));
      const { dialog, user } = await openModal();

      clickLink();
      expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();

      await user.type(dialog.getByLabelText("Monto"), "100");
      clickLink();

      const leaveDialog = await screen.findByRole("dialog", { name: LEAVE_DIALOG });

      expect(leaveDialog).toHaveTextContent(/Cobro de Bs\S* 100,00 a Maria Perez sin registrar/);
      expect(leaveDialog).not.toHaveTextContent("Cobro en curso");
      await user.click(within(leaveDialog).getByRole("button", { name: "Seguir aquí" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument(),
      );
      expect(dialog.getByLabelText("Monto")).toHaveValue("100");
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it("con el POST en vuelo pregunta antes de salir y deja de hacerlo al registrarse el pago", async () => {
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
      renderModal(withLink(<RegisterPaymentModal saleId="sale-002" />));
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);
      await waitFor(() => expect(postedBodies()).toHaveLength(1));
      clickLink();

      const leaveDialog = within(await screen.findByRole("dialog", { name: LEAVE_DIALOG }));

      expect(leaveDialog.getByText("Cobro en curso")).toBeInTheDocument();
      await user.click(leaveDialog.getByRole("button", { name: "Seguir aquí" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument(),
      );
      expect(mockRouter.push).not.toHaveBeenCalled();

      await act(async () => {
        resolvePost(paymentResponse);
      });
      expect(await screen.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();

      // Regla 14: terminado el proceso, el guardia se desactiva.
      clickLink();
      expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();
    });

    it("con un intento por confirmar pregunta antes de salir; con el modal cerrado, no", async () => {
      paymentResponse = jsonResponse({ error: { code: "INTERNAL", message: "Fallo." } }, 500);
      renderModal(withLink(<RegisterPaymentModal purchaseId="purchase-002" />));
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);
      expect(await dialog.findByText(UNCONFIRMED_NOTICE)).toBeInTheDocument();
      clickLink();

      const leaveDialog = within(await screen.findByRole("dialog", { name: LEAVE_DIALOG }));

      expect(leaveDialog.getByText("Pago en curso")).toBeInTheDocument();
      await user.click(leaveDialog.getByRole("button", { name: "Seguir aquí" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument(),
      );

      await user.click(await screen.findByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      clickLink();
      expect(screen.queryByRole("dialog", { name: LEAVE_DIALOG })).not.toBeInTheDocument();
    });
  });

  describe("PAG-F6 bajos", () => {
    it("un 400 de validacion muestra tambien el primer motivo que viene en español", async () => {
      paymentResponse = jsonResponse(
        {
          error: {
            code: "BAD_REQUEST",
            issues: [
              { code: "invalid_type", message: "Invalid input: expected number", path: ["amount"] },
              {
                code: "too_big",
                message: "El texto no puede superar 2000 caracteres.",
                path: ["notes"],
              },
            ],
            message: "La solicitud no tiene un formato valido.",
          },
        },
        400,
      );
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect(
        await dialog.findByText(
          "La solicitud no tiene un formato valido. El texto no puede superar 2000 caracteres.",
        ),
      ).toBeInTheDocument();
      expect(dialog.queryByText(/Invalid input/)).not.toBeInTheDocument();
    });

    it("si los metodos habilitados no cargan lo avisa en vez de ofrecerlos todos en silencio", async () => {
      const defaultFetch = fetchMock.getMockImplementation() as (
        url: string,
        init?: RequestInit,
      ) => Promise<Response>;

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        String(url).includes("/api/settings/payment-methods")
          ? jsonResponse({ error: { code: "INTERNAL", message: "Sin ajustes." } }, 500)
          : defaultFetch(url, init),
      );
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog } = await openModal();

      expect(
        await dialog.findByText(
          "No se pudieron cargar los métodos de pago habilitados de la tienda. Se muestran todos: confirma que el método elegido esté habilitado.",
        ),
      ).toBeInTheDocument();
    });

    it("con los metodos cargados no hay aviso de metodos", async () => {
      renderModal(<RegisterPaymentModal saleId="sale-002" />);
      const { dialog } = await openModal();

      expect(
        dialog.queryByText(/No se pudieron cargar los métodos de pago/),
      ).not.toBeInTheDocument();
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
