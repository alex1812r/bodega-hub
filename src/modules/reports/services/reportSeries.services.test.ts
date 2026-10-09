/**
 * @jest-environment node
 */

/**
 * Paridad servidor / mock de REP-05: los mismos casos corren contra
 * `reports.server` (con un doble de PostgREST en memoria) y contra
 * `reports.mock-server`, sobre los mismos datos.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../shared/mocks/erp-data", () => {
  const actual = jest.requireActual("../../../shared/mocks/erp-data");
  const store = "00000000-0000-4000-8000-000000000001";
  const otherStore = "00000000-0000-4000-8000-000000000002";

  const sale = (id: string, createdAt: string, totalRef: number, status = "pagada", storeId = store) => ({
    createdAt,
    customerId: "cont-walk-in",
    discountRef: 0,
    id,
    invoiceNumber: id,
    paidVes: status === "pendiente_pago" ? 0 : totalRef * 500,
    refRateVes: 500,
    status,
    storeId,
    subtotalRef: totalRef,
    taxRef: 0,
    totalRef,
    totalVes: totalRef * 500,
    userId: "user-admin",
  });
  const purchase = (
    id: string,
    createdAt: string,
    totalRef: number,
    supplierId: string,
    status = "recibido",
  ) => ({
    createdAt,
    discountRef: 0,
    id,
    paidVes: 0,
    purchaseNumber: id,
    refRateVes: 500,
    status,
    storeId: store,
    subtotalRef: totalRef,
    supplierId,
    taxRef: 0,
    totalRef,
    totalVes: totalRef * 500,
    userId: "user-admin",
  });
  const payment = (
    id: string,
    createdAt: string,
    method: string,
    amountRef: number,
    status = "activo",
  ) => ({
    amount: amountRef,
    amountRef,
    amountVes: amountRef * 500,
    contactId: "cont-walk-in",
    createdAt,
    direction: "entrada",
    id,
    method,
    refRateVes: 500,
    saleId: "s1",
    status,
    storeId: store,
  });

  const mockSales = [
    sale("s1", "2026-05-04T15:00:00.000Z", 10),
    sale("s2", "2026-05-04T16:00:00.000Z", 5.55),
    sale("s3", "2026-05-06T15:00:00.000Z", 20, "pendiente_pago"),
    // 22:30 del domingo 10 en Caracas (ya es lunes 11 en UTC).
    sale("s4", "2026-05-11T02:30:00.000Z", 7),
    sale("s5", "2026-05-12T15:00:00.000Z", 30),
    sale("s6", "2026-05-12T15:00:00.000Z", 99, "cancelada"),
    sale("s7", "2026-05-13T15:00:00.000Z", 88, "devuelta"),
    sale("s8", "2026-04-27T15:00:00.000Z", 8),
    sale("s9", "2026-04-29T15:00:00.000Z", 12),
    sale("s10", "2026-05-05T15:00:00.000Z", 1000, "pagada", otherStore),
  ];

  return {
    ...actual,
    mockPayments: [
      payment("pay1", "2026-05-04T15:00:00.000Z", "efectivo_ves", 10),
      payment("pay2", "2026-05-12T15:00:00.000Z", "pago_movil", 30),
      payment("pay3", "2026-04-27T15:00:00.000Z", "efectivo_ves", 8),
      payment("pay4", "2026-05-05T15:00:00.000Z", "efectivo_ves", 500, "anulado"),
    ],
    mockPurchaseItems: [],
    mockPurchases: [
      purchase("p1", "2026-05-05T15:00:00.000Z", 40, "sup-a"),
      purchase("p2", "2026-05-05T16:00:00.000Z", 10, "sup-b", "pedido"),
      purchase("p3", "2026-05-07T15:00:00.000Z", 500, "sup-a", "cancelado"),
      purchase("p4", "2026-04-28T15:00:00.000Z", 25, "sup-a"),
    ],
    mockSaleItems: mockSales.map((item) => ({
      productId: "prod-1",
      quantity: 1,
      saleId: item.id,
      subtotalRef: item.totalRef,
      subtotalVes: item.totalVes,
      unitCostRefSnapshot: item.totalRef * 0.4,
      unitPriceRef: item.totalRef,
    })),
    mockSales,
  };
});

import { ApiError } from "@/lib/api/apiError";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  mockPayments,
  mockProducts,
  mockPurchases,
  mockSaleItems,
  mockSales,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import { getPaymentMethodsReport as getPaymentMethodsReportMock } from "./paymentMethodsReport.mock-server";
import { getPaymentMethodsReport as getPaymentMethodsReportServer } from "./paymentMethodsReport.server";
import * as reportsMock from "./reports.mock-server";
import * as reportsServer from "./reports.server";

type Row = Record<string, unknown>;

/** Tope de filas por respuesta, como PostgREST. */
const POSTGREST_MAX_ROWS = 1000;

const rangeCalls: { from: number; table: string; to: number }[] = [];

/** Doble en memoria de una consulta de PostgREST: filtros, orden, rango, conteo y 416. */
function createFakeQuery(table: string, rows: Row[]) {
  const filters: ((row: Row) => boolean)[] = [];
  const orders: { ascending: boolean; column: string }[] = [];
  const state: { head: boolean; window: { from: number; to: number } | null } = {
    head: false,
    window: null,
  };
  const text = (value: unknown) => String(value);

  const query = {
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return query;
    },
    gte(column: string, value: string) {
      filters.push((row) => text(row[column]) >= value);
      return query;
    },
    in(column: string, values: unknown[]) {
      filters.push((row) => values.includes(row[column]));
      return query;
    },
    lt(column: string, value: string) {
      filters.push((row) => text(row[column]) < value);
      return query;
    },
    lte(column: string, value: string) {
      filters.push((row) => text(row[column]) <= value);
      return query;
    },
    not(column: string, operator: string, value: unknown) {
      if (operator === "is") {
        filters.push((row) => row[column] != null);
      } else {
        const excluded = text(value).replace(/[()]/g, "").split(",");
        filters.push((row) => !excluded.includes(text(row[column])));
      }
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      orders.push({ ascending: options?.ascending ?? true, column });
      return query;
    },
    range(from: number, to: number) {
      state.window = { from, to };
      rangeCalls.push({ from, table, to });
      return query;
    },
    select(_columns: string, options?: { head?: boolean }) {
      state.head = options?.head ?? false;
      return query;
    },
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      const matched = rows
        .filter((row) => filters.every((matches) => matches(row)))
        .sort((first, second) => {
          for (const { ascending, column } of orders) {
            const compared = text(first[column]).localeCompare(text(second[column]));

            if (compared !== 0) {
              return ascending ? compared : -compared;
            }
          }

          return 0;
        });
      const from = state.window?.from ?? 0;
      const to = Math.min(state.window?.to ?? Number.POSITIVE_INFINITY, from + POSTGREST_MAX_ROWS - 1);

      const result = state.head
        ? { count: matched.length, data: null, error: null, status: 200 }
        : from > 0 && from >= matched.length
          ? {
              count: null,
              data: null,
              error: { code: "PGRST103", message: "Requested range not satisfiable" },
              status: 416,
            }
          : { count: matched.length, data: matched.slice(from, to + 1), error: null, status: 200 };

      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };

  return query;
}

function useTables(tables: Record<string, Row[]>) {
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: (table: string) => createFakeQuery(table, tables[table] ?? []),
  });
}

const SERIES_SALE_STATUSES = ["borrador", "pagada", "pendiente_pago"];

/** Lo que devolverían las vistas de resumen para los datos del mock, por tienda y día. */
function summaryViewRows() {
  const daily = new Map<string, Row & { paid_ves: number; sales_count: number; total_ref: number; total_ves: number }>();
  const profit = new Map<string, Row & { cost_ref: number; gross_profit_ref: number; revenue_ref: number }>();

  for (const sale of mockSales.filter((item) => SERIES_SALE_STATUSES.includes(item.status))) {
    const saleDate = toCaracasDateKey(sale.createdAt);
    const key = `${sale.storeId}|${saleDate}`;
    const base = { sale_date: saleDate, store_id: sale.storeId };
    const day = daily.get(key) ?? { ...base, paid_ves: 0, sales_count: 0, total_ref: 0, total_ves: 0 };
    const gain = profit.get(key) ?? { ...base, cost_ref: 0, gross_profit_ref: 0, revenue_ref: 0 };

    day.paid_ves += sale.paidVes;
    day.sales_count += 1;
    day.total_ref += sale.totalRef;
    day.total_ves += sale.totalVes;
    daily.set(key, day);

    for (const item of mockSaleItems.filter((saleItem) => saleItem.saleId === sale.id)) {
      const cost = item.unitCostRefSnapshot * item.quantity;

      gain.cost_ref += cost;
      gain.revenue_ref += item.subtotalRef;
      gain.gross_profit_ref += item.subtotalRef - cost;
    }

    profit.set(key, gain);
  }

  return { daily: [...daily.values()], profit: [...profit.values()] };
}

function mockDataTables(): Record<string, Row[]> {
  const { daily, profit } = summaryViewRows();

  return {
    daily_sales_summary: daily,
    gross_profit_summary: profit,
    low_stock_products: mockProducts
      .filter((product) => product.currentStock <= product.minStock)
      .map((product) => ({
        category_id: null,
        current_cost_ref: product.currentCostRef,
        current_stock: product.currentStock,
        id: product.id,
        image_url: null,
        is_active: true,
        min_stock: product.minStock,
        name: product.name,
        sale_price_ref: product.salePriceRef,
        sku: product.sku,
        store_id: product.storeId ?? DEFAULT_STORE_ID,
      })),
    payments: mockPayments.map((payment) => ({
      amount: payment.amount,
      amount_ref: payment.amountRef,
      amount_ves: payment.amountVes,
      contact_id: payment.contactId,
      created_at: payment.createdAt,
      direction: payment.direction,
      id: payment.id,
      method: payment.method,
      sale_id: payment.saleId ?? null,
      status: payment.status ?? "activo",
      store_id: payment.storeId ?? DEFAULT_STORE_ID,
    })),
    purchases: mockPurchases.map((purchase) => ({
      created_at: purchase.createdAt,
      discount_ref: purchase.discountRef,
      id: purchase.id,
      paid_ves: purchase.paidVes,
      purchase_number: purchase.purchaseNumber,
      ref_rate_ves: purchase.refRateVes,
      status: purchase.status,
      store_id: purchase.storeId ?? DEFAULT_STORE_ID,
      subtotal_ref: purchase.subtotalRef,
      supplier_id: purchase.supplierId,
      tax_ref: purchase.taxRef,
      total_ref: purchase.totalRef,
      total_ves: purchase.totalVes,
      user_id: purchase.userId,
    })),
  };
}

type Services = {
  dailySales: (query: string) => Promise<Awaited<ReturnType<typeof reportsServer.getDailySalesReport>>>;
  grossProfit: (query: string) => Promise<Awaited<ReturnType<typeof reportsServer.getGrossProfitReport>>>;
  lowStock: (query: string) => Promise<{ items: unknown[]; skip: number; total: number }>;
  paymentMethods: (query: string) => Promise<Awaited<ReturnType<typeof getPaymentMethodsReportServer>>>;
  purchases: (query: string) => Promise<Awaited<ReturnType<typeof reportsServer.getPurchasesReport>>>;
};

const q = (query: string) => new URLSearchParams(query);

const sources: [string, Services][] = [
  [
    "server",
    {
      dailySales: (query) => reportsServer.getDailySalesReport(q(query), DEFAULT_STORE_ID),
      grossProfit: (query) => reportsServer.getGrossProfitReport(q(query), DEFAULT_STORE_ID),
      lowStock: (query) => reportsServer.getLowStockReport(q(query), DEFAULT_STORE_ID),
      paymentMethods: (query) => getPaymentMethodsReportServer(q(query), DEFAULT_STORE_ID),
      purchases: (query) => reportsServer.getPurchasesReport(q(query), DEFAULT_STORE_ID),
    },
  ],
  [
    "mock",
    {
      dailySales: async (query) => reportsMock.getDailySalesReport(q(query), DEFAULT_STORE_ID),
      grossProfit: async (query) => reportsMock.getGrossProfitReport(q(query), DEFAULT_STORE_ID),
      lowStock: async (query) => reportsMock.getLowStockReport(q(query), DEFAULT_STORE_ID),
      paymentMethods: async (query) => getPaymentMethodsReportMock(q(query), DEFAULT_STORE_ID),
      purchases: async (query) => reportsMock.getPurchasesReport(q(query), DEFAULT_STORE_ID),
    },
  ],
];

const RANGE = "from=2026-05-04&to=2026-05-13";

beforeEach(() => {
  jest.clearAllMocks();
  rangeCalls.length = 0;
  useTables(mockDataTables());
});

describe.each(sources)("series de reportes (%s)", (_name, services) => {
  it("ventas diarias por día: rellena huecos con 0 y excluye canceladas, devueltas y otras tiendas", async () => {
    const { series } = await services.dailySales(`${RANGE}&groupBy=day`);

    expect(series?.groupBy).toBe("day");
    expect(series?.current.map((bucket) => [bucket.key, bucket.totalRef, bucket.count])).toEqual([
      ["2026-05-04", 15.55, 2],
      ["2026-05-05", 0, 0],
      ["2026-05-06", 20, 1],
      ["2026-05-07", 0, 0],
      ["2026-05-08", 0, 0],
      ["2026-05-09", 0, 0],
      ["2026-05-10", 7, 1],
      ["2026-05-11", 0, 0],
      ["2026-05-12", 30, 1],
      ["2026-05-13", 0, 0],
    ]);
    expect(series?.totals).toEqual({
      current: { count: 5, paidVes: 26275, totalRef: 72.55, totalVes: 36275 },
      deltaPct: null,
      previous: null,
    });
    expect(series?.previous).toBeNull();
  });

  it("ventas diarias por semana con periodo anterior alineado y delta", async () => {
    const { series } = await services.dailySales(`${RANGE}&groupBy=week&compare=1`);

    expect(series?.current.map(({ from, label, to, totalRef }) => ({ from, label, to, totalRef }))).toEqual([
      { from: "2026-05-04", label: "04/05–10/05", to: "2026-05-10", totalRef: 42.55 },
      { from: "2026-05-11", label: "11/05–13/05", to: "2026-05-13", totalRef: 30 },
    ]);
    expect(series?.previousRange).toEqual({ from: "2026-04-24", to: "2026-05-03" });
    expect(series?.previous?.map(({ from, to, totalRef }) => ({ from, to, totalRef }))).toEqual([
      { from: "2026-04-24", to: "2026-04-30", totalRef: 20 },
      { from: "2026-05-01", to: "2026-05-03", totalRef: 0 },
    ]);
    expect(series?.totals.previous?.totalRef).toBe(20);
    expect(series?.totals.deltaPct).toBe(262.75);
  });

  it("agrupación automática: devuelve el groupBy efectivo", async () => {
    expect((await services.dailySales(`${RANGE}&compare=1`)).series?.groupBy).toBe("day");
    expect(
      (await services.dailySales("from=2026-01-01&to=2026-05-13&groupBy=auto")).series?.groupBy,
    ).toBe("week");
    expect(
      (await services.dailySales("from=2024-05-14&to=2026-05-13&groupBy=auto")).series?.groupBy,
    ).toBe("month");
  });

  it("periodo anterior sin datos: serie en 0 y delta null", async () => {
    const { series } = await services.dailySales("from=2026-04-27&to=2026-04-29&compare=1");

    expect(series?.totals.current.totalRef).toBe(20);
    expect(series?.previous?.map((bucket) => bucket.totalRef)).toEqual([0, 0, 0]);
    expect(series?.totals.deltaPct).toBeNull();
    expect(JSON.stringify(series)).not.toMatch(/NaN|Infinity/);
  });

  it("un solo día de datos: un punto", async () => {
    const { series } = await services.dailySales("from=2026-05-12&to=2026-05-12&groupBy=day");

    expect(series?.current).toHaveLength(1);
    expect(series?.current[0]).toEqual(
      expect.objectContaining({ count: 1, key: "2026-05-12", totalRef: 30 }),
    );
  });

  it("ganancia bruta: ingresos, costo y ganancia por periodo", async () => {
    const { series } = await services.grossProfit(`${RANGE}&groupBy=month&compare=1`);

    expect(series?.groupBy).toBe("month");
    expect(series?.current).toHaveLength(1);
    expect(series?.totals.current).toEqual({ costRef: 29.02, grossProfitRef: 43.53, revenueRef: 72.55 });
    expect(series?.totals.previous).toEqual({ costRef: 8, grossProfitRef: 12, revenueRef: 20 });
    expect(series?.totals.deltaPct).toBe(262.75);
  });

  // REP-F2: el total del gráfico tiene que ser la suma de la tabla que lleva debajo.
  it.each([
    RANGE,
    "from=2026-05-12&to=2026-05-13",
    "from=2026-05-10&to=2026-05-11",
    "from=2026-04-27&to=2026-05-13",
    "from=2026-01-01&to=2026-01-31",
  ])("la suma de la tabla del rango es el total de la serie (%s)", async (range) => {
    const sum = <Row>(rows: Row[], pick: (row: Row) => number) =>
      Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;
    const sales = await services.dailySales(`${range}&groupBy=day&compare=1&limit=100`);
    const profit = await services.grossProfit(`${range}&groupBy=day&compare=1&limit=100`);

    expect(sales.items).toHaveLength(sales.total);
    expect({
      count: sum(sales.items, (row) => row.salesCount),
      paidVes: sum(sales.items, (row) => row.paidVes),
      totalRef: sum(sales.items, (row) => row.totalRef),
      totalVes: sum(sales.items, (row) => row.totalVes),
    }).toEqual(sales.series?.totals.current);

    expect(profit.items).toHaveLength(profit.total);
    expect({
      costRef: sum(profit.items, (row) => row.costRef),
      grossProfitRef: sum(profit.items, (row) => row.grossProfitRef),
      revenueRef: sum(profit.items, (row) => row.revenueRef),
    }).toEqual(profit.series?.totals.current);
  });

  it("la tabla de ventas diarias y de ganancia bruta trae una fila por día, sin canceladas ni devueltas", async () => {
    const sales = await services.dailySales(`${RANGE}&limit=100`);
    const profit = await services.grossProfit(`${RANGE}&limit=100`);

    expect(sales.items.map((row) => [row.saleDate, row.salesCount, row.totalRef])).toEqual([
      ["2026-05-12", 1, 30],
      ["2026-05-10", 1, 7],
      ["2026-05-06", 1, 20],
      ["2026-05-04", 2, 15.55],
    ]);
    expect(profit.items.map((row) => [row.saleDate, row.revenueRef])).toEqual([
      ["2026-05-12", 30],
      ["2026-05-10", 7],
      ["2026-05-06", 20],
      ["2026-05-04", 15.55],
    ]);
  });

  it("compras por periodo: sin canceladas, con filtro de proveedor, sin romper la tabla", async () => {
    const all = await services.purchases(`${RANGE}&groupBy=week&compare=1`);

    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(3);
    expect(all.series?.totals).toEqual({
      current: { count: 2, totalRef: 50, totalVes: 25000 },
      deltaPct: 100,
      previous: { count: 1, totalRef: 25, totalVes: 12500 },
    });
    expect(all.series?.current.map((bucket) => bucket.totalRef)).toEqual([50, 0]);

    const supplier = await services.purchases(`${RANGE}&groupBy=day&supplierId=sup-b`);

    expect(supplier.series?.totals.current).toEqual({ count: 1, totalRef: 10, totalVes: 5000 });
  });

  it("sin groupBy ni compare, o sin from/to, responde como antes (sin series)", async () => {
    expect(await services.dailySales(RANGE)).not.toHaveProperty("series");
    expect(await services.dailySales("")).not.toHaveProperty("series");
    expect(await services.dailySales("groupBy=day&to=2026-05-13")).not.toHaveProperty("series");
    expect(await services.grossProfit("compare=1")).not.toHaveProperty("series");
    expect(await services.purchases(RANGE)).not.toHaveProperty("series");
    expect(await services.paymentMethods(RANGE)).not.toHaveProperty("comparison");
  });

  it.each(["groupBy=anual", "from=2026-99-01&groupBy=day", "from=2026-05-13&to=2026-05-04&compare=1"])(
    "rechaza %s con 400",
    async (query) => {
      for (const run of [services.dailySales, services.grossProfit, services.purchases, services.paymentMethods]) {
        await expect(run(query)).rejects.toEqual(expect.objectContaining({ status: 400 }));
        await expect(run(query)).rejects.toBeInstanceOf(ApiError);
      }
    },
  );

  it("métodos de pago con compare: totales del periodo anterior por método", async () => {
    const result = await services.paymentMethods(`${RANGE}&compare=1`);

    expect(result.summary).toEqual({ paymentCount: 2, totalRef: 40, totalVes: 20000 });
    expect(result.items).toHaveLength(5);
    expect(result.comparison?.previousRange).toEqual({ from: "2026-04-24", to: "2026-05-03" });
    expect(result.comparison?.previous?.summary).toEqual({
      paymentCount: 1,
      totalRef: 8,
      totalVes: 4000,
    });
    expect(result.comparison?.previous?.items).toHaveLength(5);
    expect(result.comparison?.previous?.items[0]).toEqual({
      amountRef: 8,
      amountVes: 4000,
      method: "efectivo_ves",
      paymentCount: 1,
    });
    expect(result.comparison?.deltaPct).toBe(400);
    expect(result.comparison?.deltaPctByMethod).toEqual({
      efectivo_usd: null,
      efectivo_ves: 25,
      pago_movil: null,
      punto_venta: null,
      transferencia: null,
    });
  });

  it("métodos de pago con compare pero sin rango: sin periodo anterior", async () => {
    const result = await services.paymentMethods("compare=1&fromStart=1&to=2026-05-13");

    expect(result.summary.paymentCount).toBe(3);
    expect(result.comparison).toEqual({
      deltaPct: null,
      deltaPctByMethod: {
        efectivo_usd: null,
        efectivo_ves: null,
        pago_movil: null,
        punto_venta: null,
        transferencia: null,
      },
      previous: null,
      previousRange: null,
    });
  });

  it("una página fuera de rango conserva el total real en vez de parecer sin registros", async () => {
    const first = await services.lowStock("skip=0&limit=10");
    const beyond = await services.lowStock("skip=500&limit=10");

    expect(first.total).toBeGreaterThan(0);
    expect(beyond).toEqual(expect.objectContaining({ items: [], skip: 500, total: first.total }));

    const purchases = await services.purchases("skip=500&limit=10");

    expect(purchases).toEqual(expect.objectContaining({ items: [], total: 4 }));
  });
});

describe("paridad exacta servidor / mock", () => {
  it.each([
    `${RANGE}&groupBy=day`,
    `${RANGE}&groupBy=week&compare=1`,
    `${RANGE}&groupBy=month&compare=1`,
    "from=2026-04-01&to=2026-05-31&compare=1",
    "from=2024-05-14&to=2026-05-13&groupBy=auto&compare=1",
    "from=2026-05-10&to=2026-05-11&groupBy=day",
  ])("misma serie y misma comparación con %s", async (query) => {
    const [server, mock] = [sources[0]![1], sources[1]![1]];

    expect((await server.dailySales(query)).series).toEqual((await mock.dailySales(query)).series);
    expect((await server.grossProfit(query)).series).toEqual((await mock.grossProfit(query)).series);
    expect((await server.purchases(query)).series).toEqual((await mock.purchases(query)).series);

    const [serverPayments, mockPaymentsResult] = [
      await server.paymentMethods(query),
      await mock.paymentMethods(query),
    ];

    expect(serverPayments.comparison).toEqual(mockPaymentsResult.comparison);
    expect(serverPayments.summary).toEqual(mockPaymentsResult.summary);
  });
});

describe("servidor: top productos (REP-F2)", () => {
  it("devuelve el nombre y el SKU de cada producto del ranking", async () => {
    useTables({
      products: [
        { id: "uuid-a", name: "Interruptor sencillo", sku: "ele-int-001" },
        { id: "uuid-b", name: "Tubo PVC 1/2", sku: "plo-pvc-012" },
      ],
      sale_items: [
        { product_id: "uuid-a", quantity: 3, sale_id: "s1", subtotal_ref: 9 },
        { product_id: "uuid-b", quantity: 5, sale_id: "s1", subtotal_ref: 10 },
      ],
      sales: [{ created_at: "2026-05-04T15:00:00.000Z", id: "s1", status: "pagada", store_id: DEFAULT_STORE_ID }],
    });

    const result = await reportsServer.getTopProductsReport(q(RANGE), DEFAULT_STORE_ID);

    expect(result.items).toEqual([
      { name: "Tubo PVC 1/2", productId: "uuid-b", revenueRef: 10, sku: "plo-pvc-012", unitsSold: 5 },
      { name: "Interruptor sencillo", productId: "uuid-a", revenueRef: 9, sku: "ele-int-001", unitsSold: 3 },
    ]);
  });
});

describe("servidor: series por encima de 1.000 filas", () => {
  function shiftDay(day: string, days: number) {
    return new Date(Date.parse(`${day}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
  }

  it("2 años de ventas diarias en dos tiendas: lee todas las páginas y agrupa por mes", async () => {
    const stores = [DEFAULT_STORE_ID, "00000000-0000-4000-8000-000000000002"];
    const rows: Row[] = [];

    for (let offset = 0; offset < 730; offset += 1) {
      for (const storeId of stores) {
        rows.push({
          paid_ves: 500,
          sale_date: shiftDay("2024-10-09", offset),
          sales_count: 1,
          store_id: storeId,
          total_ref: 1,
          total_ves: 500,
        });
      }
    }

    useTables({ daily_sales_summary: rows });

    const result = await reportsServer.getDailySalesReport(
      q("from=2024-10-09&to=2026-10-08&groupBy=auto&limit=10"),
      stores,
    );

    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(1460);
    expect(result.series?.groupBy).toBe("month");
    expect(result.series?.current).toHaveLength(25);
    expect(result.series?.totals.current).toEqual({
      count: 1460,
      paidVes: 730_000,
      totalRef: 1460,
      totalVes: 730_000,
    });
    expect(rangeCalls.filter((call) => call.table === "daily_sales_summary").slice(1)).toEqual([
      { from: 0, table: "daily_sales_summary", to: 999 },
      { from: 1000, table: "daily_sales_summary", to: 1999 },
    ]);
  });

  it("más de 1.000 compras en el rango: la serie las suma todas", async () => {
    const rows: Row[] = Array.from({ length: 2300 }, (_, index) => ({
      created_at: `${shiftDay("2026-01-01", index % 90)}T15:00:00.000Z`,
      discount_ref: 0,
      id: `purchase-${String(index).padStart(5, "0")}`,
      paid_ves: 0,
      purchase_number: `C-${index}`,
      ref_rate_ves: 500,
      status: "recibido",
      store_id: DEFAULT_STORE_ID,
      subtotal_ref: 2,
      supplier_id: "sup-a",
      tax_ref: 0,
      total_ref: 2,
      total_ves: 1000,
      user_id: null,
    }));

    useTables({ purchases: rows });

    const result = await reportsServer.getPurchasesReport(
      q("from=2026-01-01&to=2026-03-31&groupBy=auto"),
      DEFAULT_STORE_ID,
    );

    expect(result.total).toBe(2300);
    expect(result.series?.groupBy).toBe("week");
    expect(result.series?.totals.current).toEqual({ count: 2300, totalRef: 4600, totalVes: 2_300_000 });
  });
});
