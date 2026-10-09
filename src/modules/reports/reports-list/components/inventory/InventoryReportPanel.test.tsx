/**
 * REP-07b · los tres reportes de inventario: datos, vacío, cargando, error, 403
 * sin petición, controles que avisan del cambio, paginación en servidor,
 * enlaces al producto con `returnTo` y notas de cada cifra.
 *
 * En jest `formatRef` devuelve `ref 120.00`.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission, UserRole } from "@/shared/auth/permissions";

import * as inventoryHooks from "../../../hooks/useInventoryReports";
import {
  buildDeadStockReport,
  buildStockAdjustmentsReport,
  type DeadStockReport,
  type ProductLedgerRow,
  type StockAdjustmentInput,
  type StockTurnoverMeasures,
  type StockTurnoverReport,
  type StockTurnoverRow,
} from "../../../services/inventoryReports";
import { getReportById, type ReportId } from "../../config/reportCatalog";
import type { InventoryReportFilters } from "../../reportsListParams";
import type { ReportPagination } from "../ReportTable";
import { InventoryReportPanel } from "./InventoryReportPanel";

type QueryState = { data?: unknown; error?: Error | null; isFetching?: boolean; isLoading?: boolean };

let mockRole: UserRole | undefined = "admin";
let mockIsLoading = false;
let mockRemoved: Permission[] = [];
let mockCategories: { id: string; name: string }[] | undefined;
const mockQueries: Partial<Record<keyof typeof inventoryHooks, QueryState>> = {};
const mockRefetch = jest.fn();

function mockPermissions(): Permission[] {
  const all: Permission[] = mockRole
    ? jest.requireActual("../../../../../shared/auth/permissions").getRolePermissions(mockRole)
    : [];

  return all.filter((permission) => !mockRemoved.includes(permission));
}

jest.mock("../../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: Permission) => mockPermissions().includes(permission),
    isLoading: mockIsLoading,
    permissions: mockPermissions(),
    role: mockRole,
  }),
}));

jest.mock("../../../hooks/useInventoryReports", () => {
  const hook = (name: string) =>
    jest.fn(() => ({
      data: undefined,
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: mockRefetch,
      ...mockQueries[name as keyof typeof mockQueries],
    }));

  return {
    useDeadStockReport: hook("useDeadStockReport"),
    useStockAdjustmentsReport: hook("useStockAdjustmentsReport"),
    useStockTurnoverReport: hook("useStockTurnoverReport"),
  };
});

// El selector de categorías es el de Productos e Inventario: aquí solo su lista.
jest.mock("../../../../products/hooks/useProducts", () => ({
  useAllCategories: () => ({
    data: mockCategories
      ? { items: mockCategories, limit: mockCategories.length, skip: 0, total: mockCategories.length }
      : undefined,
    error: null,
  }),
}));

const hooks = jest.mocked(inventoryHooks);
const RANGE = { from: "2026-05-01", to: "2026-05-31" };
const TODAY = "2026-05-18";
const LIST_HREF = "/reports?report=dead-stock&days=90&page=2";
const RETURN_TO = encodeURIComponent(LIST_HREF);
const ALL_HOOKS = ["useDeadStockReport", "useStockAdjustmentsReport", "useStockTurnoverReport"] as const;
const DEFAULT_FILTERS: InventoryReportFilters = { days: 30, turnoverBy: "product" };

function expectNoRequest() {
  for (const name of ALL_HOOKS) {
    expect(hooks[name]).not.toHaveBeenCalled();
  }
}

function pagination(overrides: Partial<ReportPagination> = {}): ReportPagination {
  return { limit: 10, setLimit: jest.fn(), setSkip: jest.fn(), skip: 0, ...overrides };
}

function renderPanel(
  id: ReportId,
  props: {
    dateFilters?: { from?: string; groupBy?: "auto" | "day" | "month" | "week"; to?: string };
    filters?: InventoryReportFilters;
    onFiltersChange?: (patch: Partial<InventoryReportFilters>) => void;
    pagination?: ReportPagination;
  } = {},
) {
  return render(
    <InventoryReportPanel
      dateFilters={props.dateFilters ?? RANGE}
      filters={props.filters}
      listHref={LIST_HREF}
      onFiltersChange={props.onFiltersChange}
      pagination={props.pagination ?? pagination()}
      report={getReportById(id)}
    />,
  );
}

function tableBody() {
  return within(screen.getByRole("table")).getAllByRole<HTMLTableRowElement>("row").slice(1);
}

function tableHeaders() {
  return within(screen.getByRole("table"))
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
}

// --- Productos sin movimiento ------------------------------------------------

function ledgerRow(overrides: Partial<ProductLedgerRow> & Pick<ProductLedgerRow, "productId">): ProductLedgerRow {
  const costRef = overrides.costRef ?? 1;
  const stock = overrides.stock ?? 1;

  return {
    categoryId: "cat-a",
    categoryName: "Víveres",
    costRef,
    idleSince: "2026-01-01",
    isActive: true,
    lastMovementAt: null,
    lastSaleAt: null,
    name: `Producto ${overrides.productId}`,
    sku: `SKU-${overrides.productId}`,
    stock,
    stockValueRef: stock * costRef,
    ...overrides,
  };
}

const LEDGER: ProductLedgerRow[] = [
  // 78 días sin vender; último movimiento hace 38.
  ledgerRow({
    costRef: 2,
    idleSince: "2026-03-01",
    lastMovementAt: "2026-04-10T15:00:00.000Z",
    lastSaleAt: "2026-03-01T15:00:00.000Z",
    name: "Harina",
    productId: "p-1",
    sku: "HAR-1",
    stock: 50,
  }),
  // Nunca se vendió ni se movió: cuenta desde su alta (128 días).
  ledgerRow({ costRef: 5, idleSince: "2026-01-10", name: "Aceite", productId: "p-2", sku: "ACE-1", stock: 10 }),
  // Se vendió hace 8 días: no entra con 30.
  ledgerRow({
    categoryId: "cat-b",
    categoryName: "Limpieza",
    costRef: 1,
    idleSince: "2026-05-10",
    lastSaleAt: "2026-05-10T15:00:00.000Z",
    name: "Jabón",
    productId: "p-3",
    sku: "JAB-1",
    stock: 30,
  }),
];

function deadStock(query: { categoryId?: string; days?: number; limit?: number; skip?: number } = {}): DeadStockReport {
  return buildDeadStockReport({
    query: { days: 30, limit: 10, skip: 0, ...query },
    rows: LEDGER,
    today: TODAY,
  });
}

/** Muchos productos parados, para paginar: el valor baja con la posición. */
function manyDeadStock(page: { limit: number; skip: number }): DeadStockReport {
  return buildDeadStockReport({
    query: { days: 30, ...page },
    rows: Array.from({ length: 35 }, (_, index) =>
      ledgerRow({
        costRef: 1,
        name: `Parado ${index + 1}`,
        productId: `m-${String(index + 1).padStart(2, "0")}`,
        stock: 100 - index,
      }),
    ),
    today: TODAY,
  });
}

// --- Rotación ----------------------------------------------------------------

function measures(overrides: Partial<StockTurnoverMeasures> = {}): StockTurnoverMeasures {
  return {
    averageStockValueRef: 100,
    closingStock: 40,
    cogsRef: 250,
    daysOfInventory: 12,
    openingStock: 60,
    soldUnits: 125,
    stock: 50,
    stockValueRef: 100,
    turnover: 2.5,
    ...overrides,
  };
}

const TURNOVER_PRODUCT_ROWS: StockTurnoverRow[] = [
  {
    ...measures(),
    category: { id: "cat-a", name: "Víveres" },
    key: "p-1",
    product: { href: "/products/p-1", id: "p-1", name: "Harina", sku: "HAR-1" },
    productsCount: 1,
  },
  {
    ...measures({ averageStockValueRef: 0, cogsRef: 0, daysOfInventory: null, soldUnits: 0, stock: 0, stockValueRef: 0, turnover: null }),
    category: { id: null, name: "Sin categoría" },
    key: "p-2",
    product: { href: "/products/p-2", id: "p-2", name: "Aceite", sku: "ACE-1" },
    productsCount: 1,
  },
];

const TURNOVER_CATEGORY_ROWS: StockTurnoverRow[] = [
  {
    ...measures({ turnover: 1 }),
    category: { id: "cat-a", name: "Víveres" },
    key: "cat-a",
    product: null,
    productsCount: 7,
  },
  {
    ...measures({ turnover: 0.5 }),
    category: { id: null, name: "Sin categoría" },
    key: "",
    product: null,
    productsCount: 2,
  },
];

function turnover(
  rows: StockTurnoverRow[],
  page: { groupBy?: "category" | "product"; limit?: number; skip?: number; total?: number } = {},
): StockTurnoverReport {
  return {
    groupBy: page.groupBy ?? "product",
    inventoryBasis: "average_opening_closing",
    items: rows,
    limit: page.limit ?? 10,
    range: RANGE,
    rangeDays: 31,
    skip: page.skip ?? 0,
    total: page.total ?? rows.length,
    totals: measures({ averageStockValueRef: 200, cogsRef: 250, daysOfInventory: 24.8, turnover: 1.25 }),
  };
}

// --- Ajustes y mermas --------------------------------------------------------

function adjustment(
  seq: number,
  date: string,
  quantityDelta: number,
  reason: string,
  product: { id: string; name: string; unitCostRef: number } = { id: "p-1", name: "Harina", unitCostRef: 2 },
): StockAdjustmentInput {
  return {
    createdAt: `${date}T14:00:00.000Z`,
    date,
    movementId: `mov-${seq}`,
    productId: product.id,
    productName: product.name,
    quantityDelta,
    reason,
    seq,
    sku: `SKU-${product.id}`,
    type: quantityDelta < 0 ? "ajuste_salida" : "ajuste_entrada",
    unitCostRef: product.unitCostRef,
    valueRef: quantityDelta * product.unitCostRef,
  };
}

const ACEITE = { id: "p-2", name: "Aceite", unitCostRef: 5 };

/** Merma: 20 de salidas. Conteo: 6 de entradas y 2 de salidas. */
const ADJUSTMENTS: StockAdjustmentInput[] = [
  adjustment(1, "2026-05-02", -5, "Merma"),
  adjustment(2, "2026-05-03", 3, "Conteo"),
  adjustment(3, "2026-05-10", -2, "Merma", ACEITE),
  adjustment(4, "2026-05-10", -1, "Conteo"),
];

function adjustments(rows: StockAdjustmentInput[] = ADJUSTMENTS, page: { limit?: number; skip?: number } = {}) {
  return buildStockAdjustmentsReport({
    query: { ...RANGE, groupBy: "day", limit: page.limit ?? 10, skip: page.skip ?? 0 },
    rows,
  });
}

function setViewport(kind: "desktop" | "mobile") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query.includes("max-width") ? kind === "mobile" : kind === "desktop",
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    writable: true,
  });
}

describe("InventoryReportPanel · REP-07b", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;
  let rectSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockIsLoading = false;
    mockRemoved = [];
    mockCategories = [
      { id: "cat-a", name: "Víveres" },
      { id: "cat-b", name: "Limpieza" },
    ];

    for (const key of Object.keys(mockQueries)) {
      delete mockQueries[key as keyof typeof mockQueries];
    }

    setViewport("desktop");
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    // Recharts mide su contenedor: en jsdom todo mide 0 y no dibuja.
    rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function measure(this: HTMLElement) {
        return (
          this.id === "recharts_measurement_span"
            ? { height: 13, width: (this.textContent ?? "").length * 6.6 }
            : { height: 280, width: 390 }
        ) as DOMRect;
      });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rectSpy.mockRestore();
    warnSpy.mockRestore();
    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  describe("permisos: 403 del tema sin pedir nada al servidor", () => {
    it.each([
      ["dead-stock", "contador", []],
      ["stock-turnover", "almacen", []],
      ["stock-adjustments", "vendedor", []],
      ["dead-stock", "admin", ["inventory.view"]],
      ["stock-turnover", "admin", ["reports.view"]],
      ["stock-adjustments", "admin", ["inventory.view"]],
    ] as const)("%s con %s (sin %j): estado sin permiso y ninguna petición", (id, role, removed) => {
      mockRole = role;
      mockRemoved = [...removed];
      renderPanel(id);

      const forbidden = screen.getByTestId("report-forbidden");

      expect(forbidden).toHaveTextContent(`No tienes permiso para ver «${getReportById(id).name}»`);
      expect(forbidden).toHaveTextContent("Pide a un administrador de la tienda que te dé acceso.");
      expectNoRequest();
    });

    it("mientras carga la sesión no pide nada y avisa que está cargando", () => {
      mockIsLoading = true;
      mockRole = undefined;
      renderPanel("dead-stock");

      expect(screen.getByText("Cargando reporte")).toBeInTheDocument();
      expect(screen.queryByTestId("report-forbidden")).not.toBeInTheDocument();
      expectNoRequest();
    });

    it("un 403 del servidor (permiso retirado con la sesión abierta) también es el estado sin permiso", () => {
      const { ClientApiError } = jest.requireActual("../../../../../shared/api/apiFetch");

      mockQueries.useStockTurnoverReport = {
        error: new ClientApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta accion."),
      };
      renderPanel("stock-turnover");

      expect(screen.getByTestId("report-forbidden")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    });
  });

  describe("productos sin movimiento", () => {
    it("pide días, categoría y la página visible; por defecto 30 días y todas las categorías", () => {
      mockQueries.useDeadStockReport = { data: deadStock() };
      const first = renderPanel("dead-stock");

      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith({
        categoryId: undefined,
        days: 30,
        limit: 10,
        skip: 0,
      });
      first.unmount();

      renderPanel("dead-stock", {
        filters: { categoryId: "cat-a", days: 90, turnoverBy: "product" },
        pagination: pagination({ limit: 25, skip: 50 }),
      });

      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith({
        categoryId: "cat-a",
        days: 90,
        limit: 25,
        skip: 50,
      });
    });

    it("resumen de todo el conjunto: productos, capital inmovilizado y % del inventario", () => {
      mockQueries.useDeadStockReport = { data: deadStock() };
      renderPanel("dead-stock");

      const summary = screen.getByLabelText("Resumen de productos sin movimiento");
      const values = [...summary.querySelectorAll("div")].map((tile) => tile.textContent);

      // Harina 100 + Aceite 50 = 150 de 180 (el jabón, vendido hace 8 días, no entra).
      expect(values).toEqual([
        "Productos sin movimiento2",
        "Capital inmovilizadoref 150.00",
        "Del valor del inventario83,3 %de ref 180.00 en inventario",
      ]);
      expect(screen.getByRole("note")).toHaveTextContent(
        "Sin movimiento = días sin vender; el valor usa el costo actual (IVA incluido).",
      );
    });

    it("el % del inventario es «—» si el inventario no vale nada", () => {
      const report = deadStock();

      mockQueries.useDeadStockReport = {
        data: { ...report, summary: { ...report.summary, idleValuePct: null, inventoryValueRef: 0 } },
      };
      renderPanel("dead-stock");

      expect(screen.getByLabelText("Resumen de productos sin movimiento")).toHaveTextContent(
        "Del valor del inventario—",
      );
    });

    it("barras por valor inmovilizado, de mayor a menor", () => {
      mockQueries.useDeadStockReport = { data: deadStock() };
      const { container } = renderPanel("dead-stock");

      expect(screen.getByRole("img")).toHaveAccessibleName(
        "Productos sin movimiento: valor inmovilizado en REF: 2 elementos. 1. Harina: ref 100.00. 2. Aceite: ref 50.00.",
      );
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("la primera página es el top global; las siguientes dicen que son de la página", () => {
      mockQueries.useDeadStockReport = { data: manyDeadStock({ limit: 10, skip: 0 }) };
      const first = renderPanel("dead-stock");
      const chartCard = () => screen.getByRole("region", { name: "Gráfico: Productos sin movimiento" });

      expect(chartCard()).toHaveTextContent("30 días o más sin vender · Valor inmovilizado en REF · Top 10 de 35 productos");
      expect(chartCard()).not.toHaveTextContent("de esta página");
      first.unmount();

      mockQueries.useDeadStockReport = { data: manyDeadStock({ limit: 10, skip: 10 }) };
      renderPanel("dead-stock", { pagination: pagination({ skip: 10 }) });

      expect(chartCard()).toHaveTextContent("Top 10 de esta página");
      expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("1. Parado 11: ref 90.00."));
    });

    it("la tabla trae SKU, categoría, stock, costo, valor, última venta y los dos conteos de días", () => {
      mockQueries.useDeadStockReport = { data: deadStock() };
      renderPanel("dead-stock");

      expect(tableHeaders()).toEqual([
        "Producto",
        "SKU",
        "Categoría",
        "Stock",
        "Costo",
        "Valor",
        "Última venta",
        "Días sin vender",
        "Días desde el último movimiento",
      ]);
      expect(tableBody().map((row) => [...row.cells].map((cell) => cell.textContent))).toEqual([
        ["Harina", "HAR-1", "Víveres", "50", "ref 2.00", "ref 100.00", "01/03/2026", "78", "38"],
        ["Aceite", "ACE-1", "Víveres", "10", "ref 5.00", "ref 50.00", "Nunca", "128", "—"],
      ]);
    });

    it("el producto enlaza a su detalle con returnTo de la URL actual", () => {
      mockQueries.useDeadStockReport = { data: deadStock() };
      renderPanel("dead-stock");

      expect(screen.getByRole("link", { name: "Harina" })).toHaveAttribute(
        "href",
        `/products/p-1?returnTo=${RETURN_TO}`,
      );
    });

    it("chips de 30 / 60 / 90 / 180 días: el activo sale pulsado y pulsar otro avisa", async () => {
      const onFiltersChange = jest.fn();

      mockQueries.useDeadStockReport = { data: deadStock() };
      renderPanel("dead-stock", { filters: { ...DEFAULT_FILTERS, days: 60 }, onFiltersChange });

      const chips = within(screen.getByRole("group", { name: "Días sin vender" }));

      expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
        "30 días",
        "60 días",
        "90 días",
        "180 días",
      ]);
      expect(chips.getByRole("button", { name: "60 días" })).toHaveAttribute("aria-pressed", "true");
      expect(chips.getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "false");

      await userEvent.click(chips.getByRole("button", { name: "180 días" }));

      expect(onFiltersChange).toHaveBeenLastCalledWith({ days: 180 });
    });

    it("valor libre: avisa al salir del campo o con Enter, no en cada tecla, y acota a 1–3650", async () => {
      const onFiltersChange = jest.fn();
      const user = userEvent.setup();

      mockQueries.useDeadStockReport = { data: deadStock() };
      renderPanel("dead-stock", { onFiltersChange });

      const input = screen.getByLabelText("Otro valor (días)");

      expect(input).toHaveValue("30");
      expect(input).not.toHaveAttribute("type", "number");
      // Ningún chip coincide con un valor libre, pero 30 sí es un chip.
      expect(screen.getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "true");

      await user.clear(input);
      await user.type(input, "45");

      expect(onFiltersChange).not.toHaveBeenCalled();

      await user.tab();

      expect(onFiltersChange).toHaveBeenCalledTimes(1);
      expect(onFiltersChange).toHaveBeenLastCalledWith({ days: 45 });

      await user.clear(input);
      await user.type(input, "99999{Enter}");

      expect(onFiltersChange).toHaveBeenLastCalledWith({ days: 3650 });
    });

    it("valor libre vacío o igual al actual no pide nada", async () => {
      const onFiltersChange = jest.fn();
      const user = userEvent.setup();

      mockQueries.useDeadStockReport = { data: deadStock() };
      renderPanel("dead-stock", { onFiltersChange });

      const input = screen.getByLabelText("Otro valor (días)");

      await user.clear(input);
      await user.tab();
      await user.click(input);
      await user.tab();

      expect(onFiltersChange).not.toHaveBeenCalled();
      expect(input).toHaveValue("30");
    });

    it("con un valor libre en la URL ningún chip sale pulsado y el campo lo muestra", () => {
      mockQueries.useDeadStockReport = { data: deadStock({ days: 45 }) };
      renderPanel("dead-stock", { filters: { ...DEFAULT_FILTERS, days: 45 } });

      for (const chip of within(screen.getByRole("group", { name: "Días sin vender" })).getAllByRole("button")) {
        expect(chip).toHaveAttribute("aria-pressed", "false");
      }
      expect(screen.getByLabelText("Otro valor (días)")).toHaveValue("45");
      expect(screen.getByRole("region", { name: "Gráfico: Productos sin movimiento" })).toHaveTextContent(
        "45 días o más sin vender",
      );
    });

    it("filtro de categoría: lista las categorías, marca la de la URL y avisa del cambio", async () => {
      const onFiltersChange = jest.fn();

      mockQueries.useDeadStockReport = { data: deadStock({ categoryId: "cat-a" }) };
      renderPanel("dead-stock", { filters: { ...DEFAULT_FILTERS, categoryId: "cat-a" }, onFiltersChange });

      const select = screen.getByLabelText("Categoría");

      expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Todas las categorías",
        "Víveres",
        "Limpieza",
      ]);
      expect(select).toHaveValue("cat-a");

      await userEvent.selectOptions(select, "cat-b");
      expect(onFiltersChange).toHaveBeenLastCalledWith({ categoryId: "cat-b" });

      await userEvent.selectOptions(select, "");
      expect(onFiltersChange).toHaveBeenLastCalledWith({ categoryId: undefined });
    });

    it("una categoría de la URL que no está en la lista sigue elegida, con el nombre de las filas", () => {
      mockCategories = undefined;
      mockQueries.useDeadStockReport = { data: deadStock({ categoryId: "cat-a" }) };
      renderPanel("dead-stock", { filters: { ...DEFAULT_FILTERS, categoryId: "cat-a" } });

      const select = screen.getByLabelText("Categoría");

      expect(select).toHaveValue("cat-a");
      expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Todas las categorías",
        "Víveres",
      ]);
    });

    it("pide al servidor solo la página visible y paginar avisa del nuevo skip", async () => {
      const page = pagination({ limit: 10, skip: 0 });

      mockQueries.useDeadStockReport = { data: manyDeadStock({ limit: 10, skip: 0 }) };
      renderPanel("dead-stock", { pagination: page });

      expect(tableBody()).toHaveLength(10);
      expect(screen.getAllByText("Mostrando 1-10 de 35 registros").length).toBeGreaterThan(0);

      await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));

      expect(page.setSkip).toHaveBeenLastCalledWith(10);
    });

    it("una página que ya no existe vuelve a la primera", () => {
      const page = pagination({ skip: 40 });

      mockQueries.useDeadStockReport = { data: manyDeadStock({ limit: 10, skip: 40 }) };
      renderPanel("dead-stock", { pagination: page });

      expect(page.setSkip).toHaveBeenCalledWith(0);
    });

    it("vacío: mensaje con los días pedidos, sin tabla; los controles siguen a mano", () => {
      mockQueries.useDeadStockReport = { data: deadStock({ days: 365 }) };
      const { container } = renderPanel("dead-stock", { filters: { ...DEFAULT_FILTERS, days: 365 } });

      expect(screen.getByText("Ningún producto sin movimiento")).toBeInTheDocument();
      expect(
        screen.getByText("No hay productos con stock que lleven 365 días o más sin venderse."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Días sin vender" })).toBeInTheDocument();
      expect(screen.getByLabelText("Categoría")).toBeInTheDocument();
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("cargando y error con reintento", async () => {
      mockQueries.useDeadStockReport = { isLoading: true };
      const loading = renderPanel("dead-stock");

      expect(screen.getByRole("status", { name: /Cargando Productos sin movimiento/ })).toBeInTheDocument();
      loading.unmount();

      mockQueries.useDeadStockReport = { error: new Error("Failed to fetch") };
      renderPanel("dead-stock");

      expect(screen.getByText("No se pudo generar el reporte")).toBeInTheDocument();
      // REP-F8 R-11: un fallo que no es de negocio no enseña su mensaje interno.
      expect(screen.getByText("No pudimos cargar el reporte.")).toBeInTheDocument();
      expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it("390 px: la tabla abre plegada bajo el gráfico", () => {
      setViewport("mobile");
      mockQueries.useDeadStockReport = { data: deadStock() };
      renderPanel("dead-stock");

      expect(screen.getByRole("img")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Tabla de datos/ })).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("rotación de inventario", () => {
    it("pide el rango, la agrupación (como groupBy del endpoint) y la página", () => {
      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_PRODUCT_ROWS) };
      const first = renderPanel("stock-turnover");

      expect(hooks.useStockTurnoverReport).toHaveBeenLastCalledWith({
        from: RANGE.from,
        groupBy: "product",
        limit: 10,
        skip: 0,
        to: RANGE.to,
      });
      first.unmount();

      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_CATEGORY_ROWS, { groupBy: "category" }) };
      renderPanel("stock-turnover", {
        filters: { ...DEFAULT_FILTERS, turnoverBy: "category" },
        pagination: pagination({ limit: 25, skip: 25 }),
      });

      expect(hooks.useStockTurnoverReport).toHaveBeenLastCalledWith({
        from: RANGE.from,
        groupBy: "category",
        limit: 25,
        skip: 25,
        to: RANGE.to,
      });
    });

    it("conmutador Producto / Categoría: el activo sale pulsado y pulsar el otro avisa", async () => {
      const onFiltersChange = jest.fn();

      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_PRODUCT_ROWS) };
      renderPanel("stock-turnover", { onFiltersChange });

      const toggle = within(screen.getByRole("group", { name: "Ver por" }));

      expect(toggle.getByRole("button", { name: "Producto" })).toHaveAttribute("aria-pressed", "true");
      expect(toggle.getByRole("button", { name: "Categoría" })).toHaveAttribute("aria-pressed", "false");

      await userEvent.click(toggle.getByRole("button", { name: "Categoría" }));

      expect(onFiltersChange).toHaveBeenLastCalledWith({ turnoverBy: "category" });
    });

    it("por producto: rotación con 2 decimales y «—» cuando no se puede calcular", () => {
      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_PRODUCT_ROWS) };
      renderPanel("stock-turnover");

      expect(tableHeaders()).toEqual([
        "Producto",
        "SKU",
        "Categoría",
        "Unidades vendidas",
        "Costo de lo vendido",
        "Stock",
        "Valor de stock",
        "Rotación",
        "Días de inventario",
      ]);
      expect(tableBody().map((row) => [...row.cells].map((cell) => cell.textContent))).toEqual([
        ["Harina", "HAR-1", "Víveres", "125", "ref 250.00", "50", "ref 100.00", "2,50", "12"],
        ["Aceite", "ACE-1", "Sin categoría", "0", "ref 0.00", "0", "ref 0.00", "—", "—"],
      ]);
      expect(screen.getByRole("link", { name: "Harina" })).toHaveAttribute(
        "href",
        `/products/p-1?returnTo=${RETURN_TO}`,
      );
    });

    it("por categoría: una fila por categoría con su nº de productos, sin enlaces", () => {
      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_CATEGORY_ROWS, { groupBy: "category" }) };
      renderPanel("stock-turnover", { filters: { ...DEFAULT_FILTERS, turnoverBy: "category" } });

      expect(tableHeaders().slice(0, 2)).toEqual(["Categoría", "Productos"]);
      expect(tableBody().map((row) => [...row.cells].slice(0, 2).map((cell) => cell.textContent))).toEqual([
        ["Víveres", "7"],
        ["Sin categoría", "2"],
      ]);
      expect(within(screen.getByRole("table")).queryAllByRole("link")).toHaveLength(0);
      expect(screen.getByRole("img")).toHaveAccessibleName(
        "Rotación de inventario: rotación por categoría: 2 elementos. 1. Víveres: 1,00 vez. 2. Sin categoría: 0,50 veces.",
      );
    });

    it("barras por rotación: solo las filas con rotación calculable", () => {
      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_PRODUCT_ROWS) };
      const { container } = renderPanel("stock-turnover");

      expect(screen.getByRole("img")).toHaveAccessibleName(
        "Rotación de inventario: rotación por producto: 1 elemento. 1. Harina: 2,50 veces.",
      );
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("dice si el top es global (primera página) o de la página", () => {
      const chartCard = () => screen.getByRole("region", { name: "Gráfico: Rotación de inventario" });

      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_PRODUCT_ROWS, { total: 40 }) };
      const first = renderPanel("stock-turnover");

      expect(chartCard()).toHaveTextContent("Rotación por producto · Top 1 de 40 productos");
      first.unmount();

      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_PRODUCT_ROWS, { skip: 10, total: 40 }) };
      renderPanel("stock-turnover", { pagination: pagination({ skip: 10 }) });

      expect(chartCard()).toHaveTextContent("Top 1 de esta página");
    });

    it("totales de todo el reporte y la nota de cómo se calcula", () => {
      mockQueries.useStockTurnoverReport = { data: turnover(TURNOVER_PRODUCT_ROWS) };
      renderPanel("stock-turnover");

      const totals = [...screen.getByLabelText("Totales de rotación").querySelectorAll("div")].map(
        (tile) => tile.textContent,
      );

      expect(totals).toEqual([
        "Rotación1,25en 31 días",
        "Días de inventario24,8",
        "Costo de lo vendidoref 250.00",
        "Inventario promedioref 200.00apertura y cierre, a costo actual",
        "Valor de stockref 100.00hoy",
        "Unidades vendidas125",
      ]);
      expect(screen.getByRole("note")).toHaveTextContent(
        "Rotación = costo de lo vendido / inventario promedio (apertura y cierre) a costo actual.",
      );
    });

    it("sin rango completo pide que se elija uno", () => {
      renderPanel("stock-turnover", { dateFilters: {} });

      expect(screen.getByText("Elige un rango de fechas")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      // El conmutador sigue a mano.
      expect(screen.getByRole("group", { name: "Ver por" })).toBeInTheDocument();
    });

    it("vacío, cargando y error con reintento", async () => {
      mockQueries.useStockTurnoverReport = { data: turnover([]) };
      const empty = renderPanel("stock-turnover");

      expect(screen.getByText("Sin rotación en este periodo")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(empty.container.innerHTML).not.toMatch(/NaN|Infinity/);
      empty.unmount();

      mockQueries.useStockTurnoverReport = { isLoading: true };
      const loading = renderPanel("stock-turnover");

      expect(screen.getByRole("status", { name: /Cargando Rotación de inventario/ })).toBeInTheDocument();
      loading.unmount();

      mockQueries.useStockTurnoverReport = { error: new Error("Sin conexión") };
      renderPanel("stock-turnover");

      expect(screen.getByText("No se pudo generar el reporte")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("ajustes y mermas", () => {
    it("pide el rango, la agrupación de la URL y la página", () => {
      mockQueries.useStockAdjustmentsReport = { data: adjustments() };
      renderPanel("stock-adjustments", {
        dateFilters: { ...RANGE, groupBy: "week" },
        pagination: pagination({ limit: 25, skip: 25 }),
      });

      expect(hooks.useStockAdjustmentsReport).toHaveBeenLastCalledWith({
        from: RANGE.from,
        groupBy: "week",
        limit: 25,
        skip: 25,
        to: RANGE.to,
      });
    });

    it("por motivo: barras por valor movido a costo, diciendo si son entradas o salidas", () => {
      mockQueries.useStockAdjustmentsReport = { data: adjustments() };
      renderPanel("stock-adjustments");

      const byReason = within(screen.getByRole("region", { name: "Ajustes por motivo" }));

      expect(byReason.getByRole("img")).toHaveAccessibleName(
        "Ajustes y mermas: valor movido por motivo: 2 elementos. " +
          "1. Merma · salidas: ref 20.00. 2. Conteo · entradas y salidas: ref 8.00.",
      );
      expect(byReason.getByText("Valor movido a costo (entradas + salidas), en REF")).toBeInTheDocument();
    });

    it("por periodo: dos series, entradas y salidas, en REF y sin conmutador de moneda", () => {
      mockQueries.useStockAdjustmentsReport = { data: adjustments() };
      const { container } = renderPanel("stock-adjustments", { dateFilters: { ...RANGE, groupBy: "day" } });

      const byPeriod = within(screen.getByRole("region", { name: "Ajustes por periodo" }));
      const chart = byPeriod.getByRole("img");

      expect(chart).toHaveAccessibleName(expect.stringMatching(/^Ajustes y mermas: entradas y salidas por periodo: 31 puntos/));
      expect(chart).toHaveAccessibleName(expect.stringContaining("Entradas: total ref 6.00"));
      expect(chart).toHaveAccessibleName(expect.stringContaining("Salidas: total ref 22.00"));
      expect(byPeriod.getByText("Entradas")).toBeInTheDocument();
      expect(byPeriod.getByText("Salidas")).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Moneda del gráfico" })).not.toBeInTheDocument();
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("totales de todo el rango: entradas, salidas y neto con signo", () => {
      mockQueries.useStockAdjustmentsReport = { data: adjustments() };
      renderPanel("stock-adjustments");

      const totals = [...screen.getByLabelText("Totales de ajustes").querySelectorAll("div")].map(
        (tile) => tile.textContent,
      );

      expect(totals).toEqual(["Entradasref 6.003 uds", "Salidasref 22.008 uds", "Neto−ref 16.00−5 uds"]);
      expect(screen.getByRole("region", { name: "Gráfico: Ajustes y mermas" })).toHaveTextContent(
        "Neto a costo −ref 16.00",
      );
    });

    it("la nota dice con qué costo se valora; con agrupación automática por semana lo avisa", () => {
      mockQueries.useStockAdjustmentsReport = { data: adjustments() };
      const daily = renderPanel("stock-adjustments", { dateFilters: { ...RANGE, groupBy: "auto" } });

      expect(screen.getByRole("note")).toHaveTextContent(/^Valorizado al costo actual del producto\.$/);
      expect(screen.getByRole("region", { name: "Gráfico: Ajustes y mermas" })).toHaveTextContent("· por día");
      daily.unmount();

      mockQueries.useStockAdjustmentsReport = { data: { ...adjustments(), groupBy: "week" } };
      renderPanel("stock-adjustments", { dateFilters: { ...RANGE, groupBy: "auto" } });

      expect(screen.getByRole("note")).toHaveTextContent(
        "Valorizado al costo actual del producto. Agrupado por semana automáticamente.",
      );
    });

    it("la tabla trae fecha de Caracas, producto, cantidad con signo, motivo y valor; nada por usuario", () => {
      mockQueries.useStockAdjustmentsReport = { data: adjustments() };
      renderPanel("stock-adjustments");

      expect(tableHeaders()).toEqual(["Fecha", "Producto", "Cantidad", "Motivo", "Valor"]);

      const body = tableBody();

      // Del movimiento más reciente al más antiguo. 14:00 UTC = 10:00 en Caracas.
      expect(body.map((row) => [...row.cells].slice(1).map((cell) => cell.textContent))).toEqual([
        ["Harina", "−1", "Conteo", "−ref 2.00"],
        ["Aceite", "−2", "Merma", "−ref 10.00"],
        ["Harina", "+3", "Conteo", "+ref 6.00"],
        ["Harina", "−5", "Merma", "−ref 10.00"],
      ]);
      expect(body[3]?.cells[0]).toHaveTextContent(/02\/05\/2026.*10:00/);
      expect(body.map((row) => row.querySelector("[data-direction]")?.getAttribute("data-direction"))).toEqual([
        "salida",
        "salida",
        "entrada",
        "salida",
      ]);
      expect(within(screen.getByRole("table")).getAllByRole("link")[1]).toHaveAttribute(
        "href",
        `/products/p-2?returnTo=${RETURN_TO}`,
      );
    });

    it("pide al servidor solo la página visible y una página que ya no existe vuelve a la primera", () => {
      const page = pagination({ limit: 2, skip: 10 });

      mockQueries.useStockAdjustmentsReport = { data: adjustments(ADJUSTMENTS, { limit: 2, skip: 10 }) };
      renderPanel("stock-adjustments", { pagination: page });

      expect(hooks.useStockAdjustmentsReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 2, skip: 10 }),
      );
      expect(page.setSkip).toHaveBeenCalledWith(0);
    });

    it("sin rango completo pide que se elija uno", () => {
      renderPanel("stock-adjustments", { dateFilters: {} });

      expect(screen.getByText("Elige un rango de fechas")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("vacío, cargando y error con reintento", async () => {
      mockQueries.useStockAdjustmentsReport = { data: adjustments([]) };
      const empty = renderPanel("stock-adjustments");

      expect(screen.getByText("Sin ajustes en este periodo")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(empty.container.innerHTML).not.toMatch(/NaN|Infinity/);
      empty.unmount();

      mockQueries.useStockAdjustmentsReport = { isLoading: true };
      const loading = renderPanel("stock-adjustments");

      expect(screen.getAllByRole("status", { name: /Cargando Ajustes y mermas/ })).toHaveLength(2);
      loading.unmount();

      mockQueries.useStockAdjustmentsReport = { error: new Error("Sin conexión") };
      renderPanel("stock-adjustments");

      expect(screen.getByText("No se pudo generar el reporte")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });
});
