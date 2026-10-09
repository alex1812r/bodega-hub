import {
  DASHBOARD_PLATFORM_PRESETS,
  DASHBOARD_STORE_PRESETS,
  describeDashboardPeriod,
  normalizeDashboardRange,
  resolveDashboardChartRange,
} from "./dashboardPeriod";

const TODAY = "2026-05-18";

function periodOf(value: Parameters<typeof normalizeDashboardRange>[0]) {
  return describeDashboardPeriod(normalizeDashboardRange(value, TODAY), TODAY);
}

describe("dashboardPeriod", () => {
  it("sin rango el periodo es hoy y se compara con ayer, como antes", () => {
    expect(periodOf({})).toEqual({
      comparisonLabel: "vs ayer",
      currentFilters: { from: TODAY, to: TODAY },
      kpiPeriodLabel: "Hoy",
      preset: "hoy",
      previousFilters: { from: "2026-05-17", to: "2026-05-17" },
      range: { from: TODAY, preset: "today", to: TODAY },
    });
  });

  it("un preset relativo sin fechas se calcula con el día operativo", () => {
    const period = periodOf({ preset: "yesterday" });

    expect(period.range).toEqual({ from: "2026-05-17", preset: "yesterday", to: "2026-05-17" });
    expect(period.preset).toBe("ayer");
    expect(period.comparisonLabel).toBe("vs el día anterior");
    expect(period.previousFilters).toEqual({ from: "2026-05-16", to: "2026-05-16" });
  });

  it("Mes pasado se compara con los 30 días justo antes y la etiqueta lo dice", () => {
    const period = periodOf({ preset: "last_month" });

    expect(period.range).toEqual({ from: "2026-04-01", preset: "last_month", to: "2026-04-30" });
    expect(period.kpiPeriodLabel).toBe("Mes pasado");
    expect(period.preset).toBe("rango");
    expect(period.previousFilters).toEqual({ from: "2026-03-02", to: "2026-03-31" });
    expect(period.comparisonLabel).toBe("vs los 30 días anteriores");
  });

  it("Este mes se compara con el mismo nº de días anteriores, no con el mes de calendario", () => {
    const period = periodOf({ preset: "this_month" });

    expect(period.currentFilters).toEqual({ from: "2026-05-01", to: TODAY });
    expect(period.previousFilters).toEqual({ from: "2026-04-13", to: "2026-04-30" });
    expect(period.comparisonLabel).toBe("vs los 18 días anteriores");
  });

  it("un rango personalizado lleva sus fechas en la etiqueta", () => {
    const period = periodOf({ from: "2026-05-04", preset: "custom", to: "2026-05-10" });

    expect(period.kpiPeriodLabel).toBe("4–10 may 2026");
    expect(period.preset).toBe("rango");
    expect(period.previousFilters).toEqual({ from: "2026-04-27", to: "2026-05-03" });
  });

  it("con un solo extremo el periodo es ese día", () => {
    expect(normalizeDashboardRange({ from: "2026-05-10" }, TODAY)).toEqual({
      from: "2026-05-10",
      preset: "custom",
      to: "2026-05-10",
    });
    expect(normalizeDashboardRange({ to: TODAY }, TODAY)).toEqual({
      from: TODAY,
      preset: "today",
      to: TODAY,
    });
  });

  describe("ventana del gráfico", () => {
    it("un rango de menos de 7 días se amplía a los últimos 7 que terminan en su último día", () => {
      expect(resolveDashboardChartRange({ from: TODAY, to: TODAY })).toEqual({
        from: "2026-05-12",
        to: TODAY,
        widened: true,
      });
      expect(resolveDashboardChartRange({ from: "2026-04-28", to: "2026-05-03" })).toEqual({
        from: "2026-04-27",
        to: "2026-05-03",
        widened: true,
      });
    });

    it("con 7 días o más se respeta el rango", () => {
      expect(resolveDashboardChartRange({ from: "2026-05-12", to: TODAY })).toEqual({
        from: "2026-05-12",
        to: TODAY,
        widened: false,
      });
      expect(resolveDashboardChartRange({ from: "2026-04-01", to: "2026-04-30" })).toEqual({
        from: "2026-04-01",
        to: "2026-04-30",
        widened: false,
      });
    });
  });

  describe("periodos extendidos de plataforma (REP-F3)", () => {
    it("tienda conserva sus ocho periodos; plataforma añade cuatro antes de Personalizado", () => {
      expect(DASHBOARD_STORE_PRESETS).toEqual([
        "today",
        "yesterday",
        "this_week",
        "last_week",
        "this_month",
        "last_month",
        "last_30_days",
        "custom",
      ]);
      expect(DASHBOARD_PLATFORM_PRESETS).toEqual([
        "today",
        "yesterday",
        "this_week",
        "last_week",
        "this_month",
        "last_month",
        "last_30_days",
        "last_14_days",
        "last_3_months",
        "last_6_months",
        "all_time",
        "custom",
      ]);
    });

    it("Desde el inicio: métricas con fromStart, sin periodo anterior ni etiqueta de comparación", () => {
      expect(periodOf({ from: undefined, preset: "all_time", to: TODAY })).toEqual({
        comparisonLabel: null,
        currentFilters: { fromStart: true, to: TODAY },
        kpiPeriodLabel: "Desde el inicio",
        preset: "desde_inicio",
        previousFilters: null,
        range: { preset: "all_time", to: TODAY },
      });
      expect(periodOf({ preset: "all_time" }).currentFilters).toEqual({ fromStart: true, to: TODAY });
    });

    it("Últimos 3 meses son 90 días y se comparan con los 90 anteriores", () => {
      const period = periodOf({ preset: "last_3_months" });

      expect(period.range).toEqual({ from: "2026-02-18", preset: "last_3_months", to: TODAY });
      expect(period.kpiPeriodLabel).toBe("Últimos 3 meses");
      expect(period.preset).toBe("rango");
      expect(period.previousFilters).toEqual({ from: "2025-11-20", to: "2026-02-17" });
      expect(period.comparisonLabel).toBe("vs los 90 días anteriores");
    });

    it("Últimos 14 días y Últimos 6 meses", () => {
      expect(periodOf({ preset: "last_14_days" }).currentFilters).toEqual({
        from: "2026-05-05",
        to: TODAY,
      });
      expect(periodOf({ preset: "last_6_months" }).currentFilters).toEqual({
        from: "2025-11-20",
        to: TODAY,
      });
    });

    it("desde el inicio la ventana del gráfico queda abierta y no se amplía", () => {
      expect(resolveDashboardChartRange({ to: TODAY })).toEqual({
        from: undefined,
        to: TODAY,
        widened: false,
      });
    });
  });
});
