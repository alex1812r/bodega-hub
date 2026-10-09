/** DET-06b · detalle de caja: "Volver" respeta `returnTo` y cae a la lista de cajas. */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

const mockNavigation = { query: "" };

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
          ? []
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
});
