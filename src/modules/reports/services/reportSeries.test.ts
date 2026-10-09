import { ApiError } from "@/lib/api/apiError";

import {
  assertReportSeriesParams,
  buildBucketWindows,
  buildDailySalesSeries,
  buildGrossProfitSeries,
  computeDeltaPct,
  formatBucketLabel,
  parseReportSeriesParams,
  resolveAutoGroupBy,
  resolvePreviousRange,
  resolveReportSeriesRequest,
  seriesFetchRange,
  toTimeSeriesPoints,
  type DailySalesSeriesMeasures,
  type ReportSeriesDayRow,
  type ReportSeriesRequest,
} from "./reportSeries";

function params(query: string) {
  return parseReportSeriesParams(new URLSearchParams(query));
}

function request(query: string): ReportSeriesRequest {
  const resolved = resolveReportSeriesRequest(params(query));

  if (!resolved) {
    throw new Error(`Sin serie para ${query}`);
  }

  return resolved;
}

function sale(day: string, totalRef: number, count = 1): ReportSeriesDayRow<DailySalesSeriesMeasures> {
  return { day, values: { count, paidVes: totalRef * 400, totalRef, totalVes: totalRef * 500 } };
}

function expectBadRequest(run: () => unknown, message: RegExp) {
  let thrown: unknown;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect((thrown as ApiError).status).toBe(400);
  expect((thrown as ApiError).code).toBe("BAD_REQUEST");
  expect((thrown as ApiError).message).toMatch(message);
}

function allNumbers(value: unknown): number[] {
  if (typeof value === "number") {
    return [value];
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(allNumbers);
  }

  return [];
}

describe("parseReportSeriesParams", () => {
  it("lee rango, agrupación y comparación", () => {
    expect(params("from=2026-05-01&to=2026-05-31&groupBy=week&compare=1")).toEqual({
      compare: true,
      from: "2026-05-01",
      groupBy: "week",
      requested: true,
      to: "2026-05-31",
    });
  });

  it("sin groupBy ni compare no se pide la serie", () => {
    expect(params("from=2026-05-01&to=2026-05-31")).toEqual({
      compare: false,
      from: "2026-05-01",
      groupBy: null,
      requested: false,
      to: "2026-05-31",
    });
    expect(params("compare=0&groupBy=").requested).toBe(false);
  });

  it("groupBy=auto pide la serie con agrupación automática", () => {
    expect(params("groupBy=auto")).toEqual(
      expect.objectContaining({ groupBy: null, requested: true }),
    );
  });

  it("fromStart ignora from", () => {
    expect(params("fromStart=1&from=no-es-fecha&to=2026-05-31").from).toBeNull();
  });

  it.each([
    ["groupBy=year", /agrupación no es válida/],
    ["groupBy=DAY", /agrupación no es válida/],
    ["from=2026-13-01", /"desde" no es válida/],
    ["from=2026-02-30", /"desde" no es válida/],
    ["from=18/05/2026", /"desde" no es válida/],
    ["to=2026-5-1", /"hasta" no es válida/],
    ["to=2026-05-18T00:00:00Z", /"hasta" no es válida/],
    ["from=2026-05-19&to=2026-05-18", /no puede ser posterior/],
  ])("rechaza %s con 400 en español", (query, message) => {
    expectBadRequest(() => params(query), message);
  });

  it("acepta from igual a to y fechas vacías", () => {
    expect(params("from=2026-05-18&to=2026-05-18").from).toBe("2026-05-18");
    expect(params("from=&to=")).toEqual(expect.objectContaining({ from: null, to: null }));
  });
});

describe("resolveReportSeriesRequest", () => {
  it("no hay serie si no se pidió o falta from o to", () => {
    expect(resolveReportSeriesRequest(params("from=2026-05-01&to=2026-05-31"))).toBeNull();
    expect(resolveReportSeriesRequest(params("groupBy=day&to=2026-05-31"))).toBeNull();
    expect(resolveReportSeriesRequest(params("compare=1&from=2026-05-01"))).toBeNull();
    expect(resolveReportSeriesRequest(params("compare=1&fromStart=1&to=2026-05-31"))).toBeNull();
  });

  it.each([
    [1, "day"],
    [62, "day"],
    [63, "week"],
    [370, "week"],
    [371, "month"],
    [731, "month"],
  ])("agrupación automática con %i días → %s", (days, expected) => {
    expect(resolveAutoGroupBy(days)).toBe(expected);
  });

  it("devuelve la agrupación efectiva de un rango de 2 años", () => {
    expect(request("from=2024-10-09&to=2026-10-08&groupBy=auto").groupBy).toBe("month");
    expect(request("from=2024-10-09&to=2026-10-08&compare=1").groupBy).toBe("month");
    expect(request("from=2024-10-09&to=2026-10-08&groupBy=day").groupBy).toBe("day");
  });

  it("el periodo anterior es el mismo nº de días justo antes de from", () => {
    expect(resolvePreviousRange({ from: "2026-05-04", to: "2026-05-13" })).toEqual({
      from: "2026-04-24",
      to: "2026-05-03",
    });
    expect(resolvePreviousRange({ from: "2026-03-01", to: "2026-03-01" })).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });

    const compared = request("from=2026-05-04&to=2026-05-13&compare=1");
    expect(compared.previousRange).toEqual({ from: "2026-04-24", to: "2026-05-03" });
    expect(seriesFetchRange(compared)).toEqual({ from: "2026-04-24", to: "2026-05-13" });
    expect(seriesFetchRange(request("from=2026-05-04&to=2026-05-13&groupBy=day"))).toEqual({
      from: "2026-05-04",
      to: "2026-05-13",
    });
  });

  it("rechaza un rango de más de 10 años", () => {
    expectBadRequest(
      () => assertReportSeriesParams(new URLSearchParams("from=2005-01-01&to=2026-01-01&groupBy=day")),
      /no puede superar 10 años/,
    );
    expect(() =>
      assertReportSeriesParams(new URLSearchParams("from=2005-01-01&to=2026-01-01")),
    ).not.toThrow();
  });
});

describe("buildBucketWindows", () => {
  it("un periodo por día", () => {
    expect(buildBucketWindows({ from: "2026-02-27", to: "2026-03-01" }, "day")).toEqual([
      { from: "2026-02-27", to: "2026-02-27" },
      { from: "2026-02-28", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-01" },
    ]);
  });

  it("semanas de lunes a domingo, recortadas en los extremos", () => {
    // 2026-05-06 es miércoles; 2026-05-19 es martes.
    expect(buildBucketWindows({ from: "2026-05-06", to: "2026-05-19" }, "week")).toEqual([
      { from: "2026-05-06", to: "2026-05-10" },
      { from: "2026-05-11", to: "2026-05-17" },
      { from: "2026-05-18", to: "2026-05-19" },
    ]);
  });

  it("un domingo suelto es una semana de un día", () => {
    expect(buildBucketWindows({ from: "2026-05-10", to: "2026-05-11" }, "week")).toEqual([
      { from: "2026-05-10", to: "2026-05-10" },
      { from: "2026-05-11", to: "2026-05-11" },
    ]);
  });

  it("meses de calendario, recortados en los extremos y con febrero bisiesto", () => {
    expect(buildBucketWindows({ from: "2024-01-15", to: "2024-03-10" }, "month")).toEqual([
      { from: "2024-01-15", to: "2024-01-31" },
      { from: "2024-02-01", to: "2024-02-29" },
      { from: "2024-03-01", to: "2024-03-10" },
    ]);
  });

  it("cubre el rango sin huecos ni solapes en 2 años", () => {
    const range = { from: "2024-10-09", to: "2026-10-08" };

    for (const groupBy of ["day", "week", "month"] as const) {
      const windows = buildBucketWindows(range, groupBy);

      expect(windows[0]?.from).toBe(range.from);
      expect(windows.at(-1)?.to).toBe(range.to);
      expect(windows.every((window) => window.from <= window.to)).toBe(true);
    }

    expect(buildBucketWindows(range, "day")).toHaveLength(730);
    expect(buildBucketWindows(range, "month")).toHaveLength(25);
  });
});

// REP-F2: con un rango que cruza de año el eje X no distinguía un 19/05 de otro.
describe("etiquetas de un rango que cruza de año", () => {
  const series = (query: string) => {
    const request = resolveReportSeriesRequest(parseReportSeriesParams(new URLSearchParams(query)));

    if (!request) {
      throw new Error("sin serie");
    }

    return buildDailySalesSeries(request, []);
  };

  it("por día: cada etiqueta lleva su año", () => {
    const { current, previous } = series("from=2025-12-30&to=2026-01-02&groupBy=day&compare=1");

    expect(current.map((bucket) => bucket.label)).toEqual([
      "30/12/25",
      "31/12/25",
      "01/01/26",
      "02/01/26",
    ]);
    expect(previous?.map((bucket) => bucket.label)).toEqual(["26/12", "27/12", "28/12", "29/12"]);
  });

  it("por semana: el año va al final, y en los dos extremos si la semana cruza de año", () => {
    const { current } = series("from=2025-12-22&to=2026-01-11&groupBy=week");

    expect(current.map((bucket) => bucket.label)).toEqual([
      "22/12–28/12/25",
      "29/12/25–04/01/26",
      "05/01–11/01/26",
    ]);
  });

  it("por mes: los meses parciales de los extremos también llevan año", () => {
    const { current } = series("from=2024-05-19&to=2026-05-18&groupBy=month");

    expect(current[0].label).toBe("19/05–31/05/24");
    expect(current[1].label).toBe("jun 2024");
    expect(current[current.length - 1].label).toBe("01/05–18/05/26");
  });

  it("dentro de un mismo año las etiquetas siguen sin año", () => {
    const { current } = series("from=2026-05-17&to=2026-05-18&groupBy=day");

    expect(current.map((bucket) => bucket.label)).toEqual(["17/05", "18/05"]);
  });
});

describe("formatBucketLabel", () => {
  it("día, mes completo y periodo parcial", () => {
    expect(formatBucketLabel({ from: "2026-10-08", to: "2026-10-08" })).toBe("08/10");
    expect(formatBucketLabel({ from: "2026-10-01", to: "2026-10-31" })).toBe("oct 2026");
    expect(formatBucketLabel({ from: "2024-02-01", to: "2024-02-29" })).toBe("feb 2024");
    expect(formatBucketLabel({ from: "2026-10-15", to: "2026-10-31" })).toBe("15/10–31/10");
    expect(formatBucketLabel({ from: "2026-09-28", to: "2026-10-04" })).toBe("28/09–04/10");
  });
});

describe("computeDeltaPct", () => {
  it("variación con 2 decimales", () => {
    expect(computeDeltaPct(150, 100)).toBe(50);
    expect(computeDeltaPct(72.55, 20)).toBe(262.75);
    expect(computeDeltaPct(0, 100)).toBe(-100);
    expect(computeDeltaPct(1, 3)).toBe(-66.67);
  });

  it("null sin periodo anterior o con anterior en 0: nunca NaN ni Infinity", () => {
    expect(computeDeltaPct(100, 0)).toBeNull();
    expect(computeDeltaPct(0, 0)).toBeNull();
    expect(computeDeltaPct(100, null)).toBeNull();
    expect(computeDeltaPct(100, undefined)).toBeNull();
    expect(computeDeltaPct(Number.NaN, 10)).toBeNull();
    expect(computeDeltaPct(10, Number.NaN)).toBeNull();
    expect(computeDeltaPct(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });

  it("con anterior negativo el signo sigue a la dirección del cambio", () => {
    expect(computeDeltaPct(10, -10)).toBe(200);
    expect(computeDeltaPct(-20, -10)).toBe(-100);
  });
});

describe("buildReportSeries", () => {
  it("rellena con 0 los días sin ventas y suma varias filas del mismo día", () => {
    const series = buildDailySalesSeries(request("from=2026-05-04&to=2026-05-07&groupBy=day"), [
      sale("2026-05-04", 10),
      sale("2026-05-04", 5.55, 2),
      sale("2026-05-06", 20),
      sale("2026-05-08", 999),
      sale("2026-05-03", 999),
    ]);

    expect(series.groupBy).toBe("day");
    expect(series.range).toEqual({ from: "2026-05-04", to: "2026-05-07" });
    expect(series.current).toEqual([
      {
        count: 3,
        from: "2026-05-04",
        key: "2026-05-04",
        label: "04/05",
        paidVes: 6220,
        to: "2026-05-04",
        totalRef: 15.55,
        totalVes: 7775,
      },
      {
        count: 0,
        from: "2026-05-05",
        key: "2026-05-05",
        label: "05/05",
        paidVes: 0,
        to: "2026-05-05",
        totalRef: 0,
        totalVes: 0,
      },
      {
        count: 1,
        from: "2026-05-06",
        key: "2026-05-06",
        label: "06/05",
        paidVes: 8000,
        to: "2026-05-06",
        totalRef: 20,
        totalVes: 10000,
      },
      {
        count: 0,
        from: "2026-05-07",
        key: "2026-05-07",
        label: "07/05",
        paidVes: 0,
        to: "2026-05-07",
        totalRef: 0,
        totalVes: 0,
      },
    ]);
    expect(series.previous).toBeNull();
    expect(series.previousRange).toBeNull();
    expect(series.totals).toEqual({
      current: { count: 4, paidVes: 14220, totalRef: 35.55, totalVes: 17775 },
      deltaPct: null,
      previous: null,
    });
  });

  it("alinea el periodo anterior por posición con las mismas ventanas desplazadas", () => {
    const series = buildDailySalesSeries(request("from=2026-05-04&to=2026-05-13&groupBy=week&compare=1"), [
      sale("2026-05-04", 15.55),
      sale("2026-05-06", 20),
      sale("2026-05-10", 7),
      sale("2026-05-12", 30),
      sale("2026-04-27", 8),
      sale("2026-04-29", 12),
      sale("2026-04-23", 999),
    ]);

    expect(series.current.map(({ from, to, totalRef }) => ({ from, to, totalRef }))).toEqual([
      { from: "2026-05-04", to: "2026-05-10", totalRef: 42.55 },
      { from: "2026-05-11", to: "2026-05-13", totalRef: 30 },
    ]);
    expect(series.previousRange).toEqual({ from: "2026-04-24", to: "2026-05-03" });
    expect(series.previous?.map(({ from, key, to, totalRef }) => ({ from, key, to, totalRef }))).toEqual([
      { from: "2026-04-24", key: "2026-04-24", to: "2026-04-30", totalRef: 20 },
      { from: "2026-05-01", key: "2026-05-01", to: "2026-05-03", totalRef: 0 },
    ]);
    expect(series.totals.current.totalRef).toBe(72.55);
    expect(series.totals.previous?.totalRef).toBe(20);
    expect(series.totals.deltaPct).toBe(262.75);
  });

  it("periodo anterior sin datos: serie en 0 y delta null", () => {
    const series = buildDailySalesSeries(request("from=2026-05-04&to=2026-05-05&compare=1"), [
      sale("2026-05-04", 10),
    ]);

    expect(series.previous).toHaveLength(2);
    expect(series.previous?.every((bucket) => bucket.totalRef === 0 && bucket.count === 0)).toBe(true);
    expect(series.totals.previous).toEqual({ count: 0, paidVes: 0, totalRef: 0, totalVes: 0 });
    expect(series.totals.deltaPct).toBeNull();
  });

  it("un solo día de datos: un punto, sin NaN", () => {
    const series = buildDailySalesSeries(request("from=2026-05-18&to=2026-05-18&compare=1"), [
      sale("2026-05-18", 10),
    ]);

    expect(series.groupBy).toBe("day");
    expect(series.current).toHaveLength(1);
    expect(series.previous).toHaveLength(1);
    expect(series.previous?.[0]?.key).toBe("2026-05-17");
    expect(allNumbers(series).every(Number.isFinite)).toBe(true);
  });

  it("sin datos y con valores no numéricos nunca produce NaN ni Infinity", () => {
    const series = buildDailySalesSeries(request("from=2026-05-01&to=2026-05-31&compare=1"), [
      {
        day: "2026-05-02",
        values: {
          count: Number.NaN,
          paidVes: Number.POSITIVE_INFINITY,
          totalRef: Number.NaN,
          totalVes: 100,
        },
      },
    ]);

    expect(allNumbers(series).every(Number.isFinite)).toBe(true);
    expect(series.totals.current).toEqual({ count: 0, paidVes: 0, totalRef: 0, totalVes: 100 });
    expect(JSON.stringify(series)).not.toMatch(/NaN|Infinity/);
  });

  it("el total es la suma de los periodos ya redondeados", () => {
    const series = buildDailySalesSeries(request("from=2026-05-01&to=2026-05-03&groupBy=day"), [
      sale("2026-05-01", 0.1),
      sale("2026-05-02", 0.2),
      sale("2026-05-03", 0.335),
    ]);
    const sum = series.current.reduce((total, bucket) => total + bucket.totalRef, 0);

    expect(series.totals.current.totalRef).toBe(Math.round(sum * 100) / 100);
  });

  it("2 años por día: 730 periodos sin huecos", () => {
    const series = buildDailySalesSeries(request("from=2024-10-09&to=2026-10-08&groupBy=day"), [
      sale("2024-10-09", 1),
      sale("2026-10-08", 2),
    ]);

    expect(series.current).toHaveLength(730);
    expect(series.totals.current.totalRef).toBe(3);
  });

  it("ganancia bruta: mide la variación sobre grossProfitRef, también en pérdida", () => {
    const series = buildGrossProfitSeries(request("from=2026-05-02&to=2026-05-02&compare=1"), [
      { day: "2026-05-02", values: { costRef: 40, grossProfitRef: 10, revenueRef: 50 } },
      { day: "2026-05-01", values: { costRef: 30, grossProfitRef: -5, revenueRef: 25 } },
    ]);

    expect(series.totals).toEqual({
      current: { costRef: 40, grossProfitRef: 10, revenueRef: 50 },
      deltaPct: 300,
      previous: { costRef: 30, grossProfitRef: -5, revenueRef: 25 },
    });
  });
});

describe("toTimeSeriesPoints", () => {
  it("adapta los periodos a puntos de TimeSeriesChart", () => {
    const series = buildDailySalesSeries(request("from=2026-05-09&to=2026-05-11&groupBy=week"), [
      sale("2026-05-09", 10, 2),
      sale("2026-05-11", 4),
    ]);

    expect(
      toTimeSeriesPoints(series.current, { count: "count", valueRef: "totalRef", valueVes: "totalVes" }),
    ).toEqual([
      {
        count: 2,
        key: "2026-05-09",
        label: "09/05–10/05",
        title: "Del 09/05/2026 al 10/05/2026",
        valueRef: 10,
        valueVes: 5000,
      },
      {
        count: 1,
        key: "2026-05-11",
        label: "11/05",
        title: undefined,
        valueRef: 4,
        valueVes: 2000,
      },
    ]);
  });

  it("sin periodo anterior devuelve una lista vacía", () => {
    expect(toTimeSeriesPoints<DailySalesSeriesMeasures>(null, { valueRef: "totalRef" })).toEqual([]);
  });
});
