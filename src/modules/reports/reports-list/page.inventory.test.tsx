/**
 * REP-07b · `/reports` con los tres reportes de inventario: el catálogo solo los
 * ofrece con `reports.view` + `inventory.view`, una URL directa sin permiso da
 * el 403 del tema sin pedir nada, y días, categoría, agrupación de la rotación
 * y página viven en la URL (regla 15) y se limpian al cambiar de reporte.
 *
 * También el filtro de estado del reporte de compras (`status` en la URL).
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission, UserRole } from "@/shared/auth/permissions";

import * as inventoryHooks from "../hooks/useInventoryReports";
import * as reportsHooks from "../hooks/useReports";
import type { DeadStockReport, DeadStockRow } from "../services/inventoryReports";
import { inventoryReportCatalog, storeReportCatalog } from "./config/reportCatalog";

type DeadStockRequest = { categoryId?: string; days?: number; limit?: number; skip?: number };

let mockRole: UserRole | undefined = "admin";
let mockIsLoading = false;
let mockRemoved: Permission[] = [];
/** Productos parados que «tiene» el servidor. */
let mockDeadStockTotal = 35;

function mockPermissions(): Permission[] {
  const all: Permission[] = mockRole
    ? jest.requireActual("../../../shared/auth/permissions").getRolePermissions(mockRole)
    : [];

  return all.filter((permission) => !mockRemoved.includes(permission));
}

jest.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: Permission) => mockPermissions().includes(permission),
    isLoading: mockIsLoading,
    permissions: mockPermissions(),
    role: mockRole,
  }),
}));

jest.mock("../hooks/useInventoryReports", () => {
  const idle = () => ({ data: undefined, error: null, isFetching: false, isLoading: false, refetch: jest.fn() });
  // Como react-query: la misma consulta devuelve siempre el mismo objeto `data`.
  const cache = new Map<string, unknown>();
  /** Como el servidor: devuelve solo la página pedida y el resumen de todo el conjunto. */
  const buildDeadStock = (filters: DeadStockRequest): DeadStockReport => {
    const limit = filters.limit ?? 10;
    const skip = filters.skip ?? 0;
    const count = Math.max(0, Math.min(limit, mockDeadStockTotal - skip));
    const items: DeadStockRow[] = Array.from({ length: count }, (_, index) => {
      const position = skip + index + 1;

      return {
        category: { id: "cat-a", name: "Víveres" },
        costRef: 1,
        daysIdle: 90,
        daysSinceLastMovement: 40,
        idleSince: "2026-02-17",
        lastMovementAt: "2026-04-08T15:00:00.000Z",
        lastSaleAt: "2026-02-17T15:00:00.000Z",
        product: {
          href: `/products/prod-${position}`,
          id: `prod-${position}`,
          name: `Producto ${position}`,
          sku: `SKU-${position}`,
        },
        stock: 100 - position,
        stockValueRef: 100 - position,
      };
    });

    return {
      asOf: "2026-05-18",
      days: filters.days ?? 30,
      items,
      limit,
      skip,
      summary: {
        idleValuePct: 25,
        idleValueRef: 500,
        inventoryValueRef: 2000,
        productsCount: mockDeadStockTotal,
      },
      total: mockDeadStockTotal,
    };
  };

  return {
    useDeadStockReport: jest.fn((filters: DeadStockRequest = {}) => {
      const key = JSON.stringify([filters, mockDeadStockTotal]);

      if (!cache.has(key)) {
        cache.set(key, buildDeadStock(filters));
      }

      return { ...idle(), data: cache.get(key) };
    }),
    useStockAdjustmentsReport: jest.fn(idle),
    useStockTurnoverReport: jest.fn(idle),
  };
});

jest.mock("../hooks/useReports", () => {
  const empty = () => ({
    data: { items: [], limit: 10, skip: 0, total: 0 },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  });

  return {
    ...jest.requireActual("../hooks/useReports"),
    useDailySalesReport: jest.fn(empty),
    useLowStockReport: jest.fn(empty),
    usePurchasesReport: jest.fn(empty),
  };
});

jest.mock("../../products/hooks/useProducts", () => ({
  ...jest.requireActual("../../products/hooks/useProducts"),
  useAllCategories: () => ({
    data: {
      items: [
        { id: "cat-a", name: "Víveres" },
        { id: "cat-b", name: "Limpieza" },
      ],
      limit: 2,
      skip: 0,
      total: 2,
    },
    error: null,
  }),
}));

jest.mock("../../purchases/hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(),
  usePurchaseSupplier: () => ({ data: undefined, error: null }),
}));

jest.mock("../../inventory/restock", () => ({
  RestockPurchaseButton: () => <button type="button">Crear compra con estos productos</button>,
}));

jest.mock("../../../shared/components/EntityAutocomplete", () => ({
  EntityAutocomplete: ({ label }: { label: string }) => <div data-testid="entity-filter">{label}</div>,
}));

jest.mock("./components/ReportsExportActions", () => ({
  ReportsExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <pre data-testid="export-filters">{JSON.stringify(exportFilters)}</pre>
  ),
}));

import { ReportsListPage } from "./page";

const hooks = jest.mocked(inventoryHooks);
const reports = jest.mocked(reportsHooks);
const INVENTORY_HOOKS = ["useDeadStockReport", "useStockAdjustmentsReport", "useStockTurnoverReport"] as const;
/** Con datos mock el día operativo es 2026-05-18: «últimos 30 días» empieza aquí. */
const DEFAULT_RANGE = { from: "2026-04-19", to: "2026-05-18" };

function renderPage(search = "") {
  window.history.replaceState(null, "", `/reports${search}`);

  return render(<ReportsListPage />);
}

function urlParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

function catalogToggle() {
  return screen.getByRole("button", { name: /^Reporte: / });
}

async function openCatalog(user: ReturnType<typeof userEvent.setup>) {
  if (catalogToggle().getAttribute("aria-expanded") !== "true") {
    await user.click(catalogToggle());
  }

  return screen.getByRole("navigation", { name: "Catálogo de reportes" });
}

function catalogNames(catalog: HTMLElement) {
  return within(catalog)
    .getAllByRole("button")
    .map((button) => button.querySelector("span > span")?.textContent ?? "");
}

describe("ReportsListPage · reportes de inventario (REP-07b)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockIsLoading = false;
    mockRemoved = [];
    mockDeadStockTotal = 35;
    // Escritorio: la paginación muestra sus botones, el catálogo no se pliega y la tabla abre desplegada.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: !query.includes("max-width"),
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
      writable: true,
    });
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  describe("catálogo según permisos", () => {
    it("administrador: los tres aparecen en Inventario, detrás de bajo stock y kardex", async () => {
      const user = userEvent.setup();
      renderPage();

      const catalog = await openCatalog(user);

      expect(within(catalog).getAllByRole("button")).toHaveLength(storeReportCatalog.length);

      const inventario = within(screen.getByRole("region", { name: "Inventario" }));

      expect(
        inventario.getAllByRole("button").map((button) => button.querySelector("span > span")?.textContent),
      ).toEqual([
        "Bajo stock",
        "Kardex de producto",
        "Productos sin movimiento",
        "Rotación de inventario",
        "Ajustes y mermas",
      ]);
    });

    it.each([
      ["contador", []],
      ["almacen", []],
      ["vendedor", []],
      ["admin", ["inventory.view"]],
    ] as const)("%s (sin %j): ninguno de los tres se ofrece", async (role, removed) => {
      mockRole = role;
      mockRemoved = [...removed];
      const user = userEvent.setup();
      renderPage();

      const names = catalogNames(await openCatalog(user));

      for (const report of inventoryReportCatalog) {
        expect(names).not.toContain(report.name);
      }
      expect(names).toContain("Bajo stock");
    });

    it("mientras carga la sesión tampoco se ofrecen", async () => {
      mockIsLoading = true;
      mockRole = undefined;
      const user = userEvent.setup();
      renderPage();

      const names = catalogNames(await openCatalog(user));

      for (const report of inventoryReportCatalog) {
        expect(names).not.toContain(report.name);
      }
    });

    it.each(inventoryReportCatalog.map((report) => [report.id, report.name] as const))(
      "URL directa a %s sin permiso: 403 del tema y ninguna petición",
      (id, name) => {
        mockRole = "contador";
        renderPage(`?report=${id}&from=2026-05-01&to=2026-05-10`);

        expect(screen.getByTestId("report-forbidden")).toHaveTextContent(`No tienes permiso para ver «${name}»`);
        for (const hook of INVENTORY_HOOKS) {
          expect(hooks[hook]).not.toHaveBeenCalled();
        }
        // La URL no se toca: al recibir el permiso, el mismo enlace abre el reporte.
        expect(urlParams().report).toBe(id);
      },
    );
  });

  describe("productos sin movimiento: días, categoría y página en la URL", () => {
    it("sin parámetros pide 30 días, todas las categorías y la primera página; no usa rango", () => {
      renderPage("?report=dead-stock");

      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith({
        categoryId: undefined,
        days: 30,
        limit: 10,
        skip: 0,
      });
      expect(screen.getByText("Este reporte no usa rango de fechas.")).toBeInTheDocument();
      expect(urlParams()).toEqual({ report: "dead-stock" });
    });

    it("la URL trae días, categoría, página y tamaño: se piden tal cual al servidor", () => {
      renderPage("?report=dead-stock&days=45&categoryId=cat-b&page=2&limit=25");

      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith({
        categoryId: "cat-b",
        days: 45,
        limit: 25,
        skip: 25,
      });
      expect(screen.getByLabelText("Otro valor (días)")).toHaveValue("45");
      expect(screen.getByLabelText("Categoría")).toHaveValue("cat-b");
    });

    it.each(["0", "3651", "2.5", "abc", "-4"])("days=%s no vale: cae a 30 días", (days) => {
      renderPage(`?report=dead-stock&days=${days}`);

      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith(expect.objectContaining({ days: 30 }));
    });

    it("pulsar un chip escribe `days`, vuelve a la página 1; 30 (por defecto) no se escribe", async () => {
      const user = userEvent.setup();
      renderPage("?report=dead-stock&page=3");

      await user.click(screen.getByRole("button", { name: "90 días" }));

      await waitFor(() => expect(urlParams()).toEqual({ days: "90", report: "dead-stock" }));
      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith({
        categoryId: undefined,
        days: 90,
        limit: 10,
        skip: 0,
      });
      expect(screen.getByRole("button", { name: "90 días" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("Otro valor (días)")).toHaveValue("90");

      await user.click(screen.getByRole("button", { name: "30 días" }));
      await waitFor(() => expect(urlParams()).toEqual({ report: "dead-stock" }));
    });

    it("un valor libre se escribe en `days` al salir del campo", async () => {
      const user = userEvent.setup();
      renderPage("?report=dead-stock");

      const input = screen.getByLabelText("Otro valor (días)");

      await user.clear(input);
      await user.type(input, "45");
      await user.tab();

      await waitFor(() => expect(urlParams()).toEqual({ days: "45", report: "dead-stock" }));
      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith(expect.objectContaining({ days: 45, skip: 0 }));
    });

    it("elegir categoría escribe `categoryId` y vuelve a la página 1", async () => {
      const user = userEvent.setup();
      renderPage("?report=dead-stock&page=2");

      await user.selectOptions(screen.getByLabelText("Categoría"), "cat-a");

      await waitFor(() => expect(urlParams()).toEqual({ categoryId: "cat-a", report: "dead-stock" }));
      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: "cat-a", skip: 0 }),
      );

      await user.selectOptions(screen.getByLabelText("Categoría"), "");
      await waitFor(() => expect(urlParams()).toEqual({ report: "dead-stock" }));
    });

    it("paginar escribe `page` y pide `skip` / `limit` al servidor: nunca llega más de una página", async () => {
      mockDeadStockTotal = 10_000;
      const user = userEvent.setup();
      renderPage("?report=dead-stock");

      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(11);

      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      await waitFor(() => expect(urlParams()).toEqual({ page: "2", report: "dead-stock" }));
      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, skip: 10 }));
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(11);
      expect(screen.getByRole("link", { name: "Producto 11" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Producto 1" })).not.toBeInTheDocument();
      for (const call of hooks.useDeadStockReport.mock.calls) {
        expect(call[0]?.limit).toBeLessThanOrEqual(100);
      }
    });

    it("el producto enlaza a su detalle con `returnTo` de la URL actual, con sus filtros", () => {
      renderPage("?report=dead-stock&days=90&page=2");

      expect(screen.getByRole("link", { name: "Producto 11" })).toHaveAttribute(
        "href",
        `/products/prod-11?returnTo=${encodeURIComponent("/reports?report=dead-stock&days=90&page=2")}`,
      );
    });

    it("al cambiar de reporte no se arrastran días, categoría ni página", async () => {
      const user = userEvent.setup();
      renderPage("?report=dead-stock&days=90&categoryId=cat-a&page=2");

      const catalog = await openCatalog(user);

      await user.click(within(catalog).getByRole("button", { name: /^Bajo stock/ }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "low-stock" }));

      await user.click(within(await openCatalog(user)).getByRole("button", { name: /^Productos sin movimiento/ }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "dead-stock" }));
      expect(hooks.useDeadStockReport).toHaveBeenLastCalledWith({
        categoryId: undefined,
        days: 30,
        limit: 10,
        skip: 0,
      });
    });
  });

  describe("rotación de inventario: rango y agrupación en la URL", () => {
    it("sin rango en la URL pide los últimos 30 días por producto, sin escribirlos", () => {
      renderPage("?report=stock-turnover");

      expect(hooks.useStockTurnoverReport).toHaveBeenLastCalledWith({
        ...DEFAULT_RANGE,
        groupBy: "product",
        limit: 10,
        skip: 0,
      });
      expect(urlParams()).toEqual({ report: "stock-turnover" });
      // No es un reporte de serie: no ofrece «Agrupar por» día / semana / mes.
      expect(screen.queryByRole("group", { name: "Agrupar por" })).not.toBeInTheDocument();
    });

    it("`turnoverBy` de la URL viaja como `groupBy` del endpoint; `groupBy` de la URL (día/semana/mes) no", () => {
      renderPage("?report=stock-turnover&turnoverBy=category&groupBy=week&from=2026-05-01&to=2026-05-10&page=2");

      expect(hooks.useStockTurnoverReport).toHaveBeenLastCalledWith({
        from: "2026-05-01",
        groupBy: "category",
        limit: 10,
        skip: 10,
        to: "2026-05-10",
      });
      expect(within(screen.getByRole("group", { name: "Ver por" })).getByRole("button", { name: "Categoría" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("el conmutador escribe `turnoverBy` y vuelve a la página 1; «Producto» (por defecto) no se escribe", async () => {
      const user = userEvent.setup();
      renderPage("?report=stock-turnover&page=3");

      const toggle = within(screen.getByRole("group", { name: "Ver por" }));

      await user.click(toggle.getByRole("button", { name: "Categoría" }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "stock-turnover", turnoverBy: "category" }));
      expect(hooks.useStockTurnoverReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupBy: "category", skip: 0 }),
      );

      await user.click(toggle.getByRole("button", { name: "Producto" }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "stock-turnover" }));
    });

    it("al salir del reporte la agrupación no se arrastra", async () => {
      const user = userEvent.setup();
      renderPage("?report=stock-turnover&turnoverBy=category");

      await user.click(within(await openCatalog(user)).getByRole("button", { name: /^Ajustes y mermas/ }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "stock-adjustments" }));
    });
  });

  describe("ajustes y mermas: rango y agrupación de serie en la URL", () => {
    it("sin parámetros pide los últimos 30 días con agrupación automática", () => {
      renderPage("?report=stock-adjustments");

      expect(hooks.useStockAdjustmentsReport).toHaveBeenLastCalledWith({
        ...DEFAULT_RANGE,
        groupBy: "auto",
        limit: 10,
        skip: 0,
      });
      expect(urlParams()).toEqual({ report: "stock-adjustments" });
    });

    it("«Agrupar por» escribe `groupBy` como en los reportes de serie", async () => {
      const user = userEvent.setup();
      renderPage("?report=stock-adjustments&page=2");

      await user.click(within(screen.getByRole("group", { name: "Agrupar por" })).getByRole("button", { name: "Semana" }));

      await waitFor(() => expect(urlParams()).toEqual({ groupBy: "week", report: "stock-adjustments" }));
      expect(hooks.useStockAdjustmentsReport).toHaveBeenLastCalledWith({
        ...DEFAULT_RANGE,
        groupBy: "week",
        limit: 10,
        skip: 0,
      });
      // No compara con el periodo anterior.
      expect(screen.queryByLabelText("Comparar con periodo anterior")).not.toBeInTheDocument();
    });
  });

  describe("compras: filtro de estado en la URL", () => {
    function statusChips() {
      return within(screen.getByRole("group", { name: "Estado" }));
    }

    it("por defecto no manda `status` (vigentes) y avisa de lo que deja fuera", () => {
      renderPage("?report=purchases");

      const request = reports.usePurchasesReport.mock.lastCall?.[0] ?? {};

      expect(request).toEqual(expect.objectContaining(DEFAULT_RANGE));
      expect("status" in request).toBe(false);
      expect(statusChips().getAllByRole("button").map((chip) => chip.textContent)).toEqual([
        "Vigentes (por defecto)",
        "Todas",
        "Pedidas",
        "Recibidas",
        "Canceladas",
        "Devueltas",
      ]);
      expect(statusChips().getByRole("button", { name: "Vigentes (por defecto)" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByText("No incluye compras canceladas ni devueltas.")).toBeInTheDocument();
    });

    it.each([
      ["Todas", "all"],
      ["Pedidas", "pedido"],
      ["Recibidas", "recibido"],
      ["Canceladas", "cancelado"],
      ["Devueltas", "devuelto"],
    ])("«%s» escribe status=%s, lo pasa al reporte, vuelve a la página 1 y quita el aviso", async (label, status) => {
      const user = userEvent.setup();
      renderPage("?report=purchases&page=2");

      await user.click(statusChips().getByRole("button", { name: label }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "purchases", status }));
      expect(reports.usePurchasesReport.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ ...DEFAULT_RANGE, skip: 0, status }),
      );
      expect(statusChips().getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByText("No incluye compras canceladas ni devueltas.")).not.toBeInTheDocument();
    });

    it("volver a «Vigentes» quita `status` de la URL y de la petición", async () => {
      const user = userEvent.setup();
      renderPage("?report=purchases&status=all");

      expect(reports.usePurchasesReport.mock.lastCall?.[0]).toEqual(expect.objectContaining({ status: "all" }));

      await user.click(statusChips().getByRole("button", { name: "Vigentes (por defecto)" }));

      await waitFor(() => expect(urlParams()).toEqual({ report: "purchases" }));
      expect("status" in (reports.usePurchasesReport.mock.lastCall?.[0] ?? {})).toBe(false);
      expect(screen.getByText("No incluye compras canceladas ni devueltas.")).toBeInTheDocument();
    });

    it("un status inventado en la URL cae al valor por defecto", () => {
      renderPage("?report=purchases&status=anulado");

      expect("status" in (reports.usePurchasesReport.mock.lastCall?.[0] ?? {})).toBe(false);
    });

    it("la exportación recibe el mismo estado que la pantalla", () => {
      renderPage("?report=purchases&status=cancelado&from=2026-05-01&to=2026-05-10");

      expect(JSON.parse(screen.getByTestId("export-filters").textContent ?? "{}")).toEqual({
        dateFilters: { from: "2026-05-01", to: "2026-05-10" },
        purchasesFilters: { from: "2026-05-01", status: "cancelado", to: "2026-05-10" },
        stockCardFilters: {},
      });
    });

    it("el estado no se ofrece fuera de compras ni se arrastra al cambiar de reporte", async () => {
      const user = userEvent.setup();
      renderPage("?report=purchases&status=all");

      await user.click(within(await openCatalog(user)).getByRole("button", { name: /^Ventas diarias/ }));

      // Ventas diarias es el reporte por defecto: tampoco se escribe.
      await waitFor(() => expect(urlParams()).toEqual({}));
      expect(screen.queryByRole("group", { name: "Estado" })).not.toBeInTheDocument();
    });
  });

  it("la exportación sigue recibiendo solo sus filtros de siempre en los reportes de inventario", () => {
    renderPage("?report=dead-stock&days=90&categoryId=cat-a");

    expect(JSON.parse(screen.getByTestId("export-filters").textContent ?? "{}")).toEqual({
      dateFilters: {},
      purchasesFilters: {},
      stockCardFilters: {},
    });
  });
});
