import {
  defaultReportId,
  getReportById,
  groupReports,
  isReportId,
  REPORT_IDS,
  reportCatalog,
  reportGroups,
  searchReports,
} from "./reportCatalog";

function ids(reports: readonly { id: string }[]) {
  return reports.map((report) => report.id);
}

describe("reportCatalog", () => {
  it("tiene una entrada por id, sin repetidos", () => {
    expect([...ids(reportCatalog)].sort()).toEqual([...REPORT_IDS].sort());
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
      expect(report.description.length).toBeLessThanOrEqual(80);
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
