/** @jest-environment node */
/**
 * STK-601 · regresión del parche `20261006g-rpc-review-fixes-2.sql` (hallazgos de
 * `.notes/stock-integrity-gtm/rpc-review.md` que quedaron abiertos tras el parche f):
 *
 *   R4/C15  `adjust_stock` con `devolucion_cliente` / `devolucion_proveedor` SIN documento → PT400.
 *   tienda  `update_product_price`, `register_supplier_product_price` y `deactivate_supplier_product`
 *           (security definer) no filtraban por tienda ni exigían perfil activo.
 *   R12     `get_open_cash_session_for_user` y `append_supplier_product_price_history` ejecutables por /rpc.
 *   R7      `cancel_payment_apply` borraba el asiento del baúl aunque no encontrara el baúl.
 *   R11     `stock_movements` era solo-append únicamente por grants.
 *   R17     `cancel_sale` y `register_payment` aceptaban ventas en `borrador`.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en
 * `rollback`: los datos se preparan como `postgres` y cada RPC se llama con `set local role authenticated` +
 * `request.jwt.claims` del usuario lab (la ACL probada es la de PostgREST). R11 necesita además una sesión que
 * NO sea `postgres`: entra con el login `authenticator` (el de PostgREST) y llama a una función sonda
 * `security definer` que el propio test crea y borra.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/rpc-review-g.test.ts
 *
 * No depende de `now()` monótono (el reloj del contenedor lab retrocede). Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { resolveStockLabDbUrl, withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `R601-${NONCE}`;
const PROBE = `r601_probe_${NONCE}`;

/** Texto exacto que ve el usuario (la UI / BFF y las herramientas del lab se alinean con él). */
const MSG_RETURN_NEEDS_SALE = "Una devolucion de cliente debe indicar la venta a la que corresponde";
const MSG_RETURN_NEEDS_PURCHASE = "Una devolucion a proveedor debe indicar la compra a la que corresponde";

let lab: Lab;
let db: Client;
let pgrst: Client;
let rateVes = 0;
let seq = 0;
let probeCreated = false;

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
  await client.query("savepoint r601_as_user");
  try {
    await actAs(client, uid);
    const res = await client.query<Row>(text, params);
    await client.query("reset role");
    await client.query("release savepoint r601_as_user");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await client.query("rollback to savepoint r601_as_user");
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

/** Producto propio (stock 0); el stock inicial entra con su movimiento `inventario_inicial` (lo aplica el trigger). */
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

async function stock(client: Client, productId: string): Promise<number> {
  return Number((await one(client, "stock", "select current_stock from public.products where id = $1", [productId])).current_stock);
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

/** Compra recibida de `quantity` unidades a 1 REF como lab-almacén. */
async function purchase(client: Client, productId: string, quantity: number): Promise<{ id: string; totalVes: number }> {
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
  const row = await must(
    client,
    "compra recibida",
    "almacen",
    `select id, total_ves::float8 as total_ves from public.create_purchase(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0, p_tax_ref => 0,
       p_purchase_number => $4, p_status => 'recibido', p_discount_ves => 0, p_tax_ves => 0,
       p_subtotal_ves => $5::numeric, p_subtotal_ref => $6::numeric)`,
    [lab.supplierId, JSON.stringify([item]), rateVes, nextTag("compra"), quantity * rateVes, quantity],
  );
  return { id: String(row.id), totalVes: Number(row.total_ves) };
}

/** Caja propia abierta por lab-admin con fondo 0 (no toca el baúl): los cobros en cuenta exigen una sesión abierta. */
async function openSession(client: Client): Promise<void> {
  const register = await one(
    client,
    "caja propia",
    "insert into public.cash_registers (store_id, name, is_active) values ($1, $2, true) returning id",
    [lab.storeId, nextTag("caja")],
  );
  await must(client, "abrir la caja", "admin", "select id from public.open_cash_session($1::uuid, 0, 0)", [register.id]);
}

const BANK_PAYMENT = `select id from public.register_payment(
  p_sale_id => $1::uuid, p_purchase_id => $2::uuid, p_method => 'transferencia', p_amount => $3::numeric,
  p_bank_name => 'Banco R601', p_reference_code => '00601')`;

beforeAll(async () => {
  lab = await Lab.open("r601");
  db = await lab.pg();
  const rate = await one(
    db,
    "tasa vigente",
    "select rate_ves::float8 as rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  rateVes = Number(rate.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP · la tienda lab no tiene tasa de cambio");

  // R11 — sesión que no es `postgres`: el login de PostgREST (misma clave local que el resto de roles).
  const url = new URL(resolveStockLabDbUrl());
  url.username = "authenticator";
  pgrst = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  await pgrst.connect();

  // Función sonda: lo que haría una RPC `security definer` futura que intentara reescribir el libro.
  await sql(
    db,
    "crear la función sonda de R11",
    `create function public.${PROBE}(p_op text, p_id uuid) returns integer
     language plpgsql security definer set search_path = public as $probe$
     declare v_rows integer := 0;
     begin
       if p_op = 'update' then
         update public.stock_movements set quantity_delta = quantity_delta * 2 where id = p_id;
       elsif p_op = 'stock_after' then
         update public.stock_movements set stock_after = stock_after + 1 where id = p_id;
       elsif p_op = 'delete' then
         delete from public.stock_movements where id = p_id;
       elsif p_op = 'truncate' then
         truncate public.stock_movements;
       elsif p_op = 'unlink' then
         update public.stock_movements set sale_id = null, purchase_id = null, created_by = null where id = p_id;
       else
         raise exception 'op desconocida';
       end if;
       get diagnostics v_rows = row_count;
       return v_rows;
     end;
     $probe$`,
  );
  probeCreated = true;
  await sql(db, "grants de la sonda", `revoke all on function public.${PROBE}(text, uuid) from public, anon`);
  await sql(db, "grants de la sonda", `grant execute on function public.${PROBE}(text, uuid) to authenticated`);
});

afterAll(async () => {
  if (pgrst) await pgrst.end().catch(() => undefined);
  if (!lab) return;
  if (probeCreated) await lab.db.query(`drop function if exists public.${PROBE}(text, uuid)`);
  await lab.close();
});

// rpc-review R4 / C15: el tope «vendido − ya devuelto» solo existía si el llamante enviaba el documento. Una
// devolución SIN documento se aceptaba sin tope y `return_sale` no la descontaba: unidades duplicadas con la
// reconciliación en 0 (20261006c:1187-1197). Decisión: esos dos tipos dejan de existir como ajuste libre.
describe("R4 · una devolución por ajuste exige su documento", () => {
  it.each([
    { type: "devolucion_cliente", delta: 2, mensaje: MSG_RETURN_NEEDS_SALE },
    { type: "devolucion_proveedor", delta: -2, mensaje: MSG_RETURN_NEEDS_PURCHASE },
  ])("R4 · adjust_stock($type) sin documento responde PT400 y no mueve stock", async ({ type, delta, mensaje }) => {
    await withRollback(db, async () => {
      const p = await product(db, `r4-${type}`, 10);

      const res = await as(db, "almacen", "select id from public.adjust_stock($1::uuid, $2::integer, $3, $4::public.stock_movement_type)", [
        p,
        delta,
        `${TAG} devolución suelta`,
        type,
      ]);

      const moves = await sql(db, "movimientos", "select type::text as type from public.stock_movements where product_id = $1 order by seq", [p]);
      expect({ code: res.code, mensaje: res.message, stock: await stock(db, p), movimientos: moves }).toEqual({
        code: "PT400",
        mensaje,
        stock: 10,
        movimientos: [{ type: "inventario_inicial" }],
      });
    });
  });

  it("R4 · la devolución ligada a su venta / compra sigue entrando (con su tope)", async () => {
    await withRollback(db, async () => {
      const sold = await product(db, "r4-venta", 10);
      const bought = await product(db, "r4-compra", 0);
      const s = await sale(db, sold, 3);
      const c = await purchase(db, bought, 4);
      const adjust = `select type::text as type, quantity_delta, sale_id, purchase_id from public.adjust_stock(
        p_product_id => $1::uuid, p_quantity_delta => $2::integer, p_reason => $3, p_type => $4::public.stock_movement_type,
        p_sale_id => $5::uuid, p_purchase_id => $6::uuid)`;

      const fromCustomer = await as(db, "almacen", adjust, [sold, 1, `${TAG} parcial`, "devolucion_cliente", s.id, null]);
      const toSupplier = await as(db, "almacen", adjust, [bought, -1, `${TAG} parcial`, "devolucion_proveedor", null, c.id]);
      const overCap = await as(db, "almacen", adjust, [sold, 3, `${TAG} de más`, "devolucion_cliente", s.id, null]);

      expect({
        cliente: fromCustomer.rows,
        proveedor: toSupplier.rows,
        tope: overCap.code,
        stock: [await stock(db, sold), await stock(db, bought)],
      }).toEqual({
        cliente: [{ type: "devolucion_cliente", quantity_delta: 1, sale_id: s.id, purchase_id: null }],
        proveedor: [{ type: "devolucion_proveedor", quantity_delta: -1, sale_id: null, purchase_id: c.id }],
        tope: "PT409",
        stock: [8, 3],
      });
    });
  });
});

// Tres RPC `security definer` anteriores al plan (supabase-schema.sql y 20260705-supplier-product-pack-cost.sql)
// sin `assert_store_context()` ni filtro de tienda: un admin / almacén de CUALQUIER tienda cambiaba precios,
// costos o desactivaba relaciones de otra, y un token sin perfil pasaba la guarda de rol (`null not in (…)`).
describe("tienda · las RPC de precios y de proveedor-producto solo alcanzan la tienda del usuario", () => {
  const UPDATE_PRICE = "select id, sale_price_ref::float8 as sale_price_ref from public.update_product_price($1::uuid, 7.5, $2)";
  const REGISTER_PRICE = "select public.register_supplier_product_price($1::uuid, 3, 300, 'ajuste') as out";
  const DEACTIVATE = "select id, is_active from public.deactivate_supplier_product($1::uuid)";

  async function priceState(productId: string): Promise<Row> {
    const p = await one(db, "precio", "select sale_price_ref::float8 as precio from public.products where id = $1", [productId]);
    const history = await sql(
      db,
      "historial de precio",
      "select old_sale_price_ref::float8 as antes, new_sale_price_ref::float8 as despues, changed_by from public.product_price_history where product_id = $1",
      [productId],
    );
    return { precio: p.precio, historial: history };
  }

  async function supplierProductState(id: string): Promise<Row> {
    const sp = await one(db, "relación", "select last_cost_ref::float8 as costo, is_active from public.supplier_products where id = $1", [id]);
    const history = await one(db, "historial de costo", "select count(*)::int as n from public.supplier_product_price_history where supplier_product_id = $1", [id]);
    return { costo: sp.costo, activa: sp.is_active, historial: history.n };
  }

  it("update_product_price sobre un producto de otra tienda responde PT404 y no cambia nada", async () => {
    await withRollback(db, async () => {
      const foreign = await product(db, "precio-ajeno", 0, lab.defaultStoreId);

      const res = await as(db, "admin", UPDATE_PRICE, [foreign, `${TAG} ajeno`]);

      expect({ code: res.code, mensaje: res.message, estado: await priceState(foreign) }).toEqual({
        code: "PT404",
        mensaje: "Producto no encontrado",
        estado: { precio: 1, historial: [] },
      });
    });
  });

  it("update_product_price sobre un producto propio cambia el precio y deja su historial", async () => {
    await withRollback(db, async () => {
      const own = await product(db, "precio-propio", 0);

      const res = await as(db, "almacen", UPDATE_PRICE, [own, `${TAG} propio`]);

      expect({ code: res.code, fila: res.rows, estado: await priceState(own) }).toEqual({
        code: null,
        fila: [{ id: own, sale_price_ref: 7.5 }],
        estado: { precio: 7.5, historial: [{ antes: 1, despues: 7.5, changed_by: lab.uids.almacen }] },
      });
    });
  });

  it("register_supplier_product_price sobre una relación de otra tienda responde PT404 y no cambia nada", async () => {
    await withRollback(db, async () => {
      const foreign = await supplierProduct(db, "costo-ajeno", lab.defaultStoreId);

      const res = await as(db, "admin", REGISTER_PRICE, [foreign]);

      expect({ code: res.code, mensaje: res.message, estado: await supplierProductState(foreign) }).toEqual({
        code: "PT404",
        mensaje: "Relacion proveedor-producto no encontrada",
        estado: { costo: 2, activa: true, historial: 0 },
      });
    });
  });

  it("register_supplier_product_price sobre una relación propia registra el costo, la variación y el historial", async () => {
    await withRollback(db, async () => {
      const own = await supplierProduct(db, "costo-propio");

      const res = await as(db, "almacen", REGISTER_PRICE, [own]);
      const out = (res.rows[0]?.out ?? {}) as { supplier_product?: Row; variation_percent?: unknown; history_id?: unknown };

      expect({
        code: res.code,
        id: out.supplier_product?.id,
        costo: Number(out.supplier_product?.last_cost_ref),
        variacion: Number(out.variation_percent),
        historial: typeof out.history_id,
        estado: await supplierProductState(own),
      }).toEqual({
        code: null,
        id: own,
        costo: 3,
        variacion: 50,
        historial: "string",
        estado: { costo: 3, activa: true, historial: 1 },
      });
    });
  });

  it("deactivate_supplier_product sobre una relación de otra tienda responde PT404 y la deja activa", async () => {
    await withRollback(db, async () => {
      const foreign = await supplierProduct(db, "baja-ajena", lab.defaultStoreId);

      const res = await as(db, "admin", DEACTIVATE, [foreign]);

      expect({ code: res.code, mensaje: res.message, estado: await supplierProductState(foreign) }).toEqual({
        code: "PT404",
        mensaje: "Relacion proveedor-producto no encontrada",
        estado: { costo: 2, activa: true, historial: 0 },
      });
    });
  });

  it("deactivate_supplier_product sobre una relación propia la desactiva", async () => {
    await withRollback(db, async () => {
      const own = await supplierProduct(db, "baja-propia");

      const res = await as(db, "almacen", DEACTIVATE, [own]);

      expect({ code: res.code, fila: res.rows, estado: await supplierProductState(own) }).toEqual({
        code: null,
        fila: [{ id: own, is_active: false }],
        estado: { costo: 2, activa: false, historial: 0 },
      });
    });
  });

  it("un token sin perfil activo no pasa de assert_store_context en ninguna de las tres (42501)", async () => {
    await withRollback(db, async () => {
      const p = await product(db, "sin-perfil", 0);
      const sp = await supplierProduct(db, "sin-perfil-rel");
      const nobody = randomUUID();

      const codes = {
        update_product_price: (await asUser(db, nobody, UPDATE_PRICE, [p, `${TAG} sin perfil`])).code,
        register_supplier_product_price: (await asUser(db, nobody, REGISTER_PRICE, [sp])).code,
        deactivate_supplier_product: (await asUser(db, nobody, DEACTIVATE, [sp])).code,
      };

      expect({ codes, precio: (await priceState(p)).precio, relacion: await supplierProductState(sp) }).toEqual({
        codes: { update_product_price: "42501", register_supplier_product_price: "42501", deactivate_supplier_product: "42501" },
        precio: 1,
        relacion: { costo: 2, activa: true, historial: 0 },
      });
    });
  });
});

// rpc-review R12: funciones internas `security definer` sin `assert_store_context()` y ejecutables por
// `authenticated` (20260811b-cash-registers-vault.sql:179; supabase-schema.sql:1543 y :2372). Solo las llaman
// otras RPC definer (como propietario): por /rpc dejaban leer la caja de otra tienda o escribir historial de
// costos de cualquier relación con un responsable arbitrario.
describe("R12 · las funciones internas no se ejecutan por /rpc", () => {
  it("get_open_cash_session_for_user no es ejecutable por un usuario (ni de la propia tienda)", async () => {
    await withRollback(db, async () => {
      const res = await as(db, "vendedor2", "select id from public.get_open_cash_session_for_user($1::uuid, $2::uuid)", [
        lab.uids.vendedor1,
        lab.storeId,
      ]);

      expect(res.code).toBe("42501");
    });
  });

  it("append_supplier_product_price_history no es ejecutable por un usuario y no deja historial", async () => {
    await withRollback(db, async () => {
      const sp = await supplierProduct(db, "r12-historial");

      const res = await as(
        db,
        "admin",
        "select public.append_supplier_product_price_history($1::uuid, 1, 100, 9, 900, 'ajuste', $2, $3::uuid)",
        [sp, `${TAG} r12`, lab.uids.vendedor1],
      );

      const history = await one(db, "historial", "select count(*)::int as n from public.supplier_product_price_history where supplier_product_id = $1", [sp]);
      expect({ code: res.code, historial: history.n }).toEqual({ code: "42501", historial: 0 });
    });
  });
});

// rpc-review R7: en las dos ramas bancarias de `cancel_payment_apply` el `select … from store_vaults … for
// update` no comprobaba `found` (20261006b:224-229 y :265-270): sin baúl, el `update` afectaba 0 filas en
// silencio y a continuación se borraba el `vault_movements` — el asiento desaparecía sin revertir el saldo.
// El caso se monta apuntando el asiento al baúl de OTRA tienda (lo único que el FK permite).
describe("R7 · anular un pago bancario sin encontrar el baúl no borra el asiento", () => {
  async function foreignVault(): Promise<string> {
    await sql(db, "baúl de la otra tienda", "select public.ensure_store_vault($1::uuid)", [lab.defaultStoreId]);
    return String((await one(db, "baúl de la otra tienda", "select id from public.store_vaults where store_id = $1", [lab.defaultStoreId])).id);
  }

  async function paymentState(paymentId: string, type: string): Promise<Row> {
    const payment = await one(db, "pago", "select status::text as status from public.payments where id = $1", [paymentId]);
    const entries = await one(db, "asiento del baúl", "select count(*)::int as n from public.vault_movements where payment_id = $1 and type = $2", [
      paymentId,
      type,
    ]);
    return { pago: payment.status, asientos: entries.n };
  }

  it("R7 · cobro de venta en cuenta: PT404, el pago sigue activo y el asiento sale_in sigue ahí", async () => {
    await withRollback(db, async () => {
      await openSession(db);
      const s = await sale(db, await product(db, "r7-venta", 5), 2);
      const payment = String((await must(db, "cobro en cuenta", "admin", BANK_PAYMENT, [s.id, null, s.totalVes])).id);
      await one(db, "apuntar el asiento a otro baúl", "update public.vault_movements set vault_id = $1 where payment_id = $2 and type = 'sale_in' returning id", [
        await foreignVault(),
        payment,
      ]);

      const res = await as(db, "admin", "select id from public.cancel_payment($1::uuid)", [payment]);

      expect({ code: res.code, mensaje: res.message, estado: await paymentState(payment, "sale_in") }).toEqual({
        code: "PT404",
        mensaje: "Baúl no encontrado para revertir el cobro en cuenta",
        estado: { pago: "activo", asientos: 1 },
      });
    });
  });

  it("R7 · pago de compra desde cuenta: PT404, el pago sigue activo y el asiento purchase_out sigue ahí", async () => {
    await withRollback(db, async () => {
      await openSession(db);
      // El cobro en cuenta de una venta deja saldo en la cuenta del baúl para pagar la compra.
      const s = await sale(db, await product(db, "r7-fondos", 5), 3);
      await must(db, "cobro en cuenta", "admin", BANK_PAYMENT, [s.id, null, s.totalVes]);
      const c = await purchase(db, await product(db, "r7-compra", 0), 1);
      const payment = String((await must(db, "pago desde cuenta", "admin", BANK_PAYMENT, [null, c.id, c.totalVes])).id);
      await one(db, "apuntar el asiento a otro baúl", "update public.vault_movements set vault_id = $1 where payment_id = $2 and type = 'purchase_out' returning id", [
        await foreignVault(),
        payment,
      ]);

      const res = await as(db, "admin", "select id from public.cancel_payment($1::uuid)", [payment]);

      expect({ code: res.code, mensaje: res.message, estado: await paymentState(payment, "purchase_out") }).toEqual({
        code: "PT404",
        mensaje: "Baúl no encontrado para revertir el pago desde cuenta",
        estado: { pago: "activo", asientos: 1 },
      });
    });
  });

  it("R7 · con el baúl en su sitio el pago bancario se anula y el saldo de la cuenta vuelve a donde estaba", async () => {
    await withRollback(db, async () => {
      await openSession(db);
      const balance = async (): Promise<number> =>
        Number((await one(db, "saldo en cuenta", "select coalesce((select balance_ves from public.store_vaults where store_id = $1), 0)::float8 as saldo", [lab.storeId])).saldo);
      const s = await sale(db, await product(db, "r7-sano", 5), 2);
      const before = await balance();
      const payment = String((await must(db, "cobro en cuenta", "admin", BANK_PAYMENT, [s.id, null, s.totalVes])).id);
      const paid = await balance();

      const res = await as(db, "admin", "select id from public.cancel_payment($1::uuid)", [payment]);

      expect({ code: res.code, cobrado: paid - before, saldo: (await balance()) - before, estado: await paymentState(payment, "sale_in") }).toEqual({
        code: null,
        cobrado: s.totalVes,
        saldo: 0,
        estado: { pago: "anulado", asientos: 0 },
      });
    });
  });
});

// rpc-review R17: `cancel_sale` y `register_payment` aceptaban ventas en `borrador` (20261006b:746-748;
// 20261006c:1672-1674): cancelar reponía stock que nunca salió y cobrar la pasaba a pendiente / pagada sin
// movimiento. Ninguna RPC crea `borrador` hoy; solo afecta a filas heredadas (aquí se fuerza por SQL).
describe("R17 · una venta en borrador no se cancela ni se cobra", () => {
  async function draftSale(name: string): Promise<{ productId: string; saleId: string; totalVes: number }> {
    const productId = await product(db, name, 5);
    const s = await sale(db, productId, 2);
    await one(db, "pasar la venta a borrador", "update public.sales set status = 'borrador' where id = $1 returning id", [s.id]);
    return { productId, saleId: s.id, totalVes: s.totalVes };
  }

  async function saleState(saleId: string, productId: string): Promise<Row> {
    const row = await one(db, "venta", "select status::text as status, paid_ves::float8 as paid_ves from public.sales where id = $1", [saleId]);
    return { venta: row.status, cobrado: row.paid_ves, stock: await stock(db, productId) };
  }

  it("R17 · cancel_sale sobre una venta en borrador responde PT409 y no repone stock", async () => {
    await withRollback(db, async () => {
      const draft = await draftSale("r17-cancelar");

      const res = await as(db, "admin", "select id from public.cancel_sale($1::uuid)", [draft.saleId]);

      expect({ code: res.code, mensaje: res.message, estado: await saleState(draft.saleId, draft.productId) }).toEqual({
        code: "PT409",
        mensaje: "Solo se pueden cancelar ventas pagadas o pendientes de pago",
        estado: { venta: "borrador", cobrado: 0, stock: 3 },
      });
    });
  });

  it("R17 · register_payment sobre una venta en borrador responde PT409 y no la cobra", async () => {
    await withRollback(db, async () => {
      await openSession(db);
      const draft = await draftSale("r17-cobrar");

      const res = await as(db, "admin", BANK_PAYMENT, [draft.saleId, null, draft.totalVes]);

      const payments = await one(db, "pagos", "select count(*)::int as n from public.payments where sale_id = $1", [draft.saleId]);
      expect({ code: res.code, mensaje: res.message, pagos: payments.n, estado: await saleState(draft.saleId, draft.productId) }).toEqual({
        code: "PT409",
        mensaje: "No se puede registrar un pago en una venta en borrador",
        pagos: 0,
        estado: { venta: "borrador", cobrado: 0, stock: 3 },
      });
    });
  });
});

// rpc-review R11: el «solo-append» de `stock_movements` eran únicamente grants (20261006a:193-195): cualquier
// función `security definer` (propietario postgres) podía reescribir `quantity_delta` / `stock_after` o borrar
// filas. La sonda hace exactamente eso desde una sesión de PostgREST (`session_user = authenticator`).
describe("R11 · el libro de movimientos no se reescribe ni se borra fuera de una conexión directa", () => {
  /** Dentro de una transacción de la sesión `authenticator`, como lab-admin: venta real → su movimiento. */
  async function withSaleMovement<T>(fn: (movementId: string) => Promise<T>): Promise<T> {
    const target = await one(
      db,
      "producto lab con stock",
      "select id from public.products where store_id = $1 and is_active and current_stock >= 1 order by sku limit 1",
      [lab.storeId],
    );
    return withRollback(pgrst, async () => {
      const s = await sale(pgrst, String(target.id), 1);
      const found = await as(pgrst, "admin", "select id from public.stock_movements where sale_id = $1::uuid", [s.id]);
      if (!found.rows[0]) throw new Error(`SETUP · la venta no dejó movimiento visible: ${found.code ?? ""} ${found.message}`);
      return fn(String(found.rows[0].id));
    });
  }

  const probe = (op: string, id: string): Promise<Outcome> => as(pgrst, "admin", `select public.${PROBE}($1, $2::uuid) as filas`, [op, id]);

  it.each(["update", "stock_after", "delete", "truncate"])("R11 · una función definer no puede hacer «%s» sobre stock_movements (PT409)", async (op) => {
    await withSaleMovement(async (movementId) => {
      const res = await probe(op, movementId);

      const row = await as(pgrst, "admin", "select quantity_delta from public.stock_movements where id = $1::uuid", [movementId]);
      expect({ code: res.code, mensaje: res.message, movimiento: row.rows }).toEqual({
        code: "PT409",
        mensaje: "Los movimientos de inventario no se modifican ni se borran: registra un movimiento de ajuste",
        movimiento: [{ quantity_delta: -1 }],
      });
    });
  });

  it("R11 · soltar el vínculo con el documento o el usuario borrados (FK on delete set null) sigue permitido", async () => {
    await withSaleMovement(async (movementId) => {
      const res = await probe("unlink", movementId);

      const row = await as(pgrst, "admin", "select quantity_delta, sale_id, created_by from public.stock_movements where id = $1::uuid", [movementId]);
      expect({ code: res.code, filas: res.rows, movimiento: row.rows }).toEqual({
        code: null,
        filas: [{ filas: 1 }],
        movimiento: [{ quantity_delta: -1, sale_id: null, created_by: null }],
      });
    });
  });

  it("R11 · la conexión directa (postgres: seed, limpieza de tests, one-shots) conserva update y delete", async () => {
    await withRollback(db, async () => {
      const p = await product(db, "r11-directa", 4);

      const updated = await sql(db, "update directo", "update public.stock_movements set reason = $2 where product_id = $1 returning id", [p, `${TAG} directo`]);
      const deleted = await sql(db, "delete directo", "delete from public.stock_movements where product_id = $1 returning id", [p]);

      expect({ actualizadas: updated.length, borradas: deleted.length }).toEqual({ actualizadas: 1, borradas: 1 });
    });
  });
});
