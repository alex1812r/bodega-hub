/** @jest-environment node */
/**
 * REP-F7 (R-02, R-03) · con más de 1.000 ventas en el rango, "Top clientes", "Top productos" y las métricas del
 * dashboard cuentan TODAS las ventas y no fallan con "URI too long".
 *
 * Antes: `getTopCustomersReport` leía `sales` sin paginar (PostgREST corta en 1.000 filas) y `getTopProductsReport` /
 * `getDashboardMetrics` mandaban todos los ids de venta en un `.in("sale_id", ids)` (500 a partir de ~334 ventas).
 *
 * El test siembra 1.250 ventas con `TAG` en marzo de 2016 (un mes que no usa ninguna otra suite) para dos clientes
 * propios, con 2 líneas cada una, llama a los servicios reales por PostgREST como `lab-admin` y compara con SQL
 * directo. Los datos se borran al terminar.
 *
 * REP-F10 (N-01, N-02) · lo mismo para "Depreciación FX", la parte FX del "Cierre del día" y el resumen del dashboard:
 * `getFxDepreciationReport` leía `sales` sin paginar (solo las 1.000 ventas más recientes del rango) y
 * `getDashboardSummary` leía hoy + ayer en una sola respuesta. Para ellos se siembran, con otros clientes propios y un
 * pago por venta pagada: 1.200 ventas en un solo día (2016-05-10: 1.091 no canceladas), 6.000 en abril de 2016 (5.455) y
 * 1.300 + 300 en las últimas horas (hoy y ayer). Las ventas de marzo también llevan pago: sus días sueltos (~130 ventas)
 * son el caso "pocas ventas, cifras de siempre".
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/report-large-ranges.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { createRouteSupabaseClient } from "../../../src/lib/supabase/route-client";
import { getDashboardMetrics, getDashboardSummary } from "../../../src/modules/dashboard/services/dashboard.server";
import { getDailyCloseSummary } from "../../../src/modules/reports/services/dailyCloseSummary.server";
import { getFxDepreciationReport } from "../../../src/modules/reports/services/fxDepreciationReport.server";
import { getTopCustomersReport, getTopProductsReport } from "../../../src/modules/reports/services/reports.server";
import { Lab } from "../scenarios/db";

jest.mock("../../../src/lib/supabase/route-client", () => ({ createRouteSupabaseClient: jest.fn() }));
// Sembrar ~10.000 ventas con sus líneas y pagos tarda más que el tope por defecto.
jest.setTimeout(600_000);

const TAG = `repf7l-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const SALE_COUNT = 1250;
const RATE = 50;
/** Una venta cada 10 minutos desde las 08:00 de Caracas del 1 de marzo de 2016: ~8,7 días. */
const FIRST_SALE_UTC = "2016-03-01 12:00:00+00";
const RANGE = "from=2016-03-01&to=2016-03-31";
const COUNTED = "('borrador', 'pagada', 'pendiente_pago')";

let lab: Lab;
let customerIds: string[] = [];
/** Clientes de las ventas de REP-F10: aparte, para no alterar las cifras por cliente de REP-F7. */
let fxCustomerIds: string[] = [];

/** `count` ventas con 2 líneas, una cada `stepSeconds` desde `firstUtc`; `series` las distingue en el nº de factura. */
async function seedSales(series: string, customers: string[], count: number, firstUtc: string, stepSeconds: number) {
  await lab.db.query(
    `with ins as (
       insert into public.sales (store_id, invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, status, created_at)
       select $1, format('%s%s-%s', $2::text, $7::text, g), ($3::uuid[])[1 + (g % 3 = 0)::int], $4::numeric, 5 + (g % 9), 5 + (g % 9),
              (5 + (g % 9)) * $4::numeric, case when g % 4 = 0 then 0 else (5 + (g % 9)) * $4::numeric end,
              (case when g % 11 = 0 then 'cancelada' when g % 4 = 0 then 'pendiente_pago' else 'pagada' end)::public.sale_status,
              $5::timestamptz + make_interval(secs => g * $8::int)
       from generate_series(1, $6::int) g
       returning id, invoice_number
     )
     insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, unit_cost_ref_snapshot, subtotal_ves)
     select ins.id, p.id, 1 + (p.rn % 3), 4 + p.rn, 2, 0
     from ins
     cross join lateral (
       select id, row_number() over (order by sku) rn from public.products
       where store_id = $1 and is_active
       order by sku offset (split_part(ins.invoice_number, '-', 3)::int % 7) limit 2
     ) p`,
    [lab.storeId, TAG, customers, RATE, firstUtc, count, series, stepSeconds],
  );
}

/** Un pago activo por venta pagada, con la fecha de la venta: 1 de cada 3 en efectivo USD, el resto por punto de venta en Bs. */
async function seedPayments(customers: string[]) {
  await lab.db.query(
    `insert into public.payments (direction, sale_id, contact_id, method, currency, amount, amount_ves, amount_ref, ref_rate_ves, status, created_by, created_at, store_id)
     select 'entrada', s.id, s.customer_id,
            (case when n.g % 3 = 0 then 'efectivo_usd' else 'punto_venta' end)::public.payment_method,
            (case when n.g % 3 = 0 then 'USD' else 'VES' end)::public.payment_currency,
            case when n.g % 3 = 0 then s.total_ref else s.total_ves end,
            s.total_ves, s.total_ref, s.ref_rate_ves, 'activo', null, s.created_at, s.store_id
     from public.sales s
     cross join lateral (select split_part(s.invoice_number, '-', 3)::int as g) n
     where s.customer_id = any($1::uuid[]) and s.status = 'pagada'`,
    [customers],
  );
}

/** Cifras de depreciación FX y de cierre del rango, con SQL directo por día operativo de Caracas. */
async function fxOracle(from: string, to: string) {
  const [row] = await lab.rows<Record<string, string>>(
    `with in_range as (
       select s.* from public.sales s
       where s.store_id = $1 and (s.created_at at time zone 'America/Caracas')::date between $2::date and $3::date
     ), paid as (
       select p.* from public.payments p join in_range s on s.id = p.sale_id
       where p.status = 'activo' and p.store_id = $1 and s.status <> 'cancelada'
     ), pay_range as (
       select p.* from public.payments p
       where p.store_id = $1 and p.status = 'activo' and p.sale_id is not null
         and (p.created_at at time zone 'America/Caracas')::date between $2::date and $3::date
     )
     select (select count(*) from in_range where status <> 'cancelada')::text as live_sales,
            (select count(*) from in_range where status in ${COUNTED})::text as sales_count,
            (select coalesce(sum(total_ref), 0) from in_range where status in ${COUNTED})::text as total_ref,
            (select count(distinct sale_id) from paid)::text as fx_rows,
            (select count(*) from paid)::text as fx_payments,
            (select coalesce(sum(amount_ves), 0) from paid where method <> 'efectivo_usd')::text as ves_exposed,
            (select coalesce(sum(amount_ref), 0) from paid where method <> 'efectivo_usd')::text as ves_ref_at_collection,
            (select coalesce(sum(amount_ref), 0) from paid where method = 'efectivo_usd')::text as usd_held_ref,
            (select count(*) from pay_range)::text as range_payments`,
    [lab.storeId, from, to],
  );

  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

/** Lo que el reporte de depreciación FX dice del rango, en las mismas claves que `fxOracle`. */
async function fxMeasured(from: string, to: string) {
  const report = await getFxDepreciationReport(new URLSearchParams(`from=${from}&to=${to}&limit=100`), lab.storeId);

  return {
    fx_payments: report.summary.byMethod.reduce((total, method) => total + method.paymentCount, 0),
    fx_rows: report.total,
    usd_held_ref: report.summary.usdHeldRef,
    ves_exposed: report.summary.vesExposed,
    ves_ref_at_collection: report.summary.vesRefAtCollection,
  };
}

function fxExpected(oracle: Record<string, number>) {
  return {
    fx_payments: oracle.fx_payments,
    fx_rows: oracle.fx_rows,
    usd_held_ref: oracle.usd_held_ref,
    ves_exposed: oracle.ves_exposed,
    ves_ref_at_collection: oracle.ves_ref_at_collection,
  };
}

const params = (extra = "") => new URLSearchParams(`${RANGE}&limit=100${extra}`);

beforeAll(async () => {
  lab = await Lab.open("repf7l");

  try {
    const contacts = await lab.db.query<{ id: string }>(
      `insert into public.contacts (store_id, name, type)
       select $1, format('%s cliente %s', $2::text, g), 'cliente' from generate_series(1, 2) g returning id`,
      [lab.storeId, TAG],
    );
    customerIds = contacts.rows.map((row) => row.id);

    await lab.db.query(
      `with ins as (
         insert into public.sales (store_id, invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, status, created_at)
         select $1, format('%s-%s', $2::text, g), ($3::uuid[])[1 + (g % 3 = 0)::int], $4::numeric, 5 + (g % 9), 5 + (g % 9),
                (5 + (g % 9)) * $4::numeric, case when g % 4 = 0 then 0 else (5 + (g % 9)) * $4::numeric end,
                (case when g % 11 = 0 then 'cancelada' when g % 4 = 0 then 'pendiente_pago' else 'pagada' end)::public.sale_status,
                $5::timestamptz + make_interval(mins => g * 10)
         from generate_series(1, $6::int) g
         returning id, invoice_number
       )
       insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, unit_cost_ref_snapshot, subtotal_ves)
       select ins.id, p.id, 1 + (p.rn % 3), 4 + p.rn, 2, 0
       from ins
       cross join lateral (
         select id, row_number() over (order by sku) rn from public.products
         where store_id = $1 and is_active
         order by sku offset (split_part(ins.invoice_number, '-', 3)::int % 7) limit 2
       ) p`,
      [lab.storeId, TAG, customerIds, RATE, FIRST_SALE_UTC, SALE_COUNT],
    );

    await seedPayments(customerIds);

    const fxContacts = await lab.db.query<{ id: string }>(
      `insert into public.contacts (store_id, name, type)
       select $1, format('%s cliente fx %s', $2::text, g), 'cliente' from generate_series(1, 2) g returning id`,
      [lab.storeId, TAG],
    );
    fxCustomerIds = fxContacts.rows.map((row) => row.id);

    // Un solo día de Caracas (08:00 → ~21:20, una cada 40 s): 1.200 ventas, 1.091 no canceladas.
    await seedSales("d", fxCustomerIds, 1200, "2016-05-10 12:00:00+00", 40);
    // Abril de 2016, una cada 5 minutos (~21 días): 6.000 ventas, 5.455 no canceladas.
    await seedSales("m", fxCustomerIds, 6000, "2016-04-01 12:00:00+00", 300);
    // Últimas ~65 min (hoy, o a caballo de la medianoche) y hace 26 h (ayer o anteayer): más de 1.000 entre hoy y ayer.
    await seedSales("h", fxCustomerIds, 1300, new Date(Date.now() - 1300 * 3000 - 60_000).toISOString(), 3);
    await seedSales("a", fxCustomerIds, 300, new Date(Date.now() - 26 * 3600 * 1000).toISOString(), 3);
    await seedPayments(fxCustomerIds);
  } catch (error) {
    throw new Error(`SETUP · sembrar ventas: ${error instanceof Error ? error.message : String(error)}`);
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(await lab.supa("admin"));
});

afterAll(async () => {
  if (!lab) return;

  const seeded = [...customerIds, ...fxCustomerIds];

  if (seeded.length > 0) {
    await lab.db.query("delete from public.payments where contact_id = any($1::uuid[])", [seeded]).catch(() => undefined);
    await lab.db.query("delete from public.sales where customer_id = any($1::uuid[])", [seeded]).catch(() => undefined);
    await lab.db.query("delete from public.contacts where id = any($1::uuid[])", [seeded]).catch(() => undefined);
  }
  await lab.close();
});

describe("REP-F7 · reportes con más de 1.000 ventas en el rango", () => {
  it("el conjunto sembrado supera las 1.000 ventas que cuentan y son las únicas de la tienda en el rango", async () => {
    const [row] = await lab.rows<{ counted: string; other: string }>(
      `select count(*) filter (where customer_id = any($2::uuid[]) and status in ${COUNTED})::text as counted,
              count(*) filter (where customer_id <> all($2::uuid[]))::text as other
       from public.sales
       where store_id = $1 and (created_at at time zone 'America/Caracas')::date between '2016-03-01' and '2016-03-31'`,
      [lab.storeId, customerIds],
    );

    expect(Number(row.counted)).toBeGreaterThan(1000);
    expect(Number(row.other)).toBe(0);
  });

  it("Top clientes cuenta todas las ventas, no solo las primeras 1.000 (R-02)", async () => {
    const expected = await lab.rows<{ customer_id: string; sales_count: string; total_ref: string; total_ves: string }>(
      `select customer_id, count(*)::text as sales_count, sum(total_ref)::text as total_ref, sum(total_ves)::text as total_ves
       from public.sales where customer_id = any($1::uuid[]) and status in ${COUNTED}
       group by customer_id order by sum(total_ves) desc`,
      [customerIds],
    );

    const report = await getTopCustomersReport(params(), lab.storeId);

    expect(
      report.items.map((item) => ({
        customer_id: item.customerId,
        sales_count: String(item.salesCount),
        total_ref: String(item.totalRef),
        total_ves: String(item.totalVes),
      })),
    ).toEqual(expected.map((row) => ({ ...row, total_ref: String(Number(row.total_ref)), total_ves: String(Number(row.total_ves)) })));
    expect(report.items.every((item) => item.name.startsWith(TAG))).toBe(true);

    process.stdout.write(`REP-F7 top clientes: ${JSON.stringify(report.items.map((item) => [item.salesCount, item.totalRef]))}\n`);
  });

  it("Top productos no falla con «URI too long» y suma todas las líneas (R-03)", async () => {
    const expected = await lab.rows<{ product_id: string; revenue_ref: string; units: string }>(
      `select si.product_id, sum(si.quantity)::text as units, sum(si.subtotal_ref)::text as revenue_ref
       from public.sale_items si join public.sales s on s.id = si.sale_id
       where s.customer_id = any($1::uuid[]) and s.status in ${COUNTED}
       group by si.product_id`,
      [customerIds],
    );

    const report = await getTopProductsReport(params(), lab.storeId);
    const byProduct = new Map(report.items.map((item) => [item.productId, item]));

    expect(report.total).toBe(expected.length);
    for (const row of expected) {
      expect(byProduct.get(row.product_id)?.unitsSold).toBe(Number(row.units));
      expect(byProduct.get(row.product_id)?.revenueRef).toBeCloseTo(Number(row.revenue_ref), 2);
      expect(byProduct.get(row.product_id)?.sku).toBeTruthy();
    }

    process.stdout.write(
      `REP-F7 top productos: ${expected.length} productos, ${expected.reduce((total, row) => total + Number(row.units), 0)} unidades\n`,
    );
  });

  it("las métricas del dashboard cuentan todas las ventas y unidades (R-03)", async () => {
    const [expected] = await lab.rows<{ paid_ves: string; sales_count: string; total_ref: string; total_ves: string; units: string }>(
      `select count(*)::text as sales_count, sum(total_ref)::text as total_ref, sum(total_ves)::text as total_ves,
              sum(paid_ves)::text as paid_ves,
              (select sum(si.quantity) from public.sale_items si join public.sales x on x.id = si.sale_id
               where x.customer_id = any($1::uuid[]) and x.status in ${COUNTED})::text as units
       from public.sales where customer_id = any($1::uuid[]) and status in ${COUNTED}`,
      [customerIds],
    );

    const metrics = await getDashboardMetrics(params(), lab.storeId);

    expect(metrics).toEqual({
      from: "2016-03-01",
      paidVes: Number(expected.paid_ves),
      pendingVes: Number(expected.total_ves) - Number(expected.paid_ves),
      salesCount: Number(expected.sales_count),
      to: "2016-03-31",
      totalRef: Number(expected.total_ref),
      totalVes: Number(expected.total_ves),
      unitsSold: Number(expected.units),
    });

    process.stdout.write(`REP-F7 métricas: ${JSON.stringify(metrics)}\n`);
  });
});

describe("REP-F10 · depreciación FX, cierre del día y resumen del dashboard con más de 1.000 ventas", () => {
  it("con pocas ventas (un día de marzo, ~130) la depreciación FX y el cierre dan las cifras de la base", async () => {
    const oracle = await fxOracle("2016-03-03", "2016-03-03");

    expect(oracle.live_sales).toBeGreaterThan(100);
    expect(oracle.live_sales).toBeLessThan(1000);
    expect(await fxMeasured("2016-03-03", "2016-03-03")).toEqual(fxExpected(oracle));

    const close = await getDailyCloseSummary(new URLSearchParams("from=2016-03-03&to=2016-03-03"), lab.storeId);

    expect(close.sales.salesCount).toBe(oracle.sales_count);
    expect(close.sales.totalRef).toBe(oracle.total_ref);
    expect(close.paymentsSummary.paymentCount).toBe(oracle.range_payments);
    expect(close.fx.vesExposed).toBe(oracle.ves_exposed);
    expect(close.fx.usdHeldRef).toBe(oracle.usd_held_ref);

    process.stdout.write(`REP-F10 pocas ventas 2016-03-03: ${JSON.stringify({ sql: oracle, fx: close.fx })}\n`);
  });

  it.each([
    ["un día con 1.091 ventas no canceladas", "2016-05-10", "2016-05-10", 1091],
    ["marzo con más de 1.000", "2016-03-01", "2016-03-31", 1137],
    ["abril con 5.455", "2016-04-01", "2016-04-30", 5455],
  ])("Depreciación FX cuenta todas las ventas del rango, no las 1.000 más recientes: %s (N-01)", async (_label, from, to, live) => {
    const oracle = await fxOracle(from, to);
    const measured = await fxMeasured(from, to);

    expect(oracle.live_sales).toBe(live);
    expect(measured).toEqual(fxExpected(oracle));

    process.stdout.write(`REP-F10 fx ${from}..${to}: ${JSON.stringify({ sql: oracle, servicio: measured })}\n`);
  });

  it("el Cierre del día de un día con más de 1.000 ventas no se contradice: ventas, cobros y FX completos (N-01)", async () => {
    const oracle = await fxOracle("2016-05-10", "2016-05-10");
    const close = await getDailyCloseSummary(new URLSearchParams("from=2016-05-10&to=2016-05-10"), lab.storeId);

    expect(oracle.sales_count).toBeGreaterThan(1000);
    expect(close.sales.salesCount).toBe(oracle.sales_count);
    expect(close.sales.totalRef).toBe(oracle.total_ref);
    expect(close.paymentsSummary.paymentCount).toBe(oracle.range_payments);
    expect(close.fx.vesExposed).toBe(oracle.ves_exposed);
    expect(close.fx.usdHeldRef).toBe(oracle.usd_held_ref);

    process.stdout.write(
      `REP-F10 cierre 2016-05-10: ${JSON.stringify({ sql: oracle, ventas: close.sales, pagos: close.paymentsSummary.paymentCount, fx: close.fx })}\n`,
    );
  });

  it("el resumen del dashboard cuenta enteras las ventas de hoy y de ayer (N-02)", async () => {
    const [sql] = await lab.rows<{ ayer_ref: string; hoy_n: string; hoy_ref: string; hoy_ves: string; total_n: string }>(
      `with live as (
         select total_ref, total_ves, (created_at at time zone 'America/Caracas')::date as day,
                (now() at time zone 'America/Caracas')::date as today
         from public.sales where store_id = $1 and status not in ('cancelada', 'devuelta')
       )
       select count(*) filter (where day = today)::text as hoy_n,
              coalesce(sum(total_ref) filter (where day = today), 0)::text as hoy_ref,
              coalesce(sum(total_ves) filter (where day = today), 0)::text as hoy_ves,
              coalesce(sum(total_ref) filter (where day = today - 1), 0)::text as ayer_ref,
              count(*) filter (where day in (today, today - 1))::text as total_n
       from live`,
      [lab.storeId],
    );

    const summary = await getDashboardSummary(lab.storeId);

    expect(Number(sql.total_n)).toBeGreaterThan(1000);
    expect({
      previousDayTotalRef: summary.previousDayTotalRef,
      salesCount: summary.salesCount,
      totalRef: summary.totalRef,
      totalVes: summary.totalVes,
    }).toEqual({
      previousDayTotalRef: Number(sql.ayer_ref),
      salesCount: Number(sql.hoy_n),
      totalRef: Number(sql.hoy_ref),
      totalVes: Number(sql.hoy_ves),
    });

    process.stdout.write(`REP-F10 resumen: ${JSON.stringify({ sql, servicio: summary })}\n`);
  });
});
