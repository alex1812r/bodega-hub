/**
 * DET-F1 · "Ver movimientos de inventario" solo se pinta con `inventory.view`.
 * DET-F2 · el detalle de producto recuerda el scroll por URL y lo restaura al
 * volver, una sola vez y con la sublista de la pestaña activa ya pintada.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockAuth: { denied: string[] } = { denied: [] };

jest.mock("next/navigation", () => ({
  usePathname: () => "/products/p-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => !mockAuth.denied.includes(permission),
    isLoading: false,
    role: "admin",
  }),
}));
jest.mock("../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

import { ProductDetailsPage } from "./page";

const SAVED_TOP = 742;

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

function page<T>(items: T[]) {
  return { items, limit: 10, skip: 0, total: items.length };
}

describe("ProductDetailsPage · permisos y scroll (DET-F1, DET-F2)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalScrollTo = window.scrollTo;
  /** Cada restauración: a qué posición y qué había pintado en ese instante. */
  let restores: { priceRow: boolean; saleRow: boolean; top: number }[];
  /** Resuelve la respuesta retenida del historial de ventas. */
  let releaseSales: (() => void) | null;
  let holdSales: boolean;

  beforeEach(() => {
    mockAuth.denied = [];
    restores = [];
    releaseSales = null;
    holdSales = false;
    window.sessionStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: (_x: number, top: number) => {
        restores.push({
          priceRow: screen.queryByText("Cambio de prueba") !== null,
          saleRow: screen.queryByText("V-0001") !== null,
          top,
        });
      },
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");

      if (url.pathname === "/api/products/p-1") {
        return jsonResponse({ data: product });
      }

      if (url.pathname === "/api/products/p-1/sales") {
        if (holdSales) {
          await new Promise<void>((resolve) => {
            releaseSales = resolve;
          });
        }

        return jsonResponse({
          data: {
            ...page([
              {
                createdAt: "2026-05-19T10:00:00.000Z",
                id: "sale-1:p-1",
                invoiceNumber: "V-0001",
                quantity: 1,
                saleId: "sale-1",
                status: "pagada",
                subtotalRef: 12,
                subtotalVes: 480,
                unitPriceRef: 12,
              },
            ]),
            totals: { totalRef: 12, totalVes: 480, units: 1 },
          },
        });
      }

      if (url.pathname === "/api/products/p-1/price-history") {
        return jsonResponse({
          data: page([
            {
              createdAt: "2026-05-19T10:00:00.000Z",
              id: "h-1",
              kind: "change",
              previousSalePriceRef: 11,
              productId: "p-1",
              reason: "Cambio de prueba",
              salePriceRef: 12,
              userId: "user-admin",
              userName: "Admin Demo",
            },
          ]),
        });
      }

      return jsonResponse({ data: page([]) });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: originalScrollTo });
  });

  function renderPage(search = "", savedTop?: number) {
    const url = `/products/p-1${search}`;

    window.history.replaceState(null, "", url);

    if (savedTop !== undefined) {
      window.sessionStorage.setItem(
        SCROLL_POSITIONS_STORAGE_KEY,
        JSON.stringify([[url, savedTop]]),
      );
    }

    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProductDetailsPage productId="p-1" />
      </QueryClientProvider>,
    );
  }

  describe("DET-F1 · enlace a movimientos de inventario", () => {
    it("con inventory.view muestra el enlace", async () => {
      renderPage();

      expect(
        await screen.findByRole("link", { name: "Ver movimientos de inventario" }),
      ).toHaveAttribute("href", expect.stringContaining("/inventory/movements?productId=p-1"));
    });

    it("sin inventory.view no hay enlace que acabe en 403", async () => {
      mockAuth.denied = ["inventory.view"];
      renderPage();

      expect(await screen.findByRole("heading", { name: "Stock actual" })).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Ver movimientos de inventario" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("DET-F2 · scroll al volver", () => {
    it("Resumen: restaura la posición guardada cuando el producto ya está pintado", async () => {
      renderPage("", SAVED_TOP);

      await waitFor(() => expect(restores).toHaveLength(1));
      expect(restores[0].top).toBe(SAVED_TOP);
      expect(screen.getByRole("heading", { name: "Stock actual" })).toBeInTheDocument();
    });

    it("?tab=historial: espera a los dos historiales antes de restaurar", async () => {
      holdSales = true;
      renderPage("?tab=historial", SAVED_TOP);

      expect(await screen.findByText("Cambio de prueba")).toBeInTheDocument();
      await waitFor(() => expect(releaseSales).not.toBeNull());
      expect(restores).toHaveLength(0);

      releaseSales?.();

      await waitFor(() => expect(restores).toHaveLength(1));
      expect(restores[0]).toEqual({ priceRow: true, saleRow: true, top: SAVED_TOP });
    });

    it("cambiar de pestaña dentro del detalle no mueve el scroll", async () => {
      renderPage("", SAVED_TOP);
      window.sessionStorage.setItem(
        SCROLL_POSITIONS_STORAGE_KEY,
        JSON.stringify([
          ["/products/p-1", SAVED_TOP],
          ["/products/p-1?tab=historial", 300],
        ]),
      );

      await waitFor(() => expect(restores).toHaveLength(1));

      fireEvent.click(screen.getByRole("tab", { name: "Historial" }));

      expect(await screen.findByText("V-0001")).toBeInTheDocument();
      expect(window.location.search).toBe("?tab=historial");
      expect(restores).toHaveLength(1);
    });
  });
});
