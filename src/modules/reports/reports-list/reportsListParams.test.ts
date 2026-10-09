import { DATE_RANGE_PRESETS } from "@/shared/components/DateRangeField";

import { defaultReportId, getReportById, REPORT_IDS } from "./config/reportCatalog";
import {
  reportsListSchema,
  resolveReportsRange,
  toReportDateFilters,
  toReportsFilters,
} from "./reportsListParams";

const TODAY = "2026-05-18";
const shape = reportsListSchema.shape;

describe("reportsListSchema", () => {
  it("sin parámetros: reporte por defecto, sin rango, automático, sin comparar, página 1", () => {
    expect(reportsListSchema.parse({})).toEqual({
      compare: "",
      from: "",
      groupBy: "",
      limit: 10,
      page: 1,
      preset: "",
      productId: "",
      report: defaultReportId,
      supplierId: "",
      to: "",
    });
  });

  it.each(REPORT_IDS)("acepta el reporte %s", (id) => {
    expect(shape.report.safeParse(id)).toEqual({ data: id, success: true });
  });

  it.each(["", "no-existe", "DAILY-SALES", "daily-sales "])("rechaza el reporte %p", (value) => {
    expect(shape.report.safeParse(value).success).toBe(false);
  });

  it("valida fechas, preset, agrupación y comparación", () => {
    expect(shape.from.safeParse("2026-05-01").success).toBe(true);
    expect(shape.to.safeParse("2026-02-30").success).toBe(false);
    expect(shape.from.safeParse("ayer").success).toBe(false);

    for (const preset of DATE_RANGE_PRESETS) {
      expect(shape.preset.safeParse(preset).success).toBe(true);
    }
    expect(shape.preset.safeParse("last_year").success).toBe(false);

    for (const groupBy of ["day", "week", "month"]) {
      expect(shape.groupBy.safeParse(groupBy).success).toBe(true);
    }
    expect(shape.groupBy.safeParse("auto").success).toBe(false);
    expect(shape.groupBy.safeParse("year").success).toBe(false);

    expect(shape.compare.safeParse("1").success).toBe(true);
    expect(shape.compare.safeParse("true").success).toBe(false);
  });

  it("acota la página y el tamaño", () => {
    expect(shape.page.safeParse(0).success).toBe(false);
    expect(shape.page.safeParse(2.5).success).toBe(false);
    expect(shape.limit.safeParse(0).success).toBe(false);
    expect(shape.supplierId.safeParse("x".repeat(65)).success).toBe(false);
  });
});

describe("resolveReportsRange", () => {
  it("sin parámetros no hay rango", () => {
    expect(resolveReportsRange({ from: "", preset: "", to: "" }, TODAY)).toEqual({
      from: undefined,
      preset: undefined,
      to: undefined,
    });
  });

  it("un preset relativo se recalcula con el hoy operativo", () => {
    expect(resolveReportsRange({ from: "", preset: "this_month", to: "" }, TODAY)).toEqual({
      from: "2026-05-01",
      preset: "this_month",
      to: TODAY,
    });
  });

  it("las fechas mandan sobre el preset y un rango invertido se descarta", () => {
    expect(
      resolveReportsRange({ from: "2026-01-01", preset: "today", to: "2026-01-31" }, TODAY),
    ).toEqual({ from: "2026-01-01", preset: "custom", to: "2026-01-31" });
    expect(resolveReportsRange({ from: "2026-02-01", preset: "", to: "2026-01-01" }, TODAY)).toEqual({
      from: undefined,
      preset: undefined,
      to: undefined,
    });
  });
});

describe("toReportsFilters", () => {
  it("reparte el estado en los filtros de reportes y exportación", () => {
    expect(
      toReportsFilters(
        { compare: "1", groupBy: "week", productId: "prod-1", supplierId: "sup-1" },
        { from: "2026-05-01", to: "2026-05-10" },
      ),
    ).toEqual({
      dateFilters: { compare: true, from: "2026-05-01", groupBy: "week", to: "2026-05-10" },
      purchasesFilters: { from: "2026-05-01", supplierId: "sup-1", to: "2026-05-10" },
      stockCardFilters: { productId: "prod-1" },
    });
  });

  it("los valores por defecto no viajan", () => {
    expect(
      toReportsFilters(
        { compare: "", groupBy: "", productId: "", supplierId: "" },
        { from: undefined, to: undefined },
      ),
    ).toEqual({
      dateFilters: { compare: undefined, from: undefined, groupBy: undefined, to: undefined },
      purchasesFilters: { from: undefined, supplierId: undefined, to: undefined },
      stockCardFilters: { productId: undefined },
    });
  });
});

describe("toReportDateFilters", () => {
  const range = { from: "2026-05-01", to: "2026-05-10" };
  const all = { ...range, compare: true, groupBy: "month" } as const;

  it("un reporte sin rango no recibe ningún filtro de fecha", () => {
    expect(toReportDateFilters(getReportById("low-stock"), all)).toEqual({});
    expect(toReportDateFilters(getReportById("stock-card"), all)).toEqual({});
  });

  it("un reporte de rango recibe solo `from` y `to`", () => {
    expect(toReportDateFilters(getReportById("top-products"), all)).toEqual(range);
    expect(toReportDateFilters(getReportById("daily-close"), all)).toEqual(range);
  });

  it("un reporte de serie recibe la agrupación (automática si no se eligió) y la comparación", () => {
    expect(toReportDateFilters(getReportById("daily-sales"), all)).toEqual(all);
    expect(toReportDateFilters(getReportById("gross-profit"), range)).toEqual({
      ...range,
      groupBy: "auto",
    });
  });

  it("métodos de pago compara pero no agrupa", () => {
    expect(toReportDateFilters(getReportById("payment-methods"), all)).toEqual({
      ...range,
      compare: true,
    });
  });

  it("sin rango completo no se pide serie ni comparación", () => {
    expect(
      toReportDateFilters(getReportById("daily-sales"), { compare: true, from: "2026-05-01", groupBy: "day" }),
    ).toEqual({ from: "2026-05-01", to: undefined });
  });
});
