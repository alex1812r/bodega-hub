/**
 * @jest-environment node
 */

/**
 * REP-09a · flujo de ventas del dashboard: paridad servidor / mock. La serie la
 * calcula el servicio de ventas diarias de Reportes (cuya paridad Supabase /
 * mock cubre `reportSeries.services.test.ts`); aquí se comprueba que los dos
 * servicios del dashboard le piden lo mismo y devuelven lo mismo.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../reports/services/reports.server", () => ({
  getDailySalesReport: jest.fn(async (searchParams: URLSearchParams, storeIds: string | string[]) =>
    jest
      .requireActual("../../reports/services/reports.mock-server")
      .getDailySalesReport(searchParams, storeIds),
  ),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { getDailySalesReport } from "@/modules/reports/services/reports.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getDashboardSalesTrend as getTrendMock } from "./dashboard.mock-server";
import { getDashboardSalesTrend as getTrendServer } from "./dashboard.server";
import {
  readSalesTrendFromStartTo,
  salesTrendFromSeries,
  toSalesTrendFromStartParams,
  toSalesTrendSeriesParams,
} from "./salesTrend";

function params(query: string) {
  return new URLSearchParams(query);
}

describe("flujo de ventas del dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("toSalesTrendSeriesParams", () => {
    it("pide la serie con agrupación automática y la página mínima de la tabla", () => {
      const result = toSalesTrendSeriesParams(params("from=2026-05-12&to=2026-05-18&compare=1"));

      expect(Object.fromEntries(result ?? [])).toEqual({
        compare: "1",
        from: "2026-05-12",
        groupBy: "auto",
        limit: "1",
        skip: "0",
        to: "2026-05-18",
      });
    });

    it("respeta groupBy y no inventa compare", () => {
      const result = toSalesTrendSeriesParams(params("from=2026-01-01&to=2026-05-18&groupBy=month"));

      expect(result?.get("groupBy")).toBe("month");
      expect(result?.has("compare")).toBe(false);
    });

    it.each(["", "from=2026-05-12", "to=2026-05-18", "from=&to=2026-05-18"])(
      "sin rango completo (%s) no hay serie",
      (query) => {
        expect(toSalesTrendSeriesParams(params(query))).toBeNull();
      },
    );
  });

  it("sin serie no hay puntos", () => {
    expect(salesTrendFromSeries(undefined)).toEqual({ items: [], series: null });
  });

  it.each([
    ["semana con periodo anterior", "from=2026-05-12&to=2026-05-18&compare=1"],
    ["sin comparar", "from=2026-05-12&to=2026-05-18"],
    ["rango largo, agrupación automática", "from=2026-01-01&to=2026-05-18&compare=1"],
    ["agrupación pedida", "from=2026-01-01&to=2026-05-18&groupBy=month&compare=1"],
  ])("paridad servidor / mock: %s", async (_name, query) => {
    const fromServer = await getTrendServer(params(query), DEFAULT_STORE_ID);
    const fromMock = getTrendMock(params(query), DEFAULT_STORE_ID);

    expect(fromServer).toEqual(fromMock);
    expect(fromServer.series).not.toBeNull();
    expect(fromServer.items).toHaveLength(fromServer.series?.current.length ?? -1);
    // El servidor no consulta por su cuenta: delega en el servicio de Reportes.
    expect(createRouteSupabaseClient).not.toHaveBeenCalled();
    expect(getDailySalesReport).toHaveBeenCalledTimes(1);
  });

  it("devuelve la serie sin huecos, con el periodo anterior alineado y su delta", () => {
    const { items, series } = getTrendMock(
      params("from=2026-05-12&to=2026-05-18&compare=1"),
      DEFAULT_STORE_ID,
    );

    expect(series?.groupBy).toBe("day");
    expect(series?.current.map((bucket) => bucket.key)).toEqual([
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
    ]);
    expect(series?.previousRange).toEqual({ from: "2026-05-05", to: "2026-05-11" });
    expect(series?.previous).toHaveLength(7);
    expect(items.map((item) => item.saleDate)).toEqual(series?.current.map((bucket) => bucket.key));
    expect(items[6]).toEqual({
      paidVes: series?.current[6].paidVes,
      saleDate: "2026-05-18",
      salesCount: series?.current[6].count,
      totalRef: series?.current[6].totalRef,
      totalVes: series?.current[6].totalVes,
    });
    // Sin ventas en el periodo anterior no hay porcentaje (la UI pinta "—").
    expect(series?.totals.previous?.totalRef).toBe(0);
    expect(series?.totals.deltaPct).toBeNull();
  });

  it("un rango largo se agrupa solo", () => {
    const { series } = getTrendMock(
      params("from=2025-01-01&to=2026-05-18&compare=1"),
      DEFAULT_STORE_ID,
    );

    expect(series?.groupBy).toBe("month");
  });

  it("una fecha mal formada es un 400, igual en los dos servicios", async () => {
    const query = "from=2026-13-40&to=2026-05-18";

    expect(() => getTrendMock(params(query), DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST", status: 400 }),
    );
    await expect(getTrendServer(params(query), DEFAULT_STORE_ID)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });

  it("sin rango el servidor responde como antes: días con ventas y sin serie", async () => {
    const result = {
      data: [
        { paid_ves: 100, sale_date: "2026-05-17", sales_count: 2, total_ref: 10, total_ves: 5000 },
        { paid_ves: 50, sale_date: "2026-05-16", sales_count: 1, total_ref: 4, total_ves: 2000 },
        { paid_ves: 0, sale_date: "2026-05-17", sales_count: 1, total_ref: 6, total_ves: 3000 },
      ],
      error: null,
    };
    const builder = {
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      then: (onFulfilled: (value: typeof result) => unknown) =>
        Promise.resolve(result).then(onFulfilled),
    };
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: () => builder });

    await expect(getTrendServer(params(""), DEFAULT_STORE_ID)).resolves.toEqual({
      items: [
        { paidVes: 50, saleDate: "2026-05-16", salesCount: 1, totalRef: 4, totalVes: 2000 },
        { paidVes: 100, saleDate: "2026-05-17", salesCount: 3, totalRef: 16, totalVes: 8000 },
      ],
      series: null,
    });
    expect(getDailySalesReport).not.toHaveBeenCalled();
    expect(getTrendMock(params(""), DEFAULT_STORE_ID).series).toBeNull();
  });

  describe("desde el inicio (REP-F3)", () => {
    function firstSaleBuilder(firstDay: string | null) {
      const result = { data: firstDay ? [{ sale_date: firstDay }] : [], error: null };
      const builder = {
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        then: (onFulfilled: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(onFulfilled),
      };

      return builder;
    }

    it("solo es «desde el inicio» con fromStart y un to válido", () => {
      expect(readSalesTrendFromStartTo(params("fromStart=1&to=2026-05-18"))).toBe("2026-05-18");
      expect(readSalesTrendFromStartTo(params("fromStart=true&from=2026-05-01&to=2026-05-18"))).toBe(
        "2026-05-18",
      );
      expect(readSalesTrendFromStartTo(params("to=2026-05-18"))).toBeNull();
      expect(readSalesTrendFromStartTo(params("fromStart=0&to=2026-05-18"))).toBeNull();
      expect(readSalesTrendFromStartTo(params("fromStart=1"))).toBeNull();
      expect(readSalesTrendFromStartTo(params("fromStart=1&to=2026-13-40"))).toBeNull();
    });

    it("pide la serie del primer día con ventas a to, automática y sin comparación", () => {
      expect(Object.fromEntries(toSalesTrendFromStartParams("2026-05-18", "2025-03-02"))).toEqual({
        from: "2025-03-02",
        groupBy: "auto",
        limit: "1",
        skip: "0",
        to: "2026-05-18",
      });
    });

    it("sin ventas (o con el primer día después de to) la serie es solo el día to", () => {
      expect(toSalesTrendFromStartParams("2026-05-18", null).get("from")).toBe("2026-05-18");
      expect(toSalesTrendFromStartParams("2026-05-18", "2026-06-01").get("from")).toBe("2026-05-18");
    });

    it("una historia más larga que el máximo de la serie se recorta a los últimos 3660 días", () => {
      const from = toSalesTrendFromStartParams("2026-05-18", "2001-01-01").get("from") ?? "";
      const days = (Date.parse("2026-05-18T00:00:00Z") - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

      expect(days).toBe(3660);
    });

    it("mock: la serie empieza en el primer día con ventas, sin periodo anterior", () => {
      const all = getTrendMock(params("from=2020-01-01&to=2026-05-18&groupBy=day"), DEFAULT_STORE_ID);
      const firstDayWithSales = all.series?.current.find((bucket) => bucket.count > 0)?.key;
      const { series } = getTrendMock(params("fromStart=1&to=2026-05-18"), DEFAULT_STORE_ID);

      expect(firstDayWithSales).toBeDefined();
      expect(series?.range).toEqual({ from: firstDayWithSales, to: "2026-05-18" });
      expect(series?.previous).toBeNull();
      expect(series?.previousRange).toBeNull();
      expect(series?.totals.deltaPct).toBeNull();
      expect(series?.totals.current.totalRef).toBe(all.series?.totals.current.totalRef);
    });

    it("mock: una tienda sin ventas responde un solo día en cero", () => {
      const { series } = getTrendMock(params("fromStart=1&to=2026-05-18"), "store-sin-ventas");

      expect(series?.range).toEqual({ from: "2026-05-18", to: "2026-05-18" });
      expect(series?.totals.current.count).toBe(0);
    });

    it("servidor: busca el primer día en daily_sales_summary y pide la misma serie que el mock", async () => {
      const builder = firstSaleBuilder("2026-04-02");
      const from = jest.fn(() => builder);
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

      await getTrendServer(params("fromStart=1&to=2026-05-18&compare=1"), DEFAULT_STORE_ID);

      expect(from).toHaveBeenCalledWith("daily_sales_summary");
      expect(builder.select).toHaveBeenCalledWith("sale_date");
      expect(builder.order).toHaveBeenCalledWith("sale_date", { ascending: true });
      expect(builder.limit).toHaveBeenCalledWith(1);
      expect(builder.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
      expect(builder.lte).toHaveBeenCalledWith("sale_date", "2026-05-18");

      const [seriesParams] = (getDailySalesReport as jest.Mock).mock.calls[0];

      expect(Object.fromEntries(seriesParams)).toEqual({
        from: "2026-04-02",
        groupBy: "auto",
        limit: "1",
        skip: "0",
        to: "2026-05-18",
      });
    });

    it("servidor: sin ventas pide solo el día to", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: () => firstSaleBuilder(null) });

      const { series } = await getTrendServer(params("fromStart=1&to=2026-05-18"), "store-sin-ventas");

      expect(series?.range).toEqual({ from: "2026-05-18", to: "2026-05-18" });
    });
  });
});
