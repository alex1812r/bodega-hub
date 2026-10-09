/** @jest-environment node */
/**
 * REP-07a · regresión del parche `20261013b-report-inventory-views.sql`: las vistas `report_product_last_movement`,
 * `report_stock_daily_flow` y `report_stock_adjustments`, calculadas sobre el libro `stock_movements`.
 *
 * Los datos se preparan dentro de una transacción que termina en `rollback`: el escenario principal mueve el stock con
 * las RPC reales (compra recibida, ventas, anulación, devoluciones, ajustes, apertura de empaque) como usuarios lab;
 * cada lectura probada va con `set local role authenticated` + `request.jwt.claims` (ACL y RLS de PostgREST). El último
 * bloque lee por PostgREST con los servicios reales del BFF (`inventoryReports.server.ts`): confirma productos de
 * prueba marcados con `TAG` (el stock entra por movimientos, nadie escribe `current_stock`) y los borra al terminar.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/report-inventory-views.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import { createRouteSupabaseClient } from "../../../src/lib/supabase/route-client";
import {
  getDeadStockReport,
  getStockAdjustmentsReport,
  getStockTurnoverReport,
} from "../../../src/modules/reports/services/inventoryReports.server";
import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { INTEGRITY_VIEWS, Lab, actAs } from "../scenarios/db";

jest.mock("../../../src/lib/supabase/route-client", () => ({ createRouteSupabaseClient: jest.fn() }));

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string; ms: number };
type Role = LabRoleKey | "anon";

const TAG = `rep07a-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const PATCH = resolve(__dirname, "../../../supabase/patches/20261013b-report-inventory-views.sql");
const INSUFFICIENT_PRIVILEGE = "42501";
/** Vista con agregados: Postgres la rechaza por no actualizable antes de mirar privilegios. */
const NOT_UPDATABLE = "55000";
const INVENTORY_VIEWS = ["report_product_last_movement", "report_stock_daily_flow", "report_stock_adjustments"] as const;
const LAB_ROLES = ["admin", "contador", "vendedor1", "almacen"] as const;
const RATE = 50;
const BULK_PRODUCTS = 2000;
const BULK_MOVEMENTS_PER_PRODUCT = 10;
const BULK_BUDGET_MS = 3000;

const SALE_MOVEMENT = "(m.type in ('venta', 'devolucion_cliente') or (m.type = 'ajuste_entrada' and m.sale_id is not null))";

let lab: Lab;
let db: Client;
let seq = 0;
const timings: string[] = [];

function failure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown }).code;
  return { code: typeof code === "string" ? code : "?", message: error instanceof Error ? error.message : String(error) };
}

/** SQL de preparación / lectura como `postgres`. Si falla, el test no pudo montarse. */
async function sql(what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  try {
    return (await db.query<Row>(text, params)).rows;
  } catch (error) {
    const { code, message } = failure(error);
    throw new Error(`SETUP · ${what}: ${code} ${message}`);
  }
}

/** Ejecuta `text` en un savepoint como el usuario lab `role` (o `anon`); devuelve el error en vez de lanzarlo. */
async function run(role: Role, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint rep07a");
  const started = Date.now();
  try {
    await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    const ms = Date.now() - started;
    await db.query("reset role");
    await db.query("release savepoint rep07a");
    return { rows: res.rows, code: null, message: "", ms };
  } catch (error) {
    await db.query("rollback to savepoint rep07a");
    await db.query("reset role");
    return { rows: [], ...failure(error), ms: Date.now() - started };
  }
}

async function read(role: Role, text: string, params: unknown[] = []): Promise<Row[]> {
  const out = await run(role, text, params);
  if (out.code) throw new Error(`lectura como ${role}: ${out.code} ${out.message}`);
  return out.rows;
}

/** RPC real como un usuario lab: debe funcionar; si no, es un fallo de SETUP. */
async function rpc(role: LabRoleKey, what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  const out = await run(role, text, params);
  if (out.code) throw new Error(`SETUP · ${what} como ${role}: ${out.code} ${out.message}`);
  return out.rows;
}

function next(prefix: string) {
  seq += 1;
  return `${TAG}-${prefix}${String(seq).padStart(4, "0")}`;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

async function category(storeId: string = lab.storeId): Promise<{ id: string; name: string }> {
  const name = next("cat");
  const rows = await sql(`categoría ${name}`, "insert into public.categories (store_id, name) values ($1, $2) returning id", [
    storeId,
    name,
  ]);
  return { id: String(rows[0].id), name };
}

type ProductOptions = { active?: boolean; categoryId?: string | null; cost?: number; createdAt?: string; storeId?: string };

/** Producto con stock 0; el stock entra después por movimientos. `createdAt` es una expresión SQL. */
async function product(options: ProductOptions = {}): Promise<{ id: string; sku: string }> {
  const sku = next("p");
  const rows = await sql(
    `producto ${sku}`,
    `insert into public.products (store_id, category_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active, created_at)
     values ($1, $2, $3, $3, 20, $4, 0, 0, $5, ${options.createdAt ?? "now()"}) returning id`,
    [options.storeId ?? lab.storeId, options.categoryId ?? null, sku, options.cost ?? 2, options.active ?? true],
  );
  return { id: String(rows[0].id), sku };
}

type MoveOptions = { at?: string; purchaseId?: string; reason?: string | null; saleId?: string };

/** Movimiento del libro insertado como `postgres`: el trigger fija `seq`, `stock_after` y `current_stock`. */
async function move(productId: string, type: string, delta: number, options: MoveOptions = {}): Promise<string> {
  const rows = await sql(
    `movimiento ${type} ${delta}`,
    `insert into public.stock_movements (store_id, product_id, type, quantity_delta, sale_id, purchase_id, reason, created_at)
     select p.store_id, p.id, $2::public.stock_movement_type, $3, $4, $5, $6, ${options.at ?? "now()"}
     from public.products p where p.id = $1 returning id`,
    [productId, type, delta, options.saleId ?? null, options.purchaseId ?? null, options.reason === undefined ? TAG : options.reason],
  );
  return String(rows[0].id);
}

/** Venta suelta (sin RPC) con una línea por producto: para fechar ventas en el pasado. */
async function saleWithLines(
  lines: ReadonlyArray<{ cost: number; productId: string; quantity: number }>,
  options: { at?: string; storeId?: string; customerId?: string } = {},
): Promise<string> {
  const number = next("s");
  const rows = await sql(
    `venta ${number}`,
    `insert into public.sales (store_id, invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, status, created_at)
     values ($1, $2, $3, $4, 10, 10, 500, 500, 'pagada', ${options.at ?? "now()"}) returning id`,
    [options.storeId ?? lab.storeId, number, options.customerId ?? lab.customerId, RATE],
  );
  const saleId = String(rows[0].id);
  for (const line of lines) {
    await sql(
      "línea de venta",
      `insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, unit_cost_ref_snapshot, subtotal_ves)
       values ($1, $2, $3, 20, $4, 0)`,
      [saleId, line.productId, line.quantity, line.cost],
    );
  }
  return saleId;
}

const daysAgo = (days: number) => `now() - interval '${days} days'`;

async function today(): Promise<string> {
  return String((await sql("hoy Caracas", "select (now() at time zone 'America/Caracas')::date::text as day"))[0].day);
}

function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Lo que ve `role` de esos productos en las tres vistas, en un orden estable. */
async function snapshot(role: Role, productIds: readonly string[]): Promise<Row> {
  const products = await read(
    role,
    `select sku, stock, cost_ref::text, stock_value_ref::text, last_sale_at::text, last_movement_at::text, first_movement_at::text, idle_since::text
     from public.report_product_last_movement where product_id = any($1::uuid[]) order by sku`,
    [productIds],
  );
  const flow = await read(
    role,
    `select movement_date::text, product_id::text, net_delta, sold_units, cogs_ref::text
     from public.report_stock_daily_flow where product_id = any($1::uuid[]) order by movement_date, product_id`,
    [productIds],
  );
  const adjustments = await read(
    role,
    `select movement_id::text, seq::text, movement_date::text, movement_type, quantity_delta, reason, value_ref::text, cost_basis
     from public.report_stock_adjustments where product_id = any($1::uuid[]) order by seq`,
    [productIds],
  );
  return { adjustments, flow, products };
}

beforeAll(async () => {
  lab = await Lab.open("rep07a");
  db = await lab.pg();
});

afterAll(async () => {
  if (timings.length > 0) console.info(`REP-07a tiempos\n${timings.join("\n")}`);
  if (lab) await lab.close();
});

describe("20261013b · forma del esquema e idempotencia", () => {
  it("el parche se puede aplicar dos veces seguidas sin error", async () => {
    const patch = readFileSync(PATCH, "utf8");

    await expect(db.query(patch)).resolves.toBeDefined();
    await expect(db.query(patch)).resolves.toBeDefined();
  });

  it("las tres vistas son security_invoker, solo lectura para authenticated / service_role y sin acceso anon", async () => {
    const rows = await sql(
      "forma",
      `select c.relname::text as view, c.relkind::text as kind, c.reloptions::text[] as options,
              has_table_privilege('authenticated', c.oid, 'select') as authenticated_reads,
              has_table_privilege('service_role', c.oid, 'select') as service_reads,
              has_table_privilege('anon', c.oid, 'select') as anon_reads,
              has_table_privilege('authenticated', c.oid, 'insert, update, delete') as authenticated_writes
       from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relname = any($1::text[])
       order by c.relname`,
      [[...INVENTORY_VIEWS]],
    );

    expect(rows).toEqual(
      [...INVENTORY_VIEWS].sort().map((view) => ({
        view,
        kind: "v",
        options: ["security_invoker=true"],
        authenticated_reads: true,
        service_reads: true,
        anon_reads: false,
        authenticated_writes: false,
      })),
    );
  });

  it("columnas en orden; ninguna vista lee stock_after ni expone created_by", async () => {
    const columns = await sql(
      "columnas",
      `select table_name::text as view, string_agg(column_name::text, ',' order by ordinal_position) as columns
       from information_schema.columns
       where table_schema = 'public' and table_name = any($1::text[])
       group by table_name order by table_name`,
      [[...INVENTORY_VIEWS]],
    );
    const definitions = await sql(
      "definiciones",
      `select c.relname::text as view, pg_get_viewdef(c.oid) as definition
       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1::text[])`,
      [[...INVENTORY_VIEWS]],
    );

    expect(columns).toEqual([
      {
        view: "report_product_last_movement",
        columns:
          "store_id,product_id,sku,name,is_active,category_id,category_name,stock,cost_ref,stock_value_ref,last_sale_at,last_movement_at,first_movement_at,idle_since",
      },
      {
        view: "report_stock_adjustments",
        columns:
          "store_id,movement_id,seq,created_at,movement_date,product_id,sku,product_name,movement_type,quantity_delta,reason,unit_cost_ref,value_ref,cost_basis",
      },
      { view: "report_stock_daily_flow", columns: "store_id,movement_date,product_id,net_delta,sold_units,cogs_ref" },
    ]);
    for (const row of definitions) {
      expect([row.view, /stock_after|created_by/i.test(String(row.definition))]).toEqual([row.view, false]);
    }
  });
});

describe("20261013b · escenario con las RPC reales", () => {
  it("compra recibida, ventas, anulación, devoluciones, ajustes + / − y apertura de empaque: saldos, rotación y ajustes cuadran con el libro", async () => {
    await withRollback(db, async () => {
      const cat = await category();
      const a = await product({ categoryId: cat.id, cost: 2 });
      const b = await product({ categoryId: cat.id, cost: 3.5 });
      const pack = await product({ cost: 12 });
      const unit = await product({ cost: 1 });
      const ids = [a.id, b.id, pack.id, unit.id];
      await move(a.id, "inventario_inicial", 20);
      await move(b.id, "inventario_inicial", 10);
      await move(pack.id, "inventario_inicial", 4);
      const recipeId = randomUUID();
      await sql(
        "cabecera de receta",
        "insert into public.product_pack_conversions (id, store_id, pack_product_id, total_units, label, is_active) values ($1, $2, $3, 6, $4, true)",
        [recipeId, lab.storeId, pack.id, TAG],
      );
      await sql(
        "componente de receta",
        "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight) values ($1, $2, $3, 6, 1)",
        [recipeId, lab.storeId, unit.id],
      );

      const purchase = async (productId: string, quantity: number, cost: number) => {
        const subtotal = round2(quantity * cost);
        const rows = await rpc(
          "admin",
          "create_purchase",
          `select id from public.create_purchase(
             p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0,
             p_tax_ref => 0, p_notes => $4, p_status => 'recibido'::public.purchase_status, p_discount_ves => 0,
             p_tax_ves => 0, p_subtotal_ves => $5::numeric, p_subtotal_ref => $6::numeric, p_client_request_id => null)`,
          [
            lab.supplierId,
            JSON.stringify([
              {
                product_id: productId,
                cost_currency: "ref",
                unit_cost_ref: cost,
                unit_cost_ves: round2(cost * RATE),
                subtotal_ref: subtotal,
                subtotal_ves: round2(subtotal * RATE),
                tax_rate: 0,
                tax_ref: 0,
                tax_ves: 0,
                quantity,
              },
            ]),
            RATE,
            TAG,
            round2(subtotal * RATE),
            subtotal,
          ],
        );
        return String(rows[0].id);
      };
      const sale = async (lines: Array<[productId: string, quantity: number]>) => {
        const rows = await rpc(
          "vendedor1",
          "create_sale",
          `select id from public.create_sale(p_customer_id => $1::uuid, p_items => $2::jsonb, p_exchange_rate_id => null,
             p_ref_rate_ves => $3::numeric, p_invoice_number => $4)`,
          [
            lab.customerId,
            JSON.stringify(lines.map(([productId, quantity]) => ({ product_id: productId, quantity, unit_price_ref: 20 }))),
            RATE,
            next("v"),
          ],
        );
        return String(rows[0].id);
      };
      const adjust = (role: LabRoleKey, productId: string, delta: number, reason: string, type: string | null, saleId: string | null = null) =>
        rpc(
          role,
          `adjust_stock ${delta}`,
          "select id from public.adjust_stock($1::uuid, $2::integer, $3, $4::public.stock_movement_type, null, $5::uuid)",
          [productId, delta, reason, type, saleId],
        );

      // A: 20 + 10 (compra) − 5 − 3 + 3 (anulada) − 4 + 1 (devolución parcial) + 2 − 3 (ajustes) + 1 (compra) = 22.
      await purchase(a.id, 10, 3);
      await sale([
        [a.id, 5],
        [b.id, 2],
      ]);
      const cancelled = await sale([[a.id, 3]]);
      await rpc("vendedor1", "cancel_sale", "select id from public.cancel_sale($1::uuid)", [cancelled]);
      const partial = await sale([[a.id, 4]]);
      await adjust("admin", a.id, 1, `${TAG} devolución parcial`, "devolucion_cliente", partial);
      // B: 10 − 2 − 1 + 1 (devuelta entera) − 1 − 1 (ajustes) + 5 − 5 (compra anulada) = 6.
      const returned = await sale([[b.id, 1]]);
      await rpc("vendedor1", "return_sale", "select id from public.return_sale($1::uuid)", [returned]);
      await adjust("almacen", a.id, 2, "  Conteo   físico ", null);
      await adjust("almacen", a.id, -3, "Merma", null);
      await move(b.id, "ajuste_salida", -1, { reason: null });
      await move(b.id, "ajuste_salida", -1, { reason: "   " });
      await rpc("almacen", "convert_pack_to_units", "select public.convert_pack_to_units($1::uuid, 2, $2, null, null) as result", [pack.id, TAG]);
      // Cambia el costo vigente de A después de vender: el costo de lo vendido debe seguir siendo el de la línea.
      await purchase(a.id, 1, 9);
      const undone = await purchase(b.id, 5, 3.5);
      await rpc("admin", "cancel_purchase", "select id from public.cancel_purchase($1::uuid)", [undone]);

      // (a) El saldo del reporte es el del libro, el de Inventario y no deja descuadres.
      const balances = await read(
        "admin",
        `select r.sku, r.stock, r.cost_ref::float8 as cost, r.stock_value_ref::float8 as value,
                (select sum(m.quantity_delta)::int from public.stock_movements m where m.product_id = r.product_id) as ledger,
                (select o.current_stock from public.inventory_overview o where o.id = r.product_id) as overview,
                r.last_sale_at is not null as sold,
                r.last_movement_at = (select m.created_at from public.stock_movements m where m.product_id = r.product_id order by m.seq desc limit 1) as last_ok
         from public.report_product_last_movement r where r.product_id = any($1::uuid[]) order by r.sku`,
        [ids],
      );
      const expectedStock: Record<string, number> = { [a.sku]: 22, [b.sku]: 6, [pack.sku]: 2, [unit.sku]: 12 };

      expect(balances.map((row) => [row.sku, row.stock, row.ledger, row.overview])).toEqual(
        [a, b, pack, unit].map(({ sku }) => [sku, expectedStock[sku], expectedStock[sku], expectedStock[sku]]),
      );
      expect(balances.map((row) => [row.sku, row.sold, row.last_ok])).toEqual([
        [a.sku, true, true],
        [b.sku, true, true],
        [pack.sku, false, true],
        [unit.sku, false, true],
      ]);
      for (const row of balances) {
        expect([row.sku, row.value]).toEqual([row.sku, round2(Number(row.stock) * Number(row.cost))]);
      }
      for (const view of INTEGRITY_VIEWS) {
        const filter =
          view === "conversion_mismatches"
            ? "pack_product_id = any($1::uuid[]) or unit_product_id = any($1::uuid[])"
            : "product_id = any($1::uuid[])";
        const broken = await sql(`reconcile ${view}`, `select count(*)::int as rows from public.${view} where ${filter}`, [ids]);
        expect([view, broken[0].rows]).toEqual([view, 0]);
      }

      // (b) Rotación: unidades vendidas netas y costo de lo vendido, contra sumas hechas a mano sobre el libro.
      const flow = await read(
        "admin",
        `select product_id::text as id, sum(net_delta)::int as net, sum(sold_units)::int as sold, sum(cogs_ref)::float8 as cogs
         from public.report_stock_daily_flow where product_id = any($1::uuid[]) group by product_id`,
        [ids],
      );
      const byHand = await sql(
        "libro a mano",
        `select m.product_id::text as id, m.quantity_delta as delta, ${SALE_MOVEMENT} as is_sale,
                (select i.unit_cost_ref_snapshot::float8 from public.sale_items i where i.sale_id = m.sale_id and i.product_id = m.product_id limit 1) as line_cost
         from public.stock_movements m where m.product_id = any($1::uuid[])`,
        [ids],
      );
      const hand = (id: string) => {
        const moves = byHand.filter((row) => row.id === id);
        const sales = moves.filter((row) => row.is_sale === true);
        return {
          cogs: round2(sales.reduce((sum, row) => sum + round2(-Number(row.delta) * Number(row.line_cost)), 0)),
          id,
          net: moves.reduce((sum, row) => sum + Number(row.delta), 0),
          sold: sales.reduce((sum, row) => sum - Number(row.delta), 0),
        };
      };
      const seen = (id: string) => {
        const row = flow.find((candidate) => candidate.id === id);
        return { cogs: round2(Number(row?.cogs)), id, net: row?.net, sold: row?.sold };
      };

      for (const id of ids) expect(seen(id)).toEqual(hand(id));
      expect([seen(a.id).sold, seen(b.id).sold, seen(pack.id).sold, seen(unit.id).sold]).toEqual([8, 2, 0, 0]);
      // Las 8 unidades netas de A se vendieron con el costo de entonces, no con el vigente (9 tras la última compra).
      const costs = await sql("costos", "select current_cost_ref::float8 as cost from public.products where id = $1", [a.id]);
      expect(seen(a.id).cogs).not.toBe(round2(8 * Number(costs[0].cost)));
      expect(seen(a.id).cogs).toBeGreaterThan(0);

      // (b) Ajustes: solo los manuales, con motivo normalizado y valor al costo vigente.
      const adjustments = await read(
        "admin",
        `select sku, movement_type, quantity_delta, reason, unit_cost_ref::float8 as cost, value_ref::float8 as value, cost_basis,
                movement_date = (now() at time zone 'America/Caracas')::date as today
         from public.report_stock_adjustments where product_id = any($1::uuid[]) order by seq`,
        [ids],
      );
      const costOf = Object.fromEntries(balances.map((row) => [row.sku, Number(row.cost)]));
      const expectedAdjustment = (sku: string, type: string, delta: number, reason: string) => ({
        sku,
        movement_type: type,
        quantity_delta: delta,
        reason,
        cost: costOf[sku],
        value: round2(delta * costOf[sku]),
        cost_basis: "current_cost",
        today: true,
      });

      expect(adjustments).toEqual([
        expectedAdjustment(a.sku, "ajuste_entrada", 2, "Conteo físico"),
        expectedAdjustment(a.sku, "ajuste_salida", -3, "Merma"),
        expectedAdjustment(b.sku, "ajuste_salida", -1, "Sin motivo"),
        expectedAdjustment(b.sku, "ajuste_salida", -1, "Sin motivo"),
      ]);
      // Lo que NO es ajuste sí está en el libro: reversión de venta, compra anulada y apertura de empaque.
      const others = await sql(
        "otros movimientos",
        `select
           count(*) filter (where type = 'ajuste_entrada' and sale_id is not null)::int as sale_reversals,
           count(*) filter (where type = 'ajuste_salida' and purchase_id is not null)::int as purchase_reversals,
           count(*) filter (where type in ('conversion_salida', 'conversion_entrada'))::int as conversions
         from public.stock_movements where product_id = any($1::uuid[])`,
        [ids],
      );
      expect(Number(others[0].sale_reversals)).toBeGreaterThan(0);
      expect(others[0].purchase_reversals).toBe(1);
      expect(others[0].conversions).toBe(2);
    });
  });
});

describe("20261013b · fechas del libro y día operativo de Caracas", () => {
  it("idle_since: última venta por seq; sin ventas, primer movimiento; sin movimientos, alta del producto", async () => {
    await withRollback(db, async () => {
      const sold = await product();
      const never = await product();
      const empty = await product({ createdAt: "timestamptz '2020-01-10 15:00:00+00'" });
      // 1-mar-2020 23:30 en Caracas = 2-mar-2020 03:30 UTC.
      await move(sold.id, "inventario_inicial", 30, { at: "timestamptz '2020-02-01 15:00:00+00'" });
      await move(sold.id, "venta", -1, { at: "timestamptz '2020-03-10 15:00:00+00'" });
      // Fechada antes pero registrada después: es la última venta del libro (manda seq, no created_at).
      await move(sold.id, "venta", -1, { at: "timestamptz '2020-03-02 03:30:00+00'" });
      await move(sold.id, "ajuste_entrada", 5, { at: "timestamptz '2020-04-01 15:00:00+00'" });
      await move(never.id, "inventario_inicial", 8, { at: "timestamptz '2020-05-05 02:00:00+00'" });
      await move(never.id, "ajuste_salida", -2, { at: "timestamptz '2020-06-01 15:00:00+00'" });

      const rows = await read(
        "admin",
        `select sku, stock, idle_since::text as idle, last_sale_at is null as never_sold,
                (last_movement_at at time zone 'America/Caracas')::date::text as last_day,
                (first_movement_at at time zone 'America/Caracas')::date::text as first_day
         from public.report_product_last_movement where product_id = any($1::uuid[]) order by sku`,
        [[sold.id, never.id, empty.id]],
      );

      expect(rows).toEqual([
        { sku: sold.sku, stock: 33, idle: "2020-03-01", never_sold: false, last_day: "2020-04-01", first_day: "2020-02-01" },
        { sku: never.sku, stock: 6, idle: "2020-05-04", never_sold: true, last_day: "2020-06-01", first_day: "2020-05-04" },
        { sku: empty.sku, stock: 0, idle: "2020-01-10", never_sold: true, last_day: null, first_day: null },
      ]);
    });
  });

  it("flujo diario: cada movimiento cae en su día Caracas; el costo sale de la línea de venta (promedio ponderado) o del costo vigente", async () => {
    await withRollback(db, async () => {
      const item = await product({ cost: 4 });
      const late = "timestamptz '2020-03-02 03:30:00+00'";
      const early = "timestamptz '2020-03-02 04:10:00+00'";
      // Dos líneas del mismo producto en la venta: 2 × 1,00 + 6 × 3,00 → 2,50 por unidad.
      const twoLines = await saleWithLines(
        [
          { cost: 1, productId: item.id, quantity: 2 },
          { cost: 3, productId: item.id, quantity: 6 },
        ],
        { at: late },
      );
      await move(item.id, "inventario_inicial", 50, { at: "timestamptz '2020-02-01 15:00:00+00'" });
      await move(item.id, "venta", -2, { at: late, saleId: twoLines });
      await move(item.id, "venta", -6, { at: late, saleId: twoLines });
      await move(item.id, "devolucion_cliente", 1, { at: early, saleId: twoLines });
      // Venta sin documento (venta borrada): vale el costo vigente.
      await move(item.id, "venta", -3, { at: early });
      await move(item.id, "ajuste_salida", -4, { at: early, reason: "Merma" });

      const rows = await read(
        "contador",
        `select movement_date::text as day, net_delta as net, sold_units as sold, cogs_ref::float8 as cogs
         from public.report_stock_daily_flow where product_id = $1 order by movement_date`,
        [item.id],
      );

      expect(rows).toEqual([
        { day: "2020-02-01", net: 50, sold: 0, cogs: 0 },
        { day: "2020-03-01", net: -8, sold: 8, cogs: 20 },
        { day: "2020-03-02", net: -6, sold: 2, cogs: 9.5 },
      ]);
    });
  });
});

describe("20261013b · stock_after no interviene", () => {
  it("con stock_after en NULL en parte del libro las tres vistas responden lo mismo", async () => {
    await withRollback(db, async () => {
      const first = await product({ cost: 2.5 });
      const second = await product({ cost: 7 });
      const sale = await saleWithLines([{ cost: 2, productId: first.id, quantity: 5 }], { at: daysAgo(3) });
      await move(first.id, "inventario_inicial", 40, { at: daysAgo(20) });
      await move(first.id, "venta", -5, { at: daysAgo(3), saleId: sale });
      await move(first.id, "ajuste_salida", -2, { at: daysAgo(2), reason: "Vencido" });
      await move(first.id, "ajuste_entrada", 1, { at: daysAgo(1), reason: "Conteo" });
      await move(second.id, "inventario_inicial", 9, { at: daysAgo(15) });
      await move(second.id, "ajuste_salida", -9, { at: daysAgo(1), reason: "Vencido" });
      const ids = [first.id, second.id];

      const before = await snapshot("admin", ids);
      await sql("stock_after anulable", "alter table public.stock_movements alter column stock_after drop not null");
      const nulled = await sql(
        "stock_after a NULL",
        `update public.stock_movements set stock_after = null
         where product_id = any($1::uuid[]) and type <> 'inventario_inicial' returning id`,
        [ids],
      );
      const after = await snapshot("admin", ids);

      expect(nulled).toHaveLength(4);
      expect((before.products as Row[]).map((row) => row.stock)).toEqual([34, 0]);
      expect((before.adjustments as Row[]).length).toBe(3);
      expect(after).toEqual(before);
    });
  });
});

describe("20261013b · aislamiento por tienda y permisos", () => {
  it("un usuario de la tienda lab no ve en ninguna vista las filas de otra tienda; en la suya ve lo mismo que ya lee del libro", async () => {
    await withRollback(db, async () => {
      const foreignStore = lab.defaultStoreId;
      const foreignCategory = await category(foreignStore);
      const foreign = await product({ categoryId: foreignCategory.id, storeId: foreignStore });
      const foreignCustomer = String(
        (await sql("cliente ajeno", "insert into public.contacts (store_id, name, type) values ($1, $2, 'cliente') returning id", [foreignStore, next("c")]))[0]
          .id,
      );
      const foreignSale = await saleWithLines([{ cost: 2, productId: foreign.id, quantity: 1 }], {
        customerId: foreignCustomer,
        storeId: foreignStore,
      });
      await move(foreign.id, "inventario_inicial", 10);
      await move(foreign.id, "venta", -1, { saleId: foreignSale });
      await move(foreign.id, "ajuste_salida", -1, { reason: "Merma" });
      const own = await product();
      await move(own.id, "inventario_inicial", 10);
      await move(own.id, "ajuste_salida", -1, { reason: "Merma" });

      for (const view of INVENTORY_VIEWS) {
        const asPostgres = await sql(`${view} como postgres`, `select count(*)::int as rows from public.${view} where store_id = $1`, [
          foreignStore,
        ]);
        expect([view, Number(asPostgres[0].rows) > 0]).toEqual([view, true]);

        for (const role of LAB_ROLES) {
          const other = await read(role, `select count(*)::int as rows from public.${view} where store_id <> $1`, [lab.storeId]);
          const mine = await read(role, `select count(*)::int as rows from public.${view} where product_id = $1`, [own.id]);
          const ledger = await read(role, "select count(*)::int as rows from public.stock_movements where product_id = $1", [own.id]);

          expect([view, role, other[0].rows]).toEqual([view, role, 0]);
          // Las vistas no amplían quién lee el libro: ve filas quien ya lee stock_movements de su tienda.
          expect([view, role, Number(mine[0].rows) > 0]).toEqual([view, role, Number(ledger[0].rows) > 0]);
        }
      }
    });
  });

  it("anon no lee ninguna vista y nadie puede escribir en ellas", async () => {
    await withRollback(db, async () => {
      for (const view of INVENTORY_VIEWS) {
        expect([view, (await run("anon", `select 1 from public.${view} limit 1`)).code]).toEqual([view, INSUFFICIENT_PRIVILEGE]);
        const write = await run("admin", `delete from public.${view}`);
        expect([view, [INSUFFICIENT_PRIVILEGE, NOT_UPDATABLE].includes(write.code ?? "")]).toEqual([view, true]);
      }
    });
  });

  it("las vistas no escriben: el libro y los saldos quedan igual tras leerlas", async () => {
    await withRollback(db, async () => {
      const fingerprint = () =>
        sql(
          "huella",
          `select (select count(*)::text || ':' || coalesce(max(seq), 0)::text from public.stock_movements) as ledger,
                  (select coalesce(sum(current_stock), 0)::text from public.products) as stock`,
        );
      const before = await fingerprint();
      for (const view of INVENTORY_VIEWS) await read("admin", `select count(*) from public.${view}`);

      expect(await fingerprint()).toEqual(before);
    });
  });
});

describe("20261013b · rendimiento", () => {
  it("volumen de la semilla del lab: las tres vistas completas de la tienda", async () => {
    await withRollback(db, async () => {
      for (const view of INVENTORY_VIEWS) {
        const out = await run("admin", `select * from public.${view} where store_id = $1`, [lab.storeId]);
        timings.push(`  semilla · ${view}: ${out.rows.length} filas en ${out.ms} ms`);
        expect([view, out.code]).toEqual([view, null]);
        expect(out.ms).toBeLessThan(BULK_BUDGET_MS);
      }
    });
  });

  it(`${BULK_PRODUCTS} productos × ${BULK_MOVEMENTS_PER_PRODUCT} movimientos: cada vista completa dentro del presupuesto`, async () => {
    await withRollback(db, async () => {
      const started = Date.now();
      await sql(
        "productos en bloque",
        `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
         select $1, $2 || '-bulk-' || g, $2 || '-bulk-' || g, 10, 1.5, 0, 0 from generate_series(1, $3::int) g`,
        [lab.storeId, TAG, BULK_PRODUCTS],
      );
      // Por producto: inventario inicial, 6 ventas, 2 ajustes y una reversión de venta, repartidos en 60 días.
      await sql(
        "movimientos en bloque",
        `insert into public.stock_movements (store_id, product_id, type, quantity_delta, reason, created_at)
         select p.store_id, p.id,
                (case when n = 1 then 'inventario_inicial' when n in (5, 9) then 'ajuste_salida' when n = 10 then 'devolucion_cliente' else 'venta' end)::public.stock_movement_type,
                case when n = 1 then 100 when n = 10 then 1 else -1 end,
                case when n in (5, 9) then 'Merma ' || (n % 3) else $2 end,
                now() - make_interval(days => 60 - n * 6)
         from public.products p cross join generate_series(1, $3::int) n
         where p.store_id = $1 and p.sku like $2 || '-bulk-%'
         order by p.id, n`,
        [lab.storeId, TAG, BULK_MOVEMENTS_PER_PRODUCT],
      );
      await sql("estadísticas", "analyze public.stock_movements");
      await sql("estadísticas", "analyze public.products");
      timings.push(`  bloque · preparación: ${Date.now() - started} ms`);

      for (const view of INVENTORY_VIEWS) {
        const out = await run("admin", `select * from public.${view} where store_id = $1`, [lab.storeId]);
        timings.push(`  bloque · ${view}: ${out.rows.length} filas en ${out.ms} ms`);
        expect([view, out.code]).toEqual([view, null]);
        expect(out.rows.length).toBeGreaterThanOrEqual(BULK_PRODUCTS);
        expect(out.ms).toBeLessThan(BULK_BUDGET_MS);
      }
      const page = await run(
        "admin",
        `select product_id from public.report_product_last_movement
         where store_id = $1 and is_active and stock > 0 and idle_since <= (now() at time zone 'America/Caracas')::date - 5
         order by stock_value_ref desc, product_id limit 50`,
        [lab.storeId],
      );
      timings.push(`  bloque · página de 50 sin movimiento: ${page.ms} ms`);
      expect(page.ms).toBeLessThan(BULK_BUDGET_MS);
    });
  });
});

describe("20261013b · lectura por PostgREST con los servicios del BFF", () => {
  const useRole = async (role: LabRoleKey) => {
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(await lab.supa(role));
  };
  const cleanup = async () => {
    await db.query("delete from public.stock_movements where product_id in (select id from public.products where sku like $1)", [`${TAG}%`]);
    await db.query("delete from public.sales where invoice_number like $1", [`${TAG}%`]);
    await db.query("delete from public.products where sku like $1", [`${TAG}%`]);
    await db.query("delete from public.categories where name like $1", [`${TAG}%`]);
  };

  afterAll(async () => {
    if (db) await cleanup().catch(() => undefined);
  });

  it("los tres servicios cuadran con el libro confirmado: sin movimiento, rotación (saldo de apertura y cierre) y ajustes", async () => {
    const cat = await category();
    // X: 50 − 10 (hace 40 d, costo 2) − 5 merma (hace 20 d) − 4 (hace 10 d, costo 2,50) + 1 devuelta (hace 9 d) = 32.
    const x = await product({ categoryId: cat.id, cost: 3 });
    // Y: 30 desde hace 90 días, nunca vendido. Z: 10, vendido entero hace 5 días.
    const y = await product({ categoryId: cat.id, cost: 1.25 });
    const z = await product({ categoryId: cat.id, cost: 6 });
    const merma = `${TAG}   merma  `;
    const firstSale = await saleWithLines([{ cost: 2, productId: x.id, quantity: 10 }], { at: daysAgo(40) });
    const secondSale = await saleWithLines([{ cost: 2.5, productId: x.id, quantity: 4 }], { at: daysAgo(10) });
    const lastSale = await saleWithLines([{ cost: 6, productId: z.id, quantity: 10 }], { at: daysAgo(5) });
    await move(x.id, "inventario_inicial", 50, { at: daysAgo(100) });
    await move(x.id, "venta", -10, { at: daysAgo(40), saleId: firstSale });
    const mermaId = await move(x.id, "ajuste_salida", -5, { at: daysAgo(20), reason: merma });
    await move(x.id, "venta", -4, { at: daysAgo(10), saleId: secondSale });
    await move(x.id, "devolucion_cliente", 1, { at: daysAgo(9), saleId: secondSale });
    await move(y.id, "inventario_inicial", 30, { at: daysAgo(90) });
    await move(z.id, "inventario_inicial", 10, { at: daysAgo(60) });
    await move(z.id, "venta", -10, { at: daysAgo(5), saleId: lastSale });
    const day = await today();
    await useRole("admin");

    // 1. Sin movimiento en 30 días, dentro de la categoría: solo Y (X se vendió hace 10 días; Z no tiene stock).
    const dead = await getDeadStockReport({ categoryId: cat.id, days: 30, limit: 10, skip: 0 }, lab.storeId);
    expect(dead.asOf).toBe(day);
    expect(dead.items).toEqual([
      {
        category: { id: cat.id, name: cat.name },
        costRef: 1.25,
        daysIdle: 90,
        daysSinceLastMovement: 90,
        idleSince: shiftDay(day, -90),
        lastMovementAt: expect.any(String),
        lastSaleAt: null,
        product: { href: `/products/${y.id}`, id: y.id, name: y.sku, sku: y.sku },
        stock: 30,
        stockValueRef: 37.5,
      },
    ]);
    // Inventario de la categoría: X 32 × 3 = 96 + Y 37,50 = 133,50.
    expect(dead.summary).toEqual({ idleValuePct: 28.09, idleValueRef: 37.5, inventoryValueRef: 133.5, productsCount: 1 });
    expect([dead.total, dead.days]).toEqual([1, 30]);
    const recent = await getDeadStockReport({ categoryId: cat.id, days: 5, limit: 10, skip: 0 }, lab.storeId);
    expect(recent.items.map((row) => [row.product.id, row.daysIdle, row.stockValueRef])).toEqual([
      [x.id, 10, 96],
      [y.id, 90, 37.5],
    ]);
    // Toda la tienda: el conteo y los valores son los de una suma hecha a mano.
    const store = await getDeadStockReport({ days: 30, limit: 100, skip: 0 }, lab.storeId);
    const storeByHand = await sql(
      "sin movimiento a mano",
      `with last_sale as (
         select product_id, max(seq) as seq from public.stock_movements where type = 'venta' group by product_id
       ), first_move as (
         select product_id, min(seq) as seq from public.stock_movements group by product_id
       ), inventory as (
         select p.id, round(p.current_stock * p.current_cost_ref, 2) as value,
                (coalesce(
                   (select m.created_at from public.stock_movements m join last_sale l on l.seq = m.seq where l.product_id = p.id),
                   (select m.created_at from public.stock_movements m join first_move f on f.seq = m.seq where f.product_id = p.id),
                   p.created_at) at time zone 'America/Caracas')::date as idle_since
         from public.products p where p.store_id = $1 and p.is_active and p.current_stock > 0
       )
       select count(*) filter (where idle_since <= $2::date - 30)::int as idle_count,
              coalesce(sum(value) filter (where idle_since <= $2::date - 30), 0)::float8 as idle_value,
              coalesce(sum(value), 0)::float8 as inventory_value
       from inventory`,
      [lab.storeId, day],
    );
    expect([store.summary.productsCount, store.summary.idleValueRef, store.summary.inventoryValueRef]).toEqual([
      storeByHand[0].idle_count,
      round2(Number(storeByHand[0].idle_value)),
      round2(Number(storeByHand[0].inventory_value)),
    ]);
    expect(store.total).toBe(storeByHand[0].idle_count);

    // 2. Rotación entre hace 45 y hace 8 días.
    const range = { from: shiftDay(day, -45), to: shiftDay(day, -8) };
    const byProduct = await getStockTurnoverReport({ ...range, groupBy: "product", limit: 5000, skip: 0 }, lab.storeId);
    const rowOf = (id: string) => byProduct.items.find((row) => row.key === id);
    expect(byProduct.rangeDays).toBe(38);
    // X: vendió 10 + 4 − 1 = 13; costo 10 × 2 + 4 × 2,50 − 1 × 2,50 = 27,50; abrió con 50 y cerró con 32 → promedio 41 × 3 = 123.
    expect(rowOf(x.id)).toEqual({
      averageStockValueRef: 123,
      category: { id: cat.id, name: cat.name },
      closingStock: 32,
      cogsRef: 27.5,
      daysOfInventory: 169.96,
      key: x.id,
      openingStock: 50,
      product: { href: `/products/${x.id}`, id: x.id, name: x.sku, sku: x.sku },
      productsCount: 1,
      soldUnits: 13,
      stock: 32,
      stockValueRef: 96,
      turnover: 0.22,
    });
    // Z se vendió DESPUÉS del rango: al cierre del rango aún tenía 10; hoy 0.
    expect(rowOf(z.id)).toEqual(
      expect.objectContaining({ averageStockValueRef: 60, closingStock: 10, cogsRef: 0, daysOfInventory: null, openingStock: 10, soldUnits: 0, stock: 0, turnover: 0 }),
    );
    expect(rowOf(y.id)).toEqual(expect.objectContaining({ closingStock: 30, daysOfInventory: null, openingStock: 30, turnover: 0 }));
    const byCategory = await getStockTurnoverReport({ ...range, groupBy: "category", limit: 5000, skip: 0 }, lab.storeId);
    expect(byCategory.items.find((row) => row.key === cat.id)).toEqual({
      averageStockValueRef: 220.5,
      category: { id: cat.id, name: cat.name },
      closingStock: 72,
      cogsRef: 27.5,
      daysOfInventory: 304.69,
      key: cat.id,
      openingStock: 90,
      product: null,
      productsCount: 3,
      soldUnits: 13,
      stock: 62,
      stockValueRef: 133.5,
      turnover: 0.12,
    });
    expect(byCategory.totals).toEqual(byProduct.totals);
    const turnoverByHand = await sql(
      "vendido a mano",
      `select coalesce(-sum(m.quantity_delta), 0)::int as sold from public.stock_movements m
       where m.store_id = $1 and ${SALE_MOVEMENT}
         and (m.created_at at time zone 'America/Caracas')::date between $2::date and $3::date`,
      [lab.storeId, range.from, range.to],
    );
    expect(byProduct.totals.soldUnits).toBe(turnoverByHand[0].sold);

    // 3. Ajustes de los últimos 30 días.
    const adjustmentsRange = { from: shiftDay(day, -30), to: day };
    const adjustments = await getStockAdjustmentsReport({ ...adjustmentsRange, groupBy: "week", limit: 5000, skip: 0 }, lab.storeId);
    const reason = `${TAG} merma`;
    const mermaMeasures = { movementsCount: 1, netUnits: -5, netValueRef: -15, unitsIn: 0, unitsOut: 5, valueInRef: 0, valueOutRef: 15 };
    expect(adjustments.byReason.find((row) => row.reason === reason)).toEqual({ ...mermaMeasures, reason });
    expect(adjustments.items.find((row) => row.movementId === mermaId)).toEqual({
      createdAt: expect.any(String),
      date: shiftDay(day, -20),
      movementId: mermaId,
      product: { href: `/products/${x.id}`, id: x.id, name: x.sku, sku: x.sku },
      quantityDelta: -5,
      reason,
      type: "ajuste_salida",
      unitCostRef: 3,
      valueRef: -15,
    });
    expect([adjustments.costBasis, adjustments.groupBy, adjustments.range]).toEqual(["current_cost", "week", adjustmentsRange]);
    const adjustmentsByHand = await sql(
      "ajustes a mano",
      `select count(*)::int as movements, coalesce(sum(m.quantity_delta), 0)::int as net,
              coalesce(sum(round(m.quantity_delta * p.current_cost_ref, 2)), 0)::float8 as value
       from public.stock_movements m join public.products p on p.id = m.product_id
       where m.store_id = $1 and m.type in ('ajuste_entrada', 'ajuste_salida') and m.sale_id is null and m.purchase_id is null
         and (m.created_at at time zone 'America/Caracas')::date between $2::date and $3::date`,
      [lab.storeId, adjustmentsRange.from, adjustmentsRange.to],
    );
    expect([adjustments.totals.movementsCount, adjustments.totals.netUnits, adjustments.totals.netValueRef, adjustments.total]).toEqual([
      adjustmentsByHand[0].movements,
      adjustmentsByHand[0].net,
      round2(Number(adjustmentsByHand[0].value)),
      adjustmentsByHand[0].movements,
    ]);
    // La serie cubre el rango sin huecos y suma lo mismo que los totales.
    expect(adjustments.series[0].from).toBe(adjustmentsRange.from);
    expect(adjustments.series.at(-1)?.to).toBe(adjustmentsRange.to);
    expect(adjustments.series.reduce((sum, bucket) => sum + bucket.netUnits, 0)).toBe(adjustments.totals.netUnits);
    expect(round2(adjustments.series.reduce((sum, bucket) => sum + bucket.netValueRef, 0))).toBe(adjustments.totals.netValueRef);

    // El saldo de los productos confirmados coincide con el libro y no deja descuadres.
    const reconciliation = await sql(
      "reconcile",
      "select count(*)::int as rows from public.stock_reconciliation where product_id = any($1::uuid[])",
      [[x.id, y.id, z.id]],
    );
    expect(reconciliation[0].rows).toBe(0);

    const timed = async (label: string, call: () => Promise<unknown>) => {
      const started = Date.now();
      await call();
      timings.push(`  PostgREST · ${label}: ${Date.now() - started} ms`);
    };
    await timed("dead-stock", () => getDeadStockReport({ days: 30, limit: 10, skip: 0 }, lab.storeId));
    await timed("stock-turnover", () => getStockTurnoverReport({ ...range, groupBy: "product", limit: 10, skip: 0 }, lab.storeId));
    await timed("stock-adjustments", () => getStockAdjustmentsReport({ ...adjustmentsRange, groupBy: null, limit: 10, skip: 0 }, lab.storeId));
  });

  it("otro rol de la tienda lee lo mismo; una categoría que no es uuid responde vacío sin consultar", async () => {
    await useRole("contador");
    const day = await today();
    const asContador = await getDeadStockReport({ days: 30, limit: 100, skip: 0 }, lab.storeId);
    await useRole("admin");
    const asAdmin = await getDeadStockReport({ days: 30, limit: 100, skip: 0 }, lab.storeId);
    const invalid = await getDeadStockReport({ categoryId: "no-es-uuid", days: 30, limit: 10, skip: 0 }, lab.storeId);

    expect(asContador).toEqual(asAdmin);
    expect(invalid).toEqual({
      asOf: day,
      days: 30,
      items: [],
      limit: 10,
      skip: 0,
      summary: { idleValuePct: null, idleValueRef: 0, inventoryValueRef: 0, productsCount: 0 },
      total: 0,
    });
  });
});
