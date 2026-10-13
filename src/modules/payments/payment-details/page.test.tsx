/**
 * SHR-19 M4 · en el detalle de pago, el rechazo de «Anular pago» se ve dentro del modal
 * de confirmacion (que sigue abierto para reintentar), no detras, y no deja promesas
 * sin capturar.
 *
 * PAG-F2 · «Volver» de la cabecera regresa a la lista de origen que viaja en `returnTo`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Query de la URL del detalle, la que lee «Volver». */
let mockSearch = "";
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("next/navigation", () => ({
  usePathname: () => "/payments/pay-001",
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, role: "admin" }),
}));
jest.mock("../components/RegisterPaymentModal", () => ({
  RegisterPaymentModal: ({ purchaseId, saleId }: { purchaseId?: string; saleId?: string }) => (
    <output data-testid="register-payment-modal">{JSON.stringify({ purchaseId, saleId })}</output>
  ),
}));
jest.mock("./components/PaymentDetailPageHeader", () => ({
  PaymentDetailPageHeader: () => null,
}));
jest.mock("./components/PaymentDetailInfoCard", () => ({
  PaymentDetailInfoCard: () => null,
}));
jest.mock("./components/PaymentDetailBalanceCard", () => ({
  PaymentDetailBalanceCard: () => null,
}));

import { computePaymentImpact } from "../services/paymentImpact";
import { PaymentDetailsPage } from "./page";

const REJECTION = "El pago pertenece a una caja ya cerrada y transferida.";

function payment(
  status: "activo" | "anulado" = "activo",
  overrides: Record<string, unknown> = {},
) {
  return {
    amount: 100,
    amountRef: 0.2,
    amountVes: 100,
    contactId: "cont-customer",
    createdAt: "2026-10-06T13:32:00.000Z",
    currency: "VES",
    direction: "entrada",
    id: "pay-001",
    method: "efectivo_ves",
    refRateVes: 510,
    saleId: "sale-002",
    status,
    ...overrides,
  };
}

/** Impact que serviría el endpoint para un cobro en efectivo de la caja abierta «Caja 1». */
function cancelImpact(paymentId: string) {
  return computePaymentImpact({
    action: "cancel",
    canCancelPayments: true,
    document: {
      contactName: "Cliente Demo",
      id: "sale-002",
      kind: "sale",
      number: "V-000002",
      paidVes: 100,
      status: "pagada",
      totalVes: 100,
    },
    ledger: {
      cashMovements: [
        {
          amountRef: 0,
          amountVes: 100,
          registerName: "Caja 1",
          sessionStatus: "open",
          type: "sale_in",
          vaultTransferredAt: null,
        },
      ],
      kind: "full",
      vault: null,
      vaultMovements: [],
    },
    payment: {
      amount: 100,
      amountRef: 0.2,
      amountVes: 100,
      changeMethod: null,
      changeRef: 0,
      changeVes: 0,
      currency: "VES",
      id: paymentId,
      method: "efectivo_ves",
      status: "activo",
    },
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("PaymentDetailsPage · anular pago", () => {
  const fetchMock = jest.fn();
  const unhandled = jest.fn();
  let cancelResponse: () => Promise<Response>;
  let currentStatus: "activo" | "anulado";
  let paymentOverrides: Record<string, unknown>;

  beforeEach(() => {
    currentStatus = "activo";
    paymentOverrides = {};
    cancelResponse = async () =>
      jsonResponse({ error: { code: "CONFLICT", message: REJECTION } }, 409);
    unhandled.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return cancelResponse();
      }

      if (String(url).startsWith("/api/payments/pay-001/impact")) {
        return jsonResponse({ data: cancelImpact("pay-001") });
      }

      return jsonResponse({ data: payment(currentStatus, paymentOverrides) });
    });
    global.fetch = fetchMock;
    process.on("unhandledRejection", unhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
  });

  function cancelCalls() {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      .map(([url]) => String(url));
  }

  async function openCancelModal(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Anular pago" }));
    await screen.findByRole("dialog");
    // El modal calcula primero el efecto; el botón de anular llega con él.
    await screen.findByRole("button", { name: "Anular pago" });

    return within(screen.getByRole("dialog"));
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <PaymentDetailsPage paymentId="pay-001" />
      </QueryClientProvider>,
    );
  }

  describe("PAG-03b · «Registrar otro pago» siempre lleva el documento del pago", () => {
    it("pago de una venta: el modal recibe esa venta", async () => {
      renderPage();

      expect(await screen.findByTestId("register-payment-modal")).toHaveTextContent(
        JSON.stringify({ saleId: "sale-002" }),
      );
    });

    it("pago de una compra: el modal recibe esa compra", async () => {
      paymentOverrides = { direction: "salida", purchaseId: "purchase-002", saleId: undefined };
      renderPage();

      expect(await screen.findByTestId("register-payment-modal")).toHaveTextContent(
        JSON.stringify({ purchaseId: "purchase-002" }),
      );
    });

    it("pago sin venta ni compra: no se ofrece el modal (no hay documento que pagar)", async () => {
      paymentOverrides = { saleId: undefined };
      renderPage();

      await screen.findByRole("button", { name: "Anular pago" });

      expect(screen.queryByTestId("register-payment-modal")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Registrar otro pago" })).toBeDisabled();
    });

    it("pago anulado: no se ofrece el modal", async () => {
      currentStatus = "anulado";
      renderPage();

      expect(await screen.findByRole("button", { name: "Registrar otro pago" })).toBeDisabled();
      expect(screen.queryByTestId("register-payment-modal")).not.toBeInTheDocument();
    });
  });

  it("CNF-06: confirma con el efecto de ese pago y cancelar no anula nada", async () => {
    const user = userEvent.setup();

    renderPage();
    const dialog = await openCancelModal(user);

    expect(
      fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/impact")),
    ).toEqual(["/api/payments/pay-001/impact?action=cancel"]);
    expect(dialog.getByText("Sale de la caja «Caja 1»: −Bs. 100,00")).toBeInTheDocument();
    expect(dialog.getByText("Pendiente de pago")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cancelCalls()).toEqual([]);
  });

  it("muestra el rechazo del servidor dentro del modal, que sigue abierto para reintentar", async () => {
    const user = userEvent.setup();

    renderPage();
    const dialog = await openCancelModal(user);

    await user.click(dialog.getByRole("button", { name: "Anular pago" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(REJECTION);
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    expect(cancelCalls()).toEqual(["/api/payments/pay-001/cancel"]);
    // El mensaje vive solo en el modal, no repetido detras.
    expect(screen.getAllByText(REJECTION)).toHaveLength(1);

    // Reintento: ahora el servidor acepta, el modal se cierra y el pago queda anulado.
    currentStatus = "anulado";
    cancelResponse = async () => jsonResponse({ data: payment("anulado") });
    await user.click(dialog.getByRole("button", { name: "Anular pago" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cancelCalls()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();
  });

  it("un corte de red tambien se ve dentro del modal y no deja una promesa sin capturar", async () => {
    const user = userEvent.setup();

    cancelResponse = async () => {
      throw new TypeError("Failed to fetch");
    };
    renderPage();
    const dialog = await openCancelModal(user);

    await user.click(dialog.getByRole("button", { name: "Anular pago" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Failed to fetch");
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("el error no reaparece al cancelar y volver a abrir el modal", async () => {
    const user = userEvent.setup();

    renderPage();
    const dialog = await openCancelModal(user);

    await user.click(dialog.getByRole("button", { name: "Anular pago" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(REJECTION);

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // El detalle sigue ahi, sin el rechazo pintado detras.
    expect(screen.queryByText(REJECTION)).not.toBeInTheDocument();

    const reopened = await openCancelModal(user);

    expect(reopened.queryByRole("alert")).not.toBeInTheDocument();
    expect(reopened.getByRole("button", { name: "Anular pago" })).toBeEnabled();
  });

  it("al anular con exito hace un unico PATCH y cierra el modal", async () => {
    const user = userEvent.setup();

    cancelResponse = async () => jsonResponse({ data: payment("anulado") });
    renderPage();
    const dialog = await openCancelModal(user);

    currentStatus = "anulado";
    await user.click(dialog.getByRole("button", { name: "Anular pago" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cancelCalls()).toEqual(["/api/payments/pay-001/cancel"]);
    expect(screen.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
  });
});

// PAG-F6 U2: un re-pedido fallido sustituia todo el detalle (y el modal de «Registrar
// otro pago» abierto) por la pantalla de error, aunque el pago ya estuviera cargado.
describe("PaymentDetailsPage · re-pedido fallido (PAG-F6 U2)", () => {
  const serverFailure = async () =>
    jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Fallo interno." } }, 500);

  function renderWithClient() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentDetailsPage paymentId="pay-001" />
      </QueryClientProvider>,
    );

    return queryClient;
  }

  it("con el pago cargado, si un re-pedido responde 500 el detalle y el modal siguen montados", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ data: payment() })) as unknown as typeof fetch;

    const queryClient = renderWithClient();

    expect(await screen.findByTestId("register-payment-modal")).toBeInTheDocument();

    global.fetch = jest.fn(serverFailure) as unknown as typeof fetch;
    await act(async () => {
      await queryClient.refetchQueries();
      // React Query avisa a la pantalla en una tarea posterior al fallo.
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(global.fetch).toHaveBeenCalled();
    expect(queryClient.getQueryState(["payments", "detail", "pay-001"])?.status).toBe("error");
    expect(screen.getByTestId("register-payment-modal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anular pago" })).toBeInTheDocument();
    expect(screen.queryByText("No pudimos cargar el pago")).not.toBeInTheDocument();
  });

  it("sin pago cargado sigue mostrando la pantalla de error", async () => {
    global.fetch = jest.fn(serverFailure) as unknown as typeof fetch;
    renderWithClient();

    expect(await screen.findByText("No pudimos cargar el pago")).toBeInTheDocument();
    expect(screen.getByText("Fallo interno.")).toBeInTheDocument();
    expect(screen.queryByTestId("register-payment-modal")).not.toBeInTheDocument();
  });
});

describe("PaymentDetailPageHeader · «Volver» (PAG-F2)", () => {
  // El resto del archivo sustituye la cabecera por un doble: aqui se pinta la real.
  const { PaymentDetailPageHeader } = jest.requireActual<
    typeof import("./components/PaymentDetailPageHeader")
  >("./components/PaymentDetailPageHeader");
  const PAYMENTS_LIST = "/payments?from=2026-05-01&method=pago_movil&page=2";

  afterEach(() => {
    mockSearch = "";
  });

  function backHref(search: string) {
    mockSearch = search;
    render(<PaymentDetailPageHeader />);

    return screen.getByRole("link", { name: "Volver" }).getAttribute("href");
  }

  it("con returnTo vuelve a la URL exacta de la lista de origen", () => {
    expect(backHref(`returnTo=${encodeURIComponent(PAYMENTS_LIST)}`)).toBe(PAYMENTS_LIST);
  });

  it("sin returnTo vuelve al listado de pagos", () => {
    expect(backHref("")).toBe("/payments");
  });

  it.each(["https://evil.example/payments", "//evil.example", "/api/payments"])(
    "no sigue un returnTo que no es una ruta interna segura (%s)",
    (returnTo) => {
      expect(backHref(`returnTo=${encodeURIComponent(returnTo)}`)).toBe("/payments");
    },
  );
});
