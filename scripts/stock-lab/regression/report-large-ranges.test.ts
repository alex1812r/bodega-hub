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
 *   npm run stock-lab:test -- scripts/stock-lab/regression/report-large-ranges.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { createRouteSupabaseClient } from "../../../src/lib/supabase/route-client";
import { getDashboardMetrics } from "../../../src/modules/dashboard/services/dashboard.server";
import { getTopCustomersReport, getTopProductsReport } from "../../../src/modules/reports/services/reports.server";
import { Lab } from "../scenarios/db";

jest.mock("../../../src/lib/supabase/route-client", () => ({ createRouteSupabaseClient: jest.fn() }));

const TAG = `repf7l-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const SALE_COUNT = 1250;
const RATE = 50;
/** Una venta cada 10 minutos desde las 08:00 de Caracas del 1 de marzo de 2016: ~8,7 días. */
const FIRST_SALE_UTC = "2016-03-01 12:00:00+00";
const RANGE = "from=2016-03-01&to=2016-03-31";
const COUNTED = "('borrador', 'pagada', 'pendiente_pago')";

let lab: Lab;
let customerIds: string[] = [];

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
  } catch (error) {
    throw new Error(`SETUP · sembrar ventas: ${error instanceof Error ? error.message : String(error)}`);
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(await lab.supa("admin"));
});

afterAll(async () => {
  if (!lab) return;

  if (customerIds.length > 0) {
    await lab.db.query("delete from public.sales where customer_id = any($1::uuid[])", [customerIds]).catch(() => undefined);
    await lab.db.query("delete from public.contacts where id = any($1::uuid[])", [customerIds]).catch(() => undefined);
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
