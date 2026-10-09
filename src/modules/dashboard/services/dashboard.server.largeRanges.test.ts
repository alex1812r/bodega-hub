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

import { getDashboardMetrics } from "./dashboard.server";

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
