/** @jest-environment node */
/**
 * DEC-01 · una venta en `borrador` NO es una venta para ningún reporte, gráfico, ranking, KPI del dashboard, cierre del
 * día ni para el asistente (sus herramientas llaman a estos mismos servicios). Cuentan `pendiente_pago` y `pagada`; no
 * cuentan `borrador`, `cancelada` ni `devuelta` (parche `20261018a-reports-exclude-draft-sales.sql` + servicios).
 *
 * El test siembra, con cliente, categoría y productos propios (`TAG`) y fecha de hoy, ventas en los cuatro estados que
 * ya existían (sin ningún borrador) con sus líneas y un pago por venta pagada. Mide TODAS las vistas de reportes que
 * leen ventas y todos los servicios de reportes y del dashboard (por PostgREST como `lab-admin`, los mismos que usan
 * las rutas del BFF), y comprueba:
 *
 *  1. sin borradores, las cifras son las del criterio anterior (todas menos `cancelada` y `devuelta`): el cambio no
 *     mueve nada para datos sin borradores. Incluye «Cierre del día» y «Depreciación FX» (misma invariancia que
 *     `report-daily-close-fx-invariance.test.ts`, cuyo oráculo usa el criterio anterior y sigue en verde sin tocarlo);
 *  2. al añadir una venta en `borrador` con líneas, NINGUNA cifra de ninguna vista ni servicio cambia;
 *  3. al confirmarla (pasa a `pendiente_pago`), las cifras cambian exactamente en su importe;
 *  4. un borrador con un pago activo (estado que ninguna RPC produce: `register_payment` lo rechaza) tampoco entra en
 *     la depreciación FX.
 *
 * Ninguna RPC crea ni confirma una venta en `borrador`: el borrador y su confirmación se escriben por SQL directo.
 * Los datos se borran al terminar.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/report-draft-sales.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { createRouteSupabaseClient } from "../../../src/lib/supabase/route-client";
import {
  getDashboardMetrics,
  getDashboardSalesTrend,
  getDashboardSummary,
} from "../../../src/modules/dashboard/services/dashboard.server";
import { getDailyCloseSummary } from "../../../src/modules/reports/services/dailyCloseSummary.server";
import { getFxDepreciationReport } from "../../../src/modules/reports/services/fxDepreciationReport.server";
import {
  getReceivablesAgingReport,
  getSalesByCategoryReport,
  getSalesByHourReport,
} from "../../../src/modules/reports/services/moneyReports.server";
import { getPaymentMethodsReport } from "../../../src/modules/reports/services/paymentMethodsReport.server";
import {
  getCustomerPurchasesReport,
  getDailySalesReport,
  getGrossProfitReport,
  getProductProfitabilityReport,
  getTopCustomersReport,
  getTopProductsReport,
} from "../../../src/modules/reports/services/reports.server";
import { Lab } from "../scenarios/db";

jest.mock("../../../src/lib/supabase/route-client", () => ({ createRouteSupabaseClient: jest.fn() }));

const TAG = `dec01-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const RATE = 40;
/** Estado de cada venta sembrada: 3 pagadas, 2 pendientes, 1 cancelada y 1 devuelta. Ningún borrador. */
const SEEDED = ["pagada", "pendiente_pago", "pagada", "cancelada", "pagada", "devuelta", "pendiente_pago"] as const;
/** La venta en borrador: 3 × 9,00 + 2 × 4,50 = 36,00 REF; costo 3 × 5 + 2 × 2 = 19. */
const DRAFT = { costRef: 19, profitRef: 17, totalRef: 36, totalVes: 36 * RATE, units: 5 } as const;

/**
 * Las vistas de reportes que leen `sales` (y las de inventario, que leen el libro), con su filtro a los datos de este
 * test. `a` = (store, customer, products, d_from, d_to).
 */
const IN_RANGE = "v.store_id = a.store and v.sale_date between a.d_from and a.d_to";
const VIEWS = [
  ["daily_sales_summary", IN_RANGE, "v.sale_date"],
  ["gross_profit_summary", IN_RANGE, "v.sale_date"],
  ["report_sales_by_hour", IN_RANGE, "v.sale_date, v.hour"],
  ["report_sales_by_category", IN_RANGE, "v.sale_date, v.category_name"],
  ["product_profitability", "v.store_id = a.store and v.product_id = any(a.products)", "v.product_id"],
  ["customer_purchase_summary", "v.store_id = a.store and v.customer_id = a.customer", "v.customer_id"],
  ["report_open_documents_aging", "v.store_id = a.store and v.contact_id = a.customer", "v.document_number"],
  ["report_open_documents_aging_summary", "v.store_id = a.store and v.contact_id = a.customer", "v.doc_type, v.bucket"],
  ["report_stock_daily_flow", "v.store_id = a.store and v.product_id = any(a.products)", "v.movement_date, v.product_id"],
  ["report_product_last_movement", "v.store_id = a.store and v.product_id = any(a.products)", "v.product_id"],
] as const;

let lab: Lab;
let customerId = "";
let categoryId = "";
let productIds: string[] = [];
let draftId = "";
let today = "";
let yesterday = "";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([first], [second]) => (first < second ? -1 : 1))
        .map(([key, entry]) => [key, key === "generatedAt" ? "<generatedAt>" : stable(entry)]),
    );
  }
  return value;
}

const range = () => ({ from: yesterday, to: today });
const params = (extra: Record<string, string> = {}) => new URLSearchParams({ ...range(), limit: "100", ...extra });

async function insertSale(index: number, status: string, minutesAgo: number) {
  const totalRef = status === "borrador" ? DRAFT.totalRef : 20 + index;
  const paid = status === "pagada" ? totalRef * RATE : 0;
  const { rows } = await lab.db.query<{ id: string }>(
    `insert into public.sales (store_id, invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, status, created_at)
     values ($1, $2, $3, $4::numeric, $5::numeric, $5::numeric, $5::numeric * $4::numeric, $6::numeric, $7::public.sale_status,
             now() - make_interval(mins => $8::int))
     returning id`,
    [lab.storeId, `${TAG}-${index}`, customerId, RATE, totalRef, paid, status, minutesAgo],
  );
  const saleId = rows[0].id;

  // Dos líneas: 3 del primer producto (9,00; costo 5) y 2 del segundo (4,50; costo 2).
  await lab.db.query(
    `insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, unit_cost_ref_snapshot, subtotal_ves)
     values ($1, $2, 3, 9, 5, 27 * $4::numeric), ($1, $3, 2, 4.5, 2, 9 * $4::numeric)`,
    [saleId, productIds[0], productIds[1], RATE],
  );

  return saleId;
}

async function insertPayment(saleId: string, method: "efectivo_usd" | "punto_venta") {
  await lab.db.query(
    `insert into public.payments (direction, sale_id, contact_id, method, currency, amount, amount_ves, amount_ref, ref_rate_ves, status, created_by, created_at, store_id)
     select 'entrada', s.id, s.customer_id, $2::public.payment_method,
            (case when $2 = 'efectivo_usd' then 'USD' else 'VES' end)::public.payment_currency,
            case when $2 = 'efectivo_usd' then s.total_ref else s.total_ves end,
            s.total_ves, s.total_ref, s.ref_rate_ves, 'activo', null, s.created_at, s.store_id
     from public.sales s where s.id = $1`,
    [saleId, method],
  );
}

/** Todas las vistas de reportes que leen ventas, acotadas a los datos del test. */
async function measureViews() {
  const result: Record<string, unknown> = {};

  for (const [view, filter, order] of VIEWS) {
    result[view] = await lab.rows(
      `select to_jsonb(v) as row
       from public.${view} v
       cross join (select $1::uuid as store, $2::uuid as customer, $3::uuid[] as products, $4::date as d_from, $5::date as d_to) a
       where ${filter} order by ${order}`,
      [lab.storeId, customerId, productIds, yesterday, today],
    );
  }

  return result;
}

/** Todos los servicios de reportes y del dashboard que cuentan ventas (los que llaman las rutas del BFF y el asistente). */
async function measureServices() {
  const mine = <Row extends Record<string, unknown>>(items: Row[], key: string, ids: string[]) =>
    items.filter((item) => ids.includes(String(item[key])));

  const [productProfitability, customerPurchases, topProducts, topCustomers] = await Promise.all([
    getProductProfitabilityReport(new URLSearchParams({ limit: "100" }), lab.storeId),
    getCustomerPurchasesReport(new URLSearchParams({ limit: "100" }), lab.storeId),
    getTopProductsReport(params(), lab.storeId),
    getTopCustomersReport(params(), lab.storeId),
  ]);

  return stable({
    customerPurchases: mine(customerPurchases.items as Array<Record<string, unknown>>, "customerId", [customerId]),
    dailyClose: await getDailyCloseSummary(params(), lab.storeId),
    dailySales: await getDailySalesReport(params({ groupBy: "day" }), lab.storeId),
    dashboardMetrics: await getDashboardMetrics(params(), lab.storeId),
    dashboardSalesTrend: await getDashboardSalesTrend(params(), lab.storeId),
    dashboardSummary: await getDashboardSummary(lab.storeId),
    fxDepreciation: await getFxDepreciationReport(params(), lab.storeId),
    grossProfit: await getGrossProfitReport(params({ groupBy: "day" }), lab.storeId),
    paymentMethods: await getPaymentMethodsReport(params(), lab.storeId),
    productProfitability: mine(productProfitability.items as Array<Record<string, unknown>>, "productId", productIds),
    receivablesAging: await getReceivablesAgingReport({ contactId: customerId, limit: 100, skip: 0 }, lab.storeId),
    salesByCategory: await getSalesByCategoryReport(range(), lab.storeId),
    salesByHour: await getSalesByHourReport(range(), lab.storeId),
    topCustomers: mine(topCustomers.items as Array<Record<string, unknown>>, "customerId", [customerId]),
    topProducts: mine(topProducts.items as Array<Record<string, unknown>>, "productId", productIds),
  }) as Record<string, unknown>;
}

async function measure() {
  return { services: await measureServices(), views: await measureViews() };
}

/** Cifras de las ventas del test con un criterio de estados dado, por SQL directo sobre las tablas. */
async function oracle(statuses: readonly string[]) {
  const [row] = await lab.rows<Record<string, string>>(
    `with counted as (
       select * from public.sales where customer_id = $1 and status::text = any($2::text[])
     ), lines as (
       select si.* from public.sale_items si join counted s on s.id = si.sale_id
     )
     select (select count(*) from counted)::text as sales_count,
            (select coalesce(sum(total_ref), 0) from counted)::text as total_ref,
            (select coalesce(sum(total_ves), 0) from counted)::text as total_ves,
            (select coalesce(sum(paid_ves), 0) from counted)::text as paid_ves,
            (select coalesce(sum(quantity), 0) from lines)::text as units,
            (select coalesce(sum(subtotal_ref), 0) from lines)::text as revenue_ref,
            (select coalesce(sum(unit_cost_ref_snapshot * quantity), 0) from lines)::text as cost_ref,
            (select coalesce(sum(gross_profit_ref), 0) from lines)::text as gross_profit_ref`,
    [customerId, [...statuses]],
  );

  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

type Totals = { cost_ref: number; gross_profit_ref: number; paid_ves: number; revenue_ref: number; sales_count: number; total_ref: number; total_ves: number; units: number };

/** Las mismas cifras leídas de cada vista y de cada servicio, para compararlas con el oráculo. */
async function reported() {
  const sum = (rows: Array<Record<string, unknown>>, key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const view = async (name: string, filter: string, args: unknown[]) =>
    (await lab.rows<{ row: Record<string, unknown> }>(`select to_jsonb(v) as row from public.${name} v where ${filter}`, args)).map((entry) => entry.row);
  // Las vistas por día no tienen cliente: se restan las ventas ajenas del rango (ninguna en una base recién sembrada).
  const [others] = await lab.rows<{ n: string }>(
    `select count(*)::text as n from public.sales
     where store_id = $1 and customer_id <> $2 and (created_at at time zone 'America/Caracas')::date between $3::date and $4::date`,
    [lab.storeId, customerId, yesterday, today],
  );
  const byDay = [lab.storeId, yesterday, today];
  const daily = await view("daily_sales_summary", "store_id = $1 and sale_date between $2::date and $3::date", byDay);
  const profit = await view("gross_profit_summary", "store_id = $1 and sale_date between $2::date and $3::date", byDay);
  const byHour = await view("report_sales_by_hour", "store_id = $1 and sale_date between $2::date and $3::date", byDay);
  const byCategory = await view("report_sales_by_category", "store_id = $1 and sale_date between $2::date and $3::date and category_id = $4", [...byDay, categoryId]);
  const products = await view("product_profitability", "product_id = any($1::uuid[])", [productIds]);
  const customer = await view("customer_purchase_summary", "customer_id = $1", [customerId]);
  const metrics = await getDashboardMetrics(params(), lab.storeId);
  const close = await getDailyCloseSummary(params(), lab.storeId);
  const topCustomers = (await getTopCustomersReport(params(), lab.storeId)).items.filter((item) => item.customerId === customerId);
  const topProducts = (await getTopProductsReport(params(), lab.storeId)).items.filter((item) => productIds.includes(item.productId));

  return {
    foreignSalesInRange: Number(others.n),
    byView: {
      customer_purchase_summary: { sales_count: sum(customer, "sales_count"), total_ref: sum(customer, "total_ref"), total_ves: sum(customer, "total_ves") },
      daily_sales_summary: { paid_ves: sum(daily, "paid_ves"), sales_count: sum(daily, "sales_count"), total_ref: sum(daily, "total_ref"), total_ves: sum(daily, "total_ves") },
      gross_profit_summary: { cost_ref: sum(profit, "cost_ref"), gross_profit_ref: sum(profit, "gross_profit_ref"), revenue_ref: sum(profit, "revenue_ref") },
      product_profitability: { cost_ref: sum(products, "cost_ref"), gross_profit_ref: sum(products, "gross_profit_ref"), revenue_ref: sum(products, "revenue_ref"), units: sum(products, "units_sold") },
      report_sales_by_category: { cost_ref: sum(byCategory, "cost_ref"), gross_profit_ref: sum(byCategory, "gross_profit_ref"), revenue_ref: sum(byCategory, "revenue_ref"), units: sum(byCategory, "units") },
      report_sales_by_hour: { sales_count: sum(byHour, "sales_count"), total_ref: sum(byHour, "total_ref"), total_ves: sum(byHour, "total_ves") },
    },
    byService: {
      dailyClose: { sales_count: close.sales.salesCount, total_ref: close.sales.totalRef, total_ves: close.sales.totalVes },
      dashboardMetrics: { paid_ves: metrics.paidVes, sales_count: metrics.salesCount, total_ref: metrics.totalRef, total_ves: metrics.totalVes, units: metrics.unitsSold },
      topCustomers: { sales_count: sum(topCustomers, "salesCount"), total_ref: sum(topCustomers, "totalRef"), total_ves: sum(topCustomers, "totalVes") },
      topProducts: { revenue_ref: sum(topProducts, "revenueRef"), units: sum(topProducts, "unitsSold") },
    },
  };
}

function expectedFrom(totals: Totals) {
  const money = { sales_count: totals.sales_count, total_ref: totals.total_ref, total_ves: totals.total_ves };
  const margin = { cost_ref: totals.cost_ref, gross_profit_ref: totals.gross_profit_ref, revenue_ref: totals.revenue_ref };

  return {
    foreignSalesInRange: 0,
    byView: {
      customer_purchase_summary: money,
      daily_sales_summary: { ...money, paid_ves: totals.paid_ves },
      gross_profit_summary: margin,
      product_profitability: { ...margin, units: totals.units },
      report_sales_by_category: { ...margin, units: totals.units },
      report_sales_by_hour: money,
    },
    byService: {
      dailyClose: money,
      dashboardMetrics: { ...money, paid_ves: totals.paid_ves, units: totals.units },
      topCustomers: money,
      topProducts: { revenue_ref: totals.revenue_ref, units: totals.units },
    },
  };
}

const PREVIOUS_CRITERION = ["borrador", "pagada", "pendiente_pago"] as const;
const COUNTED = ["pagada", "pendiente_pago"] as const;

beforeAll(async () => {
  lab = await Lab.open("dec01");

  try {
    const [days] = await lab.rows<{ today: string; yesterday: string }>(
      `select (now() at time zone 'America/Caracas')::date::text as today,
              ((now() at time zone 'America/Caracas')::date - 1)::text as yesterday`,
    );
    today = days.today;
    yesterday = days.yesterday;

    const contact = await lab.db.query<{ id: string }>(
      "insert into public.contacts (store_id, name, type) values ($1, $2, 'cliente') returning id",
      [lab.storeId, `${TAG} cliente`],
    );
    customerId = contact.rows[0].id;

    const category = await lab.db.query<{ id: string }>(
      "insert into public.categories (store_id, name, is_active) values ($1, $2, true) returning id",
      [lab.storeId, `${TAG} categoría`],
    );
    categoryId = category.rows[0].id;

    const products = await lab.db.query<{ id: string }>(
      `insert into public.products (store_id, sku, name, category_id, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       select $1, format('%s-p%s', $2::text, g), format('%s producto %s', $2::text, g), $3, 9, 5, 0, 0, true
       from generate_series(1, 2) g returning id`,
      [lab.storeId, TAG, categoryId],
    );
    productIds = products.rows.map((row) => row.id);

    for (const [index, status] of SEEDED.entries()) {
      // Las más viejas primero, todas en los últimos minutos (hoy en Caracas salvo a caballo de la medianoche).
      const saleId = await insertSale(index + 1, status, (SEEDED.length - index) * 2 + 4);

      if (status === "pagada") {
        await insertPayment(saleId, index % 2 === 0 ? "efectivo_usd" : "punto_venta");
      }
    }
  } catch (error) {
    throw new Error(`SETUP · sembrar ventas: ${error instanceof Error ? error.message : String(error)}`);
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(await lab.supa("admin"));
});

afterAll(async () => {
  if (!lab) return;

  if (customerId) {
    await lab.db.query("delete from public.payments where contact_id = $1", [customerId]).catch(() => undefined);
    await lab.db.query("delete from public.sales where customer_id = $1", [customerId]).catch(() => undefined);
    await lab.db.query("delete from public.contacts where id = $1", [customerId]).catch(() => undefined);
  }
  if (productIds.length > 0) {
    await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]).catch(() => undefined);
  }
  if (categoryId) {
    await lab.db.query("delete from public.categories where id = $1", [categoryId]).catch(() => undefined);
  }
  await lab.close();
});

describe("DEC-01 · una venta en borrador no cuenta en ningún reporte", () => {
  let withoutDraft: Awaited<ReturnType<typeof measure>>;

  it("las vistas que leen ventas dejan fuera el estado `borrador` (parche 20261018a aplicado)", async () => {
    const rows = await lab.rows<{ definition: string; view: string }>(
      `select v as view, pg_get_viewdef(format('public.%I', v)::regclass) as definition
       from unnest($1::text[]) v`,
      [["daily_sales_summary", "gross_profit_summary", "product_profitability", "customer_purchase_summary", "report_sales_by_hour", "report_sales_by_category"]],
    );

    expect(rows.filter((row) => !/status = any \(array\['pendiente_pago'::(public\.)?sale_status, 'pagada'::(public\.)?sale_status\]\)/i.test(row.definition)).map((row) => row.view)).toEqual([]);
    // Las dos vistas diarias siguen en día operativo de Caracas (20261013a), no vuelven a UTC.
    expect(rows.filter((row) => row.view.endsWith("_summary") && row.view !== "customer_purchase_summary" && !row.definition.includes("America/Caracas")).map((row) => row.view)).toEqual([]);
  });

  it("sin borradores, las cifras son las del criterio anterior: cierre del día, depreciación FX, vistas y servicios no cambian", async () => {
    const previous = (await oracle(PREVIOUS_CRITERION)) as Totals;
    const current = (await oracle(COUNTED)) as Totals;

    // 3 pagadas + 2 pendientes; la cancelada y la devuelta ya no contaban.
    expect(previous.sales_count).toBe(5);
    expect(current).toEqual(previous);
    expect(await reported()).toEqual(expectedFrom(previous));

    withoutDraft = await measure();

    // Depreciación FX: los pagos activos de las ventas no canceladas, como siempre (3 ventas pagadas, 1 pago cada una).
    const fx = withoutDraft.services.fxDepreciation as { summary: { byMethod: Array<{ paymentCount: number }> }; total: number };
    expect(fx.total).toBe(3);
    expect(fx.summary.byMethod.reduce((total, method) => total + method.paymentCount, 0)).toBe(3);

    process.stdout.write(`DEC-01 sin borradores: ${JSON.stringify(previous)}\n`);
  });

  it("una venta en borrador con líneas no altera NINGUNA cifra de ninguna vista ni servicio", async () => {
    draftId = await insertSale(90, "borrador", 1);

    const withDraft = await measure();

    for (const [view, rows] of Object.entries(withDraft.views)) {
      expect({ view, rows }).toEqual({ view, rows: withoutDraft.views[view] });
    }
    for (const [service, result] of Object.entries(withDraft.services)) {
      expect({ service, result }).toEqual({ service, result: withoutDraft.services[service] });
    }
    // Y el oráculo: con el criterio anterior el borrador SÍ habría contado (36 REF, 5 unidades).
    const previous = (await oracle(PREVIOUS_CRITERION)) as Totals;
    const current = (await oracle(COUNTED)) as Totals;
    expect(previous.sales_count - current.sales_count).toBe(1);
    expect(previous.total_ref - current.total_ref).toBe(DRAFT.totalRef);
    expect(await reported()).toEqual(expectedFrom(current));
  });

  it("un borrador con un pago activo (estado que ninguna RPC produce) tampoco entra en la depreciación FX", async () => {
    await insertPayment(draftId, "punto_venta");

    try {
      const fx = stable(await getFxDepreciationReport(params(), lab.storeId));

      expect(fx).toEqual(withoutDraft.services.fxDepreciation);
    } finally {
      await lab.db.query("delete from public.payments where sale_id = $1", [draftId]);
    }
  });

  it("al confirmarla (pendiente_pago) cuenta: las cifras suben exactamente en su importe", async () => {
    const before = (await oracle(COUNTED)) as Totals;

    await lab.db.query("update public.sales set status = 'pendiente_pago' where id = $1", [draftId]);

    const after = (await oracle(COUNTED)) as Totals;

    expect(after).toEqual({
      cost_ref: before.cost_ref + DRAFT.costRef,
      gross_profit_ref: before.gross_profit_ref + DRAFT.profitRef,
      paid_ves: before.paid_ves,
      revenue_ref: before.revenue_ref + DRAFT.totalRef,
      sales_count: before.sales_count + 1,
      total_ref: before.total_ref + DRAFT.totalRef,
      total_ves: before.total_ves + DRAFT.totalVes,
      units: before.units + DRAFT.units,
    });
    expect(await reported()).toEqual(expectedFrom(after));

    const confirmed = await measure();
    const summary = (value: unknown) => value as { salesCount: number; totalRef: number };
    const previousSummary = summary(withoutDraft.services.dashboardSummary);

    // Resumen del dashboard (hoy): una venta más y su importe. También queda por cobrar en la antigüedad.
    expect(summary(confirmed.services.dashboardSummary).salesCount).toBe(previousSummary.salesCount + 1);
    expect(summary(confirmed.services.dashboardSummary).totalRef).toBe(previousSummary.totalRef + DRAFT.totalRef);
    expect((confirmed.views.report_open_documents_aging as unknown[]).length).toBe(
      (withoutDraft.views.report_open_documents_aging as unknown[]).length + 1,
    );

    process.stdout.write(`DEC-01 confirmada: ${JSON.stringify(after)}\n`);
  });
});
