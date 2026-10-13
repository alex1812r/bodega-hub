/** DET-06b · detalle de usuario: "Volver" respeta `returnTo` y la tienda enlaza con retorno al usuario. */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

const mockNavigation = { query: "" };

jest.mock("next/navigation", () => ({
  usePathname: () => "/platform/users/u-1",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockNavigation.query),
}));

import { withReturnTo } from "../../../shared/utils/returnTo";
import { PlatformUserDetailPage } from "./page";

describe("PlatformUserDetailPage · Volver y enlaces (DET-06b)", () => {
  beforeEach(() => {
    mockNavigation.query = "";
    global.fetch = jest.fn(async () => ({
      headers: { get: () => "application/json" },
      json: async () => ({
        data: {
          deniedPermissions: [],
          email: "ana@demo.test",
          grantedPermissions: [],
          id: "u-1",
          isActive: true,
          name: "Ana",
          role: "admin",
          store: { id: "s-1", name: "Tienda Uno", slug: "uno" },
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
        <PlatformUserDetailPage id="u-1" />
      </QueryClientProvider>,
    );
  }

  it("sin returnTo vuelve a la lista de usuarios", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a usuarios" })).toHaveAttribute(
      "href",
      "/platform/users",
    );
  });

  it("con returnTo vuelve a la URL exacta de la lista de origen", async () => {
    const listUrl = "/platform/users?search=ana&role=admin";

    mockNavigation.query = withReturnTo("/platform/users/u-1", listUrl).split("?")[1];
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a usuarios" })).toHaveAttribute(
      "href",
      listUrl,
    );
  });

  it("un returnTo externo se ignora", async () => {
    mockNavigation.query = "returnTo=%2F%2Fevil.com";
    renderPage();

    expect(await screen.findByRole("link", { name: "Volver a usuarios" })).toHaveAttribute(
      "href",
      "/platform/users",
    );
  });

  it("la tienda del usuario enlaza a su detalle con retorno a este usuario", async () => {
    renderPage();

    expect(await screen.findByRole("link", { name: "Tienda Uno" })).toHaveAttribute(
      "href",
      "/platform/stores/s-1?returnTo=%2Fplatform%2Fusers%2Fu-1",
    );
  });
});
