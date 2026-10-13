/**
 * DET-01 · detalle de producto en pestañas: la pestaña activa va en `?tab=`,
 * el Resumen abre con 3 bloques a la vista, "Ver movimientos" lleva el producto
 * y el `returnTo`, y los historiales se paginan en servidor.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

const LIST_URL = "/products?search=arroz&page=2";
const RETURN_TO = `returnTo=${encodeURIComponent(LIST_URL)}`;
const TOTAL_SALES = 500;
const TOTAL_PRICE_CHANGES = 35;

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

const emptyKardex = {
  entries30d: 0,
  exits30d: 0,
  lastMovements: [],
  openingBalance: 10,
  product: { currentStock: 10, id: "p-1", minStock: 2, name: "Arroz", sku: "arroz" },
  series: [],
  truncated: false,
};

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

/** Como el BFF: entrega solo la página pedida, nunca las 500 ventas. */
function pageOf<T>(total: number, url: URL, build: (index: number) => T) {
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const skip = Number(url.searchParams.get("skip") ?? 0);
  const count = Math.max(0, Math.min(limit, total - skip));

  return {
    items: Array.from({ length: count }, (_, offset) => build(skip + offset)),
    limit,
    skip,
    total,
  };
}

describe("ProductDetailsPage · pestañas (DET-01)", () => {
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

      if (url.pathname === "/api/products/p-1") {
        return jsonResponse({ data: product });
      }

      if (url.pathname === "/api/inventory/kardex") {
        return jsonResponse({ data: emptyKardex });
      }

      if (url.pathname === "/api/products/p-1/sales") {
        return jsonResponse({
          data: {
            ...pageOf(TOTAL_SALES, url, (index) => ({
              createdAt: "2026-05-19T10:00:00.000Z",
              id: `sale-${index + 1}:p-1`,
              invoiceNumber: `V-${String(index + 1).padStart(4, "0")}`,
              quantity: 1,
              saleId: `sale-${index + 1}`,
              status: "pagada",
              subtotalRef: 12,
              subtotalVes: 480,
              unitPriceRef: 12,
            })),
            totals: { totalRef: 6000, totalVes: 240000, units: TOTAL_SALES },
          },
        });
      }

      if (url.pathname === "/api/products/p-1/price-history") {
        return jsonResponse({
          data: pageOf(TOTAL_PRICE_CHANGES, url, (index) => ({
            createdAt: "2026-05-19T10:00:00.000Z",
            id: `h-${index + 1}`,
            kind: "change",
            previousSalePriceRef: 11,
            productId: "p-1",
            reason: `Cambio ${index + 1}`,
            salePriceRef: 12,
            userId: "user-admin",
            userName: "Admin Demo",
          })),
        });
      }

      return jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage(search = "") {
    window.history.replaceState(null, "", `/products/p-1${search}`);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProductDetailsPage productId="p-1" />
      </QueryClientProvider>,
    );
  }

  const findTab = (name: string) => screen.findByRole("tab", { name });

  function sectionOf(heading: HTMLElement) {
    return within(heading.closest("section") as HTMLElement);
  }

  async function salesCard() {
    return sectionOf(await screen.findByRole("heading", { name: "Historial de ventas" }));
  }

  function salesRequests() {
    return requests.filter((request) => request.startsWith("/api/products/p-1/sales"));
  }

  it("abre en Resumen con información, stock y precio a la vista y el kardex plegado", async () => {
    renderPage();

    expect(await findTab("Resumen")).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getAllByRole("tab").map((tab) => tab.textContent),
    ).toEqual(["Resumen", "Proveedores", "Historial", "Avanzado"]);

    // Métrica DET-01: como mucho 3 bloques expandidos al abrir.
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(
      ["Información general", "Stock actual", "Cambio rápido de precio"],
    );
    expect(screen.getByRole("button", { name: /Kardex del producto/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("heading", { name: "Historial de ventas" })).not.toBeInTheDocument();
    expect(salesRequests()).toHaveLength(0);
  });

  it("el kardex recuerda que quedó abierto", async () => {
    renderPage();

    const toggle = await screen.findByRole("button", { name: /Kardex del producto/ });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("heading", { name: "Kardex" })).toBeInTheDocument();
    expect(window.localStorage.getItem("product-detail:kardex-open")).toBe("open");
  });

  it("?tab=historial abre Historial con los dos historiales", async () => {
    renderPage("?tab=historial");

    expect(await findTab("Historial")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Historial de precios" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Historial de ventas" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Información general" })).not.toBeInTheDocument();
  });

  it("?tab=proveedores y ?tab=avanzado abren su pestaña", async () => {
    renderPage("?tab=avanzado");

    expect(await findTab("Avanzado")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Imagen" })).toBeInTheDocument();
    expect(screen.getByText("Este producto no tiene conversión de empaque.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Proveedores" }));

    expect(screen.getByRole("tab", { name: "Proveedores" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?tab=proveedores");
  });

  it("?tab=inexistente cae a Resumen", async () => {
    renderPage("?tab=inexistente");

    expect(await findTab("Resumen")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Información general" })).toBeInTheDocument();
  });

  it("cambiar de pestaña escribe la URL y conserva returnTo; Volver sigue yendo a la lista", async () => {
    renderPage(`?${RETURN_TO}`);

    fireEvent.click(await findTab("Historial"));

    let params = new URLSearchParams(window.location.search);

    expect(window.location.pathname).toBe("/products/p-1");
    expect(params.get("tab")).toBe("historial");
    expect(params.get("returnTo")).toBe(LIST_URL);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", LIST_URL);

    // Resumen es la pestaña por defecto: no se escribe en la URL.
    fireEvent.click(screen.getByRole("tab", { name: "Resumen" }));
    params = new URLSearchParams(window.location.search);

    expect(params.has("tab")).toBe(false);
    expect(params.get("returnTo")).toBe(LIST_URL);
  });

  it("sin returnTo, Volver va a la lista de productos", async () => {
    renderPage();

    await findTab("Resumen");

    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/products");
  });

  it("«Ver movimientos» va al kardex de ese producto con returnTo a la URL del detalle", async () => {
    renderPage();

    const link = await screen.findByRole("link", { name: "Ver movimientos de inventario" });

    expect(link).toHaveAttribute(
      "href",
      "/inventory/movements?productId=p-1&returnTo=%2Fproducts%2Fp-1",
    );
  });

  it("«Ver movimientos» no pierde el returnTo con el que se llegó al detalle", async () => {
    renderPage(`?${RETURN_TO}`);

    const link = await screen.findByRole("link", { name: "Ver movimientos de inventario" });
    const params = new URLSearchParams((link.getAttribute("href") ?? "").split("?")[1]);
    const detailUrl = params.get("returnTo") ?? "";

    expect(params.get("productId")).toBe("p-1");
    expect(detailUrl).toBe(`/products/p-1?${RETURN_TO}`);
    expect(new URLSearchParams(detailUrl.split("?")[1]).get("returnTo")).toBe(LIST_URL);
  });

  it("con 500 ventas pide y pinta una sola página, y la siguiente escribe la URL", async () => {
    renderPage(`?tab=historial&${RETURN_TO}`);

    const card = await salesCard();

    expect(await card.findByText("V-0001")).toBeInTheDocument();
    expect(card.getAllByRole("row")).toHaveLength(11);
    expect(card.getByText("Mostrando 1 a 10 de 500 ventas")).toBeInTheDocument();
    expect(salesRequests()).toEqual(["/api/products/p-1/sales?limit=10&skip=0"]);

    fireEvent.click(card.getByRole("button", { name: "Siguiente" }));

    expect(await card.findByText("V-0011")).toBeInTheDocument();
    expect(card.queryByText("V-0001")).not.toBeInTheDocument();
    expect(card.getAllByRole("row")).toHaveLength(11);
    expect(salesRequests()).toContain("/api/products/p-1/sales?limit=10&skip=10");

    const params = new URLSearchParams(window.location.search);

    expect(params.get("salesPage")).toBe("2");
    expect(params.get("tab")).toBe("historial");
    expect(params.get("returnTo")).toBe(LIST_URL);
    // La página de ventas no mueve la del historial de precios.
    expect(params.has("pricesPage")).toBe(false);
  });

  it("la URL con salesPage abre esa página de ventas", async () => {
    renderPage("?tab=historial&salesPage=3");

    const card = await salesCard();

    expect(await card.findByText("V-0021")).toBeInTheDocument();
    expect(salesRequests()).toEqual(["/api/products/p-1/sales?limit=10&skip=20"]);
  });

  it("salesPage=9999 cae a la última página válida y corrige la URL", async () => {
    renderPage("?tab=historial&salesPage=9999");

    const card = await salesCard();

    expect(await card.findByText("V-0500")).toBeInTheDocument();
    expect(card.getByText("Mostrando 491 a 500 de 500 ventas")).toBeInTheDocument();
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("salesPage")).toBe("50"),
    );
  });

  it("el historial de precios también se pagina en servidor, con su propio parámetro", async () => {
    renderPage("?tab=historial");

    const card = sectionOf(await screen.findByRole("heading", { name: "Historial de precios" }));

    expect(await card.findByText("Cambio 1")).toBeInTheDocument();
    expect(card.getAllByRole("row")).toHaveLength(11);
    expect(requests).toContain("/api/products/p-1/price-history?limit=10&skip=0");

    fireEvent.click(card.getByRole("button", { name: "Siguiente" }));

    expect(await card.findByText("Cambio 11")).toBeInTheDocument();
    expect(requests).toContain("/api/products/p-1/price-history?limit=10&skip=10");

    const params = new URLSearchParams(window.location.search);

    expect(params.get("pricesPage")).toBe("2");
    expect(params.has("salesPage")).toBe(false);
  });
});
