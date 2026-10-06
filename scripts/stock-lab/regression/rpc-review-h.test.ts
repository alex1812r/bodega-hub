/** @jest-environment node */
/**
 * STK-615 · regresión del parche `20261006h-rls-store-scope-and-finite-guards.sql` (hallazgos de
 * `.notes/stock-integrity-gtm/qa/pass-1/13-rpc-review.txt` confirmados en `12-own-b-rpc-review*.log`):
 *
 *   N1     `sale_items`, `purchase_items`, `product_price_history`, `supplier_product_price_history` y
 *          `supplier_product_pack_units` se leían desde cualquier tienda (`using (true)`).
 *   N2     empaques e historiales de precio se escribían sin filtro de tienda (solo rol).
 *   N3     `store_vaults`, `vault_movements`, `cash_movements` y `cash_sessions` escribibles por PostgREST.
 *   N4     `NaN` / `Infinity` en parámetros numeric atravesaban las guardas `< 0`.
 *   N6     las guardas de rol de las tres RPC de precios respondían P0001 (400) en vez de PT403.
 *   R5(c)  `cancel_payment_apply` evaluaba F4 y borraba `cash_movements` sin bloquear la sesión de caja.
 *
 * Cada test enuncia el comportamiento SANO. Casi todo corre por `pg` dentro de una transacción que termina en
 * `rollback`: los datos se preparan como `postgres` y cada sentencia probada se ejecuta con
 * `set local role authenticated` + `request.jwt.claims` del usuario (la ACL y la RLS probadas son las de
 * PostgREST). El usuario de OTRA tienda es `admin@example.com` (tienda `default`). R5(c) necesita dos
 * transacciones intercaladas, así que confirma sus datos y los borra en `afterAll`.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/rpc-review-h.test.ts
 *
 * No depende de `now()` monótono (el reloj del contenedor lab retrocede). Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `R615-${NONCE}`;
const OTHER_STORE_ADMIN_EMAIL = "admin@example.com";

/** Texto exacto que ve el usuario cuando un parámetro numeric llega como NaN / Infinity. */
const notFinite = (campo: string): string => `Valor numerico invalido en ${campo}: debe ser un numero finito`;
const MSG_F4 =
  "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo";

let lab: Lab;
let db: Client;
let rateVes = 0;
let seq = 0;
/** `admin@example.com`: admin activo de la tienda `default`. */
let otherAdmin = "";

/** Datos confirmados por R5(c) (se borran en `afterAll`). */
const committed = { products: [] as string[], registers: [] as string[] };

function nextTag(name: string): string {
  seq += 1;
  return `${TAG}-${name}-${seq}`;
}

function failure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown }).code;
  return { code: typeof code === "string" ? code : "?", message: error instanceof Error ? error.message : String(error) };
}

/** SQL de preparación / lectura como `postgres`. Si falla, el test no pudo montarse. */
async function sql(client: Client, what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  try {
    return (await client.query<Row>(text, params)).rows;
  } catch (error) {
    const { code, message } = failure(error);
    throw new Error(`SETUP · ${what}: ${code} ${message}`);
  }
}

async function one(client: Client, what: string, text: string, params: unknown[] = []): Promise<Row> {
  const rows = await sql(client, what, text, params);
  if (!rows[0]) throw new Error(`SETUP · ${what}: sin filas`);
  return rows[0];
}

/**
 * Ejecuta `text` como el usuario `uid` (rol `authenticated` + claims) dentro de un savepoint. Devuelve el error
 * (SQLSTATE + mensaje) en vez de lanzarlo y deja la transacción utilizable y de vuelta en el rol de la sesión.
 */
async function asUser(client: Client, uid: string, text: string, params: unknown[] = []): Promise<Outcome> {
  await client.query("savepoint r615_as_user");
  try {
    await actAs(client, uid);
    const res = await client.query<Row>(text, params);
    await client.query("reset role");
    await client.query("release savepoint r615_as_user");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await client.query("rollback to savepoint r615_as_user");
    await client.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

function as(client: Client, role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  return asUser(client, lab.uids[role], text, params);
}

/** Llamada de preparación como usuario lab: debe salir bien y devolver una fila. */
async function must(client: Client, what: string, role: LabRoleKey, text: string, params: unknown[] = []): Promise<Row> {
  const out = await as(client, role, text, params);
  if (out.code !== null || !out.rows[0]) throw new Error(`SETUP · ${what}: ${out.code ?? "sin filas"} ${out.message}`);
  return out.rows[0];
}

/** Producto (stock 0); el stock inicial entra con su movimiento `inventario_inicial` (lo aplica el trigger). */
async function product(client: Client, name: string, stock: number, storeId: string = lab.storeId): Promise<string> {
  const sku = nextTag(name).toLowerCase();
  const row = await one(
    client,
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, 1, 1, 0, 0, true) returning id`,
    [storeId, sku, sku],
  );
  const id = String(row.id);
  if (stock > 0) {
    await sql(
      client,
      `stock inicial de ${sku}`,
      `insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
       values ($1, 'inventario_inicial', $2, $3, $4)`,
      [id, stock, `${TAG} fixture`, storeId],
    );
  }
  return id;
}

/** Relación proveedor-producto con costo 2 REF / 200 Bs. `storeId` distinto del lab = tienda ajena (proveedor propio). */
async function supplierProduct(client: Client, name: string, storeId: string = lab.storeId): Promise<string> {
  let supplierId = lab.supplierId;
  if (storeId !== lab.storeId) {
    const contact = await one(
      client,
      "proveedor de la otra tienda",
      "insert into public.contacts (store_id, type, name) values ($1, 'proveedor', $2) returning id",
      [storeId, nextTag(`${name}-prov`)],
    );
    supplierId = String(contact.id);
  }
  const productId = await product(client, name, 0, storeId);
  const row = await one(
    client,
    `relación proveedor-producto ${name}`,
    `insert into public.supplier_products (store_id, supplier_id, product_id, last_cost_ref, last_cost_ves, is_active)
     values ($1, $2, $3, 2, 200, true) returning id`,
    [storeId, supplierId, productId],
  );
  return String(row.id);
}

async function packUnit(client: Client, supplierProductId: string, label: string): Promise<string> {
  const row = await one(
    client,
    `empaque ${label}`,
    `insert into public.supplier_product_pack_units (supplier_product_id, label, units_per_pack, is_default, is_active)
     values ($1, $2, 12, false, true) returning id`,
    [supplierProductId, label],
  );
  return String(row.id);
}

type Numbers = Record<string, number | string | null>;

const SALE_NUMBERS: Numbers = { p_ref_rate_ves: 0, p_discount_ref: 0, p_tax_ref: 0 };

/** `create_sale` / `create_sale_with_payments` de 1 unidad a 1 REF con los numeric escalares de `numbers`. */
function saleCall(fn: "create_sale" | "create_sale_with_payments", productId: string, numbers: Numbers): { text: string; params: unknown[] } {
  const n: Numbers = { ...SALE_NUMBERS, p_ref_rate_ves: rateVes, ...numbers };
  const payments = fn === "create_sale_with_payments" ? "p_payments => '[]'::jsonb, " : "";
  return {
    text: `select id, total_ves::float8 as total_ves from public.${fn}(
      p_customer_id => $1::uuid, p_items => $2::jsonb, ${payments}p_ref_rate_ves => $3::numeric,
      p_discount_ref => $4::numeric, p_tax_ref => $5::numeric, p_invoice_number => $6)`,
    params: [
      lab.customerId,
      JSON.stringify([{ product_id: productId, quantity: 1, unit_price_ref: 1 }]),
      n.p_ref_rate_ves,
      n.p_discount_ref,
      n.p_tax_ref,
      nextTag("fact"),
    ],
  };
}

/** Compra recibida de `quantity` unidades a 1 REF con los numeric escalares de `numbers`. */
function purchaseCall(productId: string, quantity: number, numbers: Numbers = {}): { text: string; params: unknown[] } {
  const n: Numbers = {
    p_ref_rate_ves: rateVes,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: quantity * rateVes,
    p_subtotal_ref: quantity,
    ...numbers,
  };
  const item = {
    product_id: productId,
    entry_mode: "unit",
    quantity,
    cost_currency: "ref",
    unit_cost_ref: 1,
    unit_cost_ves: rateVes,
    subtotal_ref: quantity,
    subtotal_ves: quantity * rateVes,
    tax_rate: 0,
    tax_ref: 0,
    tax_ves: 0,
  };
  return {
    text: `select id, total_ves::float8 as total_ves from public.create_purchase(
      p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => $4::numeric,
      p_tax_ref => $5::numeric, p_purchase_number => $6, p_status => 'recibido', p_discount_ves => $7::numeric,
      p_tax_ves => $8::numeric, p_subtotal_ves => $9::numeric, p_subtotal_ref => $10::numeric)`,
    params: [
      lab.supplierId,
      JSON.stringify([item]),
      n.p_ref_rate_ves,
      n.p_discount_ref,
      n.p_tax_ref,
      nextTag("compra"),
      n.p_discount_ves,
      n.p_tax_ves,
      n.p_subtotal_ves,
      n.p_subtotal_ref,
    ],
  };
}

/** Venta de `quantity` unidades a 1 REF como lab-admin (queda `pendiente_pago`). */
async function sale(client: Client, productId: string, quantity: number): Promise<{ id: string; totalVes: number }> {
  const row = await must(
    client,
    "venta",
    "admin",
    `select id, total_ves::float8 as total_ves from public.create_sale(
       p_customer_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_invoice_number => $4)`,
    [lab.customerId, JSON.stringify([{ product_id: productId, quantity, unit_price_ref: 1 }]), rateVes, nextTag("fact")],
  );
  return { id: String(row.id), totalVes: Number(row.total_ves) };
}

async function purchase(client: Client, productId: string, quantity: number): Promise<{ id: string; totalVes: number }> {
  const call = purchaseCall(productId, quantity);
  const row = await must(client, "compra recibida", "almacen", call.text, call.params);
  return { id: String(row.id), totalVes: Number(row.total_ves) };
}

/** Caja propia abierta por lab-admin con fondo 0 (no toca el baúl). */
async function openSession(client: Client, name = "caja"): Promise<{ registerId: string; sessionId: string }> {
  const register = await one(
    client,
    "caja propia",
    "insert into public.cash_registers (store_id, name, is_active) values ($1, $2, true) returning id",
    [lab.storeId, nextTag(name)],
  );
  const session = await must(client, "abrir la caja", "admin", "select id from public.open_cash_session($1::uuid, 0, 0)", [register.id]);
  return { registerId: String(register.id), sessionId: String(session.id) };
}

const BANK_PAYMENT = `select id from public.register_payment(
  p_sale_id => $1::uuid, p_purchase_id => $2::uuid, p_method => 'transferencia', p_amount => $3::numeric,
  p_bank_name => 'Banco R615', p_reference_code => '00615')`;
const CASH_PAYMENT = "select id from public.register_payment(p_sale_id => $1::uuid, p_method => 'efectivo_ves', p_amount => $2::numeric)";

beforeAll(async () => {
  lab = await Lab.open("r615");
  db = await lab.pg();
  const rate = await one(
    db,
    "tasa vigente",
    "select rate_ves::float8 as rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  rateVes = Number(rate.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP · la tienda lab no tiene tasa de cambio");

  const other = await one(
    db,
    `usuario ${OTHER_STORE_ADMIN_EMAIL} de la tienda default`,
    `select u.id from auth.users u join public.profiles p on p.id = u.id
     where u.email = $1 and p.store_id = $2 and p.role = 'admin' and p.is_active`,
    [OTHER_STORE_ADMIN_EMAIL, lab.defaultStoreId],
  );
  otherAdmin = String(other.id);
});

afterAll(async () => {
  if (!lab) return;
  await cleanupCommitted();
  await lab.close();
});

/** Borra lo que R5(c) confirmó y devuelve al baúl lo que su transferencia le sumó. */
async function cleanupCommitted(): Promise<void> {
  if (committed.products.length === 0 && committed.registers.length === 0) return;
  const c = lab.db;
  try {
    await c.query("begin");
    const ids = async (text: string, params: unknown[]): Promise<unknown[]> => (await c.query<Row>(text, params)).rows.map((r) => r.id);
    const sales = await ids("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [committed.products]);
    const payments = await ids("select id from public.payments where sale_id = any($1::uuid[])", [sales]);
    const sessions = await ids("select id from public.cash_sessions where register_id = any($1::uuid[])", [committed.registers]);
    await c.query(
      `update public.store_vaults v
       set balance_efectivo_ves = v.balance_efectivo_ves - t.ves, balance_ref = v.balance_ref - t.ref
       from (select vault_id, sum(amount_ves) as ves, sum(amount_ref) as ref from public.vault_movements
             where from_session_id = any($1::uuid[]) and type = 'transfer_in' group by vault_id) t
       where v.id = t.vault_id`,
      [sessions],
    );
    await c.query("delete from public.vault_movements where from_session_id = any($1::uuid[]) or payment_id = any($2::uuid[])", [sessions, payments]);
    await c.query("delete from public.cash_movements where payment_id = any($1::uuid[]) or session_id = any($2::uuid[])", [payments, sessions]);
    await c.query("delete from public.payments where id = any($1::uuid[])", [payments]);
    await c.query("delete from public.stock_movements where product_id = any($1::uuid[])", [committed.products]);
    await c.query("delete from public.sales where id = any($1::uuid[])", [sales]);
    await c.query("delete from public.products where id = any($1::uuid[])", [committed.products]);
    await c.query("delete from public.cash_sessions where id = any($1::uuid[])", [sessions]);
    await c.query("delete from public.cash_registers where id = any($1::uuid[])", [committed.registers]);
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => undefined);
    await c.query("update public.products set is_active = false where id = any($1::uuid[])", [committed.products]).catch(() => undefined);
    await c.query("update public.cash_registers set is_active = false where id = any($1::uuid[])", [committed.registers]).catch(() => undefined);
    console.warn(`STK-615: no se pudieron borrar los datos ${TAG} (quedan inactivos): ${failure(error).message}`);
  }
}

// 13-rpc-review N1: cinco políticas SELECT `to authenticated using (true)` sobre tablas sin `store_id`
// (supabase-schema.sql:2293-2296, 2318-2321, 2208-2211, 2252-2255, 2264-2267). Con el JWT de admin@example.com
// (tienda default) un GET por PostgREST devolvía las líneas de venta y compra, los historiales de precio / costo y
// los empaques de la tienda lab (12-own-b-rpc-review.log §N1).
describe("N1 · las líneas de documento, los historiales de precio y los empaques solo se leen desde su tienda", () => {
  const TABLES = ["sale_items", "purchase_items", "product_price_history", "supplier_product_price_history", "supplier_product_pack_units"] as const;
  type Table = (typeof TABLES)[number];
  type Filters = Record<Table, { column: string; id: string }>;

  /** Una fila propia de la tienda `storeId` en cada tabla alcanzable por SQL (venta y compra solo en la tienda lab). */
  async function historyRows(storeId: string): Promise<Pick<Filters, "product_price_history" | "supplier_product_price_history" | "supplier_product_pack_units">> {
    const sp = await supplierProduct(db, "n1-rel", storeId);
    const p = String((await one(db, "producto de la relación", "select product_id from public.supplier_products where id = $1", [sp])).product_id);
    await sql(db, "historial de precio", "insert into public.product_price_history (product_id, old_sale_price_ref, new_sale_price_ref, reason) values ($1, 1, 2, $2)", [p, TAG]);
    await sql(
      db,
      "historial de costo",
      `insert into public.supplier_product_price_history (supplier_product_id, old_cost_ref, new_cost_ref, old_cost_ves, new_cost_ves, origin)
       values ($1, 1, 2, 100, 200, 'ajuste')`,
      [sp],
    );
    await packUnit(db, sp, nextTag("bulto"));
    return {
      product_price_history: { column: "product_id", id: p },
      supplier_product_price_history: { column: "supplier_product_id", id: sp },
      supplier_product_pack_units: { column: "supplier_product_id", id: sp },
    };
  }

  async function labRows(): Promise<Filters> {
    const sold = await product(db, "n1-venta", 5);
    const bought = await product(db, "n1-compra", 0);
    const s = await sale(db, sold, 2);
    const c = await purchase(db, bought, 3);
    return {
      sale_items: { column: "sale_id", id: s.id },
      purchase_items: { column: "purchase_id", id: c.id },
      ...(await historyRows(lab.storeId)),
    };
  }

  async function visible(uid: string, filters: Partial<Filters>): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const table of TABLES) {
      const filter = filters[table];
      if (!filter) continue;
      const res = await asUser(db, uid, `select count(*)::int as n from public.${table} where ${filter.column} = $1`, [filter.id]);
      out[table] = res.code ?? res.rows[0]?.n;
    }
    return out;
  }

  it("N1 · un usuario de OTRA tienda (admin@example.com) no lee ninguna fila de la tienda lab", async () => {
    await withRollback(db, async () => {
      const filters = await labRows();

      expect(await visible(otherAdmin, filters)).toEqual({
        sale_items: 0,
        purchase_items: 0,
        product_price_history: 0,
        supplier_product_price_history: 0,
        supplier_product_pack_units: 0,
      });
    });
  });

  it("N1 · un usuario lab no lee los historiales ni los empaques de la tienda default", async () => {
    await withRollback(db, async () => {
      const filters = await historyRows(lab.defaultStoreId);

      expect({ admin: await visible(lab.uids.admin, filters), vendedor: await visible(lab.uids.vendedor1, filters) }).toEqual({
        admin: { product_price_history: 0, supplier_product_price_history: 0, supplier_product_pack_units: 0 },
        vendedor: { product_price_history: 0, supplier_product_price_history: 0, supplier_product_pack_units: 0 },
      });
    });
  });

  it.each(["admin", "vendedor1", "almacen", "contador"] as const)("N1 · %s de la tienda lab sigue leyendo las filas de su tienda", async (role) => {
    await withRollback(db, async () => {
      const filters = await labRows();

      expect(await visible(lab.uids[role], filters)).toEqual({
        sale_items: 1,
        purchase_items: 1,
        product_price_history: 1,
        supplier_product_price_history: 1,
        supplier_product_pack_units: 1,
      });
    });
  });

  it("N1 · admin@example.com sigue leyendo los historiales y empaques de SU tienda", async () => {
    await withRollback(db, async () => {
      const filters = await historyRows(lab.defaultStoreId);

      expect(await visible(otherAdmin, filters)).toEqual({
        product_price_history: 1,
        supplier_product_price_history: 1,
        supplier_product_pack_units: 1,
      });
    });
  });
});

// 13-rpc-review N2: la política `for all` de `supplier_product_pack_units` y las de INSERT de los dos historiales
// solo miraban el rol (supabase-schema.sql:2270-2274, 2214-2217, 2258-2261). El admin de la tienda default
// insertaba, cambiaba (12 → 777) y borraba empaques de la tienda lab e insertaba historial falso
// (12-own-b-rpc-review.log §N2). El BFF escribe los empaques con la sesión del usuario
// (src/modules/contacts/services/supplierProducts.server.ts:543-647): la propia tienda debe seguir funcionando.
describe("N2 · empaques e historiales de precio solo se escriben desde su tienda", () => {
  const INSERT_PACK = `insert into public.supplier_product_pack_units (supplier_product_id, label, units_per_pack, is_default, is_active)
    values ($1, $2, $3, false, true) returning id`;

  async function packState(supplierProductId: string): Promise<Row[]> {
    return sql(
      db,
      "empaques",
      "select label, units_per_pack, is_default, is_active from public.supplier_product_pack_units where supplier_product_id = $1 order by label",
      [supplierProductId],
    );
  }

  it("N2 · admin@example.com no inserta, cambia ni borra empaques de una relación de la tienda lab", async () => {
    await withRollback(db, async () => {
      const sp = await supplierProduct(db, "n2-ajeno");
      const unit = await packUnit(db, sp, "Bulto x12");

      const inserted = await asUser(db, otherAdmin, INSERT_PACK, [sp, "CAOS x999 otra tienda", 999]);
      const updated = await asUser(db, otherAdmin, "update public.supplier_product_pack_units set units_per_pack = 777 where id = $1 returning id", [unit]);
      const deleted = await asUser(db, otherAdmin, "delete from public.supplier_product_pack_units where id = $1 returning id", [unit]);

      expect({
        insert: inserted.code,
        update: [updated.code, updated.rows.length],
        delete: [deleted.code, deleted.rows.length],
        empaques: await packState(sp),
      }).toEqual({
        insert: "42501",
        update: [null, 0],
        delete: [null, 0],
        empaques: [{ label: "Bulto x12", units_per_pack: 12, is_default: false, is_active: true }],
      });
    });
  });

  it("N2 · admin@example.com no inserta historial de precio ni de costo de la tienda lab", async () => {
    await withRollback(db, async () => {
      const sp = await supplierProduct(db, "n2-historial");
      const p = String((await one(db, "producto", "select product_id from public.supplier_products where id = $1", [sp])).product_id);

      const price = await asUser(
        db,
        otherAdmin,
        "insert into public.product_price_history (product_id, old_sale_price_ref, new_sale_price_ref, reason, changed_by) values ($1, 1, 0.01, $2, $3)",
        [p, "CAOS otra tienda", otherAdmin],
      );
      const cost = await asUser(
        db,
        otherAdmin,
        `insert into public.supplier_product_price_history (supplier_product_id, old_cost_ref, new_cost_ref, old_cost_ves, new_cost_ves, origin, changed_by)
         values ($1, 1, 0.01, 1, 1, 'ajuste', $2)`,
        [sp, otherAdmin],
      );

      const counts = await one(
        db,
        "historiales",
        `select (select count(*)::int from public.product_price_history where product_id = $1) as precio,
                (select count(*)::int from public.supplier_product_price_history where supplier_product_id = $2) as costo`,
        [p, sp],
      );
      expect({ precio: price.code, costo: cost.code, filas: counts }).toEqual({ precio: "42501", costo: "42501", filas: { precio: 0, costo: 0 } });
    });
  });

  it("N2 · almacén de la tienda lab crea, edita y desactiva empaques de su tienda (las escrituras del BFF)", async () => {
    await withRollback(db, async () => {
      const sp = await supplierProduct(db, "n2-propio");
      const old = await packUnit(db, sp, "Bulto x12");
      await sql(db, "empaque por defecto", "update public.supplier_product_pack_units set is_default = true where id = $1", [old]);

      // createSupplierProductPackUnit({ isDefault: true }): quita el default anterior e inserta el nuevo.
      const unset = await as(db, "almacen", "update public.supplier_product_pack_units set is_default = false where supplier_product_id = $1 and is_default = true returning id", [sp]);
      const created = await as(
        db,
        "almacen",
        `insert into public.supplier_product_pack_units (supplier_product_id, label, units_per_pack, is_default, is_active)
         values ($1, 'Caja x24', 24, true, true) returning id`,
        [sp],
      );
      // updateSupplierProductPackUnit / deactivateSupplierProductPackUnit.
      const edited = await as(db, "almacen", "update public.supplier_product_pack_units set units_per_pack = 6, label = 'Bulto x6' where id = $1 returning id", [old]);
      const deactivated = await as(db, "admin", "update public.supplier_product_pack_units set is_active = false, is_default = false where id = $1 returning id", [created.rows[0]?.id]);

      expect({
        codes: [unset.code, created.code, edited.code, deactivated.code],
        filas: [unset.rows.length, created.rows.length, edited.rows.length, deactivated.rows.length],
        empaques: await packState(sp),
      }).toEqual({
        codes: [null, null, null, null],
        filas: [1, 1, 1, 1],
        empaques: [
          { label: "Bulto x6", units_per_pack: 6, is_default: false, is_active: true },
          { label: "Caja x24", units_per_pack: 24, is_default: false, is_active: false },
        ],
      });
    });
  });

  it("N2 · admin de la tienda lab borra un empaque propio; un vendedor no escribe empaques", async () => {
    await withRollback(db, async () => {
      const sp = await supplierProduct(db, "n2-roles");
      const unit = await packUnit(db, sp, "Bulto x12");

      const seller = await as(db, "vendedor1", INSERT_PACK, [sp, "Vendedor", 3]);
      const removed = await as(db, "admin", "delete from public.supplier_product_pack_units where id = $1 returning id", [unit]);

      expect({ vendedor: seller.code, borrado: [removed.code, removed.rows.length], empaques: await packState(sp) }).toEqual({
        vendedor: "42501",
        borrado: [null, 1],
        empaques: [],
      });
    });
  });
});

// 13-rpc-review N3: las políticas «Admins manage …» (`for all`) de 20260811b-cash-registers-vault.sql:127-164 y el
// grant de tabla dejaban al admin escribir caja y baúl por PostgREST sin pasar por las RPC ni por sus guardas
// (12-own-b-rpc-review-2.log §N3: baúl a 987 654 321, asientos inventados, apertura a 999 999). El BFF no escribe
// esas cuatro tablas con la sesión del usuario: solo las lee y llama a las RPC.
describe("N3 · caja y baúl solo se escriben por las RPC", () => {
  const TABLES = ["store_vaults", "vault_movements", "cash_movements", "cash_sessions"] as const;

  async function moneyState(sessionId: string): Promise<Row> {
    return one(
      db,
      "estado de caja y baúl",
      `select (select balance_ves::text || '/' || balance_efectivo_ves::text || '/' || balance_ref::text from public.store_vaults where store_id = $1) as baul,
              (select count(*)::int from public.vault_movements where store_id = $1) as asientos_baul,
              (select count(*)::int from public.cash_movements where store_id = $1) as asientos_caja,
              (select count(*)::int from public.cash_sessions where store_id = $1) as sesiones,
              (select status || '/' || opening_ves::text from public.cash_sessions where id = $2) as sesion`,
      [lab.storeId, sessionId],
    );
  }

  it("N3 · el admin de la tienda no escribe store_vaults, vault_movements, cash_movements ni cash_sessions por PostgREST (42501)", async () => {
    await withRollback(db, async () => {
      const { sessionId } = await openSession(db, "n3");
      const spare = await one(db, "segunda caja", "insert into public.cash_registers (store_id, name, is_active) values ($1, $2, true) returning id", [
        lab.storeId,
        nextTag("n3-libre"),
      ]);
      const s = await sale(db, await product(db, "n3", 5), 1);
      await must(db, "cobro en cuenta", "admin", BANK_PAYMENT, [s.id, null, s.totalVes]);
      const vault = String((await one(db, "baúl", "select id from public.store_vaults where store_id = $1", [lab.storeId])).id);
      const before = await moneyState(sessionId);

      const attempts: Array<[string, string, unknown[]]> = [
        ["store_vaults update", "update public.store_vaults set balance_ves = 987654321, balance_efectivo_ves = 123456789 where store_id = $1", [lab.storeId]],
        ["store_vaults insert", "insert into public.store_vaults (store_id, balance_ves) values ($1, 123456789)", [lab.storeId]],
        ["store_vaults delete", "delete from public.store_vaults where store_id = $1", [lab.storeId]],
        [
          "vault_movements insert",
          "insert into public.vault_movements (store_id, vault_id, type, bucket, amount_ves, amount_ref, notes) values ($1, $2, 'deposit', 'efectivo', 5000, 0, 'CAOS N3')",
          [lab.storeId, vault],
        ],
        ["vault_movements update", "update public.vault_movements set amount_ves = 1 where store_id = $1", [lab.storeId]],
        ["vault_movements delete", "delete from public.vault_movements where store_id = $1", [lab.storeId]],
        [
          "cash_movements insert",
          "insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, notes) values ($1, $2, 'transfer_out', 5000, 0, 'CAOS N3')",
          [lab.storeId, sessionId],
        ],
        ["cash_movements update", "update public.cash_movements set amount_ves = 1 where session_id = $1", [sessionId]],
        ["cash_movements delete", "delete from public.cash_movements where session_id = $1", [sessionId]],
        ["cash_sessions update", "update public.cash_sessions set opening_ves = 999999, vault_transferred_at = clock_timestamp() where id = $1", [sessionId]],
        ["cash_sessions insert", "insert into public.cash_sessions (store_id, register_id, opened_by) values ($1, $2, $3)", [lab.storeId, spare.id, lab.uids.admin]],
        ["cash_sessions delete", "delete from public.cash_sessions where id = $1", [sessionId]],
      ];
      const codes: Record<string, string | null> = {};
      for (const [name, text, params] of attempts) codes[name] = (await as(db, "admin", text, params)).code;

      expect({ codes, estado: await moneyState(sessionId) }).toEqual({
        codes: Object.fromEntries(attempts.map(([name]) => [name, "42501"])),
        estado: before,
      });
    });
  });

  it("N3 · authenticated y anon no tienen privilegios de escritura ni políticas de escritura en las cuatro tablas", async () => {
    const privileges = await sql(
      db,
      "privilegios",
      `select t.name as tabla, r.name as rol,
              has_table_privilege(r.name, 'public.' || t.name, 'INSERT') or has_table_privilege(r.name, 'public.' || t.name, 'UPDATE')
                or has_table_privilege(r.name, 'public.' || t.name, 'DELETE') or has_table_privilege(r.name, 'public.' || t.name, 'TRUNCATE')
                or has_any_column_privilege(r.name, 'public.' || t.name, 'INSERT') or has_any_column_privilege(r.name, 'public.' || t.name, 'UPDATE') as escribe,
              has_table_privilege(r.name, 'public.' || t.name, 'SELECT') as lee
       from unnest($1::text[]) as t(name) cross join unnest(array['anon', 'authenticated']) as r(name)
       order by 1, 2`,
      [[...TABLES]],
    );
    const policies = await sql(
      db,
      "políticas",
      "select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename = any($1::text[]) and cmd <> 'SELECT' order by 1, 2",
      [[...TABLES]],
    );

    expect({ escriben: privileges.filter((p) => p.escribe), lecturas: privileges.filter((p) => p.rol === "authenticated" && p.lee).length, politicas: policies }).toEqual({
      escriben: [],
      lecturas: 4,
      politicas: [],
    });
  });

  it("N3 · las RPC de caja y baúl siguen funcionando para el admin y las lecturas de la tienda no cambian", async () => {
    await withRollback(db, async () => {
      const { sessionId } = await openSession(db, "n3-rpc");
      const s = await sale(db, await product(db, "n3-rpc", 5), 2);
      const bank = await as(db, "admin", BANK_PAYMENT, [s.id, null, s.totalVes]);
      const deposit = await as(db, "admin", "select id from public.register_vault_deposit(100, 0, $1)", [`${TAG} depósito`]);
      const withdrawal = await as(db, "admin", "select id from public.register_vault_withdrawal(40, 0, $1)", [`${TAG} retiro`]);
      const cancelled = await as(db, "admin", "select status::text as status from public.cancel_payment($1::uuid)", [bank.rows[0]?.id]);
      const closed = await as(db, "admin", "select status from public.close_cash_session($1::uuid, 25, 0)", [sessionId]);
      const transferred = await as(db, "admin", "select id from public.transfer_cash_closures_to_vault(array[$1::uuid])", [sessionId]);

      const reads: Record<string, unknown> = {};
      for (const table of TABLES) {
        const column = table === "cash_sessions" ? "id" : table === "cash_movements" ? "session_id" : "store_id";
        const value = table === "cash_sessions" || table === "cash_movements" ? sessionId : lab.storeId;
        const res = await as(db, "admin", `select count(*)::int > 0 as hay from public.${table} where ${column} = $1`, [value]);
        reads[table] = res.code ?? res.rows[0]?.hay;
      }
      const sellerVault = await as(db, "vendedor1", "select count(*)::int as n from public.store_vaults where store_id = $1", [lab.storeId]);
      const outsider = await asUser(db, otherAdmin, "select count(*)::int as n from public.cash_sessions where id = $1", [sessionId]);

      expect({
        rpc: [bank.code, deposit.code, withdrawal.code, cancelled.code, closed.code, transferred.code],
        pago: cancelled.rows[0]?.status,
        cierre: closed.rows[0]?.status,
        lecturas: reads,
        vendedor: sellerVault.rows[0]?.n,
        otraTienda: outsider.rows[0]?.n,
      }).toEqual({
        rpc: [null, null, null, null, null, null],
        pago: "anulado",
        cierre: "closed",
        lecturas: { store_vaults: true, vault_movements: true, cash_movements: true, cash_sessions: true },
        vendedor: 1,
        otraTienda: 0,
      });
    });
  });
});
