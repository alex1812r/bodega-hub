/** DET-06b · detalle de tienda: "Volver" respeta `returnTo` y sus usuarios enlazan con retorno a la tienda. */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

const mockNavigation = { query: "" };

jest.mock("next/navigation", () => ({
  usePathname: () => "/platform/stores/s-1",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockNavigation.query),
}));

import { withReturnTo } from "../../../shared/utils/returnTo";
import { StoreDetailPage } from "./page";

describe("StoreDetailPage · Volver y enlaces (DET-06b)", () => {
  beforeEach(() => {
    mockNavigation.query = "";
    global.fetch = jest.fn(async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({
        data: {
          createdAt: "2026-01-15T12:00:00.000Z",
          id: "s-1",
          name: "Tienda Uno",
          slug: "uno",
          status: "active",
          users: [{ email: "ana@demo.test", id: "u-1", isActive: true, name: "Ana", role: "admin" }],
          usersCount: 1,
        },
      }),
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;
  });

  function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <StoreDetailPage id="s-1" />
      </QueryClientProvider>,
    );
  }

  it("sin returnTo vuelve a la lista de tiendas", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a tiendas" })).toHaveAttribute(
      "href",
      "/platform/stores",
    );
  });

  it("con returnTo vuelve a la URL exacta de la lista de origen", async () => {
    const listUrl = "/platform/stores?search=uno&status=active";

    mockNavigation.query = withReturnTo("/platform/stores/s-1", listUrl).split("?")[1];
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a tiendas" })).toHaveAttribute(
      "href",
      listUrl,
    );
  });

  it("un returnTo externo se ignora", async () => {
    mockNavigation.query = "returnTo=%2F%2Fevil.com";
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a tiendas" })).toHaveAttribute(
      "href",
      "/platform/stores",
    );
  });

  it("cada usuario de la tienda enlaza a su detalle con retorno a esta tienda", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Ana" })).toHaveAttribute(
      "href",
      "/platform/users/u-1?returnTo=%2Fplatform%2Fstores%2Fs-1",
    );
  });
});
