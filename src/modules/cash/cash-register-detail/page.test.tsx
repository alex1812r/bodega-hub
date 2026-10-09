/** DET-06b · detalle de caja: "Volver" respeta `returnTo` y cae a la lista de cajas. */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

const mockNavigation = { query: "" };
/** Turnos que devuelve `/sessions`; cada prueba pone los suyos. */
let mockSessions: unknown[] = [];

jest.mock("next/navigation", () => ({
  usePathname: () => "/cash/registers/r-1",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockNavigation.query),
}));

import { withReturnTo } from "../../../shared/utils/returnTo";
import { CashRegisterDetailPage } from "./page";

describe("CashRegisterDetailPage · Volver (DET-06b)", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    mockNavigation.query = "";
    mockSessions = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    global.fetch = jest.fn(async (url: string) => ({
      headers: { get: () => "application/json" },
      json: async () => ({
        data: String(url).endsWith("/sessions")
          ? mockSessions
          : {
              createdAt: "2026-01-15T12:00:00.000Z",
              id: "r-1",
              isActive: true,
              name: "Caja principal",
              storeId: "store-1",
              updatedAt: "2026-01-15T12:00:00.000Z",
            },
      }),
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <CashRegisterDetailPage id="r-1" />
      </QueryClientProvider>,
    );
  }

  it("sin returnTo vuelve a la lista de cajas", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a cajas" })).toHaveAttribute(
      "href",
      "/cash/registers",
    );
  });

  it("con returnTo vuelve a la URL de origen", async () => {
    mockNavigation.query = withReturnTo("/cash/registers/r-1", "/cash/closures?page=2").split("?")[1];
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a cajas" })).toHaveAttribute(
      "href",
      "/cash/closures?page=2",
    );
  });

  it("un returnTo externo se ignora", async () => {
    mockNavigation.query = "returnTo=https%3A%2F%2Fevil.com";
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a cajas" })).toHaveAttribute(
      "href",
      "/cash/registers",
    );
  });

  describe("diferencia de un cierre (CNF-13)", () => {
    const register = { id: "r-1", isActive: true, name: "Caja principal" };

    function closedSession(theoretical: { ref: number | null; ves: number | null }) {
      return {
        closedAt: "2026-01-15T22:00:00.000Z",
        closingRef: 10,
        closingVes: 900.1,
        id: "s-1",
        openedAt: "2026-01-15T12:00:00.000Z",
        openingRef: 0,
        openingVes: 0,
        register,
        registerId: "r-1",
        status: "closed",
        theoreticalClosingRef: theoretical.ref,
        theoreticalClosingVes: theoretical.ves,
      };
    }

    it("sin teórico dice «Teórico no disponible» y no inventa una diferencia", async () => {
      mockSessions = [closedSession({ ref: null, ves: null })];
      renderPage();

      expect(await screen.findByText("Teórico no disponible")).toBeInTheDocument();
      expect(screen.queryByText("Cuadrada")).not.toBeInTheDocument();
    });

    it("con teórico igual al contado muestra «Cuadrada»", async () => {
      mockSessions = [closedSession({ ref: 10, ves: 900.1 })];
      renderPage();

      expect(await screen.findByText("Cuadrada")).toBeInTheDocument();
      expect(screen.queryByText("Teórico no disponible")).not.toBeInTheDocument();
    });

    it("con teórico distinto muestra la diferencia contado − teórico", async () => {
      mockSessions = [closedSession({ ref: 10, ves: 1000.3 })];
      renderPage();

      expect(await screen.findByText(/[-−].*100,20/)).toBeInTheDocument();
      expect(screen.queryByText("Teórico no disponible")).not.toBeInTheDocument();
    });
  });
});
