/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../cash/services/cash.session.server", () => ({
  listOpenCashSessions: jest.fn().mockResolvedValue([]),
  listPendingClosures: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../vault/services/vault.server", () => ({
  getVault: jest.fn().mockResolvedValue(null),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { getDailyCloseSummary } from "./dailyCloseSummary.server";
import { computeFxDepreciationReport } from "./fxDepreciationReport";
import { getFxDepreciationReport } from "./fxDepreciationReport.server";
import { getTopCustomersReport, getTopProductsReport } from "./reports.server";
import { createFakePostgrest } from "./testing/fakePostgrest";
import {
  buildSalesFixture,
  COUNTED_SALE_STATUSES,
  FIXTURE_DAY,
  FIXTURE_STORE_ID,
} from "./testing/salesFixtures";

/**
 * REP-F7 (R-02, R-03): los reportes que leen `sales` y luego filtran por
 * `.in("sale_id", ids)` solo contaban las primeras 1.000 ventas y fallaban con
 * "URI too long" a partir de unas 220–334 ventas en el rango.
 */

type Fixture = ReturnType<typeof buildSalesFixture>;

const RANGE = `from=${FIXTURE_DAY}&to=${FIXTURE_DAY}`;

function useDatabase(fixture: Fixture) {
  const database = createFakePostgrest(fixture);
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(database.client);

  return database;
}

function countedSales(fixture: Fixture) {
  return fixture.sales.filter((sale) => COUNTED_SALE_STATUSES.includes(sale.status));
}

/** Top clientes calculado a mano sobre TODAS las ventas del fixture. */
function expectedTopCustomers(fixture: Fixture) {
  const totals = new Map<string, { salesCount: number; totalRef: number; totalVes: number }>();

  for (const sale of countedSales(fixture)) {
    const current = totals.get(sale.customer_id) ?? { salesCount: 0, totalRef: 0, totalVes: 0 };
    totals.set(sale.customer_id, {
      salesCount: current.salesCount + 1,
      totalRef: current.totalRef + sale.total_ref,
      totalVes: current.totalVes + sale.total_ves,
    });
  }

  return fixture.contacts
    .map((contact) => ({ customerId: contact.id, name: contact.name, ...totals.get(contact.id)! }))
    .sort((first, second) => second.totalVes - first.totalVes);
}

/** Top productos calculado a mano sobre TODAS las líneas de las ventas que cuentan. */
function expectedTopProducts(fixture: Fixture) {
  const saleIds = new Set(countedSales(fixture).map((sale) => sale.id));
  const totals = new Map<string, { revenueRef: number; unitsSold: number }>();

  for (const item of fixture.sale_items.filter((line) => saleIds.has(line.sale_id))) {
    const current = totals.get(item.product_id) ?? { revenueRef: 0, unitsSold: 0 };
    totals.set(item.product_id, {
      revenueRef: current.revenueRef + item.subtotal_ref,
      unitsSold: current.unitsSold + item.quantity,
    });
  }

  return fixture.products
    .map((product) => ({
      name: product.name,
      productId: product.id,
      sku: product.sku,
      ...totals.get(product.id)!,
    }))
    .sort((first, second) => second.unitsSold - first.unitsSold);
}

/**
 * Depreciación FX tal como la calculaba la consulta única de antes: todos los
 * pagos activos de las ventas no canceladas, en el orden de la tabla.
 */
function expectedFxReport(fixture: Fixture, searchParams: URLSearchParams) {
  const sales = fixture.sales
    .filter((sale) => sale.status !== "cancelada")
    .sort((first, second) => (first.created_at < second.created_at ? 1 : -1));
  const saleIds = new Set(sales.map((sale) => sale.id));

  return computeFxDepreciationReport({
    generatedAt: "<generatedAt>",
    payments: fixture.payments
      .filter((payment) => payment.status === "activo" && saleIds.has(payment.sale_id))
      .map((payment) => ({
        amountRef: payment.amount_ref,
        amountVes: payment.amount_ves,
        method: payment.method,
        saleId: payment.sale_id,
        storeId: payment.store_id,
      })),
    sales: sales.map((sale) => ({
      createdAt: sale.created_at,
      id: sale.id,
      invoiceNumber: sale.invoice_number,
      refRateVes: sale.ref_rate_ves,
      storeId: sale.store_id,
      totalRef: sale.total_ref,
    })),
    searchParams,
    valuationRatesByStore: {
      [FIXTURE_STORE_ID]: { createdAt: "2026-05-18T12:00:00.000Z", rateVes: 520 },
    },
  });
}

function withoutGeneratedAt<T extends { summary: { generatedAt: string } }>(report: T) {
  return { ...report, summary: { ...report.summary, generatedAt: "<generatedAt>" } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getTopCustomersReport", () => {
  // Conjunto pequeño: las cifras de siempre (este caso ya pasaba antes del arreglo).
  it("con 40 ventas da las mismas cifras que el cálculo a mano", async () => {
    const fixture = buildSalesFixture(40);
    useDatabase(fixture);

    const report = await getTopCustomersReport(new URLSearchParams(RANGE), FIXTURE_STORE_ID);

    expect(report.items).toEqual(expectedTopCustomers(fixture));
    expect(report.total).toBe(3);
  });

  it("cuenta todas las ventas del rango, no solo las primeras 1.000 (R-02)", async () => {
    const fixture = buildSalesFixture(2500);
    useDatabase(fixture);

    const report = await getTopCustomersReport(new URLSearchParams(RANGE), FIXTURE_STORE_ID);

    expect(report.items.reduce((total, item) => total + item.salesCount, 0)).toBe(
      countedSales(fixture).length,
    );
    expect(report.items).toEqual(expectedTopCustomers(fixture));
  });
});

describe("getTopProductsReport", () => {
  it("con 40 ventas da las mismas cifras que el cálculo a mano", async () => {
    const fixture = buildSalesFixture(40);
    useDatabase(fixture);

    const report = await getTopProductsReport(new URLSearchParams(RANGE), FIXTURE_STORE_ID);

    expect(report.items).toEqual(expectedTopProducts(fixture));
  });

  it.each([400, 5000])(
    "con %i ventas no falla con «URI too long» ni pierde ventas (R-03)",
    async (count) => {
      const fixture = buildSalesFixture(count);
      const database = useDatabase(fixture);

      const report = await getTopProductsReport(new URLSearchParams(RANGE), FIXTURE_STORE_ID);

      expect(report.items).toEqual(expectedTopProducts(fixture));
      expect(Math.max(...database.requests.map((request) => request.largestInList))).toBeLessThanOrEqual(
        100,
      );
    },
  );
});

describe("getFxDepreciationReport", () => {
  // 1 lote (≤ 100 ventas) y varios lotes: las mismas cifras que la consulta única.
  it.each([
    [40, "1 lote"],
    [100, "1 lote exacto"],
    [101, "2 lotes"],
    [334, "4 lotes: antes «URI too long»"],
    [900, "9 lotes"],
    [1000, "10 lotes"],
    [1111, "1.000 ventas no canceladas: justo el tope de una respuesta"],
  ])("con %i ventas (%s) da cifras idénticas a la consulta única", async (count) => {
    const fixture = buildSalesFixture(count);
    useDatabase(fixture);
    const searchParams = new URLSearchParams(`${RANGE}&limit=100`);

    const report = await getFxDepreciationReport(searchParams, FIXTURE_STORE_ID);

    expect(withoutGeneratedAt(report)).toEqual(expectedFxReport(fixture, searchParams));
    expect(report.summary.vesExposed).toBeGreaterThan(0);
  });
});

/**
 * REP-F10 (N-01): la lectura de `sales` de la depreciación FX no se paginaba y
 * PostgREST la cortaba en las 1.000 ventas más recientes; el resto del rango no
 * contaba, sin error ni aviso. 1.212 y 6.061 ventas dejan 1.091 y 5.455 no
 * canceladas.
 */
describe("getFxDepreciationReport con más de 1.000 ventas en el rango (N-01)", () => {
  it.each([
    [1212, 1091],
    [6061, 5455],
  ])("con %i ventas cuenta las %i no canceladas, no solo las 1.000 más recientes", async (count, live) => {
    const fixture = buildSalesFixture(count);
    const database = useDatabase(fixture);
    const searchParams = new URLSearchParams(`${RANGE}&limit=100`);

    const report = await getFxDepreciationReport(searchParams, FIXTURE_STORE_ID);
    const expected = expectedFxReport(fixture, searchParams);

    expect(fixture.sales.filter((sale) => sale.status !== "cancelada")).toHaveLength(live);
    expect(report.total).toBe(expected.total);
    expect(report.summary.vesExposed).toBe(expected.summary.vesExposed);
    expect(report.summary.usdHeldRef).toBe(expected.summary.usdHeldRef);
    expect(withoutGeneratedAt(report)).toEqual(expected);
    expect(Math.max(...database.requests.map((request) => request.largestInList))).toBeLessThanOrEqual(
      100,
    );
  });

  it("con pocas ventas lee `sales` una sola vez y en el orden de siempre (más recientes primero)", async () => {
    const fixture = buildSalesFixture(40);
    const database = useDatabase(fixture);
    const salesOrders: Array<[string, boolean | undefined]> = [];
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: (table: string) => {
        const query = database.client.from(table);

        if (table === "sales") {
          const order = query.order.bind(query);
          query.order = (column, options) => {
            salesOrders.push([column, options?.ascending]);
            return order(column, options);
          };
        }

        return query;
      },
    });

    await getFxDepreciationReport(new URLSearchParams(RANGE), FIXTURE_STORE_ID);

    expect(database.requests.filter((request) => request.table === "sales")).toHaveLength(1);
    // `created_at desc` es el orden de antes; `id` solo desempata para paginar.
    expect(salesOrders).toEqual([
      ["created_at", false],
      ["id", true],
    ]);
  });
});

describe("getDailyCloseSummary con más de 1.000 ventas en el día (N-01)", () => {
  it.each([1212, 6061])("con %i ventas la parte FX y la de cobros cuentan todo el día", async (count) => {
    const fixture = buildSalesFixture(count);
    useDatabase(fixture);
    const searchParams = new URLSearchParams(RANGE);

    const summary = await getDailyCloseSummary(searchParams, FIXTURE_STORE_ID);
    const fx = expectedFxReport(fixture, searchParams).summary;

    expect(summary.sales.salesCount).toBe(countedSales(fixture).length);
    expect(summary.paymentsSummary.paymentCount).toBe(
      fixture.payments.filter((payment) => payment.status === "activo").length,
    );
    expect(summary.fx).toEqual({
      capitalRefToday: fx.capitalRefToday,
      depreciationPctOnVes: fx.depreciationPctOnVes,
      usdHeldRef: fx.usdHeldRef,
      valuationRateVes: fx.valuationRateVes,
      vesExposed: fx.vesExposed,
      vesLossRef: fx.vesLossRef,
    });
  });
});

describe("getDailyCloseSummary", () => {
  it.each([40, 334, 1000])("con %i ventas da las cifras de ventas y FX del cálculo a mano", async (count) => {
    const fixture = buildSalesFixture(count);
    useDatabase(fixture);
    const searchParams = new URLSearchParams(RANGE);

    const summary = await getDailyCloseSummary(searchParams, FIXTURE_STORE_ID);
    const sales = countedSales(fixture);
    const fx = expectedFxReport(fixture, searchParams).summary;

    expect(summary.sales).toEqual({
      salesCount: sales.length,
      totalRef: sales.reduce((total, sale) => total + sale.total_ref, 0),
      totalVes: sales.reduce((total, sale) => total + sale.total_ves, 0),
    });
    expect(summary.fx).toEqual({
      capitalRefToday: fx.capitalRefToday,
      depreciationPctOnVes: fx.depreciationPctOnVes,
      usdHeldRef: fx.usdHeldRef,
      valuationRateVes: fx.valuationRateVes,
      vesExposed: fx.vesExposed,
      vesLossRef: fx.vesLossRef,
    });
  });
});
