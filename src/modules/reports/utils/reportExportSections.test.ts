import { getRolePermissions } from "@/shared/auth/permissions";

import { reportCatalog } from "../reports-list/config/reportCatalog";
import type { ReportsExportDataset, ReportsExportFilters } from "../services/fetchReportsForExport";
import {
  buildReportExportSections,
  formatReportExportPeriodLabel,
  getReportExportName,
} from "./reportExportSections";
import type { ReportsExportView } from "./reportExportView";

// REP-F2: el periodo de la exportación se lee en español, no en ISO.
describe("formatReportExportPeriodLabel", () => {
  it.each([
    ["2026-04-01", "2026-04-30", "Periodo: del 1 abr 2026 al 30 abr 2026"],
    ["2025-12-28", "2026-01-03", "Periodo: del 28 dic 2025 al 3 ene 2026"],
    ["2026-05-18", "2026-05-18", "Periodo: 18 may 2026"],
    ["2026-05-01", undefined, "Desde: 1 may 2026"],
    [undefined, "2026-05-18", "Hasta: 18 may 2026"],
    [" ", "", "Todas las fechas"],
    [undefined, undefined, "Todas las fechas"],
  ])("%p – %p → %s", (from, to, expected) => {
    expect(formatReportExportPeriodLabel(from, to)).toBe(expected);
  });

  it("no usa caracteres fuera de Latin-1 (el PDF no los dibuja)", () => {
    expect(formatReportExportPeriodLabel("2026-04-01", "2026-04-30")).toMatch(/^[\u0000-ÿ]+$/);
  });
});

const SUPPLIER_ID = "5f0c1a9e-0000-4000-8000-00000000a001";
const PRODUCT_ID = "5f0c1a9e-0000-4000-8000-00000000b002";
const CUSTOMER_ID = "5f0c1a9e-0000-4000-8000-00000000c003";
const CATEGORY_ID = "5f0c1a9e-0000-4000-8000-00000000d004";
const INTERNAL_IDS = [SUPPLIER_ID, PRODUCT_ID, CUSTOMER_ID, CATEGORY_ID];

const emptyDataset: ReportsExportDataset = {
  customerPurchases: [],
  dailyClose: [],
  dailySales: [],
  fxDepreciation: [],
  grossProfit: [],
  lowStock: [],
  paymentMethods: [],
  productProfitability: [],
  purchases: [],
  stockCard: [],
  supplierPurchases: [],
  topCustomers: [],
  topProducts: [],
};

const storeDataset: ReportsExportDataset = {
  ...emptyDataset,
  cashCloseDifferences: [],
  deadStock: [],
  payablesAging: [],
  receivablesAging: [],
  salesByCategory: [],
  salesByHour: [],
  stockAdjustments: [],
  stockTurnover: [],
  storeName: "Bodega Demo",
};

const range = { from: "2026-09-01", to: "2026-09-30" };

function view(overrides: Partial<ReportsExportView> = {}): ReportsExportView {
  return {
    activeReportId: "daily-sales",
    compare: false,
    viewer: { permissions: getRolePermissions("admin"), role: "admin" },
    ...overrides,
  };
}

function filtersWith(overrides: Partial<ReportsExportFilters> = {}): ReportsExportFilters {
  return { dateFilters: range, purchasesFilters: range, stockCardFilters: {}, ...overrides };
}

function headerOf(
  reportId: string,
  data: ReportsExportDataset,
  filters: ReportsExportFilters,
  exportedAt?: string,
) {
  const section = buildReportExportSections(data, filters, exportedAt).find(
    (candidate) => candidate.id === reportId,
  );

  if (!section) {
    throw new Error(`Sin sección ${reportId}`);
  }

  return section.headerLines;
}

describe("buildReportExportSections (REP-08)", () => {
  it("sin vista son los 13 reportes multi-tienda, en el orden del catálogo", () => {
    const sections = buildReportExportSections(emptyDataset, filtersWith());

    expect(sections.map((section) => section.id)).toEqual(reportCatalog.map((report) => report.id));
    expect(sections.map((section) => section.title)).toEqual(
      reportCatalog.map((report) => report.name),
    );
  });

  it("añade los reportes de la tienda activa que vienen en los datos, y solo esos", () => {
    const all = buildReportExportSections(storeDataset, filtersWith({ view: view() }));

    expect(all.map((section) => section.id).slice(reportCatalog.length)).toEqual([
      "sales-by-hour",
      "sales-by-category",
      "receivables-aging",
      "payables-aging",
      "cash-close-differences",
      "dead-stock",
      "stock-turnover",
      "stock-adjustments",
    ]);
    expect(all.map((section) => section.title).slice(-3)).toEqual([
      "Productos sin movimiento",
      "Rotación de inventario",
      "Ajustes y mermas",
    ]);

    // Contador: dinero sí, inventario no.
    const withoutInventory = buildReportExportSections(
      { ...storeDataset, deadStock: undefined, stockAdjustments: undefined, stockTurnover: undefined },
      filtersWith({ view: view() }),
    );

    expect(withoutInventory).toHaveLength(reportCatalog.length + 5);
  });

  it("el encabezado lleva rango, tienda y fecha de generación en hora de Caracas (24 h)", () => {
    expect(
      headerOf("top-products", storeDataset, filtersWith({ view: view() }), "2026-10-01T18:05:00.000Z"),
    ).toEqual([
      "Periodo: del 1 sep 2026 al 30 sep 2026",
      "Tienda: Bodega Demo",
      "Generado: 01/10/2026, 14:05 (hora de Caracas)",
    ]);
  });

  it("sin rango dice «Todas las fechas»", () => {
    expect(
      headerOf("daily-sales", emptyDataset, {
        dateFilters: {},
        purchasesFilters: {},
        stockCardFilters: {},
      }),
    ).toEqual(["Todas las fechas"]);
  });

  it("el reporte abierto dice su agrupación efectiva y si se compara con el periodo anterior", () => {
    // 30 días sin `groupBy` en la URL: automática = día.
    expect(headerOf("daily-sales", emptyDataset, filtersWith({ view: view({ compare: true }) }))).toEqual(
      [
        "Periodo: del 1 sep 2026 al 30 sep 2026",
        "Agrupación: Día",
        "Comparado con periodo anterior",
      ],
    );
    expect(
      headerOf("gross-profit", emptyDataset, filtersWith({ view: view({ activeReportId: "gross-profit", groupBy: "month" }) })),
    ).toContain("Agrupación: Mes");
    // 122 días: la automática pasa a semana.
    expect(
      headerOf("daily-sales", emptyDataset, {
        ...filtersWith({ view: view() }),
        dateFilters: { from: "2026-06-01", to: "2026-09-30" },
      }),
    ).toContain("Agrupación: Semana");
  });

  it("agrupación y comparación no salen en las demás hojas ni sin rango completo", () => {
    const filters = filtersWith({ view: view({ compare: true, groupBy: "week" }) });

    expect(headerOf("gross-profit", emptyDataset, filters)).toEqual([
      "Periodo: del 1 sep 2026 al 30 sep 2026",
    ]);
    // Top productos no admite ni agrupar ni comparar.
    expect(
      headerOf(
        "top-products",
        emptyDataset,
        filtersWith({ view: view({ activeReportId: "top-products", compare: true, groupBy: "week" }) }),
      ),
    ).toEqual(["Periodo: del 1 sep 2026 al 30 sep 2026"]);
    expect(
      headerOf("daily-sales", emptyDataset, { ...filters, dateFilters: { from: "2026-09-01" } }),
    ).toEqual(["Desde: 1 sep 2026"]);
  });

  it("compras nombra al proveedor y el estado, nunca el id", () => {
    const data: ReportsExportDataset = {
      ...emptyDataset,
      supplierPurchases: [
        {
          name: "Distribuidora Polar",
          pendingVes: 0,
          purchasesCount: 2,
          supplierId: SUPPLIER_ID,
          totalRef: 10,
          totalVes: 365,
        },
      ],
    };
    const filters = filtersWith({
      purchasesFilters: { ...range, status: "recibido", supplierId: SUPPLIER_ID },
    });

    expect(headerOf("purchases", data, filters)).toEqual([
      "Periodo: del 1 sep 2026 al 30 sep 2026",
      "Filtros: Proveedor: Distribuidora Polar · Estado: Recibido",
    ]);
    // Sin el nombre a mano tampoco se muestra el id.
    expect(headerOf("purchases", emptyDataset, filters)).toContain(
      "Filtros: Proveedor: seleccionado · Estado: Recibido",
    );
    // El estado también puede venir de la URL.
    expect(
      headerOf("purchases", emptyDataset, filtersWith({ view: view({ purchasesStatus: "all" }) })),
    ).toContain("Filtros: Estado: Todos");
  });

  it("el kardex nombra el producto (REP-08: antes mostraba «Producto: <id>»)", () => {
    const filters = filtersWith({ stockCardFilters: { productId: PRODUCT_ID } });
    const movement = {
      createdAt: "2026-09-02T12:00:00.000Z",
      id: "m1",
      productId: PRODUCT_ID,
      productName: "Harina PAN 1 kg",
      quantityDelta: 5,
      stockAfter: 15,
      type: "compra",
    } as ReportsExportDataset["stockCard"][number];

    expect(headerOf("stock-card", { ...emptyDataset, stockCard: [movement] }, filters)).toEqual([
      "Producto: Harina PAN 1 kg",
    ]);
    expect(
      headerOf(
        "stock-card",
        {
          ...emptyDataset,
          lowStock: [{ currentStock: 1, id: PRODUCT_ID, minStock: 5, name: "Café 500 g", sku: "caf-500" }],
        },
        filters,
      ),
    ).toEqual(["Producto: Café 500 g"]);
    expect(headerOf("stock-card", emptyDataset, filters)).toEqual(["Producto: seleccionado"]);
  });

  it("sin producto, el kardex explica cómo exportarlo sin hablar de parámetros internos", () => {
    const lines = headerOf("stock-card", emptyDataset, filtersWith());

    expect(lines).toEqual([
      "Sin producto seleccionado",
      "Elige un producto en el reporte Kardex de producto para exportar sus movimientos.",
    ]);
    expect(lines.join(" ")).not.toMatch(/productId/i);
  });

  it("cuentas por cobrar y por pagar muestran tramo y contacto solo en la hoja abierta", () => {
    const data: ReportsExportDataset = {
      ...storeDataset,
      customerPurchases: [
        { customerId: CUSTOMER_ID, name: "María Pérez", pendingVes: 10, salesCount: 1, totalRef: 1, totalVes: 36 },
      ],
    };
    const filters = filtersWith({
      view: view({ activeReportId: "receivables-aging", bucket: "30+", contactId: CUSTOMER_ID }),
    });

    expect(headerOf("receivables-aging", data, filters)).toEqual([
      "Saldos pendientes a la fecha",
      "Filtros: Tramo: Más de 30 días · Cliente: María Pérez",
      "Tienda: Bodega Demo",
    ]);
    expect(headerOf("payables-aging", data, filters)).toEqual([
      "Saldos pendientes a la fecha",
      "Tienda: Bodega Demo",
    ]);
    expect(
      headerOf(
        "payables-aging",
        storeDataset,
        filtersWith({ view: view({ activeReportId: "payables-aging", contactId: SUPPLIER_ID }) }),
      ),
    ).toContain("Filtros: Proveedor: seleccionado");
  });

  it("cierre de caja, productos sin movimiento y rotación dicen sus filtros", () => {
    expect(
      headerOf(
        "cash-close-differences",
        storeDataset,
        filtersWith({ view: view({ activeReportId: "cash-close-differences", currency: "ref" }) }),
      ),
    ).toContain("Filtros: Moneda: REF");
    expect(
      headerOf(
        "cash-close-differences",
        storeDataset,
        filtersWith({ view: view({ activeReportId: "cash-close-differences" }) }),
      ),
    ).toContain("Filtros: Moneda: Bs");
    // Cerrado sale con las dos monedas: no hay filtro que anunciar.
    expect(headerOf("cash-close-differences", storeDataset, filtersWith({ view: view() }))).toEqual([
      "Periodo: del 1 sep 2026 al 30 sep 2026",
      "Tienda: Bodega Demo",
    ]);

    const deadStockRow = {
      category: { id: CATEGORY_ID, name: "Víveres" },
      product: { href: "/x", id: PRODUCT_ID, name: "Harina", sku: "har-1" },
    } as NonNullable<ReportsExportDataset["deadStock"]>[number];

    expect(
      headerOf(
        "dead-stock",
        { ...storeDataset, deadStock: [deadStockRow] },
        filtersWith({ view: view({ activeReportId: "dead-stock", categoryId: CATEGORY_ID, days: 90 }) }),
      ),
    ).toContain("Filtros: Sin vender desde hace 90 días o más · Categoría: Víveres");
    expect(headerOf("dead-stock", storeDataset, filtersWith({ view: view() }))).toContain(
      "Filtros: Sin vender desde hace 30 días o más",
    );
    expect(
      headerOf(
        "stock-turnover",
        storeDataset,
        filtersWith({ view: view({ activeReportId: "stock-turnover", turnoverGroupBy: "category" }) }),
      ),
    ).toContain("Filtros: Agrupado por: Categoría");
  });

  it("ningún encabezado deja ver un id interno", () => {
    const sections = buildReportExportSections(
      storeDataset,
      filtersWith({
        purchasesFilters: { ...range, supplierId: SUPPLIER_ID },
        stockCardFilters: { productId: PRODUCT_ID },
        view: view({ activeReportId: "dead-stock", categoryId: CATEGORY_ID, contactId: CUSTOMER_ID }),
      }),
      "2026-10-01T18:05:00.000Z",
    );
    const text = sections.flatMap((section) => [section.title, ...section.headerLines]).join("\n");

    for (const id of INTERNAL_IDS) {
      expect(text).not.toContain(id);
    }
  });

  it("los reportes con rango obligatorio avisan cuando falta", () => {
    const filters = { ...filtersWith({ view: view() }), dateFilters: {} };

    for (const id of ["sales-by-hour", "sales-by-category", "stock-turnover", "stock-adjustments"]) {
      expect(headerOf(id, storeDataset, filters)).toContain(
        "Elige un rango con fecha inicial y final para exportar este reporte.",
      );
    }
    expect(headerOf("receivables-aging", storeDataset, filters)).not.toContain(
      "Elige un rango con fecha inicial y final para exportar este reporte.",
    );
  });

  it("plataforma dice el alcance de tiendas sin listar ids", () => {
    const scoped = (scope: ReportsExportFilters["scope"]) =>
      headerOf("daily-sales", emptyDataset, filtersWith({ scope }))[1];

    expect(scoped({ pathPrefix: "/api/platform/reports" })).toBe("Tiendas: todas");
    expect(scoped({ pathPrefix: "/api/platform/reports", storeScope: "all" })).toBe("Tiendas: todas");
    expect(
      scoped({ pathPrefix: "/api/platform/reports", storeIds: "s1,s2,s3", storeScope: "selected" }),
    ).toBe("Tiendas: 3 seleccionadas");
    expect(scoped({ pathPrefix: "/api/platform/reports", storeIds: "s1", storeScope: "one" })).toBe(
      "Tiendas: 1 seleccionada",
    );
  });

  it("una hoja cortada lo dice en su encabezado, con las cifras", () => {
    const [purchases] = buildReportExportSections(
      { ...emptyDataset, truncated: { purchases: { exported: 20_000, total: 53_210 } } },
      filtersWith(),
    ).filter((section) => section.id === "purchases");
    const notice =
      "Archivo cortado: esta hoja trae las primeras 20.000 filas de 53.210. Acota los filtros para exportar el resto.";

    expect(purchases?.truncationNotice).toBe(notice);
    expect(purchases?.headerLines.at(-1)).toBe(notice);
    expect(
      buildReportExportSections(emptyDataset, filtersWith()).every(
        (section) => section.truncationNotice === undefined,
      ),
    ).toBe(true);
  });

  it("el encabezado solo usa Latin-1 (el PDF no dibuja otra cosa)", () => {
    const sections = buildReportExportSections(
      { ...storeDataset, truncated: { purchases: { exported: 20_000, total: 53_210 } } },
      filtersWith({
        purchasesFilters: { ...range, status: "pedido", supplierId: SUPPLIER_ID },
        view: view({ activeReportId: "dead-stock", compare: true, days: 60 }),
      }),
      "2026-10-01T18:05:00.000Z",
    );

    for (const section of sections) {
      expect([section.title, ...section.headerLines].join(" ")).toMatch(/^[\u0000-ÿ]+$/);
    }
  });
});

describe("getReportExportName", () => {
  it("da el nombre visible del reporte", () => {
    expect(getReportExportName("daily-sales")).toBe("Ventas diarias");
    expect(getReportExportName("receivables-aging")).toBe("Cuentas por cobrar");
    expect(getReportExportName("stock-turnover")).toBe("Rotación de inventario");
  });

  it("sin id o con uno desconocido no inventa un nombre", () => {
    expect(getReportExportName(undefined)).toBeUndefined();
    expect(getReportExportName("no-existe")).toBeUndefined();
  });
});
