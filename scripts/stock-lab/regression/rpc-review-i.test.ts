/** @jest-environment node */
/**
 * STK-625 · regresión del parche `20261006i-reject-non-finite-numeric-columns.sql` (hallazgo M1 de
 * `.notes/stock-integrity-gtm/qa/pass-2/23-rpc-review.txt`, residuo de N4):
 *
 *   M1   el parche h rechaza NaN / Infinity en los PARÁMETROS de las RPC, pero un admin / almacén de la tienda
 *        dejaba `'NaN'` directamente en una columna numeric por PostgREST (`PATCH /rest/v1/products
 *        {sale_price_ref:'NaN'}`: el check `>= 0` lo acepta porque NaN compara mayor que todo). `create_sale`
 *        tomaba ese precio de lista y sacaba totales NaN; `current_cost_ref` NaN contaminaba costos y
 *        `exchange_rates.rate_ves` NaN bloqueaba todas las ventas de la tienda.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en
 * `rollback`: los datos se preparan como `postgres` y cada sentencia probada se ejecuta con
 * `set local role authenticated` + `request.jwt.claims` del usuario (la ACL y la RLS son las de PostgREST).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/rpc-review-i.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `R625-${NONCE}`;
const TRIGGERS = ["trg_zz_reject_non_finite_numeric_ins", "trg_zz_reject_non_finite_numeric_upd"];

/** Texto exacto que ve el usuario (el mismo de `assert_finite_numeric`, con el nombre de la columna). */
const notFinite = (column: string): string => `Valor numerico invalido en ${column}: debe ser un numero finito`;

/** Las 22 tablas de `public` con columnas numeric (las 21 del barrido de STK-625 + `tax_rates`, 20261007a). */
const NUMERIC_TABLES = [
  "app_settings",
  "cash_movements",
  "cash_sessions",
  "categories",
  "exchange_rates",
  "payments",
  "payroll_commission_sales",
  "payroll_employees",
  "payroll_items",
  "payroll_periods",
  "payroll_settings",
  "product_price_history",
  "products",
  "purchase_items",
  "purchases",
  "sale_items",
  "sales",
  "store_vaults",
  "supplier_product_price_history",
  "supplier_products",
  "tax_rates",
  "vault_movements",
];

let lab: Lab;
let db: Client;
let rateVes = 0;
let seq = 0;

function nextTag(name: string): string {
  seq += 1;
  return `${TAG}-${name}-${seq}`;
}

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

async function one(what: string, text: string, params: unknown[] = []): Promise<Row> {
  const rows = await sql(what, text, params);
  if (!rows[0]) throw new Error(`SETUP · ${what}: sin filas`);
  return rows[0];
}

/**
 * Ejecuta `text` dentro de un savepoint, como el usuario lab `role` (rol `authenticated` + claims) o, con
 * `null`, como `postgres`. Devuelve el error (SQLSTATE + mensaje) en vez de lanzarlo y deja la transacción
 * utilizable y de vuelta en el rol de la sesión.
 */
async function run(role: LabRoleKey | null, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint r625");
  try {
    if (role) await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint r625");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint r625");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

/** Llamada de preparación como usuario lab: debe salir bien y devolver una fila. */
async function must(what: string, role: LabRoleKey, text: string, params: unknown[] = []): Promise<Row> {
  const out = await run(role, text, params);
  if (out.code !== null || !out.rows[0]) throw new Error(`SETUP · ${what}: ${out.code ?? "sin filas"} ${out.message}`);
  return out.rows[0];
}

/** Producto a 3.50 REF de lista y costo 1.25; el stock inicial entra con su movimiento `inventario_inicial`. */
async function product(name: string, stock: number): Promise<string> {
  const sku = nextTag(name).toLowerCase();
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, 3.5, 1.25, 0, 0, true) returning id`,
    [lab.storeId, sku],
  );
  if (stock > 0) {
    await sql(
      `stock inicial de ${sku}`,
      `insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
       values ($1, 'inventario_inicial', $2, $3, $4)`,
      [row.id, stock, `${TAG} fixture`, lab.storeId],
    );
  }
  return String(row.id);
}

async function supplierProduct(productId: string): Promise<string> {
  const row = await one(
    "relación proveedor-producto",
    `insert into public.supplier_products (store_id, supplier_id, product_id, last_cost_ref, last_cost_ves, last_pack_cost_ref, is_active)
     values ($1, $2, $3, 2, 200, 24, true) returning id`,
    [lab.storeId, lab.supplierId, productId],
  );
  return String(row.id);
}

/** `create_sale` de `quantity` unidades SIN precio de línea: la RPC toma el precio de lista del producto. */
function listPriceSale(role: LabRoleKey, productId: string, quantity: number): Promise<Outcome> {
  return run(
    role,
    `select id, subtotal_ref::text as subtotal_ref, total_ref::text as total_ref, total_ves::text as total_ves
     from public.create_sale(p_customer_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_invoice_number => $4)`,
    [lab.customerId, JSON.stringify([{ product_id: productId, quantity }]), rateVes, nextTag("fact")],
  );
}

beforeAll(async () => {
  lab = await Lab.open("r625");
  db = await lab.pg();
  const rate = await one(
    "tasa vigente",
    "select rate_ves::float8 as rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  rateVes = Number(rate.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP · la tienda lab no tiene tasa de cambio");
});

afterAll(async () => {
  if (lab) await lab.close();
});

// 23-rpc-review M1: authenticated tiene INSERT / UPDATE sobre estas columnas (grant de tabla + política de la
// tienda) y 'NaN'::numeric cumple los CHECK `>= 0` / `> 0` y cabe en numeric(12,2).
describe("M1 · un NaN escrito directamente en una columna numeric se rechaza con PT400 y la fila queda intacta", () => {
  type Ctx = { product: string; sp: string; category: string };
  type Write = {
    name: string;
    column: string;
    roles: LabRoleKey[];
    /** Sentencia con `$1` = id de la fila / del padre y `$2` = el valor numeric bajo prueba. */
    text: string;
    id: (ctx: Ctx) => string;
    /** Valores normales que deben seguir entrando por esa misma sentencia. */
    valid: string[];
  };

  const WRITES: Write[] = [
    {
      name: "UPDATE products.sale_price_ref",
      column: "sale_price_ref",
      roles: ["admin", "almacen"],
      text: "update public.products set sale_price_ref = $2::numeric where id = $1 returning sale_price_ref::text as v",
      id: (ctx) => ctx.product,
      valid: ["0", "12.34"],
    },
    {
      name: "UPDATE products.current_cost_ref",
      column: "current_cost_ref",
      roles: ["admin", "almacen"],
      text: "update public.products set current_cost_ref = $2::numeric where id = $1 returning current_cost_ref::text as v",
      id: (ctx) => ctx.product,
      valid: ["0", "0.07"],
    },
    {
      name: "INSERT products.sale_price_ref",
      column: "sale_price_ref",
      roles: ["admin", "almacen"],
      text: `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
             select store_id, sku || '-b', name || ' b', $2::numeric, 1, 0, 0, true from public.products where id = $1
             returning sale_price_ref::text as v`,
      id: (ctx) => ctx.product,
      valid: ["4.50"],
    },
    {
      name: "INSERT exchange_rates.rate_ves",
      column: "rate_ves",
      roles: ["admin", "contador"],
      text: `insert into public.exchange_rates (store_id, rate_ves, source, notes)
             select store_id, $2::numeric, 'manual', 'R625' from public.products where id = $1 returning rate_ves::text as v`,
      id: (ctx) => ctx.product,
      valid: ["36.5125"],
    },
    {
      name: "UPDATE supplier_products.last_cost_ref",
      column: "last_cost_ref",
      roles: ["admin", "almacen"],
      text: "update public.supplier_products set last_cost_ref = $2::numeric where id = $1 returning last_cost_ref::text as v",
      id: (ctx) => ctx.sp,
      valid: ["0", "2.75"],
    },
    {
      name: "UPDATE supplier_products.last_cost_ves",
      column: "last_cost_ves",
      roles: ["almacen"],
      text: "update public.supplier_products set last_cost_ves = $2::numeric where id = $1 returning last_cost_ves::text as v",
      id: (ctx) => ctx.sp,
      valid: ["275.10"],
    },
    {
      name: "UPDATE supplier_products.last_pack_cost_ref",
      column: "last_pack_cost_ref",
      roles: ["almacen"],
      text: "update public.supplier_products set last_pack_cost_ref = $2::numeric where id = $1 returning last_pack_cost_ref::text as v",
      id: (ctx) => ctx.sp,
      valid: ["33.00"],
    },
    {
      name: "UPDATE categories.tax_rate",
      column: "tax_rate",
      roles: ["admin", "almacen"],
      text: "update public.categories set tax_rate = $2::numeric where id = $1 returning tax_rate::text as v",
      id: (ctx) => ctx.category,
      valid: ["0", "16.00"],
    },
    {
      name: "UPDATE app_settings.default_tax_rate",
      column: "default_tax_rate",
      roles: ["admin"],
      text: `update public.app_settings set default_tax_rate = $2::numeric
             where store_id = (select store_id from public.products where id = $1) returning default_tax_rate::text as v`,
      id: (ctx) => ctx.product,
      valid: ["0", "16.00"],
    },
    {
      name: "INSERT product_price_history.new_sale_price_ref",
      column: "new_sale_price_ref",
      roles: ["admin", "almacen"],
      text: `insert into public.product_price_history (product_id, old_sale_price_ref, new_sale_price_ref, reason)
             values ($1, 1, $2::numeric, 'R625') returning new_sale_price_ref::text as v`,
      id: (ctx) => ctx.product,
      valid: ["2.00"],
    },
    {
      name: "INSERT supplier_product_price_history.new_cost_ves",
      column: "new_cost_ves",
      roles: ["admin", "almacen"],
      text: `insert into public.supplier_product_price_history (supplier_product_id, old_cost_ref, new_cost_ref, old_cost_ves, new_cost_ves, origin)
             values ($1, 1, 2, 100, $2::numeric, 'ajuste') returning new_cost_ves::text as v`,
      id: (ctx) => ctx.sp,
      valid: ["200.00"],
    },
    {
      name: "INSERT payroll_employees.commission_pct",
      column: "commission_pct",
      roles: ["admin"],
      text: `insert into public.payroll_employees (store_id, profile_id, commission_pct)
             select store_id, auth.uid(), $2::numeric from public.products where id = $1 returning commission_pct::text as v`,
      id: (ctx) => ctx.product,
      valid: ["2.50"],
    },
  ];

  const CASES = WRITES.flatMap((write) => write.roles.map((role) => ({ ...write, role })));

  async function context(): Promise<Ctx> {
    const p = await product("m1", 10);
    const category = await one("categoría", "insert into public.categories (store_id, name, tax_rate) values ($1, $2, 8) returning id", [
      lab.storeId,
      nextTag("cat"),
    ]);
    return { product: p, sp: await supplierProduct(p), category: String(category.id) };
  }

  /** Todo lo que estas sentencias pueden escribir, como texto (un NaN guardado se vería aquí). */
  async function state(ctx: Ctx): Promise<Row> {
    return one(
      "estado",
      `select (select sale_price_ref::text || '/' || current_cost_ref::text from public.products where id = $1) as producto,
              (select count(*)::int from public.products where store_id = $4) as productos,
              (select count(*)::int || '/' || max(rate_ves)::text from public.exchange_rates where store_id = $4) as tasas,
              (select last_cost_ref::text || '/' || last_cost_ves::text || '/' || last_pack_cost_ref::text from public.supplier_products where id = $2) as relacion,
              (select tax_rate::text from public.categories where id = $3) as categoria,
              (select default_tax_rate::text from public.app_settings where store_id = $4) as ajustes,
              (select count(*)::int from public.product_price_history where product_id = $1) as historial_precio,
              (select count(*)::int from public.supplier_product_price_history where supplier_product_id = $2) as historial_costo,
              (select count(*)::int from public.payroll_employees where store_id = $4) as nomina`,
      [ctx.product, ctx.sp, ctx.category, lab.storeId],
    );
  }

  it.each(CASES)("M1 · $role: $name = NaN responde PT400 y no cambia nada", async (c) => {
    await withRollback(db, async () => {
      const ctx = await context();
      const before = await state(ctx);

      const res = await run(c.role, c.text, [c.id(ctx), "NaN"]);

      expect({ code: res.code, mensaje: res.message, estado: await state(ctx) }).toEqual({
        code: "PT400",
        mensaje: notFinite(c.column),
        estado: before,
      });
    });
  });

  // Todas las columnas numeric de `public` tienen precisión (numeric(p,s)): Postgres rechaza ±Infinity al
  // convertir el valor, antes de cualquier trigger (22003). El trigger cubre Infinity donde la columna no
  // tiene precisión (test de la tabla temporal, más abajo).
  it.each(CASES)("M1 · $role: $name = Infinity se rechaza y no cambia nada", async (c) => {
    await withRollback(db, async () => {
      const ctx = await context();
      const before = await state(ctx);

      const plus = await run(c.role, c.text, [c.id(ctx), "Infinity"]);
      const minus = await run(c.role, c.text, [c.id(ctx), "-Infinity"]);

      expect({ codes: [plus.code, minus.code], estado: await state(ctx) }).toEqual({ codes: ["22003", "22003"], estado: before });
    });
  });

  it.each(CASES)("M1 · $role: $name sigue aceptando valores normales (cero y decimales)", async (c) => {
    await withRollback(db, async () => {
      const ctx = await context();
      const written: Array<[string | null, number | null]> = [];
      for (const value of c.valid) {
        const res = await run(c.role, c.text.replace("sku || '-b'", `sku || '-${written.length}'`), [c.id(ctx), value]);
        written.push([res.code, res.rows[0] ? Number(res.rows[0].v) : null]);
      }

      expect(written).toEqual(c.valid.map((value) => [null, Number(value)]));
    });
  });

  it("M1 · extremo a extremo: tras el intento de NaN en el precio y el costo, create_sale sin precio de línea da totales finitos", async () => {
    await withRollback(db, async () => {
      const ctx = await context();

      const price = await run("almacen", "update public.products set sale_price_ref = 'NaN' where id = $1 returning id", [ctx.product]);
      const cost = await run("admin", "update public.products set current_cost_ref = 'NaN' where id = $1 returning id", [ctx.product]);
      const sold = await listPriceSale("vendedor1", ctx.product, 2);
      const line = await sql(
        "línea de la venta",
        `select unit_price_ref::text as precio, unit_cost_ref_snapshot::text as costo, subtotal_ref::text as subtotal, gross_profit_ref::text as utilidad
         from public.sale_items where sale_id = $1`,
        [sold.rows[0]?.id],
      );

      expect({
        intentos: [price.code, cost.code],
        venta: sold.code,
        totales: [sold.rows[0]?.subtotal_ref, sold.rows[0]?.total_ref, Number(sold.rows[0]?.total_ves)],
        linea: line,
      }).toEqual({
        intentos: ["PT400", "PT400"],
        venta: null,
        totales: ["7.00", "7.00", Math.round(7 * rateVes * 100) / 100],
        linea: [{ precio: "3.50", costo: "1.25", subtotal: "7.00", utilidad: "4.50" }],
      });
    });
  });

  it("M1 · extremo a extremo: tras el intento de tasa NaN la tienda sigue vendiendo con su tasa vigente", async () => {
    await withRollback(db, async () => {
      const ctx = await context();

      const rate = await run("contador", "insert into public.exchange_rates (store_id, rate_ves, source) values ($1, 'NaN', 'manual') returning id", [lab.storeId]);
      const current = await one(
        "tasa vigente",
        "select rate_ves::float8 as rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
        [lab.storeId],
      );
      const sold = await listPriceSale("vendedor1", ctx.product, 1);

      expect({ intento: rate.code, vigente: current.rate_ves, venta: sold.code, total: sold.rows[0]?.total_ref }).toEqual({
        intento: "PT400",
        vigente: rateVes,
        venta: null,
        total: "3.50",
      });
    });
  });
});

// Red de seguridad: las tablas que solo escriben las RPC security definer (ventas, compras, pagos, caja, baúl)
// llevan el mismo trigger. `authenticated` no puede escribirlas, así que se prueba como `postgres`, que es como
// escriben las RPC.
describe("M1 · el trigger cubre todas las tablas de public con columnas numeric", () => {
  /** Deja al menos una fila en cada una de las 22 tablas (flujos reales por RPC + nómina por SQL; `tax_rates` trae su semilla). */
  async function populate(): Promise<void> {
    const p = await product("net", 10);
    await must("precio", "almacen", "select id from public.update_product_price($1::uuid, 4.25, $2)", [p, TAG]);
    const register = await one("caja", "insert into public.cash_registers (store_id, name, is_active) values ($1, $2, true) returning id", [
      lab.storeId,
      nextTag("caja"),
    ]);
    await must("abrir la caja", "admin", "select id from public.open_cash_session($1::uuid, 0, 0)", [register.id]);
    await must("depósito al baúl", "admin", "select id from public.register_vault_deposit(100, 0, $1)", [TAG]);
    const sale = await must(
      "venta",
      "admin",
      `select id, total_ves::float8 as total_ves from public.create_sale(
         p_customer_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_invoice_number => $4)`,
      [lab.customerId, JSON.stringify([{ product_id: p, quantity: 1, unit_price_ref: 1 }]), rateVes, nextTag("fact")],
    );
    await must("cobro en efectivo", "admin", "select id from public.register_payment(p_sale_id => $1::uuid, p_method => 'efectivo_ves', p_amount => $2::numeric)", [
      sale.id,
      sale.total_ves,
    ]);
    const item = {
      product_id: p,
      entry_mode: "unit",
      quantity: 2,
      cost_currency: "ref",
      unit_cost_ref: 1,
      unit_cost_ves: rateVes,
      subtotal_ref: 2,
      subtotal_ves: 2 * rateVes,
      tax_rate: 0,
      tax_ref: 0,
      tax_ves: 0,
    };
    await must(
      "compra recibida",
      "almacen",
      `select id from public.create_purchase(
         p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_purchase_number => $4, p_status => 'recibido',
         p_discount_ves => 0, p_tax_ves => 0, p_subtotal_ves => $5::numeric, p_subtotal_ref => 2)`,
      [lab.supplierId, JSON.stringify([item]), rateVes, nextTag("compra"), 2 * rateVes],
    );
    await sql("ajustes de nómina", "insert into public.payroll_settings (store_id) values ($1) on conflict (store_id) do nothing", [lab.storeId]);
    const employee = await one(
      "empleado de nómina",
      "insert into public.payroll_employees (store_id, profile_id, commission_pct) values ($1, $2, 5) returning id",
      [lab.storeId, lab.uids.vendedor1],
    );
    const period = await one(
      "período de nómina",
      `insert into public.payroll_periods (store_id, period_key, from_date, to_date, created_by)
       values ($1, $2, date '2026-01-01', date '2026-01-15', $3) returning id`,
      [lab.storeId, nextTag("periodo"), lab.uids.admin],
    );
    const payrollItem = await one(
      "línea de nómina",
      "insert into public.payroll_items (store_id, period_id, employee_id, profile_id, commission_pct) values ($1, $2, $3, $4, 5) returning id",
      [lab.storeId, period.id, employee.id, lab.uids.vendedor1],
    );
    await sql(
      "venta comisionada",
      `insert into public.payroll_commission_sales (store_id, item_id, sale_id, kind, sale_total_ref, commission_ref)
       values ($1, $2, $3, 'normal', 1, 0.05)`,
      [lab.storeId, payrollItem.id, sale.id],
    );
  }

  it("M1 · UPDATE con NaN como postgres en cada columna numeric de las 22 tablas responde PT400 con el nombre de la columna", async () => {
    await withRollback(db, async () => {
      await populate();
      const columns = await sql(
        "columnas numeric",
        `select c.relname as tabla, a.attname as columna
         from pg_class c join pg_attribute a on a.attrelid = c.oid
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
           and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.atttypid = 'numeric'::regtype
         order by 1, a.attnum`,
      );

      const wrong: string[] = [];
      for (const { tabla, columna } of columns) {
        const res = await run(null, `update public."${String(tabla)}" set "${String(columna)}" = 'NaN' where ctid in (select ctid from public."${String(tabla)}" limit 1) returning 1 as n`);
        if (res.code !== "PT400" || res.message !== notFinite(String(columna))) {
          wrong.push(`${String(tabla)}.${String(columna)}: ${res.code ?? `aceptado (${res.rows.length} fila)`} ${res.message}`.trim());
        }
      }

      expect({ tablas: [...new Set(columns.map((c) => c.tabla))], columnas: columns.length > 60, fallos: wrong }).toEqual({
        tablas: NUMERIC_TABLES,
        columnas: true,
        fallos: [],
      });
    });
  });

  it("M1 · catálogo: cada tabla con numeric tiene los dos triggers con todas sus columnas, y la función no es ejecutable por PostgREST", async () => {
    const coverage = await sql(
      "cobertura",
      `select c.relname as tabla,
              (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.atttypid = 'numeric'::regtype) as columnas,
              (select coalesce(jsonb_object_agg(t.tgname, string_to_array(rtrim(encode(t.tgargs, 'escape'), '\\000'), '\\000') order by t.tgname), '{}'::jsonb)
               from pg_trigger t
               where t.tgrelid = c.oid and not t.tgisinternal and t.tgenabled = 'O' and t.tgqual is not null
                 and t.tgfoid = to_regprocedure('public.reject_non_finite_numeric()')) as triggers
       from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                     and a.attgenerated = '' and a.atttypid = 'numeric'::regtype)
       order by 1`,
    );
    const privileges = await sql(
      "privilegios",
      `select r.name as rol, has_function_privilege(r.name, p.oid, 'execute') as ejecuta, p.prosecdef as definer
       from pg_proc p cross join unnest(array['anon', 'authenticated']) as r(name)
       where p.oid = to_regprocedure('public.reject_non_finite_numeric()') order by 1`,
    );

    expect({
      tablas: coverage.map((row) => row.tabla),
      incompletas: coverage.filter((row) => JSON.stringify(row.triggers) !== JSON.stringify(Object.fromEntries(TRIGGERS.map((name) => [name, row.columnas])))),
      privilegios: privileges,
    }).toEqual({
      tablas: NUMERIC_TABLES,
      incompletas: [],
      privilegios: [
        { rol: "anon", ejecuta: false, definer: false },
        { rol: "authenticated", ejecuta: false, definer: false },
      ],
    });
  });

  it("M1 · en una columna numeric sin precisión el trigger rechaza NaN, Infinity y -Infinity (INSERT y UPDATE) y deja pasar NULL y finitos", async () => {
    await withRollback(db, async () => {
      await sql("tabla temporal", "create temp table r625_free (id int primary key, a numeric, b numeric(12,2)) on commit drop");
      await sql(
        "triggers",
        `create trigger trg_ins before insert on r625_free for each row
           when ((new.a - new.a) <> 0 or (new.b - new.b) <> 0) execute function public.reject_non_finite_numeric('a', 'b');
         create trigger trg_upd before update on r625_free for each row
           when (((new.a - new.a) <> 0 and new.a is distinct from old.a) or ((new.b - new.b) <> 0 and new.b is distinct from old.b))
           execute function public.reject_non_finite_numeric('a', 'b')`,
      );
      await sql("fila", "insert into r625_free values (1, 0, null), (2, 1e30, -0.01)");

      const out: Record<string, string | null> = {};
      for (const value of ["NaN", "Infinity", "-Infinity"]) {
        const inserted = await run(null, "insert into r625_free values (9, $1::numeric, 1)", [value]);
        const updated = await run(null, "update r625_free set a = $1::numeric where id = 1", [value]);
        out[value] = [inserted, updated].every((r) => r.code === "PT400" && r.message === notFinite("a")) ? "PT400" : `${inserted.code} / ${updated.code}`;
      }
      const fine = await run(null, "update r625_free set a = -123456789.000001, b = null where id = 2 returning a::text as a");

      expect({ ...out, finito: [fine.code, fine.rows[0]?.a], filas: await sql("filas", "select id, a::text as a from r625_free order by id") }).toEqual({
        NaN: "PT400",
        Infinity: "PT400",
        "-Infinity": "PT400",
        finito: [null, "-123456789.000001"],
        filas: [
          { id: 1, a: "0" },
          { id: 2, a: "-123456789.000001" },
        ],
      });
    });
  });
});

// El parche no toca filas existentes ni añade constraints: una fila que ya tuviera NaN (anterior al parche)
// debe seguir siendo operable y corregible, y la red de seguridad impide que ese NaN llegue a una venta.
describe("M1 · una fila con NaN anterior al parche sigue siendo operable y no contamina ventas", () => {
  it("M1 · producto con precio NaN heredado: se edita y se corrige; create_sale lo rechaza con PT400 mientras tanto", async () => {
    await withRollback(db, async () => {
      const p = await product("legado", 10);
      // Estado anterior al parche: el NaN ya está en la fila (se planta con los triggers del parche apagados).
      for (const trigger of TRIGGERS) await db.query(`alter table public.products disable trigger ${trigger}`).catch(() => undefined);
      await sql("NaN heredado", "update public.products set sale_price_ref = 'NaN' where id = $1", [p]);
      for (const trigger of TRIGGERS) await db.query(`alter table public.products enable trigger ${trigger}`).catch(() => undefined);

      const renamed = await run("almacen", "update public.products set name = name || ' (editado)' where id = $1 returning id", [p]);
      const sold = await listPriceSale("vendedor1", p, 1);
      const sales = await one("ventas del producto", "select count(*)::int as n from public.sale_items where product_id = $1", [p]);
      const stock = await one("stock", "select current_stock from public.products where id = $1", [p]);
      const fixed = await run("almacen", "update public.products set sale_price_ref = 2.5 where id = $1 returning sale_price_ref::text as v", [p]);
      const after = await listPriceSale("vendedor1", p, 1);

      expect({
        edicion: [renamed.code, renamed.rows.length],
        venta: [sold.code, sold.message],
        sinRastro: [sales.n, stock.current_stock],
        correccion: [fixed.code, fixed.rows[0]?.v],
        ventaDespues: [after.code, after.rows[0]?.total_ref],
      }).toEqual({
        edicion: [null, 1],
        venta: ["PT400", notFinite("unit_price_ref")],
        sinRastro: [0, 10],
        correccion: [null, "2.50"],
        ventaDespues: [null, "2.50"],
      });
    });
  });
});
