import { ApiError } from "@/lib/api/apiError";

import { REPORT_MIN_YEAR, reportMaxYear } from "./reportParams";
import {
  buildBucketWindows,
  buildDailySalesSeries,
  parseReportSeriesParams,
  resolvePreviousRange,
  resolveReportSeriesRequest,
  type ReportGroupBy,
  type ReportSeriesRequest,
} from "./reportSeries";

/**
 * REP-F7 / R-01: `to=9999-12-31` colgaba el proceso. `shiftIsoDate("9999-12-31", 1)`
 * es `"10000-01-01"`, que como TEXTO es menor que `"9999-12-31"`: el bucle de
 * ventanas no terminaba hasta el año 275760.
 */

const GROUP_BYS: ReportGroupBy[] = ["day", "week", "month"];

function elapsedMs(run: () => void) {
  const startedAt = Date.now();
  run();

  return Date.now() - startedAt;
}

function badRequestMessage(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.code === "BAD_REQUEST") {
      return error.message;
    }

    throw error;
  }

  return null;
}

describe("defensa en profundidad: los bucles de fechas terminan con el año 9999", () => {
  const range = { from: "9999-12-01", to: "9999-12-31" };

  it.each(GROUP_BYS)("buildBucketWindows por %s termina en < 1 s y cubre el rango", (groupBy) => {
    let windows: ReturnType<typeof buildBucketWindows> = [];

    expect(elapsedMs(() => (windows = buildBucketWindows(range, groupBy)))).toBeLessThan(1000);
    expect(windows[0]?.from).toBe(range.from);
    expect(windows.at(-1)?.to).toBe(range.to);
    expect(windows.length).toBeLessThanOrEqual(31);
  });

  it("un día, una ventana; un mes completo, un mes", () => {
    expect(buildBucketWindows({ from: "9999-12-31", to: "9999-12-31" }, "day")).toEqual([
      { from: "9999-12-31", to: "9999-12-31" },
    ]);
    expect(buildBucketWindows(range, "month")).toEqual([range]);
    expect(buildBucketWindows(range, "day")).toHaveLength(31);
  });

  it.each(GROUP_BYS)("la serie con compare por %s termina en < 1 s", (groupBy) => {
    const request: ReportSeriesRequest = {
      groupBy,
      previousRange: resolvePreviousRange(range),
      range,
    };
    let series: ReturnType<typeof buildDailySalesSeries> | null = null;

    expect(
      elapsedMs(() => {
        series = buildDailySalesSeries(request, [
          { day: "9999-12-31", values: { count: 1, paidVes: 0, totalRef: 7, totalVes: 0 } },
          { day: "9999-11-30", values: { count: 1, paidVes: 0, totalRef: 3, totalVes: 0 } },
        ]);
      }),
    ).toBeLessThan(1000);

    const built = series as ReturnType<typeof buildDailySalesSeries> | null;
    expect(built?.totals.current.totalRef).toBe(7);
    expect(built?.totals.previous?.totalRef).toBe(3);
    expect(built?.previous).toHaveLength(built?.current.length ?? -1);
  });

  it("nunca hay más ventanas que días del rango, aunque el rango no sea una fecha", () => {
    for (const groupBy of GROUP_BYS) {
      expect(
        buildBucketWindows({ from: "2026-05-01", to: "10000-01-01" }, groupBy),
      ).toEqual([]);
      expect(buildBucketWindows({ from: "abc", to: "2026-05-01" }, groupBy)).toEqual([]);
      expect(buildBucketWindows({ from: "2026-05-02", to: "2026-05-01" }, groupBy)).toEqual([]);
    }
  });
});

describe("validación de entrada: año razonable", () => {
  const maxYear = reportMaxYear();

  it.each([
    ["to=9999-12-31", /"hasta" no es válida.*año debe estar entre/],
    ["from=9999-12-01&to=9999-12-31&groupBy=day", /"desde" no es válida/],
    [`from=${REPORT_MIN_YEAR - 1}-12-31`, /"desde" no es válida.*año debe estar entre/],
    [`to=${maxYear + 1}-01-01`, /"hasta" no es válida/],
    ["from=0001-01-01", /"desde" no es válida/],
  ])("rechaza %s con 400 en español", (query, message) => {
    expect(badRequestMessage(() => parseReportSeriesParams(new URLSearchParams(query)))).toMatch(
      message,
    );
  });

  it("acepta los años de los extremos del intervalo", () => {
    const params = parseReportSeriesParams(
      new URLSearchParams(`from=${REPORT_MIN_YEAR}-01-01&to=${maxYear}-12-31`),
    );

    expect(params).toEqual(
      expect.objectContaining({ from: `${REPORT_MIN_YEAR}-01-01`, to: `${maxYear}-12-31` }),
    );
  });

  it("el periodo anterior de un rango en el año mínimo se calcula y termina", () => {
    const request = resolveReportSeriesRequest(
      parseReportSeriesParams(
        new URLSearchParams(
          `from=${REPORT_MIN_YEAR}-01-01&to=${REPORT_MIN_YEAR}-01-31&groupBy=day&compare=1`,
        ),
      ),
    );

    expect(request?.previousRange).toEqual({
      from: `${REPORT_MIN_YEAR - 1}-12-01`,
      to: `${REPORT_MIN_YEAR - 1}-12-31`,
    });

    let series: ReturnType<typeof buildDailySalesSeries> | null = null;
    expect(
      elapsedMs(() => {
        series = buildDailySalesSeries(request as ReportSeriesRequest, [
          {
            day: `${REPORT_MIN_YEAR - 1}-12-15`,
            values: { count: 1, paidVes: 0, totalRef: 4, totalVes: 0 },
          },
        ]);
      }),
    ).toBeLessThan(1000);

    const built = series as ReturnType<typeof buildDailySalesSeries> | null;
    expect(built?.current).toHaveLength(31);
    expect(built?.previous).toHaveLength(31);
    expect(built?.totals.previous?.totalRef).toBe(4);
  });
});
