/**
 * INV-01b · `/inventory` como vista única de stock: columnas del libro de
 * movimientos, aviso de descuadre (solo admin), filtros aplicados por el
 * servidor y todo el estado de la lista en la URL (regla 15).
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InventoryOverviewItem } from "../services/inventoryOverview";

const mockExportInventoryToExcel = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));
jest.mock("../inventory-movements/components/InventoryAdjustmentModal", () => ({
  InventoryAdjustmentModal: () => null,
}));
jest.mock("../inventory-movements/components/InventoryPackConversionModal", () => ({
  InventoryPackConversionModal: () => null,
}));
jest.mock("../services/exportInventoryExcel", () => ({
  exportInventoryToExcel: (...args: unknown[]) => mockExportInventoryToExcel(...args),
}));

import { INVENTORY_RECONCILIATION_HELP } from "./components/InventoryReconciliationBadge";
import { InventoryListPage } from "./page";

function item(
  id: string,
  name: string,
  overrides: Partial<InventoryOverviewItem> = {},
): InventoryOverviewItem {
  return {
    category: { id: "cat-1", isActive: true, name: "Categoría 01", taxRate: 16 },
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 20,
    entries30d: 0,
    exits30d: 0,
    id,
    isActive: true,
    lastMovementAt: null,
    lastMovementType: null,
    minStock: 5,
    name,
    salePriceRef: 2,
    sku: id.toUpperCase(),
    stockStatus: "ok",
    ...overrides,
  };
}

/** Lo que recibe un admin: todas las filas traen `reconciliationDiff`. */
const ADMIN_ITEMS: InventoryOverviewItem[] = [
  item("p-harina", "Harina", {
    entries30d: 120,
    exits30d: 96,
    lastMovementAt: "2026-10-05T16:00:00.000Z",
    lastMovementType: "venta",
    reconciliationDiff: null,
  }),
  item("p-arroz", "Arroz", {
    currentStock: 4,
    entries30d: 24,
    exits30d: 31,
    lastMovementAt: "2026-10-02T16:00:00.000Z",
    lastMovementType: "compra",
    reconciliationDiff: 3,
    stockStatus: "low",
  }),
  item("p-aceite", "Aceite", {
    currentStock: -4,
    exits30d: 16,
    lastMovementAt: "2026-10-01T16:00:00.000Z",
    lastMovementType: "ajuste_salida",
    reconciliationDiff: -2,
    stockStatus: "low",
  }),
  item("p-sal", "Sal", { reconciliationDiff: 0 }),
];

function withoutReconciliation(row: InventoryOverviewItem): InventoryOverviewItem {
  const copy = { ...row };

  delete copy.reconciliationDiff;

  return copy;
}

const CATEGORIES = Array.from({ length: 12 }, (_, index) => ({
  id: `cat-${index + 1}`,
  isActive: true,
  name: `Categoría ${String(index + 1).padStart(2, "0")}`,
  taxRate: 16,
}));

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function page(items: InventoryOverviewItem[], total = items.length, limit = 10, skip = 0) {
  return jsonResponse({ data: { items, limit, skip, total } });
}

describe("InventoryListPage · vista única de stock", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  /** Respuesta de `GET /api/inventory` según los parámetros pedidos. */
  let inventoryResponse: (params: URLSearchParams) => Response | Promise<Response>;
  let isMobile = false;

  beforeEach(() => {
    isMobile = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: isMobile,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    window.history.replaceState(null, "", "/inventory");
    inventoryResponse = () => page(ADMIN_ITEMS, 45);
    mockExportInventoryToExcel.mockReset();
    mockExportInventoryToExcel.mockResolvedValue(undefined);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const [path, query = ""] = String(url).split("?");
      const params = new URLSearchParams(query);

      if (path === "/api/inventory") {
        return inventoryResponse(params);
      }

      if (path === "/api/categories") {
        // Como el servidor: nunca más de `limit` filas por página.
        const limit = Number(params.get("limit") ?? 10);
        const skip = Number(params.get("skip") ?? 0);

        return jsonResponse({
          data: {
            items: CATEGORIES.slice(skip, skip + limit),
            limit,
            skip,
            total: CATEGORIES.length,
          },
        });
      }

      return jsonResponse({ data: null });
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
    window.history.replaceState(null, "", query ? `/inventory?${query}` : "/inventory");

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <InventoryListPage />
      </QueryClientProvider>,
    );
  }

  /** Parámetros de cada `GET /api/inventory`, en orden. */
  function inventoryRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/inventory")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastInventoryRequest() {
    const requests = inventoryRequests();

    return requests[requests.length - 1];
  }

  async function findRow(name: string) {
    const cell = await screen.findByTitle(name);
    const row = cell.closest("tr");

    if (!row) {
      throw new Error(`Sin fila para ${name}`);
    }

    return row;
  }

  describe("columnas", () => {
    it("shows stock, minimum, 30-day entries and exits, last movement and status for each product", async () => {
      renderPage();

      const row = await findRow("Harina");

      for (const header of [
        "Producto",
        "Categoría",
        "Stock",
        "Mínimo",
        "Entradas 30 d",
        "Salidas 30 d",
        "Último movimiento",
        "Estado",
      ]) {
        expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
      }

      const cells = within(row).getAllByRole("cell");

      expect(cells[0]).toHaveTextContent("Harina");
      expect(cells[0]).toHaveTextContent("P-HARINA");
      expect(cells[1]).toHaveTextContent("Categoría 01");
      expect(cells[2]).toHaveTextContent(/^20$/);
      expect(cells[3]).toHaveTextContent(/^5$/);
      expect(cells[4]).toHaveTextContent(/^120$/);
      expect(cells[5]).toHaveTextContent(/^96$/);
      expect(cells[6]).toHaveTextContent("05/10/2026");
      expect(cells[6]).toHaveTextContent("Venta");
      expect(cells[7]).toHaveTextContent("EnStock");
    });

    it("labels the type of the last movement and says 'Sin movimientos' when there is none", async () => {
      renderPage();

      expect(within(await findRow("Arroz")).getByText("Compra")).toBeInTheDocument();
      expect(within(await findRow("Aceite")).getByText("Ajuste salida")).toBeInTheDocument();
      expect(within(await findRow("Sal")).getByText("Sin movimientos")).toBeInTheDocument();
    });

    it("shows a negative stock as it is, highlighted with the error token", async () => {
      renderPage();

      const stock = within(await findRow("Aceite")).getByText("-4");

      expect(stock).toHaveAttribute("data-negative", "true");
      expect(stock).toHaveClass("text-error");
      expect(within(await findRow("Harina")).getByText("20")).not.toHaveClass("text-error");
    });

    it("shows every figure in stacked cards on a phone", async () => {
      isMobile = true;
      renderPage();

      const card = (await screen.findByTitle("Arroz")).closest("li");

      if (!card) {
        throw new Error("Sin tarjeta para Arroz");
      }

      expect(screen.queryByRole("table")).not.toBeInTheDocument();

      const terms = within(card)
        .getAllByRole("term")
        .map((term) => term.textContent);

      expect(terms).toEqual([
        "Categoría",
        "Stock",
        "Mínimo",
        "Entradas 30 d",
        "Salidas 30 d",
        "Último movimiento",
        "Estado",
      ]);
      expect(card).toHaveTextContent("P-ARROZ");
      expect(card).toHaveTextContent("02/10/2026");
      expect(card).toHaveTextContent("Compra");
      expect(within(card).getByTestId("inventory-reconciliation-badge")).toHaveTextContent(
        "Descuadre +3",
      );
    });
  });

  describe("descuadre", () => {
    it("shows the admin a signed badge with its help text only where the diff is not zero", async () => {
      renderPage();

      const surplus = within(await findRow("Arroz")).getByTestId("inventory-reconciliation-badge");
      const shortage = within(await findRow("Aceite")).getByTestId("inventory-reconciliation-badge");

      expect(surplus).toHaveTextContent("Descuadre +3");
      expect(surplus).toHaveAttribute("title", INVENTORY_RECONCILIATION_HELP);
      expect(INVENTORY_RECONCILIATION_HELP).toBe("El stock no coincide con la suma de movimientos");
      expect(shortage).toHaveTextContent("Descuadre −2");
      // `null` (cuadra) y 0 no pintan nada.
      expect(
        within(await findRow("Harina")).queryByTestId("inventory-reconciliation-badge"),
      ).not.toBeInTheDocument();
      expect(
        within(await findRow("Sal")).queryByTestId("inventory-reconciliation-badge"),
      ).not.toBeInTheDocument();
      expect(screen.getAllByTestId("inventory-reconciliation-badge")).toHaveLength(2);
    });

    it("shows nothing to the other roles: the field does not arrive", async () => {
      inventoryResponse = () => page(ADMIN_ITEMS.map(withoutReconciliation), 45);
      renderPage();

      await findRow("Arroz");

      expect(screen.queryByTestId("inventory-reconciliation-badge")).not.toBeInTheDocument();
      expect(screen.queryByText(/Descuadre/)).not.toBeInTheDocument();
    });
  });

  describe("estado en la URL", () => {
    it("asks for the first page without filters when the URL has no parameters, and writes nothing", async () => {
      renderPage();

      await findRow("Harina");

      expect(lastInventoryRequest()).toEqual({ limit: "10", skip: "0" });
      expect(window.location.search).toBe("");
      expect(screen.getByLabelText("Búsqueda")).toHaveValue("");
      expect(screen.getByLabelText("Categoría")).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("honours every parameter of the URL on mount and sends all of them to the server", async () => {
      renderPage(
        "search=arroz&category=cat-3&status=low&status=out&lowStock=true&minPrice=1.5&maxPrice=20&page=2&limit=20",
      );

      await findRow("Harina");

      expect(inventoryRequests()).toHaveLength(1);
      expect(lastInventoryRequest()).toEqual({
        categoryId: "cat-3",
        limit: "20",
        lowStock: "true",
        maxPriceRef: "20",
        minPriceRef: "1.5",
        search: "arroz",
        skip: "20",
        stockStatus: "low,out",
      });
      expect(screen.getByLabelText("Búsqueda")).toHaveValue("arroz");
      await waitFor(() => expect(screen.getByLabelText("Categoría")).toHaveValue("cat-3"));
      expect(screen.getByLabelText("Precio mínimo (REF)")).toHaveValue("1.5");
      expect(screen.getByLabelText("Precio máximo (REF)")).toHaveValue("20");
      expect(screen.getByRole("button", { name: "En Stock" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Stock Bajo" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Sin Stock" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Solo por reponer" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("falls back to the default of an invalid parameter without losing the valid ones", async () => {
      renderPage("status=roto&minPrice=abc&lowStock=quizas&page=-3&category=cat-2");

      await findRow("Harina");

      expect(lastInventoryRequest()).toEqual({ categoryId: "cat-2", limit: "10", skip: "0" });
    });

    it("writes the stock status in the URL, asks the server for it and goes back to page 1", async () => {
      const user = userEvent.setup();

      renderPage("page=3");
      await findRow("Harina");
      expect(lastInventoryRequest()).toMatchObject({ skip: "20" });

      await user.click(screen.getByRole("button", { name: "Sin Stock" }));

      expect(window.location.search).toBe("?status=out");
      await waitFor(() =>
        expect(lastInventoryRequest()).toEqual({ limit: "10", skip: "0", stockStatus: "out" }),
      );

      await user.click(screen.getByRole("button", { name: "Stock Bajo" }));

      expect(window.location.search).toBe("?status=low&status=out");
      await waitFor(() => expect(lastInventoryRequest()).toMatchObject({ stockStatus: "low,out" }));

      // Con los tres marcados no hay nada que filtrar.
      await user.click(screen.getByRole("button", { name: "En Stock" }));

      expect(window.location.search).toBe("?status=ok&status=low&status=out");
      await waitFor(() => expect(lastInventoryRequest()).not.toHaveProperty("stockStatus"));
    });

    it("writes category and low stock in the URL and sends them to the server", async () => {
      const user = userEvent.setup();

      renderPage("page=2");
      await findRow("Harina");
      await user.selectOptions(await screen.findByLabelText("Categoría"), "Categoría 04");

      expect(window.location.search).toBe("?category=cat-4");

      await user.click(screen.getByRole("button", { name: "Solo por reponer" }));

      expect(window.location.search).toBe("?category=cat-4&lowStock=true");
      await waitFor(() =>
        expect(lastInventoryRequest()).toEqual({
          categoryId: "cat-4",
          limit: "10",
          lowStock: "true",
          skip: "0",
        }),
      );
    });

    it("debounces the search: one request with the whole text, then the URL", async () => {
      const user = userEvent.setup();

      renderPage("page=2");
      await findRow("Harina");
      await user.type(screen.getByLabelText("Búsqueda"), "hari");

      expect(screen.getByLabelText("Búsqueda")).toHaveValue("hari");
      await waitFor(() => expect(window.location.search).toBe("?search=hari"));
      await waitFor(() =>
        expect(lastInventoryRequest()).toEqual({ limit: "10", search: "hari", skip: "0" }),
      );
      expect(inventoryRequests().filter((request) => "search" in request)).toHaveLength(1);
    });

    it("writes the price range in the URL and sends it as minPriceRef / maxPriceRef", async () => {
      const user = userEvent.setup();

      renderPage();
      await findRow("Harina");
      await user.type(screen.getByLabelText("Precio mínimo (REF)"), "2.5");
      await user.type(screen.getByLabelText("Precio máximo (REF)"), "40");

      await waitFor(() => expect(window.location.search).toBe("?minPrice=2.5&maxPrice=40"));
      await waitFor(() =>
        expect(lastInventoryRequest()).toEqual({
          limit: "10",
          maxPriceRef: "40",
          minPriceRef: "2.5",
          skip: "0",
        }),
      );
    });

    it("keeps page and page size in the URL", async () => {
      const user = userEvent.setup();

      renderPage();
      await findRow("Harina");
      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      expect(window.location.search).toBe("?page=2");
      await waitFor(() => expect(lastInventoryRequest()).toEqual({ limit: "10", skip: "10" }));
    });

    it("never touches the reserved 'product' parameter", async () => {
      const user = userEvent.setup();

      renderPage("product=p-arroz&page=2");
      await findRow("Harina");

      expect(lastInventoryRequest()).toEqual({ limit: "10", skip: "10" });

      await user.click(screen.getByRole("button", { name: "Sin Stock" }));

      expect(window.location.search).toBe("?product=p-arroz&status=out");

      await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

      expect(window.location.search).toBe("?product=p-arroz");
    });

    it("goes back to the last valid page when the requested one is past the total", async () => {
      inventoryResponse = (params) => {
        const skip = Number(params.get("skip"));

        return skip >= 12 ? page([], 12, 10, skip) : page(ADMIN_ITEMS.slice(0, 2), 12, 10, skip);
      };
      renderPage("page=9");

      await findRow("Harina");

      expect(window.location.search).toBe("?page=2");
      expect(inventoryRequests()).toEqual([
        { limit: "10", skip: "80" },
        { limit: "10", skip: "10" },
      ]);
      expect(screen.queryByText(/Aún no hay productos/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Ningún producto coincide/)).not.toBeInTheDocument();
    });
  });

  describe("categorías", () => {
    it("offers every category in the filter, beyond the first page of ten", async () => {
      renderPage();

      await waitFor(() =>
        expect(within(screen.getByLabelText("Categoría")).getAllByRole("option")).toHaveLength(13),
      );

      const options = within(screen.getByLabelText("Categoría"))
        .getAllByRole("option")
        .map((option) => option.textContent);

      expect(options[0]).toBe("Todas las categorías");
      expect(options).toContain("Categoría 11");
      expect(options).toContain("Categoría 12");
    });
  });

  describe("estados", () => {
    it("shows a skeleton while loading", async () => {
      let release: (response: Response) => void = () => undefined;

      inventoryResponse = () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        });

      const { container } = renderPage();

      await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeInTheDocument());
      expect(screen.queryByText(/Aún no hay productos/)).not.toBeInTheDocument();

      release(page(ADMIN_ITEMS));

      await findRow("Harina");
      expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    });

    it("says there are no products yet when the list is empty without filters", async () => {
      inventoryResponse = () => page([]);
      renderPage();

      expect(await screen.findByText("Aún no hay productos en el inventario")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("offers to clear the filters when they leave the list empty", async () => {
      const user = userEvent.setup();

      inventoryResponse = (params) => (params.has("search") ? page([]) : page(ADMIN_ITEMS));
      renderPage("search=zzz&status=out&limit=20");

      const empty = (await screen.findByText("Ningún producto coincide con los filtros")).closest("td");

      if (!empty) {
        throw new Error("Sin celda de estado vacío");
      }

      await user.click(within(empty).getByRole("button", { name: "Limpiar filtros" }));

      // El tamaño de página no es un filtro: se conserva.
      expect(window.location.search).toBe("?limit=20");
      expect(await findRow("Harina")).toBeInTheDocument();
      expect(lastInventoryRequest()).toEqual({ limit: "20", skip: "0" });
      expect(screen.getByLabelText("Búsqueda")).toHaveValue("");
    });

    it("shows the server error with a retry that repeats the request", async () => {
      const user = userEvent.setup();
      let fail = true;

      inventoryResponse = () =>
        fail
          ? jsonResponse({ error: { code: "INTERNAL", message: "No se pudo leer el inventario." } }, 500)
          : page(ADMIN_ITEMS);
      renderPage();

      expect(await screen.findByText("No se pudo leer el inventario.")).toBeInTheDocument();

      fail = false;
      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(await findRow("Harina")).toBeInTheDocument();
      expect(inventoryRequests()).toHaveLength(2);
    });

    it("says the user has no permission on a 403, without table, filters or retry", async () => {
      inventoryResponse = () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403);
      renderPage();

      expect(
        await screen.findByText("No tienes permiso para ver el inventario"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Búsqueda")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    });
  });

  describe("exportación", () => {
    it("exports with the filters of the URL, without page or page size", async () => {
      const user = userEvent.setup();

      renderPage("search=arroz&category=cat-3&status=low&lowStock=true&minPrice=1&maxPrice=9&page=2&limit=20");
      await findRow("Harina");
      await user.click(screen.getByRole("button", { name: "Exportar Excel" }));

      await waitFor(() => expect(mockExportInventoryToExcel).toHaveBeenCalledTimes(1));
      expect(mockExportInventoryToExcel).toHaveBeenCalledWith({
        categoryId: "cat-3",
        lowStock: true,
        maxPriceRef: 9,
        minPriceRef: 1,
        search: "arroz",
        stockStatus: "low",
      });
    });
  });
});
