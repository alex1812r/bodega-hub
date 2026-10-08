/**
 * PRO-F11 · el detalle pide enteras sus listas de referencia: sin `limit` el
 * BFF entrega 10 y la categoría 11.ª o el proveedor 11.º no aparecían.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  usePathname: () => "/products/p-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

import { ProductDetailsPage } from "./page";

const product = {
  categoryId: "cat-1",
  currentCostRef: 10,
  currentStock: 10,
  id: "p-1",
  isActive: true,
  minStock: 2,
  name: "Arroz",
  salePriceRef: 12,
  sku: "arroz",
};

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

describe("ProductDetailsPage · listas de referencia completas (PRO-F11)", () => {
  const originalMatchMedia = window.matchMedia;
  let requests: string[];

  beforeEach(() => {
    requests = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(`${url.pathname}${url.search}`);

      return url.pathname === "/api/products/p-1"
        ? jsonResponse({ data: product })
        : jsonResponse({ data: { items: [], limit: 100, skip: 0, total: 0 } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("pide categorías y proveedores del producto con el tope de página", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProductDetailsPage productId="p-1" />
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText("Arroz")).not.toHaveLength(0);
    await waitFor(() =>
      expect(requests).toEqual(
        expect.arrayContaining([
          "/api/categories?limit=100&skip=0",
          "/api/products/p-1/suppliers?limit=100",
        ]),
      ),
    );
  });
});
