import { MONEY_REPORT_SLUGS } from "../../services/moneyReports";
import {
  defaultReportId,
  getReportById,
  groupReports,
  isMoneyReportId,
  isReportId,
  moneyReportCatalog,
  MULTI_STORE_REPORT_IDS,
  REPORT_IDS,
  reportCatalog,
  reportGroups,
  searchReports,
  storeReportCatalog,
} from "./reportCatalog";

function ids(reports: readonly { id: string }[]) {
  return reports.map((report) => report.id);
}

describe("reportCatalog", () => {
  it("tiene una entrada por id, sin repetidos", () => {
    expect([...ids(storeReportCatalog)].sort()).toEqual([...REPORT_IDS].sort());
    expect([...ids(reportCatalog)].sort()).toEqual([...MULTI_STORE_REPORT_IDS].sort());
    expect(isReportId(defaultReportId)).toBe(true);
    expect(isReportId("no-existe")).toBe(false);
    expect(isReportId(undefined)).toBe(false);
  });

  it("reparte los reportes en Ventas, Compras, Inventario y Dinero", () => {
    const grouped = groupReports(reportCatalog);

    expect(grouped.map((group) => group.label)).toEqual(["Ventas", "Compras", "Inventario", "Dinero"]);
    expect(Object.fromEntries(grouped.map((group) => [group.id, ids(group.reports)]))).toEqual({
      compras: ["purchases", "supplier-purchases"],
      dinero: ["daily-close", "payment-methods", "fx-depreciation"],
      inventario: ["low-stock", "stock-card"],
      ventas: [
        "daily-sales",
        "gross-profit",
        "product-profitability",
        "top-products",
        "top-customers",
        "customer-purchases",
      ],
    });
    expect(reportGroups.map((group) => group.id)).toEqual(grouped.map((group) => group.id));
  });

  it("cada reporte tiene nombre y una descripción de una línea", () => {
    for (const report of reportCatalog) {
      expect(report.name.trim()).not.toBe("");
      expect(report.description).not.toMatch(/\n/);
      // REP-F2: corta, para que quepa lo más posible en la tarjeta (el resto se recorta con «…»).
      expect(report.description.length).toBeLessThanOrEqual(50);
      expect(report.description.endsWith(".")).toBe(true);
    }
  });

  it("los textos van con tildes", () => {
    const text = reportCatalog.map((report) => `${report.name} ${report.description} ${report.period}`).join(" ");

    expect(text).not.toMatch(/\b(dia|Metodos|metodo|Depreciacion|minimo|ultima|ultimo|Historico|perdida|mas)\b/);
    expect(getReportById("daily-close").name).toBe("Cierre del día");
    expect(getReportById("payment-methods").name).toBe("Métodos de pago");
    expect(getReportById("fx-depreciation").name).toBe("Depreciación FX");
  });

  it("declara qué reportes usan rango, agrupación, comparación y filtro de entidad", () => {
    const pick = (predicate: (report: (typeof reportCatalog)[number]) => unknown) =>
      ids(reportCatalog.filter(predicate)).sort();

    expect(pick((report) => !report.usesDateRange)).toEqual([
      "customer-purchases",
      "low-stock",
      "product-profitability",
      "stock-card",
      "supplier-purchases",
    ]);
    expect(pick((report) => report.supportsGroupBy)).toEqual(["daily-sales", "gross-profit", "purchases"]);
    expect(pick((report) => report.supportsCompare)).toEqual([
      "daily-sales",
      "gross-profit",
      "payment-methods",
      "purchases",
    ]);
    expect(pick((report) => report.entityFilter === "supplier")).toEqual(["purchases"]);
    expect(pick((report) => report.entityFilter === "product")).toEqual(["stock-card"]);
    // Agrupar o comparar exige rango.
    expect(pick((report) => (report.supportsGroupBy || report.supportsCompare) && !report.usesDateRange)).toEqual([]);
  });

  describe("reportes de dinero (REP-06b)", () => {
    it("los cinco ids nuevos están en el catálogo de la tienda y no en el multi-tienda", () => {
      expect(ids(moneyReportCatalog)).toEqual([...MONEY_REPORT_SLUGS]);
      expect(ids(moneyReportCatalog)).toEqual([
        "sales-by-hour",
        "sales-by-category",
        "receivables-aging",
        "payables-aging",
        "cash-close-differences",
      ]);
      for (const id of MONEY_REPORT_SLUGS) {
        expect(isReportId(id)).toBe(true);
        expect(isMoneyReportId(id)).toBe(true);
        expect(getReportById(id).id).toBe(id);
        // Plataforma y la exportación leen `reportCatalog`: ahí no existen.
        expect(ids(reportCatalog)).not.toContain(id);
      }
      expect(isMoneyReportId("daily-sales")).toBe(false);
    });

    it("van en Ventas y en Dinero, detrás de los que ya había", () => {
      const grouped = Object.fromEntries(
        groupReports(storeReportCatalog).map((group) => [group.id, ids(group.reports)]),
      );

      expect(grouped.ventas.slice(-2)).toEqual(["sales-by-hour", "sales-by-category"]);
      expect(grouped.dinero).toEqual([
        "daily-close",
        "payment-methods",
        "fx-depreciation",
        "receivables-aging",
        "payables-aging",
        "cash-close-differences",
      ]);
      expect(grouped.compras).toEqual(["purchases", "supplier-purchases"]);
      expect(grouped.inventario).toEqual(["low-stock", "stock-card"]);
    });

    it("nombre con tildes, descripción de una línea de 50 caracteres como mucho", () => {
      expect(Object.fromEntries(moneyReportCatalog.map((report) => [report.id, report.name]))).toEqual({
        "cash-close-differences": "Diferencias de cierre de caja",
        "payables-aging": "Cuentas por pagar",
        "receivables-aging": "Cuentas por cobrar",
        "sales-by-category": "Ventas y margen por categoría",
        "sales-by-hour": "Ventas por hora y día de la semana",
      });

      for (const report of moneyReportCatalog) {
        expect(report.description).not.toMatch(/\n/);
        expect(report.description.length).toBeLessThanOrEqual(50);
        expect(report.description.endsWith(".")).toBe(true);
      }
    });

    it("rango: ventas por hora y por categoría lo usan (30 días por defecto); cobrar y pagar, no; caja, opcional", () => {
      const pick = (id: (typeof MONEY_REPORT_SLUGS)[number]) => {
        const { chart, defaultDatePreset, usesDateRange } = getReportById(id);

        return { chart, defaultDatePreset, usesDateRange };
      };

      expect(pick("sales-by-hour")).toEqual({ chart: "heatmap", defaultDatePreset: "last_30_days", usesDateRange: true });
      expect(pick("sales-by-category")).toEqual({
        chart: "ranking",
        defaultDatePreset: "last_30_days",
        usesDateRange: true,
      });
      expect(pick("receivables-aging")).toEqual({ chart: "ranking", defaultDatePreset: undefined, usesDateRange: false });
      expect(pick("payables-aging")).toEqual({ chart: "ranking", defaultDatePreset: undefined, usesDateRange: false });
      expect(pick("cash-close-differences")).toEqual({
        chart: "line",
        defaultDatePreset: undefined,
        usesDateRange: true,
      });
      // Ninguno agrupa, compara ni usa el filtro de proveedor / producto de la barra.
      for (const report of moneyReportCatalog) {
        expect(report.supportsCompare ?? false).toBe(false);
        expect(report.supportsGroupBy ?? false).toBe(false);
        expect(report.entityFilter).toBeUndefined();
      }
    });
  });

  it("un id desconocido cae al primer reporte", () => {
    expect(getReportById("no-existe" as never)).toBe(reportCatalog[0]);
  });
});

describe("searchReports", () => {
  it("sin texto devuelve todo el catálogo", () => {
    expect(searchReports(reportCatalog, "   ")).toHaveLength(reportCatalog.length);
  });

  it("busca en el nombre sin tildes ni mayúsculas", () => {
    expect(ids(searchReports(reportCatalog, "METODOS DE PAGO"))).toEqual(["payment-methods"]);
    expect(ids(searchReports(reportCatalog, "depreciación"))).toEqual(["fx-depreciation"]);
    expect(ids(searchReports(reportCatalog, "Depreciacion"))).toEqual(["fx-depreciation"]);
  });

  it("busca también en la descripción", () => {
    expect(ids(searchReports(reportCatalog, "minimo"))).toEqual(["low-stock"]);
    expect(ids(searchReports(reportCatalog, "baúl"))).toEqual(["daily-close"]);
  });

  it("sin coincidencias devuelve una lista vacía y no deja grupos", () => {
    expect(searchReports(reportCatalog, "nómina")).toEqual([]);
    expect(groupReports([])).toEqual([]);
  });
});
