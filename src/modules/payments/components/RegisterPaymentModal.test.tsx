import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

    await user.type(dialog.getByLabelText("Monto"), "999999");
    await submit(user);

    expect(
      await dialog.findByText("El pago excede el saldo pendiente de la venta."),
    ).toBeInTheDocument();
  });
});
