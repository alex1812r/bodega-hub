/**
 * REP-03 · `/reports`: catálogo agrupado con búsqueda, estado en la URL (regla
 * 15: reporte, rango, agrupación, comparación, proveedor, producto y página),
 * un solo control de fechas sin inputs nativos y paginación que no se arrastra
 * de un reporte a otro (D20).
 *
 * REP-04 · rango por defecto (últimos 30 días, sin escribirlo en la URL) en los
 * reportes con gráfico y fechas; «todas las fechas» sigue disponible; la
 * paginación de depreciación FX vive en la URL.
 */
import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as reportsHooks from "../hooks/useReports";
import { REPORT_IDS, storeReportCatalog as reportCatalog, type ReportId } from "./config/reportCatalog";

type PageRequest = { limit?: number; skip?: number };

/** Filas de cada reporte de tabla; el resto responde vacío. */
const mockTotals: Record<string, number> = {};
const mockSupplierSearch = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock("../hooks/useReports", () => {
  const pagedReport = (slug: string) => (filters: PageRequest = {}) => {
    const total = mockTotals[slug] ?? 0;
    const limit = filters.limit ?? 10;
    const skip = filters.skip ?? 0;
    const count = Math.max(0, Math.min(limit, total - skip));

    return {
      data: {
        items: Array.from({ length: count }, (_, index) => {
          const position = skip + index + 1;

          return {
            costRef: 1,
            createdAt: "2026-05-10T12:00:00.000Z",
            currentStock: 1,
            customerId: `id-${position}`,
            grossProfitRef: 1,
            id: `id-${position}`,
            itemsCount: 1,
            minStock: 2,
            name: `Fila ${position}`,
            paidVes: 1,
            pendingVes: 0,
            productId: `Fila ${position}`,
            purchaseNumber: `Fila ${position}`,
            purchasesCount: 1,
            quantityDelta: 1,
            revenueRef: 2,
            saleDate: "2026-05-10",
            salesCount: 1,
            sku: `SKU-${position}`,
            stockAfter: 1,
            supplierId: `id-${position}`,
            totalRef: 1,
            totalVes: position,
            type: "venta",
            unitsSold: 1,
          };
        }),
        limit,
        skip,
        total,
      },
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: jest.fn(),
    };
  };
  const idle = () => ({ data: undefined, error: null, isFetching: false, isLoading: false });

  return {
    ...jest.requireActual("../hooks/useReports"),
    useCustomerPurchasesReport: jest.fn(pagedReport("customer-purchases")),
    useDailyCloseReport: jest.fn(idle),
    useDailySalesReport: jest.fn(pagedReport("daily-sales")),
    useFxDepreciationReport: jest.fn(idle),
    useGrossProfitReport: jest.fn(pagedReport("gross-profit")),
    useLowStockReport: jest.fn(pagedReport("low-stock")),
    usePaymentMethodsReport: jest.fn(() => ({
      data: {
        items: [],
        limit: 10,
        skip: 0,
        summary: { paymentCount: 0, totalRef: 0, totalVes: 0 },
        total: 0,
      },
      error: null,
      isFetching: false,
      isLoading: false,
    })),
    useProductProfitabilityReport: jest.fn(pagedReport("product-profitability")),
    usePurchasesReport: jest.fn(pagedReport("purchases")),
    useStockCardReport: jest.fn(pagedReport("stock-card")),
    useSupplierPurchasesReport: jest.fn(pagedReport("supplier-purchases")),
    useTopCustomersReport: jest.fn(pagedReport("top-customers")),
    useTopProductsReport: jest.fn(pagedReport("top-products")),
  };
});

// Sesión de administrador: ve los 18 reportes (los de dinero piden permisos propios).
jest.mock("../../../shared/auth/usePermission", () => {
  const { getRolePermissions } = jest.requireActual("../../../shared/auth/permissions");
  const permissions = getRolePermissions("admin");

  return { usePermission: () => ({ can: () => true, isLoading: false, permissions, role: "admin" }) };
});

// Los reportes de dinero (REP-06b) tienen sus pruebas en `page.money.test.tsx`.
jest.mock("../hooks/useMoneyReports", () => {
  const idle = () => ({
    data: undefined,
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  });

  return {
    useCashCloseDifferencesReport: jest.fn(idle),
    usePayablesAgingReport: jest.fn(idle),
    useReceivablesAgingReport: jest.fn(idle),
    useSalesByCategoryReport: jest.fn(idle),
    useSalesByHourReport: jest.fn(idle),
  };
});

jest.mock("../../contacts/hooks/useContacts", () => ({
  useContact: () => ({ data: undefined, error: null }),
}));

jest.mock("../../purchases/hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: (params: { query: string }) => mockSupplierSearch(params.query),
  usePurchaseSupplier: (id?: string) => ({
    data: id ? { id, name: `Proveedor ${id}` } : undefined,
    error: null,
  }),
}));

jest.mock("../../inventory/hooks/useInventory", () => ({
  useInventoryProduct: (id?: string, enabled = true) => ({
    data: id && enabled ? { id, name: `Producto ${id}`, sku: "SKU-1" } : undefined,
    error: null,
  }),
}));

jest.mock("../../inventory/restock", () => ({
  RestockPurchaseButton: () => <button type="button">Crear compra con estos productos</button>,
}));

jest.mock("./components/ReportsExportActions", () => ({
  ReportsExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <pre data-testid="export-filters">{JSON.stringify(exportFilters)}</pre>
  ),
}));

import { ReportsListPage } from "./page";

const hooks = jest.mocked(reportsHooks);
// Con datos mock el día operativo es fijo (ver `getBusinessTodayIsoDate`).
const TODAY = "2026-05-18";
/** Primer día de «últimos 30 días» contando hoy. */
const DEFAULT_FROM = "2026-04-19";

function setUrl(search: string) {
  window.history.replaceState(null, "", `/reports${search}`);
}

function urlParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

function renderPage(search = "") {
  setUrl(search);

  return render(<ReportsListPage />);
}

function exportFilters() {
  return JSON.parse(screen.getByTestId("export-filters").textContent ?? "{}") as unknown;
}

function catalogToggle() {
  return screen.getByRole("button", { name: /^Reporte: / });
}

function activeReportName() {
  return catalogToggle().textContent ?? "";
}

async function selectReport(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  if (catalogToggle().getAttribute("aria-expanded") !== "true") {
    await user.click(catalogToggle());
  }

  const catalog = screen.getByRole("navigation", { name: "Catálogo de reportes" });

  await user.click(within(catalog).getByRole("button", { name }));
}

describe("ReportsListPage · REP-03", () => {
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  let replaceStateUrls: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockTotals)) {
      delete mockTotals[key];
    }
    mockSupplierSearch.mockResolvedValue([]);
    // Escritorio: la paginación muestra los botones de página y el catálogo no se pliega al elegir.
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
    replaceStateUrls = [];
    window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      replaceStateUrls.push(String(url));
      nativeReplaceState(data, unused, url);
    };
  });

  afterEach(() => {
    window.history.replaceState = nativeReplaceState;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
    setUrl("");
  });

  describe("estado en la URL", () => {
    it("sin parámetros abre el reporte por defecto en sus últimos 30 días, sin escribirlos en la URL", () => {
      renderPage();

      expect(activeReportName()).toContain("Ventas diarias");
      expect(screen.getByTestId("date-range-label")).toHaveTextContent("19 abr – 18 may 2026");
      expect(screen.getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith(
        { from: DEFAULT_FROM, groupBy: "auto", limit: 10, skip: 0, to: TODAY },
        undefined,
      );
      // Se exporta lo mismo que se ve.
      expect(exportFilters()).toEqual({
        dateFilters: { from: DEFAULT_FROM, to: TODAY },
        purchasesFilters: { from: DEFAULT_FROM, to: TODAY },
        stockCardFilters: {},
      });
      expect(urlParams()).toEqual({});
      expect(replaceStateUrls.join(" ")).not.toMatch(/from=|to=|preset=/);
    });

    it.each([
      ["gross-profit", "useGrossProfitReport", { groupBy: "auto" }],
      ["purchases", "usePurchasesReport", { groupBy: "auto" }],
      ["top-products", "useTopProductsReport", {}],
      ["top-customers", "useTopCustomersReport", {}],
      ["payment-methods", "usePaymentMethodsReport", {}],
    ] as const)("%s sin rango en la URL usa los últimos 30 días", (reportId, hookName, extra) => {
      renderPage(`?report=${reportId}`);

      expect(hooks[hookName]).toHaveBeenLastCalledWith(
        expect.objectContaining({ ...extra, from: DEFAULT_FROM, to: TODAY }),
        undefined,
      );
      expect(screen.getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(urlParams()).toEqual({ report: reportId });
    });

    it.each([
      ["daily-close", "useDailyCloseReport"],
      ["fx-depreciation", "useFxDepreciationReport"],
    ] as const)("%s sin rango en la URL sigue sin rango", (reportId, hookName) => {
      renderPage(`?report=${reportId}`);

      expect(hooks[hookName]).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ from: expect.anything() }),
        undefined,
      );
      expect(hooks[hookName]).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ to: expect.anything() }),
        undefined,
      );
      expect(screen.getByTestId("date-range-label")).toHaveTextContent("Todas las fechas");
      expect(screen.getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("quitar el rango deja «todas las fechas» (`preset=custom`) y el reporte responde sin serie", async () => {
      const user = userEvent.setup();
      mockTotals["daily-sales"] = 35;
      renderPage();

      await user.click(screen.getByRole("button", { name: "Quitar rango de fechas" }));

      expect(urlParams()).toEqual({ preset: "custom" });
      expect(screen.getByTestId("date-range-label")).toHaveTextContent("Todas las fechas");
      expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith({ limit: 10, skip: 0 }, undefined);
      expect(screen.getByText("Elige un rango de fechas")).toBeInTheDocument();
      expect(screen.getByText("Mostrando 1-10 de 35 registros")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Últimos 30 días" }));

      expect(urlParams()).toEqual({ preset: "last_30_days" });
    });

    it("la paginación de depreciación FX se lee de la URL", () => {
      renderPage("?report=fx-depreciation&page=3&limit=20");

      expect(hooks.useFxDepreciationReport).toHaveBeenLastCalledWith(
        { limit: 20, skip: 40 },
        undefined,
      );
    });

    it("al montar con `report`, `from` y `to` selecciona el reporte y el rango", () => {
      renderPage("?report=top-products&from=2026-05-01&to=2026-05-10");

      expect(activeReportName()).toContain("Top productos");
      expect(screen.getByText("Resultados: Top productos")).toBeInTheDocument();
      expect(screen.getByTestId("date-range-label")).toHaveTextContent("1–10 may 2026");
      expect(screen.getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
      expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith(
        { from: "2026-05-01", limit: 10, skip: 0, to: "2026-05-10" },
        undefined,
      );
      expect(exportFilters()).toMatchObject({
        dateFilters: { from: "2026-05-01", to: "2026-05-10" },
        purchasesFilters: { from: "2026-05-01", to: "2026-05-10" },
      });
    });

    it("`?report=low-stock&from=…&to=…` selecciona el reporte; el rango queda en la URL aunque no lo use", () => {
      renderPage("?report=low-stock&from=2026-05-01&to=2026-05-10");

      expect(activeReportName()).toContain("Bajo stock");
      expect(hooks.useLowStockReport).toHaveBeenLastCalledWith({ limit: 10, skip: 0 }, undefined);
      expect(screen.getByText("Este reporte no usa rango de fechas.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hoy" })).toBeDisabled();
      expect(urlParams()).toEqual({ from: "2026-05-01", report: "low-stock", to: "2026-05-10" });
    });

    it("un `preset` relativo se recalcula con el hoy operativo", () => {
      renderPage("?report=top-customers&preset=yesterday");

      expect(screen.getByRole("button", { name: "Ayer" })).toHaveAttribute("aria-pressed", "true");
      expect(hooks.useTopCustomersReport).toHaveBeenLastCalledWith(
        { from: "2026-05-17", limit: 10, skip: 0, to: "2026-05-17" },
        undefined,
      );
    });

    it("al montar restaura agrupación, comparación, proveedor, página y tamaño", () => {
      mockTotals.purchases = 80;
      renderPage(
        "?report=purchases&from=2026-05-01&to=2026-05-10&groupBy=week&compare=1&supplierId=sup-7&page=2&limit=20",
      );

      expect(hooks.usePurchasesReport).toHaveBeenLastCalledWith(
        {
          compare: true,
          from: "2026-05-01",
          groupBy: "week",
          limit: 20,
          skip: 20,
          supplierId: "sup-7",
          to: "2026-05-10",
        },
        undefined,
      );
      expect(screen.getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("checkbox", { name: "Comparar con periodo anterior" })).toBeChecked();
      expect(screen.getByRole("combobox", { name: "Proveedor" })).toHaveValue("Proveedor sup-7");
    });

    it("un `report` desconocido y valores inválidos caen al valor por defecto sin romper", () => {
      renderPage("?report=no-existe&from=ayer&groupBy=year&compare=si&page=-3&limit=abc");

      expect(activeReportName()).toContain("Ventas diarias");
      expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith(
        { from: DEFAULT_FROM, groupBy: "auto", limit: 10, skip: 0, to: TODAY },
        undefined,
      );
      expect(screen.getByRole("button", { name: "Automático" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("checkbox", { name: "Comparar con periodo anterior" })).not.toBeChecked();
    });

    it("cambiar de reporte escribe la URL con `history.replaceState` y limpia `page`", async () => {
      const user = userEvent.setup();
      mockTotals["daily-sales"] = 35;
      renderPage("?page=2");

      expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 10, skip: 10 }),
        undefined,
      );

      await selectReport(user, /^Top clientes/);

      expect(replaceStateUrls.at(-1)).toBe("/reports?report=top-customers");
      expect(urlParams()).toEqual({ report: "top-customers" });
      expect(hooks.useTopCustomersReport).toHaveBeenLastCalledWith(
        { from: DEFAULT_FROM, limit: 10, skip: 0, to: TODAY },
        undefined,
      );
    });

    it("volver al reporte por defecto quita `report` de la URL", async () => {
      const user = userEvent.setup();
      renderPage("?report=low-stock");

      await selectReport(user, /^Ventas diarias/);

      expect(replaceStateUrls.at(-1)).toBe("/reports");
    });

    it("al volver con «atrás» la pantalla sigue la URL", () => {
      const { rerender } = renderPage("?report=low-stock");

      expect(activeReportName()).toContain("Bajo stock");

      // Navegación externa: la URL cambia sin pasar por la pantalla.
      act(() => {
        nativeReplaceState(null, "", "/reports?report=gross-profit&preset=this_month&groupBy=day");
      });
      rerender(<ReportsListPage />);

      expect(activeReportName()).toContain("Ganancia bruta");
      expect(hooks.useGrossProfitReport).toHaveBeenLastCalledWith(
        { from: "2026-05-01", groupBy: "day", limit: 10, skip: 0, to: TODAY },
        undefined,
      );
    });

    it("el rango elegido se escribe como `preset` y vuelve a la página 1", async () => {
      const user = userEvent.setup();
      mockTotals["top-products"] = 35;
      renderPage("?report=top-products&page=3");

      await user.click(screen.getByRole("button", { name: "Últimos 30 días" }));

      expect(urlParams()).toEqual({ preset: "last_30_days", report: "top-products" });
      expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith(
        { from: "2026-04-19", limit: 10, skip: 0, to: TODAY },
        undefined,
      );

      await user.click(screen.getByRole("button", { name: "Quitar rango de fechas" }));

      // «Todas las fechas» a propósito: sin parámetros volvería el rango por defecto.
      expect(urlParams()).toEqual({ preset: "custom", report: "top-products" });
      expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith({ limit: 10, skip: 0 }, undefined);
    });
  });

  describe("agrupación y comparación", () => {
    it("solo aparecen en los reportes que las admiten", async () => {
      const user = userEvent.setup();
      renderPage("?report=top-products");

      expect(screen.queryByRole("group", { name: "Agrupar por" })).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Comparar con periodo anterior" })).not.toBeInTheDocument();

      await selectReport(user, /^Métodos de pago/);

      expect(screen.queryByRole("group", { name: "Agrupar por" })).not.toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Comparar con periodo anterior" })).toBeInTheDocument();

      for (const name of [/^Ventas diarias/, /^Ganancia bruta/, /^Compras Compras del rango/]) {
        await selectReport(user, name);

        expect(screen.getByRole("group", { name: "Agrupar por" })).toBeInTheDocument();
        expect(screen.getByRole("checkbox", { name: "Comparar con periodo anterior" })).toBeInTheDocument();
      }
    });

    it("se escriben en la URL y llegan al reporte de serie", async () => {
      const user = userEvent.setup();
      renderPage("?from=2026-05-01&to=2026-05-10");

      // Con rango completo se pide la serie con agrupación automática.
      expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith(
        { from: "2026-05-01", groupBy: "auto", limit: 10, skip: 0, to: "2026-05-10" },
        undefined,
      );

      await user.click(screen.getByRole("button", { name: "Mes" }));
      await user.click(screen.getByRole("checkbox", { name: "Comparar con periodo anterior" }));

      expect(urlParams()).toEqual({
        compare: "1",
        from: "2026-05-01",
        groupBy: "month",
        to: "2026-05-10",
      });
      expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith(
        { compare: true, from: "2026-05-01", groupBy: "month", limit: 10, skip: 0, to: "2026-05-10" },
        undefined,
      );

      await user.click(screen.getByRole("button", { name: "Automático" }));
      await user.click(screen.getByRole("checkbox", { name: "Comparar con periodo anterior" }));

      expect(urlParams()).toEqual({ from: "2026-05-01", to: "2026-05-10" });
    });

    it("métodos de pago usa el rango global y `compare`, sin control de fechas propio", () => {
      renderPage("?report=payment-methods&preset=today&compare=1");

      expect(hooks.usePaymentMethodsReport).toHaveBeenLastCalledWith(
        { compare: true, from: TODAY, to: TODAY },
        undefined,
      );
      expect(screen.getAllByRole("group", { name: "Rango de fechas" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Hoy" })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Desde el inicio" })).not.toBeInTheDocument();
    });
  });

  describe("proveedor y producto", () => {
    it("solo se muestran en los reportes que los usan", async () => {
      const user = userEvent.setup();
      renderPage();

      expect(screen.queryByRole("combobox", { name: "Proveedor" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Producto" })).not.toBeInTheDocument();

      await selectReport(user, /^Compras Compras del rango/);
      expect(screen.getByRole("combobox", { name: "Proveedor" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Producto" })).not.toBeInTheDocument();

      await selectReport(user, /^Kardex de producto/);
      expect(screen.getByRole("combobox", { name: "Producto" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Proveedor" })).not.toBeInTheDocument();
    });

    it("el proveedor se busca por nombre y su id va a la URL y al reporte", async () => {
      const user = userEvent.setup();
      mockSupplierSearch.mockResolvedValue([
        {
          id: "sup-1",
          isActive: true,
          label: "Distribuidora Polar",
          phone: "",
          taxId: "J-123",
          type: "proveedor",
        },
      ]);
      renderPage("?report=purchases");

      await user.type(screen.getByRole("combobox", { name: "Proveedor" }), "Polar");
      await user.click(await screen.findByRole("option", { name: /Distribuidora Polar/ }));

      expect(mockSupplierSearch).toHaveBeenCalledWith("Polar");
      expect(urlParams()).toEqual({ report: "purchases", supplierId: "sup-1" });
      expect(hooks.usePurchasesReport).toHaveBeenLastCalledWith(
        { from: DEFAULT_FROM, groupBy: "auto", limit: 10, skip: 0, supplierId: "sup-1", to: TODAY },
        undefined,
      );
      expect(screen.getByRole("combobox", { name: "Proveedor" })).toHaveValue("Distribuidora Polar");
    });

    it("un `productId` de la URL muestra el nombre del producto y filtra el kardex", () => {
      renderPage("?report=stock-card&productId=prod-9");

      expect(screen.getByRole("combobox", { name: "Producto" })).toHaveValue("Producto prod-9 (SKU-1)");
      expect(hooks.useStockCardReport).toHaveBeenLastCalledWith(
        { limit: 10, productId: "prod-9", skip: 0 },
        undefined,
      );
    });
  });

  describe("catálogo", () => {
    it("agrupa los reportes en Ventas, Compras, Inventario y Dinero y marca el activo", async () => {
      const user = userEvent.setup();
      renderPage("?report=low-stock");

      await user.click(catalogToggle());

      const catalog = screen.getByRole("navigation", { name: "Catálogo de reportes" });
      const groups = within(catalog).getAllByRole("heading", { level: 4 });

      expect(groups.map((heading) => heading.textContent)).toEqual([
        "Ventas",
        "Compras",
        "Inventario",
        "Dinero",
      ]);
      expect(within(catalog).getAllByRole("button")).toHaveLength(reportCatalog.length);
      expect(
        within(screen.getByRole("region", { name: "Inventario" })).getByRole("button", {
          name: /^Bajo stock/,
        }),
      ).toHaveAttribute("aria-current", "true");
      expect(within(catalog).getAllByRole("button", { current: true })).toHaveLength(1);
    });

    it("busca por nombre o descripción sin tildes ni mayúsculas", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(catalogToggle());
      const catalog = screen.getByRole("navigation", { name: "Catálogo de reportes" });

      await user.type(screen.getByRole("searchbox", { name: "Buscar reporte" }), "METODOS");
      expect(within(catalog).getAllByRole("button")).toHaveLength(1);
      expect(within(catalog).getByRole("button", { name: /^Métodos de pago/ })).toBeInTheDocument();
      // Solo quedan los grupos con coincidencias.
      expect(within(catalog).getAllByRole("heading", { level: 4 }).map((item) => item.textContent)).toEqual([
        "Dinero",
      ]);

      await user.clear(screen.getByRole("searchbox", { name: "Buscar reporte" }));
      await user.type(screen.getByRole("searchbox", { name: "Buscar reporte" }), "minimo");
      expect(within(catalog).getAllByRole("button")).toHaveLength(1);
      expect(within(catalog).getByRole("button", { name: /^Bajo stock/ })).toBeInTheDocument();
    });

    it("sin coincidencias muestra un estado vacío y la búsqueda no cambia el reporte ni la URL", async () => {
      const user = userEvent.setup();
      renderPage("?report=low-stock");

      await user.click(catalogToggle());
      await user.type(screen.getByRole("searchbox", { name: "Buscar reporte" }), "nómina");

      expect(screen.getByText("Ningún reporte coincide con «nómina»")).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Catálogo de reportes" })).not.toBeInTheDocument();
      expect(activeReportName()).toContain("Bajo stock");
      expect(urlParams()).toEqual({ report: "low-stock" });
    });

    it("plegado muestra el reporte activo; se elige con teclado", async () => {
      const user = userEvent.setup();
      renderPage();

      expect(catalogToggle()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("navigation", { name: "Catálogo de reportes" })).not.toBeInTheDocument();

      catalogToggle().focus();
      await user.keyboard("{Enter}");
      expect(catalogToggle()).toHaveAttribute("aria-expanded", "true");

      within(screen.getByRole("navigation", { name: "Catálogo de reportes" }))
        .getByRole("button", { name: /^Top productos/ })
        .focus();
      await user.keyboard("{Enter}");

      expect(urlParams()).toEqual({ report: "top-products" });
      expect(activeReportName()).toContain("Top productos");
    });

    it("en pantallas angostas se pliega al elegir para dejar el resultado a la vista", async () => {
      const user = userEvent.setup();
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query: string) => ({
          addEventListener: () => undefined,
          addListener: () => undefined,
          dispatchEvent: () => false,
          matches: query.includes("max-width"),
          media: query,
          onchange: null,
          removeEventListener: () => undefined,
          removeListener: () => undefined,
        }),
        writable: true,
      });
      renderPage();

      await selectReport(user, /^Bajo stock/);

      expect(catalogToggle()).toHaveAttribute("aria-expanded", "false");
      expect(activeReportName()).toContain("Bajo stock");
    });
  });

  describe("paginación por reporte (D20)", () => {
    it.each([
      ["product-profitability", /^Rentabilidad por producto/],
      ["low-stock", /^Bajo stock/],
      ["customer-purchases", /^Compras de clientes/],
      ["supplier-purchases", /^Compras a proveedores/],
    ] as const)("de la página 2 de un reporte largo a %s: empieza en su primera página", async (slug, name) => {
      const user = userEvent.setup();
      mockTotals["daily-sales"] = 35;
      mockTotals[slug] = 3;
      renderPage();

      await user.click(screen.getByRole("button", { name: "Ir a pagina 2" }));
      expect(urlParams()).toEqual({ page: "2" });

      await selectReport(user, name);

      expect(urlParams()).toEqual({ report: slug });
      expect(screen.queryByText("No hay registros para mostrar")).not.toBeInTheDocument();
      expect(screen.getAllByText("Fila 1").length).toBeGreaterThan(0);
    });

    it("una página de la URL que ya no existe vuelve a la primera en vez de quedar vacía", async () => {
      mockTotals["low-stock"] = 3;
      renderPage("?report=low-stock&page=9");

      await waitFor(() => expect(urlParams()).toEqual({ report: "low-stock" }));
      expect(screen.queryByText("No hay registros para mostrar")).not.toBeInTheDocument();
      expect(screen.getAllByText("Fila 1").length).toBeGreaterThan(0);
    });
  });

  describe("sin inputs nativos de fecha", () => {
    it.each(REPORT_IDS)("%s: un solo control de rango y ningún input de fecha", (reportId: ReportId) => {
      const { container } = renderPage(`?report=${reportId}&from=2026-05-01&to=2026-05-10`);
      const report = reportCatalog.find((item) => item.id === reportId);

      expect(
        container.querySelectorAll(
          'input[type="date"], input[type="datetime-local"], input[type="month"], input[type="time"]',
        ),
      ).toHaveLength(0);
      expect(screen.getAllByRole("group", { name: "Rango de fechas" })).toHaveLength(1);
      expect(screen.queryAllByText("Este reporte no usa rango de fechas.")).toHaveLength(
        report?.usesDateRange ? 0 : 1,
      );
      expect(screen.getByRole("button", { name: "Hoy" })).toHaveProperty(
        "disabled",
        !report?.usesDateRange,
      );
    });
  });
});
