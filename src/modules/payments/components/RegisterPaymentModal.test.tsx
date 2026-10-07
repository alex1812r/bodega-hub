import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { VENEZUELAN_BANKS } from "@/shared/venezuela/banks";

import { RegisterPaymentModal } from "./RegisterPaymentModal";

const BANK = VENEZUELAN_BANKS[0];

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

  beforeEach(() => {
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
          data: { id: "sale-002", paidVes: 3000, refRateVes: 510, totalVes: 11475 },
        });
      }

      if (String(url).includes("/api/purchases/")) {
        return jsonResponse({
          data: { id: "purchase-002", paidVes: 0, refRateVes: 500, totalVes: 20200 },
        });
      }

      return jsonResponse({ data: null });
    });
    global.fetch = fetchMock;
  });

  async function openModal() {
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Registrar pago" }));

    const dialog = await screen.findByRole("dialog");

    await within(dialog).findByText(/Saldo pendiente actual/);

    return { dialog: within(dialog), user };
  }

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
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
      currency: "VES",
      method: "efectivo_ves",
      saleId: "sale-002",
    });
  });

  it("sin documento elegido no ofrece atajos de saldo", async () => {
    const user = userEvent.setup();

    renderModal(<RegisterPaymentModal />);
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));

    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.getByLabelText("ID venta")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Completar saldo" })).not.toBeInTheDocument();
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

    it("una compra en USD solo avisa: el servidor convierte con la tasa del dia, no la de la compra", async () => {
      renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
      const { dialog, user } = await openModal();

      await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
      await user.type(dialog.getByLabelText("Monto"), "45");
      expect(dialog.getByRole("status")).toHaveTextContent(/El monto supera el saldo pendiente/);
      await submit(user);

      expect((await expectSinglePost()).body).toMatchObject({ amount: 45, currency: "USD" });
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

      await user.click(screen.getByRole("button", { name: "Registrar pago" }));

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
        expect(dialog.getByRole("button", { name: "Registrar pago" })).toBeDisabled();

        await act(async () => {
          resolveDocument(loaded as Response);
        });

        expect(await dialog.findByText(/Saldo pendiente actual/)).toBeInTheDocument();
        expect(dialog.queryByText("Cargando saldo pendiente...")).not.toBeInTheDocument();
        expect(dialog.getByRole("button", { name: "Registrar pago" })).toBeEnabled();

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
      expect(dialog.getByRole("button", { name: "Registrar pago" })).toBeEnabled();

      await user.type(dialog.getByLabelText("Monto"), "100");
      await submit(user);

      expect((await expectSinglePost()).body).toEqual({
        amount: 100,
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

    it("si la carga de la compra se corta avisa con el mensaje del fallo", async () => {
      replyToDocumentWith("/api/purchases/", async () => {
        throw new TypeError("Failed to fetch");
      });

      renderModal(<RegisterPaymentModal purchaseId="purchase-002" />);
      const { dialog } = await openModalWithoutBalance();

      const alert = await dialog.findByRole("alert");

      expect(alert).toHaveTextContent("No se pudo comprobar el saldo pendiente");
      expect(alert).toHaveTextContent("Failed to fetch");
      expect(dialog.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(dialog.getByRole("button", { name: "Registrar pago" })).toBeEnabled();
    });
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
        currency: "USD",
        method: "efectivo_usd",
        saleId: "sale-002",
      });
    });

    it("sin tasa para convertir, el monto tecleado en Bs se vacia", async () => {
      const releaseMethods = holdPaymentMethods();
      const user = userEvent.setup();

      renderModal(<RegisterPaymentModal />);
      await user.click(screen.getByRole("button", { name: "Registrar pago" }));

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
        currency: "VES",
        method: "efectivo_ves",
        saleId: "sale-002",
      });
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
