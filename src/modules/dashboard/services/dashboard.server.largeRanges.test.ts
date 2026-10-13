/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { createFakePostgrest } from "@/modules/reports/services/testing/fakePostgrest";
import {
  buildSalesFixture,
  COUNTED_SALE_STATUSES,
  FIXTURE_DAY,
  FIXTURE_STORE_ID,
} from "@/modules/reports/services/testing/salesFixtures";

import { getDashboardMetrics, getDashboardSummary } from "./dashboard.server";

/**
 * REP-F7 (R-03): las métricas del dashboard leían `sales` sin paginar (solo
 * las primeras 1.000) y pedían las líneas con todos los ids en la URL: 500
 * "URI too long" a partir de unas 334 ventas en el rango.
 */

type Fixture = ReturnType<typeof buildSalesFixture>;

function expectedMetrics(fixture: Fixture) {
  const sales = fixture.sales.filter((sale) => COUNTED_SALE_STATUSES.includes(sale.status));
  const saleIds = new Set(sales.map((sale) => sale.id));
  const totalVes = sales.reduce((total, sale) => total + sale.total_ves, 0);
  const paidVes = sales.reduce((total, sale) => total + sale.paid_ves, 0);

  return {
    from: FIXTURE_DAY,
    paidVes,
    pendingVes: totalVes - paidVes,
    salesCount: sales.length,
    to: FIXTURE_DAY,
    totalRef: sales.reduce((total, sale) => total + sale.total_ref, 0),
    totalVes,
    unitsSold: fixture.sale_items
      .filter((item) => saleIds.has(item.sale_id))
      .reduce((total, item) => total + item.quantity, 0),
  };
}

async function metricsFor(count: number) {
  const fixture = buildSalesFixture(count);
  const database = createFakePostgrest(fixture);
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(database.client);

  const metrics = await getDashboardMetrics(
    new URLSearchParams(`from=${FIXTURE_DAY}&to=${FIXTURE_DAY}`),
    FIXTURE_STORE_ID,
  );

  return { database, fixture, metrics };
}

describe("getDashboardMetrics con rangos grandes", () => {
  // Conjunto pequeño: las cifras de siempre (este caso ya pasaba antes del arreglo).
  it("con 40 ventas da las mismas cifras que el cálculo a mano", async () => {
    const { fixture, metrics } = await metricsFor(40);

    expect(metrics).toEqual(expectedMetrics(fixture));
  });

  it.each([334, 1000, 5000])(
    "con %i ventas no falla con «URI too long» ni pierde ventas",
    async (count) => {
      const { database, fixture, metrics } = await metricsFor(count);

      expect(metrics).toEqual(expectedMetrics(fixture));
      expect(Math.max(...database.requests.map((request) => request.largestInList))).toBeLessThanOrEqual(
        100,
      );
    },
  );
});

/**
 * REP-F10 (N-02): el resumen leía las ventas de hoy y de ayer en una sola
 * respuesta sin paginar: con más de 1.000 entre los dos días se cortaba
 * («ayer» en 0 u «hoy» a medias), sin error.
 */
describe("getDashboardSummary con más de 1.000 ventas entre hoy y ayer (N-02)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    // Solo se fija el reloj («hoy» es el día del fixture); los temporizadores siguen reales.
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
      now: new Date(`${FIXTURE_DAY}T20:00:00.000Z`),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Las primeras `yesterdayCount` ventas del fixture pasan al día anterior. */
  async function summaryFor(count: number, yesterdayCount: number) {
    const fixture = buildSalesFixture(count);
    const sales = fixture.sales.map((sale, index) =>
      index < yesterdayCount
        ? { ...sale, created_at: new Date(Date.parse(sale.created_at) - DAY_MS).toISOString() }
        : sale,
    );
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(
      createFakePostgrest({ ...fixture, sales }).client,
    );

    const isLive = (sale: (typeof sales)[number]) => sale.status !== "cancelada";
    const today = sales.slice(yesterdayCount).filter(isLive);
    const previousDayTotalRef = sales
      .slice(0, yesterdayCount)
      .filter(isLive)
      .reduce((total, sale) => total + sale.total_ref, 0);
    const totalRef = today.reduce((total, sale) => total + sale.total_ref, 0);

    return {
      expected: {
        activeCustomers: 0,
        dayOverDayChangePercent: ((totalRef - previousDayTotalRef) / previousDayTotalRef) * 100,
        lowStockCount: 0,
        pendingSalesCount: sales.filter((sale) => sale.status === "pendiente_pago").length,
        previousDayTotalRef,
        salesCount: today.length,
        totalRef,
        totalVes: today.reduce((total, sale) => total + sale.total_ves, 0),
      },
      summary: await getDashboardSummary(FIXTURE_STORE_ID),
    };
  }

  // Conjunto pequeño: las cifras de siempre (este caso ya pasaba antes del arreglo).
  it("con 40 ventas (10 de ayer) da las mismas cifras que el cálculo a mano", async () => {
    const { expected, summary } = await summaryFor(40, 10);

    expect(summary).toEqual(expected);
  });

  it.each([
    [1513, 300],
    [6361, 300],
  ])("con %i ventas (%i de ayer) cuenta enteras las de hoy y las de ayer", async (count, yesterdayCount) => {
    const { expected, summary } = await summaryFor(count, yesterdayCount);

    expect(expected.salesCount).toBeGreaterThanOrEqual(1091);
    expect(summary).toEqual(expected);
  });
});
