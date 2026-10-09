/**
 * DET-06b · cajas: la lista no tiene búsqueda, filtros ni paginación (sin estado
 * que conservar en la URL); sus enlaces al detalle son enlaces reales con la
 * ruta de la lista en `returnTo`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  usePathname: () => "/cash/registers",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { CashRegistersListPage } from "./page";

function register(id: string) {
  return {
    assignedUserId: null,
    assignedUserName: null,
    createdAt: "2026-01-15T12:00:00.000Z",
    id,
    isActive: true,
    name: `Caja ${id}`,
    storeId: "store-1",
    updatedAt: "2026-01-15T12:00:00.000Z",
  };
}

describe("CashRegistersListPage · enlaces al detalle (DET-06b)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/cash/registers");
    // jsdom no trae matchMedia; la tabla de escritorio es la que tiene el menú de fila.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url).split("?")[0];
      const data =
        path === "/api/cash/registers"
          ? [register("001"), register("002")]
          : path === "/api/users"
            ? { items: [], limit: 100, skip: 0, total: 0 }
            : [];

      return {
        headers: { get: () => "application/json" },
        json: async () => ({ data }),
        ok: true,
        status: 200,
      };
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <CashRegistersListPage />
      </QueryClientProvider>,
    );
  }

  it("el nombre de la caja es un enlace al detalle con la lista en returnTo", async () => {
    renderPage();

    const link = await screen.findByRole("link", { name: "Caja 001" });

    expect(link).toHaveAttribute("href", "/cash/registers/001?returnTo=%2Fcash%2Fregisters");
  });

  it("«Ver detalle» del menú de fila lleva el mismo returnTo", async () => {
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Acciones de Caja 002" }));

    expect(await screen.findByRole("menuitem", { name: "Ver detalle" })).toHaveAttribute(
      "href",
      "/cash/registers/002?returnTo=%2Fcash%2Fregisters",
    );
  });

  it("parámetros que la pantalla no usa (`page=9999`, `sort`) no la rompen ni se cuelan en el retorno", async () => {
    window.history.replaceState(null, "", "/cash/registers?page=9999&sort=cualquiera");
    renderPage();

    expect(await screen.findByRole("link", { name: "Caja 001" })).toHaveAttribute(
      "href",
      "/cash/registers/001?returnTo=%2Fcash%2Fregisters",
    );
    expect(screen.getAllByText("Caja 002").length).toBeGreaterThan(0);
  });
});
