/**
 * SHR-19 M4 · el rechazo de «Anular pago» se ve dentro del modal de confirmacion
 * (que sigue abierto para reintentar), no detras, y no deja promesas sin capturar.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, role: "admin" }),
}));
jest.mock("./components/PaymentsExportActions", () => ({
  PaymentsExportActions: () => null,
}));
jest.mock("./components/PaymentsListFilters", () => ({
  PaymentsListFilters: () => null,
}));
jest.mock("../components/RegisterPaymentModal", () => ({
  RegisterPaymentModal: () => null,
}));

import { PaymentsListPage } from "./page";

const REJECTION = "El pago pertenece a una caja ya cerrada y transferida.";

function payment(id: string) {
  return {
    amount: 100,
    amountRef: 0.2,
    amountVes: 100,
    contactId: "cont-customer",
    createdAt: "2026-10-06T13:32:00.000Z",
    currency: "VES",
    direction: "entrada",
    id,
    method: "efectivo_ves",
    refRateVes: 510,
    saleId: "sale-002",
    status: "activo",
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

describe("PaymentsListPage · anular pago", () => {
  const fetchMock = jest.fn();
  const unhandled = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let cancelResponse: () => Promise<Response>;

  beforeEach(() => {
    // jsdom no trae matchMedia; la tabla de escritorio es la que tiene el menu de fila.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    cancelResponse = async () =>
      jsonResponse({ error: { code: "CONFLICT", message: REJECTION } }, 409);
    unhandled.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return cancelResponse();
      }

      return jsonResponse({
        data: { items: [payment("pay-001"), payment("pay-002")], limit: 10, skip: 0, total: 2 },
      });
    });
    global.fetch = fetchMock;
    process.on("unhandledRejection", unhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function cancelCalls() {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      .map(([url]) => String(url));
  }

  async function openCancelModal(user: ReturnType<typeof userEvent.setup>, row: number) {
    const menus = await screen.findAllByRole("button", { name: /acciones/i });

    await user.click(menus[row]);
    await user.click(await screen.findByRole("menuitem", { name: "Anular" }));

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
        <PaymentsListPage />
      </QueryClientProvider>,
    );
  }

  it("muestra el rechazo del servidor dentro del modal, que sigue abierto para reintentar", async () => {
    const user = userEvent.setup();

    renderPage();
    const dialog = await openCancelModal(user, 0);

    await user.click(dialog.getByRole("button", { name: "Anular pago" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(REJECTION);
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    expect(cancelCalls()).toEqual(["/api/payments/pay-001/cancel"]);

    // Reintento: ahora el servidor acepta y el modal se cierra.
    cancelResponse = async () => jsonResponse({ data: { ...payment("pay-001"), status: "anulado" } });
    await user.click(dialog.getByRole("button", { name: "Anular pago" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cancelCalls()).toHaveLength(2);
  });

  it("un corte de red tambien se ve dentro del modal y no deja una promesa sin capturar", async () => {
    const user = userEvent.setup();

    cancelResponse = async () => {
      throw new TypeError("Failed to fetch");
    };
    renderPage();
    const dialog = await openCancelModal(user, 0);

    await user.click(dialog.getByRole("button", { name: "Anular pago" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Failed to fetch");
    await settle();
    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("el error de un pago no reaparece al cancelar y abrir el modal para otro pago", async () => {
    const user = userEvent.setup();

    renderPage();
    const dialog = await openCancelModal(user, 0);

    await user.click(dialog.getByRole("button", { name: "Anular pago" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(REJECTION);

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // La lista sigue ahi (el fallo de la anulacion no la sustituye por un error).
    expect(screen.queryByText(REJECTION)).not.toBeInTheDocument();

    const reopened = await openCancelModal(user, 1);

    expect(reopened.queryByRole("alert")).not.toBeInTheDocument();
    expect(reopened.getByRole("button", { name: "Anular pago" })).toBeEnabled();
  });
});
