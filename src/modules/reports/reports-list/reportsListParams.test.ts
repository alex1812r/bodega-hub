import { DATE_RANGE_PRESETS } from "@/shared/components/DateRangeField";

import { defaultReportId, getReportById, REPORT_IDS } from "./config/reportCatalog";
import {
  DEFAULT_CASH_CLOSE_CURRENCY,
  reportsListSchema,
  resolveReportsRange,
  serializeMoneyReportFilters,
  serializeReportsRange,
  toMoneyReportFilters,
  toReportDateFilters,
  toReportsFilters,
  toReportSwitchPatch,
} from "./reportsListParams";

const TODAY = "2026-05-18";
const shape = reportsListSchema.shape;

describe("parámetros de los reportes de dinero (REP-06b)", () => {
  it("bucket, contactId y currency aceptan solo sus valores y caen a vacío", () => {
    for (const bucket of ["", "0-7", "8-30", "30+"]) {
      expect(shape.bucket.safeParse(bucket)).toEqual({ data: bucket, success: true });
    }
    expect(shape.bucket.safeParse("31-60").success).toBe(false);

    for (const currency of ["", "ves", "ref"]) {
      expect(shape.currency.safeParse(currency)).toEqual({ data: currency, success: true });
    }
    expect(shape.currency.safeParse("usd").success).toBe(false);

    expect(shape.contactId.safeParse("c".repeat(120)).success).toBe(true);
    expect(shape.contactId.safeParse("c".repeat(121)).success).toBe(false);
  });

  it("toMoneyReportFilters: sin parámetros no hay tramo ni contacto y la moneda es Bs", () => {
    expect(DEFAULT_CASH_CLOSE_CURRENCY).toBe("ves");
    expect(toMoneyReportFilters({ bucket: "", contactId: "", currency: "" })).toEqual({
      bucket: undefined,
      contactId: undefined,
      currency: "ves",
    });
    expect(toMoneyReportFilters({ bucket: "30+", contactId: "cli-1", currency: "ref" })).toEqual({
      bucket: "30+",
      contactId: "cli-1",
      currency: "ref",
    });
  });

  it("serializeMoneyReportFilters solo toca lo que cambia y no escribe la moneda por defecto", () => {
    expect(serializeMoneyReportFilters({ bucket: "8-30" })).toEqual({ bucket: "8-30" });
    expect(serializeMoneyReportFilters({ bucket: undefined })).toEqual({ bucket: "" });
    expect(serializeMoneyReportFilters({ contactId: "cli-1" })).toEqual({ contactId: "cli-1" });
    expect(serializeMoneyReportFilters({ contactId: undefined })).toEqual({ contactId: "" });
    expect(serializeMoneyReportFilters({ currency: "ref" })).toEqual({ currency: "ref" });
    expect(serializeMoneyReportFilters({ currency: "ves" })).toEqual({ currency: "" });
    expect(serializeMoneyReportFilters({})).toEqual({});
  });

  it("ida y vuelta: lo serializado se vuelve a leer igual", () => {
    const filters = { bucket: "0-7", contactId: "prov-9", currency: "ref" } as const;
    const state = { bucket: "", contactId: "", currency: "", ...serializeMoneyReportFilters(filters) } as const;

    expect(toMoneyReportFilters(state)).toEqual(filters);
  });

  it("cambiar de reporte limpia tramo, contacto y moneda", () => {
    expect(toReportSwitchPatch("payables-aging")).toEqual({
      bucket: "",
      contactId: "",
      currency: "",
      report: "payables-aging",
    });
  });

  it("los reportes de ventas nuevos abren en últimos 30 días; cierre de caja, sin rango", () => {
    const empty = { from: "", preset: "", to: "" } as const;

    for (const id of ["sales-by-hour", "sales-by-category"] as const) {
      expect(resolveReportsRange(empty, TODAY, getReportById(id)).preset).toBe("last_30_days");
    }
    expect(resolveReportsRange(empty, TODAY, getReportById("cash-close-differences"))).toEqual({
      from: undefined,
      preset: undefined,
      to: undefined,
    });
    expect(toReportDateFilters(getReportById("receivables-aging"), { from: "2026-05-01", to: "2026-05-10" })).toEqual(
      {},
    );
  });
});

describe("reportsListSchema", () => {
  it("sin parámetros: reporte por defecto, sin rango, automático, sin comparar, página 1", () => {
    expect(reportsListSchema.parse({})).toEqual({
      bucket: "",
      compare: "",
      contactId: "",
      currency: "",
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

describe("rango por defecto del reporte", () => {
  const empty = { from: "", preset: "", to: "" } as const;

  it.each(["daily-sales", "gross-profit", "purchases", "top-products", "top-customers", "payment-methods"] as const)(
    "%s sin parámetros usa los últimos 30 días contando hoy",
    (reportId) => {
      expect(resolveReportsRange(empty, TODAY, getReportById(reportId))).toEqual({
        from: "2026-04-19",
        preset: "last_30_days",
        to: TODAY,
      });
    },
  );

  it.each(REPORT_IDS.filter((id) => !getReportById(id).defaultDatePreset))(
    "%s sin parámetros sigue sin rango",
    (reportId) => {
      expect(resolveReportsRange(empty, TODAY, getReportById(reportId))).toEqual({
        from: undefined,
        preset: undefined,
        to: undefined,
      });
    },
  );

  it("cierre del día y depreciación FX no tienen rango por defecto", () => {
    expect(getReportById("daily-close").defaultDatePreset).toBeUndefined();
    expect(getReportById("fx-depreciation").defaultDatePreset).toBeUndefined();
  });

  it("lo que trae la URL manda sobre el rango por defecto", () => {
    const report = getReportById("daily-sales");

    expect(resolveReportsRange({ from: "", preset: "yesterday", to: "" }, TODAY, report)).toEqual({
      from: "2026-05-17",
      preset: "yesterday",
      to: "2026-05-17",
    });
    expect(
      resolveReportsRange({ from: "2026-01-01", preset: "", to: "2026-01-31" }, TODAY, report),
    ).toEqual({ from: "2026-01-01", preset: "custom", to: "2026-01-31" });
  });

  it("`preset=custom` sin fechas es «todas las fechas»", () => {
    expect(
      resolveReportsRange({ from: "", preset: "custom", to: "" }, TODAY, getReportById("daily-sales")),
    ).toEqual({ from: undefined, preset: undefined, to: undefined });
  });

  it("quitar el rango se guarda como `preset=custom` solo donde hay rango por defecto", () => {
    const cleared = { from: undefined, preset: undefined, to: undefined };

    expect(serializeReportsRange(cleared, getReportById("daily-sales"))).toEqual({
      from: "",
      preset: "custom",
      to: "",
    });
    expect(serializeReportsRange(cleared, getReportById("daily-close"))).toEqual({
      from: "",
      preset: "",
      to: "",
    });
    expect(serializeReportsRange(cleared)).toEqual({ from: "", preset: "", to: "" });
  });

  it("un preset o un rango elegidos se guardan como siempre", () => {
    const report = getReportById("daily-sales");

    expect(serializeReportsRange({ preset: "this_month" }, report)).toEqual({
      from: "",
      preset: "this_month",
      to: "",
    });
    expect(
      serializeReportsRange({ from: "2026-01-01", preset: "custom", to: "2026-01-31" }, report),
    ).toEqual({ from: "2026-01-01", preset: "", to: "2026-01-31" });
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
