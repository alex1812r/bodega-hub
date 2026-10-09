/** @jest-environment node */
/**
 * REP-07a / REP-F7 · "no rompe": el cierre del día y la depreciación FX dan las MISMAS cifras con las vistas
 * `daily_sales_summary` / `gross_profit_summary` agrupando por día UTC (definición anterior, `20260716b`) y por día
 * operativo de Caracas (`20261013a`), porque ninguno de los dos servicios las lee: leen `sales`, `sale_items`,
 * `payments` y `exchange_rates` con el rango ya convertido a día Caracas.
 *
 * El test siembra sus datos (240 ventas con `TAG` en septiembre de 2017, un mes que no usa ninguna otra suite: una por
 * hora durante 10 días, 1 de cada 12 cancelada, 2 líneas por venta y un pago activo por venta pagada), llama a
 * `getDailyCloseSummary` y `getFxDepreciationReport` por PostgREST como `lab-admin` con cada definición de las vistas y
 * compara. Además comprueba contra SQL directo que las cifras son las de la base, también en el rango de 12 días
 * (~220 ventas, varios lotes de ids), que antes del arreglo de REP-F7 fallaba con "URI too long".
 *
 * Al terminar, aunque falle, `afterAll` deja las dos vistas con la definición de
 * `supabase/patches/20261013a-report-money-views.sql` (leída del propio parche) y borra los datos sembrados.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/report-daily-close-fx-invariance.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createRouteSupabaseClient } from "../../../src/lib/supabase/route-client";
import { getDailyCloseSummary } from "../../../src/modules/reports/services/dailyCloseSummary.server";
import { getFxDepreciationReport } from "../../../src/modules/reports/services/fxDepreciationReport.server";
import { Lab } from "../scenarios/db";

jest.mock("../../../src/lib/supabase/route-client", () => ({ createRouteSupabaseClient: jest.fn() }));

const TAG = `repf7-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const PATCH_FILE = path.resolve(__dirname, "../../../supabase/patches/20261013a-report-money-views.sql");
const VIEWS = ["daily_sales_summary", "gross_profit_summary"] as const;

/** Primera venta: 20:15 del 19 de septiembre de 2017 en Caracas (00:15 UTC del 20). Una por hora. */
const FIRST_SALE_UTC = "2017-09-20 00:15:00+00";
const SALE_COUNT = 240;
const RATE = 52;

const RANGES = [
  // Día con ventas entre las 20:00 y las 23:59 de Caracas (00:15-03:15 UTC del día siguiente).
  { from: "2017-09-24", to: "2017-09-24" },
  { from: "2017-09-25", to: "2017-09-25" },
  // Primer día de los datos: empieza a las 20:15 Caracas del 19.
  { from: "2017-09-19", to: "2017-09-19" },
  { from: "2017-09-23", to: "2017-09-25" },
  { from: "2017-09-22", to: "2017-09-26" },
  // Todo el conjunto: ~220 ventas no canceladas, varios lotes de ids.
  { from: "2017-09-19", to: "2017-09-30" },
] as const;

/** Definición anterior a 20261013a (20260716b, día UTC) con el `security_invoker` de 20261006a. */
const UTC_VIEWS_SQL = `
create or replace view public.daily_sales_summary
with (security_invoker = true) as
select
  store_id,
  date_trunc('day', created_at)::date as sale_date,
  count(*) as sales_count,
  sum(total_ref) as total_ref,
  sum(total_ves) as total_ves,
  sum(paid_ves) as paid_ves
from public.sales
where status not in ('cancelada', 'devuelta')
group by store_id, date_trunc('day', created_at)::date;

create or replace view public.gross_profit_summary
with (security_invoker = true) as
select
  s.store_id,
  date_trunc('day', s.created_at)::date as sale_date,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
where s.status not in ('cancelada', 'devuelta')
group by s.store_id, date_trunc('day', s.created_at)::date;
`;

/** Las dos vistas tal como las define el parche 20261013a (día operativo de Caracas). */
function caracasViewsSql() {
  const patch = readFileSync(PATCH_FILE, "utf8");

  return VIEWS.map((view) => {
    const start = patch.indexOf(`create or replace view public.${view}`);
    const end = patch.indexOf(";", start);

    if (start < 0 || end < 0) {
      throw new Error(`SETUP · el parche 20261013a no define public.${view}`);
    }

    const statement = patch.slice(start, end + 1);

    if (!statement.includes("America/Caracas")) {
      throw new Error(`SETUP · la definición de public.${view} en 20261013a no agrupa por día de Caracas`);
    }

    return statement;
  }).join("\n");
}

let lab: Lab;
let customerId = "";

async function applyViews(sql: string) {
  await lab.db.query("begin");

  try {
    await lab.db.query(sql);
    await lab.db.query("commit");
  } catch (error) {
    await lab.db.query("rollback");
    throw error;
  }

  await lab.db.query("notify pgrst, 'reload schema'");
}

async function viewsGroupBy(): Promise<Array<"caracas" | "utc">> {
  const rows = await lab.rows<{ definition: string }>(
    "select pg_get_viewdef(format('public.%I', v)::regclass) as definition from unnest($1::text[]) v",
    [[...VIEWS]],
  );

  return rows.map((row) => (row.definition.includes("America/Caracas") ? "caracas" : "utc"));
}

/** Filas de la vista para las ventas sembradas (son las únicas de la tienda lab en 2017). */
async function dailySalesViewRows() {
  return lab.rows<{ sale_date: string; sales_count: string }>(
    `select sale_date::text, sales_count::text from public.daily_sales_summary
     where store_id = $1 and sale_date between '2017-09-01' and '2017-10-31' order by sale_date`,
    [lab.storeId],
  );
}

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

/** Cierre del día y depreciación FX de todos los rangos. `generatedAt` no es una cifra: se neutraliza. */
async function measure() {
  const result: Record<string, { dailyClose: unknown; fxDepreciation: unknown }> = {};

  for (const range of RANGES) {
    const params = () => new URLSearchParams({ ...range, limit: "100" });

    result[`${range.from}..${range.to}`] = {
      dailyClose: stable(await getDailyCloseSummary(params(), lab.storeId)),
      fxDepreciation: stable(await getFxDepreciationReport(params(), lab.storeId)),
    };
  }

  return result;
}

/** Las mismas cifras, calculadas con SQL directo sobre las tablas por día operativo de Caracas. */
async function sqlOracle(range: { from: string; to: string }) {
  const [row] = await lab.rows<{
    payments: string;
    sales_count: string;
    total_ref: string;
    total_ves: string;
    usd_held_ref: string;
    ves_exposed: string;
  }>(
    `with in_range as (
       select s.* from public.sales s
       where s.store_id = $1
         and (s.created_at at time zone 'America/Caracas')::date between $2::date and $3::date
     ), counted as (
       select * from in_range where status in ('borrador', 'pagada', 'pendiente_pago')
     ), paid as (
       select p.* from public.payments p
       join in_range s on s.id = p.sale_id
       where p.status = 'activo' and p.store_id = $1 and s.status <> 'cancelada'
     )
     select (select count(*) from counted)::text as sales_count,
            (select coalesce(sum(total_ref), 0) from counted)::text as total_ref,
            (select coalesce(sum(total_ves), 0) from counted)::text as total_ves,
            (select count(*) from paid)::text as payments,
            (select coalesce(sum(amount_ves), 0) from paid where method <> 'efectivo_usd')::text as ves_exposed,
            (select coalesce(sum(amount_ref), 0) from paid where method = 'efectivo_usd')::text as usd_held_ref`,
    [lab.storeId, range.from, range.to],
  );

  return {
    payments: Number(row.payments),
    salesCount: Number(row.sales_count),
    totalRef: Number(row.total_ref),
    totalVes: Number(row.total_ves),
    usdHeldRef: Number(row.usd_held_ref),
    vesExposed: Number(row.ves_exposed),
  };
}

beforeAll(async () => {
  lab = await Lab.open("repf7");

  try {
    const groupBy = await viewsGroupBy();

    if (groupBy.some((value) => value !== "caracas")) {
      throw new Error(`las vistas no están en la definición de 20261013a (${groupBy.join(", ")}): falta aplicar el parche`);
    }

    const contact = await lab.db.query<{ id: string }>(
      "insert into public.contacts (store_id, name, type) values ($1, $2, 'cliente') returning id",
      [lab.storeId, `${TAG} cliente`],
    );
    customerId = contact.rows[0].id;

    // 240 ventas, una por hora (cubre las 24 horas UTC: incluye 20:00-23:59 Caracas del día anterior); 2 líneas cada una.
    await lab.db.query(
      `with ins as (
         insert into public.sales (store_id, invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, status, created_at)
         select $1, format('%s-%s', $2::text, g), $3, $4::numeric, 10 + (g % 7), 10 + (g % 7), (10 + (g % 7)) * $4::numeric,
                case when g % 5 = 0 then 0 else (10 + (g % 7)) * $4::numeric end,
                (case when g % 12 = 0 then 'cancelada' when g % 5 = 0 then 'pendiente_pago' else 'pagada' end)::public.sale_status,
                $5::timestamptz + make_interval(hours => g)
         from generate_series(1, $6::int) g
         returning id, invoice_number
       )
       insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, unit_cost_ref_snapshot, subtotal_ves)
       select ins.id, p.id, 1 + (p.rn % 3), 4 + p.rn, 2 + (p.rn * 0.5), 0
       from ins
       cross join lateral (
         select id, row_number() over (order by sku) rn from public.products
         where store_id = $1 and is_active
         order by sku offset (split_part(ins.invoice_number, '-', 3)::int % 5) limit 2
       ) p`,
      [lab.storeId, TAG, customerId, RATE, FIRST_SALE_UTC, SALE_COUNT],
    );

    // Un pago activo por venta pagada, con la fecha de la venta: 2 de cada 3 por punto de venta en Bs y 1 de cada 3 en
    // efectivo USD (para que la depreciación FX no sea 0).
    await lab.db.query(
      `insert into public.payments (direction, sale_id, contact_id, method, currency, amount, amount_ves, amount_ref, ref_rate_ves, status, created_by, created_at, store_id)
       select 'entrada', s.id, s.customer_id,
              (case when n.g % 3 = 0 then 'efectivo_usd' else 'punto_venta' end)::public.payment_method,
              (case when n.g % 3 = 0 then 'USD' else 'VES' end)::public.payment_currency,
              case when n.g % 3 = 0 then s.total_ref else s.total_ves end,
              s.total_ves, s.total_ref, s.ref_rate_ves, 'activo', null, s.created_at, s.store_id
       from public.sales s
       cross join lateral (select split_part(s.invoice_number, '-', 3)::int as g) n
       where s.customer_id = $1 and s.status = 'pagada'`,
      [customerId],
    );
  } catch (error) {
    throw new Error(`SETUP · sembrar ventas y pagos: ${error instanceof Error ? error.message : String(error)}`);
  }

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(await lab.supa("admin"));
});

afterAll(async () => {
  if (!lab) return;

  // Lo primero y pase lo que pase: las vistas vuelven a la definición de 20261013a.
  let restoreError: unknown = null;
  try {
    await applyViews(caracasViewsSql());
  } catch (error) {
    restoreError = error;
  }

  if (customerId) {
    await lab.db.query("delete from public.payments where contact_id = $1", [customerId]).catch(() => undefined);
    await lab.db.query("delete from public.sales where customer_id = $1", [customerId]).catch(() => undefined);
    await lab.db.query("delete from public.contacts where id = $1", [customerId]).catch(() => undefined);
  }

  const groupBy = await viewsGroupBy().catch(() => []);
  await lab.close();

  if (restoreError || groupBy.length !== VIEWS.length || groupBy.some((value) => value !== "caracas")) {
    throw new Error(
      `LAS VISTAS NO QUEDARON EN 20261013a (${groupBy.join(", ")}): reaplica supabase/patches/20261013a-report-money-views.sql. ${restoreError instanceof Error ? restoreError.message : ""}`,
    );
  }
});

describe("REP-F7 · cierre del día y depreciación FX no dependen de las vistas diarias", () => {
  let withCaracasViews: Awaited<ReturnType<typeof measure>>;

  it("el conjunto sembrado tiene ventas de 20:00 a 23:59 de Caracas y más de un lote de ids", async () => {
    const [row] = await lab.rows<{ late: string; total: string }>(
      `select count(*)::text as total,
              count(*) filter (where extract(hour from created_at at time zone 'America/Caracas') >= 20)::text as late
       from public.sales where customer_id = $1`,
      [customerId],
    );

    expect(Number(row.total)).toBe(SALE_COUNT);
    expect(Number(row.late)).toBeGreaterThanOrEqual(40);
    expect((await sqlOracle(RANGES[5])).salesCount).toBeGreaterThan(200);
  });

  it("con las vistas en día Caracas (20261013a) las cifras son las de la base, también con ~220 ventas", async () => {
    withCaracasViews = await measure();

    for (const range of RANGES) {
      const oracle = await sqlOracle(range);
      const measured = withCaracasViews[`${range.from}..${range.to}`] as {
        dailyClose: { fx: { usdHeldRef: number; vesExposed: number }; sales: Record<string, number> };
        fxDepreciation: { summary: { byMethod: Array<{ paymentCount: number }>; usdHeldRef: number; vesExposed: number } };
      };

      expect(measured.dailyClose.sales).toEqual({
        salesCount: oracle.salesCount,
        totalRef: oracle.totalRef,
        totalVes: oracle.totalVes,
      });
      expect(measured.fxDepreciation.summary.vesExposed).toBe(oracle.vesExposed);
      expect(measured.fxDepreciation.summary.usdHeldRef).toBe(oracle.usdHeldRef);
      expect(measured.fxDepreciation.summary.byMethod.reduce((total, method) => total + method.paymentCount, 0)).toBe(
        oracle.payments,
      );
      expect(measured.dailyClose.fx.vesExposed).toBe(oracle.vesExposed);
      expect(measured.dailyClose.fx.usdHeldRef).toBe(oracle.usdHeldRef);

      process.stdout.write(
        `REP-F7 ${range.from}..${range.to}: ventas=${oracle.salesCount} REF=${oracle.totalRef} pagos=${oracle.payments} Bs expuestos=${oracle.vesExposed} USD=${oracle.usdHeldRef}\n`,
      );
    }
  });

  it("con las vistas en día UTC (definición anterior) el cierre del día y la depreciación FX son idénticos", async () => {
    const caracasRows = await dailySalesViewRows();

    await applyViews(UTC_VIEWS_SQL);

    try {
      expect(await viewsGroupBy()).toEqual(["utc", "utc"]);
      // La vista SÍ cambia (el reparto por día es otro): la comparación no es vacía.
      expect(await dailySalesViewRows()).not.toEqual(caracasRows);

      expect(await measure()).toEqual(withCaracasViews);
    } finally {
      await applyViews(caracasViewsSql());
    }

    expect(await viewsGroupBy()).toEqual(["caracas", "caracas"]);
    expect(await dailySalesViewRows()).toEqual(caracasRows);
  });
});
