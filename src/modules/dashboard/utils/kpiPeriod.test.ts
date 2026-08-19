import {
  getKpiComparisonLabel,
  getKpiPeriodLabel,
  inclusiveIsoDayCount,
  kpiChangePercent,
  parseDashboardMetricsDateParams,
  resolveKpiMetricsFilters,
  resolvePreviousKpiMetricsFilters,
} from "./kpiPeriod";

const TODAY = "2026-05-18";

describe("kpiPeriod", () => {
  it("maps Hoy to today and previous to ayer", () => {
    expect(resolveKpiMetricsFilters("hoy", undefined, TODAY)).toEqual({
      from: "2026-05-18",
      to: "2026-05-18",
    });
    expect(resolvePreviousKpiMetricsFilters("hoy", undefined, TODAY)).toEqual({
      from: "2026-05-17",
      to: "2026-05-17",
    });
  });

  it("maps Ayer to yesterday and previous to the day before", () => {
    expect(resolveKpiMetricsFilters("ayer", undefined, TODAY)).toEqual({
      from: "2026-05-17",
      to: "2026-05-17",
    });
    expect(resolvePreviousKpiMetricsFilters("ayer", undefined, TODAY)).toEqual({
      from: "2026-05-16",
      to: "2026-05-16",
    });
  });

  it("maps rango to the chosen Caracas dates and the equal-length period before from", () => {
    const range = { from: "2026-08-10", to: "2026-08-16" };

    expect(inclusiveIsoDayCount(range.from, range.to)).toBe(7);
    expect(resolveKpiMetricsFilters("rango", range, TODAY)).toEqual(range);
    expect(resolvePreviousKpiMetricsFilters("rango", range, TODAY)).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    });
  });

  it("maps Desde el inicio to fromStart without a previous range", () => {
    expect(resolveKpiMetricsFilters("desde_inicio", undefined, TODAY)).toEqual({
      fromStart: true,
      to: "2026-05-18",
    });
    expect(resolvePreviousKpiMetricsFilters("desde_inicio", undefined, TODAY)).toBeNull();
    expect(getKpiComparisonLabel("desde_inicio")).toBeNull();
    expect(getKpiPeriodLabel("desde_inicio")).toBe("Desde el inicio");
  });

  it("parses fromStart as a skipped lower bound", () => {
    expect(parseDashboardMetricsDateParams(new URLSearchParams("fromStart=1&to=2026-08-16"))).toEqual({
      from: null,
      fromStart: true,
      to: "2026-08-16",
    });
    expect(
      parseDashboardMetricsDateParams(
        new URLSearchParams("fromStart=1&from=2026-08-01&to=2026-08-16"),
      ),
    ).toEqual({
      from: null,
      fromStart: true,
      to: "2026-08-16",
    });
    expect(parseDashboardMetricsDateParams(new URLSearchParams("from=2026-08-16&to=2026-08-16"))).toEqual(
      {
        from: "2026-08-16",
        fromStart: false,
        to: "2026-08-16",
      },
    );
  });

  it("does not invent a percent when the previous total is zero", () => {
    expect(kpiChangePercent(40, 20)).toBe(100);
    expect(kpiChangePercent(10, 0)).toBeNull();
    expect(kpiChangePercent(10, null)).toBeNull();
  });
});
