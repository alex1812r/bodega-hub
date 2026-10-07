/**
 * SHR-19 M4 · en el detalle de pago, el rechazo de «Anular pago» se ve dentro del modal
 * de confirmacion (que sigue abierto para reintentar), no detras, y no deja promesas
 * sin capturar.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, role: "admin" }),
}));
jest.mock("../components/RegisterPaymentModal", () => ({
  RegisterPaymentModal: () => null,
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

import { PaymentDetailsPage } from "./page";

const REJECTION = "El pago pertenece a una caja ya cerrada y transferida.";

function payment(status: "activo" | "anulado" = "activo") {
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
  };
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

  beforeEach(() => {
    currentStatus = "activo";
    cancelResponse = async () =>
      jsonResponse({ error: { code: "CONFLICT", message: REJECTION } }, 409);
    unhandled.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return cancelResponse();
      }

      return jsonResponse({ data: payment(currentStatus) });
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

    return within(await screen.findByRole("dialog"));
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
