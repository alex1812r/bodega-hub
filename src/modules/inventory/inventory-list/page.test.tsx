/**
 * INV-01b · `/inventory` como vista única de stock: columnas del libro de
 * movimientos, aviso de descuadre (solo admin), filtros aplicados por el
 * servidor y todo el estado de la lista en la URL (regla 15).
 *
 * INV-02 · movimientos en línea: fila expandible con `product` en la URL,
 * carga bajo demanda y producto fijado cuando no está en la página.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

import type { InventoryMovement } from "../hooks/useInventory";
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
// La reposición (INV-05) tiene sus propios tests: aquí solo importa cuándo se ofrece.
jest.mock("../restock", () => ({
  RestockPurchaseButton: () => <button type="button">Crear compra con estos productos</button>,
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

/** Producto activo que no está en la página que devuelve la lista. */
const OFF_PAGE_ITEM = item("p-cafe", "Café", {
  currentStock: 7,
  entries30d: 12,
  exits30d: 5,
  lastMovementAt: "2026-10-06T16:00:00.000Z",
  lastMovementType: "compra",
  minStock: 9,
  reconciliationDiff: 2,
  stockStatus: "low",
});

const MOVEMENTS: InventoryMovement[] = [
  {
    createdAt: "2026-10-08T14:00:00.000Z",
    documentKind: "venta",
    documentNumber: "V-000123",
    id: "mov-venta",
    productId: "p-arroz",
    quantityDelta: -2,
    saleId: "sale-1",
    stockAfter: 4,
    type: "venta",
  },
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
  let prefersReducedMotion = false;

  beforeEach(() => {
    isMobile = false;
    prefersReducedMotion = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: query.includes("prefers-reduced-motion") ? prefersReducedMotion : isMobile,
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

      if (path === "/api/inventory/movements") {
        return jsonResponse({
          data: { items: MOVEMENTS, limit: 10, skip: 0, total: MOVEMENTS.length },
        });
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

  /** Parámetros de cada `GET /api/inventory/movements`, en orden. */
  function movementRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/inventory/movements")
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

  describe("reposición", () => {
    it("offers 'Crear compra con estos productos' in the header only with the 'Solo por reponer' filter on", async () => {
      const view = renderPage();

      await findRow("Harina");
      expect(
        screen.queryByRole("button", { name: "Crear compra con estos productos" }),
      ).not.toBeInTheDocument();

      view.unmount();
      renderPage("lowStock=true");

      await findRow("Harina");
      expect(
        screen.getByRole("button", { name: "Crear compra con estos productos" }),
      ).toBeInTheDocument();
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

    it("does not send 'product' to the list and keeps it when the filters change or are cleared", async () => {
      const user = userEvent.setup();

      renderPage("product=p-arroz&page=2");
      await findRow("Harina");

      expect(lastInventoryRequest()).toEqual({ limit: "10", skip: "10" });

      await user.click(screen.getByRole("button", { name: "Sin Stock" }));

      expect(window.location.search).toBe("?status=out&product=p-arroz");

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

  describe("movimientos en línea", () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    const MOVEMENTS_PANEL = /^Últimos movimientos de /;

    beforeEach(() => {
      scrollIntoView.mockReset();
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    function panelOf(name: string) {
      return screen.queryByRole("region", { name: `Últimos movimientos de ${name}` });
    }

    /** La lista sin el producto pedido por id; ese producto, solo con `productId`. */
    function listWithOffPageProduct(found: InventoryOverviewItem[] = [OFF_PAGE_ITEM]) {
      inventoryResponse = (params) =>
        params.has("productId") ? page(found) : page(ADMIN_ITEMS, 45);
    }

    it("asks for no movements until a row is expanded", async () => {
      renderPage();
      await findRow("Harina");

      expect(movementRequests()).toEqual([]);
      expect(screen.queryByRole("region", { name: MOVEMENTS_PANEL })).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Ver movimientos de / })).toHaveLength(4);
    });

    it("expands a row with its last 10 movements, writes 'product' in the URL and collapses it again", async () => {
      const user = userEvent.setup();

      renderPage();

      const row = await findRow("Arroz");
      const toggle = within(row).getByRole("button", { name: "Ver movimientos de Arroz" });

      expect(toggle).toHaveAttribute("aria-expanded", "false");

      await user.click(toggle);

      const panel = panelOf("Arroz");

      expect(panel).toBeInTheDocument();
      expect(window.location.search).toBe("?product=p-arroz");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-controls", panel?.id);
      expect(toggle).toHaveAccessibleName("Ocultar movimientos de Arroz");
      // La fila expandida va justo debajo de la del producto, a todo el ancho.
      expect(panel?.closest("tr")).toBe(row.nextElementSibling);
      expect(panel?.closest("td")).toHaveAttribute("colspan", "9");
      expect(await within(panel as HTMLElement).findByText("Venta V-000123")).toBeInTheDocument();
      expect(movementRequests()).toEqual([{ limit: "10", productId: "p-arroz" }]);
      // Solo cambió `product`: la lista no se vuelve a pedir.
      expect(inventoryRequests()).toHaveLength(1);

      await user.click(toggle);

      expect(panelOf("Arroz")).not.toBeInTheDocument();
      expect(window.location.search).toBe("");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveAccessibleName("Ver movimientos de Arroz");
    });

    it("passes the reconciliation diff of the row to the panel", async () => {
      const user = userEvent.setup();

      renderPage();
      await user.click(
        within(await findRow("Arroz")).getByRole("button", { name: "Ver movimientos de Arroz" }),
      );

      expect(within(panelOf("Arroz") as HTMLElement).getByRole("note")).toHaveTextContent(
        "El stock (4) no coincide con la suma de movimientos (1).",
      );
    });

    it("replaces the expanded product when another row is expanded", async () => {
      const user = userEvent.setup();

      renderPage("product=p-arroz");
      await findRow("Harina");
      expect(panelOf("Arroz")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Ver movimientos de Harina" }));

      expect(window.location.search).toBe("?product=p-harina");
      expect(panelOf("Harina")).toBeInTheDocument();
      expect(panelOf("Arroz")).not.toBeInTheDocument();
      expect(screen.getAllByRole("region", { name: MOVEMENTS_PANEL })).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Ver movimientos de Arroz" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    it("stays on the same page when a row is expanded or collapsed", async () => {
      const user = userEvent.setup();

      renderPage("page=2");
      await findRow("Harina");
      await user.click(screen.getByRole("button", { name: "Ver movimientos de Sal" }));

      expect(window.location.search).toBe("?page=2&product=p-sal");

      await user.click(screen.getByRole("button", { name: "Ocultar movimientos de Sal" }));

      expect(window.location.search).toBe("?page=2");
      expect(inventoryRequests()).toEqual([{ limit: "10", skip: "10" }]);
    });

    it("works with the keyboard: Enter expands and Space collapses", async () => {
      const user = userEvent.setup();

      renderPage();

      const toggle = within(await findRow("Sal")).getByRole("button", {
        name: "Ver movimientos de Sal",
      });

      toggle.focus();
      await user.keyboard("{Enter}");

      expect(panelOf("Sal")).toBeInTheDocument();
      expect(toggle).toHaveFocus();

      await user.keyboard(" ");

      expect(panelOf("Sal")).not.toBeInTheDocument();
    });

    it("expands only from its button: the rest of the row keeps its own clicks", async () => {
      const user = userEvent.setup();

      renderPage();

      const row = await findRow("Arroz");

      await user.click(within(row).getByTitle("Arroz"));
      await user.click(within(row).getByText("Compra"));

      expect(screen.queryByRole("region", { name: MOVEMENTS_PANEL })).not.toBeInTheDocument();
      expect(window.location.search).toBe("");
      expect(movementRequests()).toEqual([]);
    });

    it("opens the product of the URL on mount when it is in the page, scrolls to it and asks for nothing else", async () => {
      renderPage("status=low&product=p-arroz");

      const row = await findRow("Arroz");
      const panel = panelOf("Arroz") as HTMLElement;

      expect(panel).toBeInTheDocument();
      expect(window.location.search).toBe("?status=low&product=p-arroz");
      expect(inventoryRequests()).toEqual([{ limit: "10", skip: "0", stockStatus: "low" }]);
      expect(screen.queryByRole("region", { name: "Producto seleccionado" })).not.toBeInTheDocument();
      expect(within(panel).getByRole("link", { name: /Ver kardex completo/ })).toHaveAttribute(
        "href",
        `/inventory/movements?productId=p-arroz&returnTo=${encodeURIComponent(
          "/inventory?status=low&product=p-arroz",
        )}`,
      );
      await waitFor(() => expect(movementRequests()).toHaveLength(1));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      expect(scrollIntoView.mock.contexts[0]).toBe(
        within(row).getByRole("button", { name: "Ocultar movimientos de Arroz" }),
      );
    });

    it("scrolls without animation when the user prefers reduced motion", async () => {
      prefersReducedMotion = true;
      renderPage("product=p-arroz");
      await findRow("Arroz");

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
    });

    it("does not scroll when the user expands a row", async () => {
      const user = userEvent.setup();

      renderPage();
      await findRow("Harina");
      await user.click(screen.getByRole("button", { name: "Ver movimientos de Aceite" }));

      expect(panelOf("Aceite")).toBeInTheDocument();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("pins the product of the URL above the table when it is not in the page", async () => {
      const user = userEvent.setup();

      listWithOffPageProduct();
      renderPage("product=p-cafe");

      const pinned = await screen.findByRole("region", { name: "Producto seleccionado" });

      expect(inventoryRequests()).toEqual([
        { limit: "10", skip: "0" },
        { limit: "10", productId: "p-cafe", skip: "0" },
      ]);
      expect(await within(pinned).findByTitle("Café")).toBeInTheDocument();
      expect(pinned).toHaveTextContent("P-CAFE");
      expect(within(pinned).getByTestId("inventory-reconciliation-badge")).toHaveTextContent(
        "Descuadre +2",
      );

      const figures = Object.fromEntries(
        within(pinned)
          .getAllByRole("term")
          .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
      );

      expect(figures).toMatchObject({
        "Entradas 30 d": "12",
        "Mínimo": "9",
        "Salidas 30 d": "5",
        Stock: "7",
      });
      expect(figures["Último movimiento"]).toContain("06/10/2026");
      expect(figures["Último movimiento"]).toContain("Compra");
      expect(Object.keys(figures)).toContain("Estado");

      // Sus movimientos van abiertos y el kardex completo vuelve a esta misma URL.
      const panel = within(pinned).getByRole("region", { name: "Últimos movimientos de Café" });

      expect(await within(panel).findByText("Venta V-000123")).toBeInTheDocument();
      expect(movementRequests()).toEqual([{ limit: "10", productId: "p-cafe" }]);
      expect(within(panel).getByRole("link", { name: /Ver kardex completo/ })).toHaveAttribute(
        "href",
        `/inventory/movements?productId=p-cafe&returnTo=${encodeURIComponent("/inventory?product=p-cafe")}`,
      );
      // La tabla sigue debajo, con ninguna fila expandida.
      expect(pinned).not.toContainElement(await findRow("Harina"));
      expect(pinned.compareDocumentPosition(screen.getByRole("table"))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      await user.click(within(pinned).getByRole("button", { name: "Quitar selección" }));

      expect(window.location.search).toBe("");
      expect(screen.queryByRole("region", { name: "Producto seleccionado" })).not.toBeInTheDocument();
      expect(await findRow("Harina")).toBeInTheDocument();
    });

    it("shows an inactive product of the URL with an 'Inactivo' badge, its stock and its movements (INV-F1 · F2)", async () => {
      listWithOffPageProduct([item("p-cafe", "Café", { currentStock: 0, isActive: false })]);
      renderPage("product=p-cafe");

      const pinned = await screen.findByRole("region", { name: "Producto seleccionado" });

      expect(await within(pinned).findByTitle("Café")).toBeInTheDocument();
      expect(within(pinned).getByText("Inactivo")).toBeInTheDocument();
      expect(screen.queryByText("No se encontró el producto seleccionado.")).not.toBeInTheDocument();
      expect(
        await within(
          within(pinned).getByRole("region", { name: "Últimos movimientos de Café" }),
        ).findByText("Venta V-000123"),
      ).toBeInTheDocument();
    });

    it("does not mark an active pinned product as inactive", async () => {
      listWithOffPageProduct();
      renderPage("product=p-cafe");

      const pinned = await screen.findByRole("region", { name: "Producto seleccionado" });

      expect(await within(pinned).findByTitle("Café")).toBeInTheDocument();
      expect(within(pinned).queryByText("Inactivo")).not.toBeInTheDocument();
    });

    it("replaces the pinned product when a row is expanded", async () => {
      const user = userEvent.setup();

      listWithOffPageProduct();
      renderPage("product=p-cafe");
      await screen.findByRole("region", { name: "Producto seleccionado" });
      await user.click(screen.getByRole("button", { name: "Ver movimientos de Harina" }));

      expect(window.location.search).toBe("?product=p-harina");
      expect(screen.queryByRole("region", { name: "Producto seleccionado" })).not.toBeInTheDocument();
      expect(panelOf("Harina")).toBeInTheDocument();
    });

    it.each([
      ["does not exist, is inactive or belongs to another store", () => page([])],
      [
        "is not a valid id",
        () => jsonResponse({ error: { code: "BAD_REQUEST", message: "Id inválido." } }, 400),
      ],
    ])("says the selected product was not found when it %s, and the list keeps working", async (_case, response) => {
      const user = userEvent.setup();

      inventoryResponse = (params) => (params.has("productId") ? response() : page(ADMIN_ITEMS, 45));
      renderPage("product=p-fantasma");

      const notice = await screen.findByText("No se encontró el producto seleccionado.");
      const pinned = notice.closest("section") as HTMLElement;

      expect(await findRow("Harina")).toBeInTheDocument();
      expect(movementRequests()).toEqual([]);
      expect(within(pinned).queryByRole("region")).not.toBeInTheDocument();

      await user.click(within(pinned).getByRole("button", { name: "Quitar selección" }));

      expect(window.location.search).toBe("");
      expect(screen.queryByText("No se encontró el producto seleccionado.")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Ver movimientos de Harina" }));

      expect(panelOf("Harina")).toBeInTheDocument();
    });

    it("offers to retry when the selected product could not be read", async () => {
      const user = userEvent.setup();
      let fail = true;

      inventoryResponse = (params) => {
        if (!params.has("productId")) {
          return page(ADMIN_ITEMS, 45);
        }

        return fail
          ? jsonResponse({ error: { code: "INTERNAL", message: "No se pudo leer el inventario." } }, 500)
          : page([OFF_PAGE_ITEM]);
      };
      renderPage("product=p-cafe");

      expect(
        await screen.findByText("No pudimos cargar el producto seleccionado. No se pudo leer el inventario."),
      ).toBeInTheDocument();
      expect(await findRow("Harina")).toBeInTheDocument();

      fail = false;
      await user.click(
        within(screen.getByRole("region", { name: "Producto seleccionado" })).getByRole("button", {
          name: "Reintentar",
        }),
      );

      expect(await screen.findByTitle("Café")).toBeInTheDocument();
    });

    it("keeps 'product' when a filter takes the product out of the page: it moves to the pinned block and comes back", async () => {
      const user = userEvent.setup();

      inventoryResponse = (params) => {
        if (params.has("productId")) {
          return page([ADMIN_ITEMS[1]]);
        }

        return params.get("stockStatus") === "out" ? page([ADMIN_ITEMS[3]]) : page(ADMIN_ITEMS, 45);
      };
      renderPage("product=p-arroz");
      await findRow("Arroz");
      expect(panelOf("Arroz")?.closest("tr")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Sin Stock" }));

      expect(window.location.search).toBe("?status=out&product=p-arroz");

      const pinned = await screen.findByRole("region", { name: "Producto seleccionado" });

      expect(within(pinned).getByTitle("Arroz")).toBeInTheDocument();
      expect(within(pinned).getByRole("region", { name: "Últimos movimientos de Arroz" })).toBeInTheDocument();
      expect(await findRow("Sal")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /movimientos de Arroz/ })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

      expect(window.location.search).toBe("?product=p-arroz");
      expect(panelOf("Arroz")?.closest("tr")).toBe((await findRow("Arroz")).nextElementSibling);
      expect(screen.queryByRole("region", { name: "Producto seleccionado" })).not.toBeInTheDocument();
    });

    it("keeps 'product' when the page changes", async () => {
      const user = userEvent.setup();

      inventoryResponse = (params) => {
        if (params.has("productId")) {
          return page([ADMIN_ITEMS[1]]);
        }

        return params.get("skip") === "10"
          ? page([ADMIN_ITEMS[3]], 45, 10, 10)
          : page(ADMIN_ITEMS.slice(0, 3), 45);
      };
      renderPage("product=p-arroz");
      await findRow("Arroz");
      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      expect(window.location.search).toBe("?page=2&product=p-arroz");
      expect(
        within(await screen.findByRole("region", { name: "Producto seleccionado" })).getByTitle("Arroz"),
      ).toBeInTheDocument();
    });

    it("ignores a 'product' that cannot be an id", async () => {
      renderPage(`product=${"x".repeat(65)}`);
      await findRow("Harina");

      expect(inventoryRequests()).toEqual([{ limit: "10", skip: "0" }]);
      expect(screen.queryByRole("region", { name: MOVEMENTS_PANEL })).not.toBeInTheDocument();
    });

    it("expands the card of a phone with a labelled button and the panel at its foot", async () => {
      const user = userEvent.setup();

      isMobile = true;
      renderPage();

      const card = (await screen.findByTitle("Arroz")).closest("li") as HTMLElement;
      const toggle = within(card).getByRole("button", { name: "Ver movimientos de Arroz" });

      expect(toggle).toHaveTextContent("Movimientos");
      expect(movementRequests()).toEqual([]);

      await user.click(toggle);

      const panel = within(card).getByRole("region", { name: "Últimos movimientos de Arroz" });

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute("aria-controls", panel.id);
      expect(card.lastElementChild).toContainElement(panel);
      expect(window.location.search).toBe("?product=p-arroz");
      expect(screen.getAllByRole("region", { name: MOVEMENTS_PANEL })).toHaveLength(1);
    });

    it("puts no block element inside the subtitle paragraph of a phone card (INV-F1 · O2)", async () => {
      isMobile = true;

      const { container } = renderPage();

      await screen.findAllByTitle("Arroz");

      expect(container.querySelectorAll("li p button")).not.toHaveLength(0);
      expect(container.querySelectorAll("p div")).toHaveLength(0);
    });
  });

  describe("volver (returnTo)", () => {
    const PRODUCTS_URL = "/products?search=caf&page=2";
    const RETURN_TO = `returnTo=${encodeURIComponent(PRODUCTS_URL)}`;

    function returnToOf(href: string | null) {
      return new URLSearchParams((href ?? "").split("?")[1] ?? "").get("returnTo");
    }

    it("offers 'Volver' to the returnTo of the URL and keeps it when filtering, paging and expanding", async () => {
      const user = userEvent.setup();

      renderPage(RETURN_TO);
      await findRow("Harina");

      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", PRODUCTS_URL);

      await user.click(screen.getByRole("button", { name: "Ver movimientos de Arroz" }));
      await user.click(screen.getByRole("button", { name: "Ir a pagina 2" }));

      expect(new URLSearchParams(window.location.search).get("page")).toBe("2");

      await user.selectOptions(await screen.findByLabelText("Categoría"), "cat-2");

      const params = new URLSearchParams(window.location.search);

      expect(params.get("returnTo")).toBe(PRODUCTS_URL);
      expect(params.get("product")).toBe("p-arroz");
      expect(params.get("category")).toBe("cat-2");
      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", PRODUCTS_URL);
    });

    it("carries the original returnTo nested in the link to the full kardex", async () => {
      renderPage(`product=p-arroz&${RETURN_TO}`);

      const link = await screen.findByRole("link", { name: /Ver kardex completo/ });
      const listUrl = returnToOf(link.getAttribute("href"));

      expect(link.getAttribute("href")?.split("?")[0]).toBe("/inventory/movements");
      // La lista escribe primero los parámetros ajenos: se comparan los valores, no el orden.
      expect(listUrl?.split("?")[0]).toBe("/inventory");
      expect(Object.fromEntries(new URLSearchParams(listUrl?.split("?")[1]))).toEqual({
        product: "p-arroz",
        returnTo: PRODUCTS_URL,
      });
    });

    it("sends the row actions to the movements with the list URL as returnTo, nested returnTo included", async () => {
      const user = userEvent.setup();

      renderPage(`status=low&${RETURN_TO}`);

      const row = await findRow("Arroz");

      await user.click(within(row).getByRole("button", { name: "Abrir acciones" }));

      for (const name of ["Kardex / movimientos", "Registrar ajuste"]) {
        const href = screen.getByRole("menuitem", { name }).getAttribute("href");
        const listUrl = returnToOf(href);

        expect(href?.split("?")[0]).toBe("/inventory/movements");
        expect(new URLSearchParams(href?.split("?")[1]).get("productId")).toBe("p-arroz");
        expect(listUrl?.split("?")[0]).toBe("/inventory");
        expect(Object.fromEntries(new URLSearchParams(listUrl?.split("?")[1]))).toEqual({
          returnTo: PRODUCTS_URL,
          status: "low",
        });
      }
    });

    it.each(["", "returnTo=%2F%2Fevil.com", "returnTo=https%3A%2F%2Fevil.com"])(
      "offers no 'Volver' without a safe returnTo (%s)",
      async (query) => {
        renderPage(query);
        await findRow("Harina");

        expect(screen.queryByRole("link", { name: /^Volver/ })).not.toBeInTheDocument();
      },
    );
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

  describe("DET-06d · volver con filtros y scroll", () => {
    /** Posición guardada para `url` y espía del `scrollTo` de la ventana (sin `<main>`, hace scroll ella). */
    function rememberScroll(url: string, top: number) {
      const scrollTo = jest.fn();

      Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
      window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify([[url, top]]));

      return scrollTo;
    }

    afterEach(() => {
      window.sessionStorage.clear();
    });

    it("restores the scroll saved for this exact URL once the rows are painted", async () => {
      const scrollTo = rememberScroll("/inventory?status=low&page=2", 640);

      renderPage("status=low&page=2");

      expect(scrollTo).not.toHaveBeenCalled();

      await findRow("Harina");

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(0, 640);
    });

    it("does not move the scroll on a URL without a saved position", async () => {
      const scrollTo = rememberScroll("/inventory?status=low&page=2", 640);

      renderPage("status=low");
      await findRow("Harina");

      expect(scrollTo).not.toHaveBeenCalled();
    });

    it("sends 'Ver todos los movimientos' with the exact list URL as returnTo", async () => {
      renderPage("status=low&page=2");
      await findRow("Harina");

      expect(screen.getByRole("link", { name: "Ver todos los movimientos" })).toHaveAttribute(
        "href",
        `/inventory/movements?returnTo=${encodeURIComponent("/inventory?status=low&page=2")}`,
      );
    });

    it("keeps the returnTo the list arrived with nested in 'Ver todos los movimientos'", async () => {
      const origin = "/products?search=caf&page=2";

      renderPage(`status=low&returnTo=${encodeURIComponent(origin)}`);
      await findRow("Harina");

      const href = screen
        .getByRole("link", { name: "Ver todos los movimientos" })
        .getAttribute("href");
      const listUrl = new URLSearchParams((href ?? "").split("?")[1] ?? "").get("returnTo");

      expect(href?.split("?")[0]).toBe("/inventory/movements");
      expect(listUrl?.split("?")[0]).toBe("/inventory");
      expect(Object.fromEntries(new URLSearchParams(listUrl?.split("?")[1]))).toEqual({
        returnTo: origin,
        status: "low",
      });
    });

    it("goes back to a detail with the returnTo that detail arrived with (chained)", async () => {
      const detailUrl = `/products/p-arroz?returnTo=${encodeURIComponent("/products?search=arr&page=2")}`;

      renderPage(`returnTo=${encodeURIComponent(detailUrl)}`);
      await findRow("Harina");

      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", detailUrl);
    });
  });
});
