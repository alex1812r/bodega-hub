/**
 * INV-06 · la lista de productos no filtra por stock: la celda "Stock" enlaza a
 * la fila del producto en `/inventory` y un atajo lleva a Inventario con la
 * búsqueda y la categoría actuales. Ambos solo con `inventory.view`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockPermissions: string[] = [];

jest.mock("next/navigation", () => ({
  usePathname: () => "/products",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.includes(permission),
    isLoading: false,
    role: "admin",
  }),
}));
jest.mock("../product-details/components/ProductFormModal", () => ({
  ProductFormModal: () => null,
}));

import { ProductsListPage } from "./page";

jest.setTimeout(20_000);

function product(id: string, name: string, currentStock: number) {
  return {
    categoryId: "cat-1",
    currentCostRef: 10,
    currentStock,
    id,
    isActive: true,
    minStock: 2,
    name,
    salePriceRef: 15,
    sku: id,
  };
}

const PRODUCTS = [product("p-arroz", "Arroz", 10), product("p-sal", "Sal", 0)];
const STOCK_LINK_ARROZ = "Ver el stock de Arroz en Inventario: 10 un";
const STOCK_LINK_SAL = "Ver el stock de Sal en Inventario: 0 un";
const INVENTORY_LINK = "Ver stock en Inventario";

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

describe("ProductsListPage · stock en Inventario (INV-06)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let isMobile = false;

  beforeEach(() => {
    isMobile = false;
    mockPermissions = ["products.view", "products.manage", "inventory.view"];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: isMobile,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string) => {
      const path = String(input).split("?")[0];

      if (path === "/api/products/price-review/summary") {
        return jsonResponse({ data: { total: 0 } });
      }

      if (path === "/api/products") {
        return jsonResponse({ data: { items: PRODUCTS, limit: 10, skip: 0, total: 2 } });
      }

      if (path === "/api/settings/pricing") {
        return jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } });
      }

      if (path === "/api/categories") {
        return jsonResponse({
          data: {
            items: [{ id: "cat-1", isActive: true, name: "Víveres", taxRate: 16 }],
            limit: 10,
            skip: 0,
            total: 1,
          },
        });
      }

      return jsonResponse({ data: { id: "rate-1", rateVes: 50 } });
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage(query = "") {
    window.history.replaceState(null, "", query ? `/products?${query}` : "/products");

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <ProductsListPage />
      </QueryClientProvider>,
    );
  }

  /** Parámetros de cada `GET /api/products` del listado, en orden. */
  function productRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/products")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  it("links the stock cell to the product row in inventory, with the exact list URL to come back", async () => {
    renderPage("search=a&margin=low");

    const returnTo = encodeURIComponent("/products?search=a&margin=low");
    const link = await screen.findByRole("link", { name: STOCK_LINK_ARROZ });

    expect(link.tagName).toBe("A");
    expect(link).toHaveTextContent("10 un");
    expect(link).toHaveAttribute("href", `/inventory?product=p-arroz&returnTo=${returnTo}`);
    expect(link.closest("tr")).toHaveTextContent("Arroz");
    expect(screen.getByRole("link", { name: STOCK_LINK_SAL })).toHaveAttribute(
      "href",
      `/inventory?product=p-sal&returnTo=${returnTo}`,
    );
    // El enlace al detalle del nombre sigue siendo otro.
    expect(screen.getByRole("link", { name: "Arroz" })).toHaveAttribute(
      "href",
      `/products/p-arroz?returnTo=${returnTo}`,
    );
  });

  it("links the stock on the mobile cards too", async () => {
    isMobile = true;
    renderPage();

    const link = await screen.findByRole("link", { name: STOCK_LINK_ARROZ });

    expect(link.closest("li")).not.toBeNull();
    expect(link).toHaveAttribute(
      "href",
      `/inventory?product=p-arroz&returnTo=${encodeURIComponent("/products")}`,
    );
  });

  it("keeps the stock as plain text and hides the shortcut without inventory.view", async () => {
    mockPermissions = ["products.view"];
    renderPage("search=arroz");

    const row = (await screen.findByRole("link", { name: "Arroz" })).closest("tr");

    if (!row) {
      throw new Error("Sin fila para Arroz");
    }

    expect(within(row).getByText("10 un").tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: /Inventario/ })).not.toBeInTheDocument();
  });

  it("offers no stock filter controls, only the shortcut to inventory", async () => {
    renderPage();
    await screen.findByRole("link", { name: STOCK_LINK_ARROZ });

    expect(screen.getAllByRole("combobox").map((select) => select.id)).toEqual([
      "products-category",
      "products-status",
      "products-margin",
      "products-sort",
    ]);
    expect(screen.queryByText(/stock bajo|agotado|sin stock/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: INVENTORY_LINK })).toHaveAttribute(
      "href",
      `/inventory?returnTo=${encodeURIComponent("/products")}`,
    );
  });

  it("carries search and category to inventory, and nothing else of the list state", async () => {
    renderPage("search=harina+pan&category=cat-1&status=inactive&margin=low&sort=currentStock");

    const link = await screen.findByRole("link", { name: INVENTORY_LINK });
    const [path, query] = (link.getAttribute("href") ?? "").split("?");
    const params = new URLSearchParams(query);

    expect(path).toBe("/inventory");
    expect(Object.fromEntries(params)).toEqual({
      category: "cat-1",
      returnTo: "/products?search=harina+pan&category=cat-1&status=inactive&margin=low&sort=currentStock",
      search: "harina pan",
    });
  });

  it("follows the category chosen after mounting", async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("link", { name: STOCK_LINK_ARROZ });
    await user.selectOptions(screen.getByLabelText("Categoría"), "cat-1");

    await waitFor(() =>
      expect(screen.getByRole("link", { name: INVENTORY_LINK })).toHaveAttribute(
        "href",
        `/inventory?category=cat-1&returnTo=${encodeURIComponent("/products?category=cat-1")}`,
      ),
    );
  });

  it("ignores stock parameters of an old URL: no filter is sent and the list does not loop", async () => {
    const user = userEvent.setup();

    renderPage("lowStock=true&stockStatus=out&stock=low&status=low&margin=high");
    await screen.findByRole("link", { name: STOCK_LINK_ARROZ });

    // `status=low` es de Inventario: aquí no es un estado válido y cae al valor por defecto.
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(productRequests()).toEqual([
      { limit: "10", margin: "high", skip: "0", sortBy: "name", sortOrder: "asc" },
    ]);

    await user.selectOptions(screen.getByLabelText("Ganancia"), "Baja");
    await waitFor(() => expect(productRequests()).toHaveLength(2));

    expect(productRequests()[1]).toEqual({
      limit: "10",
      margin: "low",
      skip: "0",
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(new URLSearchParams(window.location.search).get("margin")).toBe("low");
    expect(new URLSearchParams(window.location.search).has("status")).toBe(false);
  });
});
