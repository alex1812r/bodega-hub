/**
 * PAG-06a · P4-3 — clave de idempotencia de `register_payment`
 * (supabase/patches/20261008a-register-payment-idempotency.sql).
 *
 * Un reintento de `POST /api/payments` tras un corte de red llega a la base como
 * la misma llamada con la misma `p_client_request_id`: debe devolver el pago
 * original sin insertar otro pago ni mover caja, baúl o el saldo del documento.
 *
 * Corre contra la base lab local (`npm run stock-lab:test`) por el camino real:
 * supabase-js con la anon key + sesión de un usuario lab. `pg` (rol postgres)
 * solo prepara datos y lee el resultado; la carrera usa dos conexiones `pg` con
 * `role authenticated` + `request.jwt.claims` para intercalar las transacciones
 * de forma determinista.
 *
 * Datos propios con prefijo `PAG06-<nonce>`; se borran en `afterAll` y el baúl
 * vuelve a los saldos que tenía. Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type Doc = { sale: string } | { purchase: string };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `PAG06-${NONCE}`;

let lab: Lab;
let rateVes = 0;
let seq = 0;
let vaultBefore: Row | null = null;
const productIds: string[] = [];
const saleIds: string[] = [];
const purchaseIds: string[] = [];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

/** Envuelve una fase de preparación: si falla, el error dice SETUP (no es la reproducción). */
async function setup<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`SETUP ${what}: ${messageOf(error)}`);
  }
}

async function rpc(client: SupabaseClient, fn: string, args: Row): Promise<RpcResult> {
  const { data, error } = await client.rpc(fn, args);
  return { data, error: error ? { message: error.message, code: error.code } : null };
}

async function rpcAs(role: LabRoleKey, fn: string, args: Row): Promise<RpcResult> {
  return rpc(await setup(`sesión de ${role}`, () => lab.supa(role)), fn, args);
}

/** RPC de preparación: debe funcionar; si no, es un fallo de SETUP. */
async function rpcOk(role: LabRoleKey, fn: string, args: Row): Promise<Row> {
  const res = await rpcAs(role, fn, args);
  if (res.error) throw new Error(`SETUP ${fn} como ${role}: ${res.error.code ?? ""} ${res.error.message}`);
  return (res.data ?? {}) as Row;
}

async function one(text: string, params: unknown[]): Promise<Row> {
  const rows = await lab.rows(text, params);
  if (!rows[0]) throw new Error(`SETUP sin filas: ${text}`);
  return rows[0];
}

/** Producto propio con stock cargado por `adjust_stock` (nunca `current_stock` a mano). */
async function mkProduct(key: string, stock: number): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${key}-${seq}`;
  const row = await one(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, 1, 0.5, 0, 0, true) returning id`,
    [lab.storeId, sku, `Producto ${sku}`],
  );
  const id = String(row.id);
  productIds.push(id);
  if (stock > 0) {
    await rpcOk("admin", "adjust_stock", {
      p_product_id: id,
      p_quantity_delta: stock,
      p_reason: `${TAG} inventario inicial`,
      p_type: "inventario_inicial",
    });
  }
  return id;
}

/** Venta de lab-vendedor-1 sin cobrar: `units` unidades a 1 REF (total = units × tasa). */
async function mkSale(key: string, units: number): Promise<string> {
  const productId = await mkProduct(key, units);
  seq += 1;
  const sale = await rpcOk("vendedor1", "create_sale", {
    p_customer_id: lab.customerId,
    p_items: [{ product_id: productId, quantity: units, unit_price_ref: 1 }],
    p_exchange_rate_id: null,
    p_ref_rate_ves: rateVes,
    p_invoice_number: `${TAG}-V${seq}`,
  });
  const id = String(sale.id);
  saleIds.push(id);
  return id;
}

/** Compra en `pedido` (no mueve stock) de `units` unidades a 1 REF. */
async function mkPurchase(key: string, units: number): Promise<string> {
  const productId = await mkProduct(key, 0);
  seq += 1;
  const purchase = await rpcOk("almacen", "create_purchase", {
    p_supplier_id: lab.supplierId,
    p_items: [
      {
        product_id: productId,
        cost_currency: "ref",
        unit_cost_ref: 1,
        unit_cost_ves: rateVes,
        subtotal_ref: units,
        subtotal_ves: units * rateVes,
        tax_rate: 0,
        tax_ref: 0,
        tax_ves: 0,
        entry_mode: "unit",
        quantity: units,
      },
    ],
    p_ref_rate_ves: rateVes,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_notes: `${TAG}-C${seq}`,
    p_status: "pedido",
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: units * rateVes,
    p_subtotal_ref: units,
  });
  const id = String(purchase.id);
  purchaseIds.push(id);
  return id;
}

/** Los cobros de venta exigen sesión de caja abierta del vendedor: se abre si no hay y no se cierra. */
async function ensureCashSession(role: "vendedor1" | "vendedor2"): Promise<void> {
  const open = () =>
    lab.rows(
      `select s.id from public.cash_sessions s join public.cash_registers r on r.id = s.register_id
       where r.assigned_user_id = $1 and r.is_active and s.status = 'open'`,
      [lab.uids[role]],
    );
  if ((await open()).length > 0) return;
  const register = await one(
    "select id from public.cash_registers where store_id = $1 and assigned_user_id = $2 and is_active limit 1",
    [lab.storeId, lab.uids[role]],
  );
  const res = await rpcAs(role, "open_cash_session", { p_register_id: register.id, p_opening_ves: 0, p_opening_ref: 0 });
  if ((await open()).length === 0) throw new Error(`SETUP caja de ${role}: ${res.error?.message ?? "sin sesión abierta"}`);
}

async function vaultBalances(): Promise<Row> {
  const rows = await lab.rows(
    `select balance_ves::float8 as cuenta, balance_efectivo_ves::float8 as efectivo, balance_ref::float8 as ref
     from public.store_vaults where store_id = $1`,
    [lab.storeId],
  );
  return rows[0] ?? { cuenta: 0, efectivo: 0, ref: 0 };
}

/** Todo lo que un pago mueve, para un documento: pagos, asientos de caja y baúl, saldo del documento y del baúl. */
async function ledger(doc: Doc): Promise<Row> {
  const [column, table, id] = "sale" in doc ? ["sale_id", "sales", doc.sale] : ["purchase_id", "purchases", doc.purchase];
  const row = await one(
    `select
       (select count(*)::int from public.payments p where p.${column} = $1) as pagos,
       (select count(*)::int from public.payments p where p.${column} = $1 and p.status = 'activo') as activos,
       (select count(*)::int from public.cash_movements m join public.payments p on p.id = m.payment_id where p.${column} = $1) as caja,
       (select count(*)::int from public.vault_movements m join public.payments p on p.id = m.payment_id where p.${column} = $1) as baul,
       (select paid_ves::float8 from public.${table} where id = $1) as pagado`,
    [id],
  );
  return { ...row, saldos: await vaultBalances() };
}

function idOf(res: RpcResult): string {
  return res.error ? `${res.error.code ?? "error"}` : String((res.data as Row | null)?.id);
}

/** Borra todo lo creado por este archivo y devuelve el baúl a sus saldos previos. */
async function cleanup(): Promise<void> {
  try {
    await lab.db.query("begin");
    const payments = (
      await lab.rows("select id from public.payments where sale_id = any($1::uuid[]) or purchase_id = any($2::uuid[])", [
        saleIds,
        purchaseIds,
      ])
    ).map((row) => row.id);
    await lab.db.query("delete from public.cash_movements where payment_id = any($1::uuid[])", [payments]);
    await lab.db.query("delete from public.vault_movements where payment_id = any($1::uuid[]) or (store_id = $2 and notes = $3)", [
      payments,
      lab.storeId,
      `${TAG} fondo`,
    ]);
    await lab.db.query("delete from public.payments where id = any($1::uuid[])", [payments]);
    await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
    await lab.db.query("delete from public.sales where id = any($1::uuid[])", [saleIds]);
    await lab.db.query("delete from public.purchases where id = any($1::uuid[])", [purchaseIds]);
    await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
    if (vaultBefore) {
      await lab.db.query(
        "update public.store_vaults set balance_ves = $2, balance_efectivo_ves = $3, balance_ref = $4 where store_id = $1",
        [lab.storeId, vaultBefore.cuenta, vaultBefore.efectivo, vaultBefore.ref],
      );
    }
    await lab.db.query("commit");
  } catch (error) {
    await lab.db.query("rollback").catch(() => undefined);
    await lab.db.query("update public.products set is_active = false where id = any($1::uuid[])", [productIds]).catch(() => undefined);
    console.warn(`PAG-06a: no se pudieron borrar los datos ${TAG} (quedan inactivos): ${messageOf(error)}`);
  }
}

beforeAll(async () => {
  lab = await setup("abrir el laboratorio", () => Lab.open("pag06"));
  const rate = await setup("tasa vigente", () =>
    one("select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1", [lab.storeId]),
  );
  rateVes = Number(rate.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP la tienda lab no tiene tasa de cambio");
  await setup("caja de lab-vendedor-1", () => ensureCashSession("vendedor1"));
  // Tras abrir la caja (la apertura con fondo 0 no toca el baúl) y antes del fondo propio.
  vaultBefore = await setup("saldos del baúl", vaultBalances);
  // Fondo en efectivo para los pagos a proveedor de este archivo.
  await setup("fondo del baúl", () =>
    rpcOk("admin", "register_vault_deposit", { p_amount_ves: 100 * rateVes, p_amount_ref: 0, p_notes: `${TAG} fondo` }),
  );
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

describe("P4-3 · un reintento con la misma clave no duplica el pago", () => {
  it.each([
    { metodo: "punto_venta", caja: 1, baul: 1 },
    { metodo: "efectivo_ves", caja: 1, baul: 0 },
  ])("venta · $metodo: el replay devuelve el mismo pago y no repite asientos de caja ni de baúl", async ({ metodo, caja, baul }) => {
    const saleId = await setup("venta", () => mkSale(`venta-${metodo}`, 10));
    const args = { p_sale_id: saleId, p_method: metodo, p_amount: 2 * rateVes, p_client_request_id: randomUUID() };

    const first = await rpcAs("vendedor1", "register_payment", args);
    const afterFirst = await ledger({ sale: saleId });
    const retry = await rpcAs("vendedor1", "register_payment", args);

    expect(first.error).toBeNull();
    expect(afterFirst).toMatchObject({ pagos: 1, caja, baul, pagado: 2 * rateVes });
    expect({ replay: idOf(retry) === idOf(first) ? "el mismo pago" : idOf(retry), despues: await ledger({ sale: saleId }) }).toEqual({
      replay: "el mismo pago",
      despues: afterFirst,
    });
  });

  it("venta · efectivo con vuelto: el replay no repite el sale_in ni el change_out", async () => {
    const saleId = await setup("venta", () => mkSale("venta-vuelto", 10));
    const args = {
      p_sale_id: saleId,
      p_method: "efectivo_ves",
      p_amount: 12 * rateVes,
      p_change_method: "efectivo_ves",
      p_change_amount: 2 * rateVes,
      p_client_request_id: randomUUID(),
    };

    const first = await rpcAs("vendedor1", "register_payment", args);
    const afterFirst = await ledger({ sale: saleId });
    const retry = await rpcAs("vendedor1", "register_payment", args);

    expect(first.error).toBeNull();
    expect(afterFirst).toMatchObject({ pagos: 1, caja: 2, baul: 0, pagado: 10 * rateVes });
    expect({ replay: idOf(retry) === idOf(first) ? "el mismo pago" : idOf(retry), despues: await ledger({ sale: saleId }) }).toEqual({
      replay: "el mismo pago",
      despues: afterFirst,
    });
  });

  it("compra · efectivo: el replay devuelve el mismo pago y el baúl baja una sola vez", async () => {
    const purchaseId = await setup("compra", () => mkPurchase("compra", 10));
    const before = await vaultBalances();
    const args = { p_purchase_id: purchaseId, p_method: "efectivo_ves", p_amount: 3 * rateVes, p_client_request_id: randomUUID() };

    const first = await rpcAs("admin", "register_payment", args);
    const afterFirst = await ledger({ purchase: purchaseId });
    const retry = await rpcAs("admin", "register_payment", args);

    expect(first.error).toBeNull();
    expect(afterFirst).toMatchObject({
      pagos: 1,
      caja: 0,
      baul: 1,
      pagado: 3 * rateVes,
      saldos: { ...before, efectivo: Number(before.efectivo) - 3 * rateVes },
    });
    expect({ replay: idOf(retry) === idOf(first) ? "el mismo pago" : idOf(retry), despues: await ledger({ purchase: purchaseId }) }).toEqual({
      replay: "el mismo pago",
      despues: afterFirst,
    });
  });

  it("el replay responde aunque el documento ya haya quedado saldado por ese pago (no PT400 de saldo)", async () => {
    const saleId = await setup("venta", () => mkSale("venta-saldada", 4));
    const args = { p_sale_id: saleId, p_method: "punto_venta", p_amount: 4 * rateVes, p_client_request_id: randomUUID() };

    const first = await rpcAs("vendedor1", "register_payment", args);
    const retry = await rpcAs("vendedor1", "register_payment", args);

    const sale = await one("select status::text as status from public.sales where id = $1", [saleId]);
    expect({ primera: first.error?.code ?? "ok", replay: idOf(retry) === idOf(first) ? "el mismo pago" : idOf(retry), estado: sale.status }).toEqual({
      primera: "ok",
      replay: "el mismo pago",
      estado: "pagada",
    });
    expect(await ledger({ sale: saleId })).toMatchObject({ pagos: 1, caja: 1, baul: 1, pagado: 4 * rateVes });
  });
});

describe("P4-3 · la clave no devuelve un pago que no corresponde (PT409)", () => {
  it("la misma clave con otro monto responde PT409 y no mueve nada", async () => {
    const saleId = await setup("venta", () => mkSale("otro-monto", 10));
    const key = randomUUID();
    await setup("primer pago", () =>
      rpcOk("vendedor1", "register_payment", { p_sale_id: saleId, p_method: "punto_venta", p_amount: rateVes, p_client_request_id: key }),
    );
    const afterFirst = await ledger({ sale: saleId });

    const other = await rpcAs("vendedor1", "register_payment", {
      p_sale_id: saleId,
      p_method: "punto_venta",
      p_amount: 2 * rateVes,
      p_client_request_id: key,
    });

    expect({ codigo: other.error?.code ?? "ok", despues: await ledger({ sale: saleId }) }).toEqual({ codigo: "PT409", despues: afterFirst });
    expect(other.error?.message).toMatch(/clave de idempotencia/i);
  });

  it("la misma clave con otro método, o sobre otro documento, responde PT409", async () => {
    const saleId = await setup("venta", () => mkSale("otro-doc-a", 10));
    const otherSaleId = await setup("otra venta", () => mkSale("otro-doc-b", 10));
    const key = randomUUID();
    await setup("primer pago", () =>
      rpcOk("vendedor1", "register_payment", { p_sale_id: saleId, p_method: "punto_venta", p_amount: rateVes, p_client_request_id: key }),
    );

    const otherMethod = await rpcAs("vendedor1", "register_payment", {
      p_sale_id: saleId,
      p_method: "efectivo_ves",
      p_amount: rateVes,
      p_client_request_id: key,
    });
    const otherDoc = await rpcAs("vendedor1", "register_payment", {
      p_sale_id: otherSaleId,
      p_method: "punto_venta",
      p_amount: rateVes,
      p_client_request_id: key,
    });

    expect({
      otroMetodo: otherMethod.error?.code ?? "ok",
      otroDocumento: otherDoc.error?.code ?? "ok",
      pagosVenta: (await ledger({ sale: saleId })).pagos,
      pagosOtraVenta: (await ledger({ sale: otherSaleId })).pagos,
    }).toEqual({ otroMetodo: "PT409", otroDocumento: "PT409", pagosVenta: 1, pagosOtraVenta: 0 });
  });

  it("la clave del pago de OTRO usuario no le devuelve ese pago ajeno (PT409)", async () => {
    const saleId = await setup("venta", () => mkSale("ajena", 10));
    const args = { p_sale_id: saleId, p_method: "punto_venta", p_amount: rateVes, p_client_request_id: randomUUID() };
    await setup("pago de lab-vendedor-1", () => rpcOk("vendedor1", "register_payment", args));

    const other = await rpcAs("admin", "register_payment", args);

    expect({ codigo: other.error?.code ?? "ok", pagos: (await ledger({ sale: saleId })).pagos }).toEqual({ codigo: "PT409", pagos: 1 });
  });

  it("la clave de un pago ya ANULADO no se responde como pago registrado ni registra otro (PT409)", async () => {
    const purchaseId = await setup("compra", () => mkPurchase("anulado", 10));
    const args = { p_purchase_id: purchaseId, p_method: "efectivo_ves", p_amount: rateVes, p_client_request_id: randomUUID() };
    await setup("pago y anulación", async () => {
      const payment = await rpcOk("admin", "register_payment", args);
      await rpcOk("admin", "cancel_payment", { p_payment_id: payment.id });
    });
    const afterCancel = await ledger({ purchase: purchaseId });

    const retry = await rpcAs("admin", "register_payment", args);

    expect(afterCancel).toMatchObject({ pagos: 1, activos: 0, pagado: 0 });
    expect({ codigo: retry.error?.code ?? "ok", despues: await ledger({ purchase: purchaseId }) }).toEqual({ codigo: "PT409", despues: afterCancel });
  });
});

describe("P4-3 · dos peticiones simultáneas con la misma clave", () => {
  it("una registra y la otra recibe ese mismo pago: 1 pago, 1 asiento de caja, 1 de baúl (sin 23505)", async () => {
    const saleId = await setup("venta", () => mkSale("carrera", 10));
    const key = randomUUID();
    const [t1, t2] = await setup("conexiones", async () => [await lab.pg(), await lab.pg()]);
    const pid2 = Number((await t2.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);

    // Determinista: T1 registra el pago y NO confirma; T2 envía lo mismo y queda en espera del advisory lock; T1 confirma.
    const call = async (client: Client): Promise<string> => {
      await client.query("begin");
      await actAs(client, lab.uids.vendedor1);
      const res = await client.query<{ id: string }>(
        `select (public.register_payment(
           p_sale_id => $1::uuid, p_method => 'punto_venta', p_amount => $2::numeric, p_client_request_id => $3::uuid)).id`,
        [saleId, 2 * rateVes, key],
      );
      return String(res.rows[0]?.id);
    };

    let first = "";
    let second = "";
    try {
      first = await setup("primera petición (sin confirmar)", () => call(t1));
      const pending = call(t2)
        .then(async (id) => {
          await t2.query("commit");
          return id;
        })
        .catch((error: unknown) => `${(error as { code?: string }).code ?? "error"} ${messageOf(error)}`);
      await setup("la segunda petición en espera", async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await lab.rows("select pid from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'", [pid2]);
          if (waiting.length === 1) return;
          await new Promise((done) => setTimeout(done, 100));
        }
        throw new Error("la segunda petición no llegó a esperar a la primera en 10 s");
      });
      await t1.query("commit");
      second = await pending;
    } finally {
      await t1.query("rollback").catch(() => undefined);
      await t2.query("rollback").catch(() => undefined);
    }

    expect({ segunda: second === first ? "el mismo pago" : second, despues: await ledger({ sale: saleId }) }).toMatchObject({
      segunda: "el mismo pago",
      despues: { pagos: 1, caja: 1, baul: 1, pagado: 2 * rateVes },
    });
  });

  it("si la primera se revierte, la que esperaba registra el pago (la clave no queda quemada)", async () => {
    const saleId = await setup("venta", () => mkSale("carrera-rollback", 10));
    const key = randomUUID();
    const [t1, t2] = await setup("conexiones", async () => [await lab.pg(), await lab.pg()]);
    const pid2 = Number((await t2.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);

    const call = async (client: Client): Promise<string> => {
      await client.query("begin");
      await actAs(client, lab.uids.vendedor1);
      const res = await client.query<{ id: string }>(
        `select (public.register_payment(
           p_sale_id => $1::uuid, p_method => 'punto_venta', p_amount => $2::numeric, p_client_request_id => $3::uuid)).id`,
        [saleId, 2 * rateVes, key],
      );
      return String(res.rows[0]?.id);
    };

    let first = "";
    let second = "";
    try {
      first = await setup("primera petición (sin confirmar)", () => call(t1));
      const pending = call(t2)
        .then(async (id) => {
          await t2.query("commit");
          return id;
        })
        .catch((error: unknown) => `${(error as { code?: string }).code ?? "error"} ${messageOf(error)}`);
      await setup("la segunda petición en espera", async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await lab.rows("select pid from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'", [pid2]);
          if (waiting.length === 1) return;
          await new Promise((done) => setTimeout(done, 100));
        }
        throw new Error("la segunda petición no llegó a esperar a la primera en 10 s");
      });
      await t1.query("rollback");
      second = await pending;
    } finally {
      await t1.query("rollback").catch(() => undefined);
      await t2.query("rollback").catch(() => undefined);
    }

    const rows = await lab.rows("select id from public.payments where sale_id = $1", [saleId]);
    expect({ segundaRegistra: /^[0-9a-f-]{36}$/.test(second) && second !== first, pagoVivo: rows[0]?.id === second, despues: await ledger({ sale: saleId }) }).toMatchObject({
      segundaRegistra: true,
      pagoVivo: true,
      despues: { pagos: 1, caja: 1, baul: 1, pagado: 2 * rateVes },
    });
  });
});

describe("P4-3 · sin clave todo sigue igual", () => {
  it("venta: dos envíos idénticos sin clave registran dos pagos con sus asientos (comportamiento de siempre)", async () => {
    const saleId = await setup("venta", () => mkSale("sin-clave-venta", 10));
    const args = { p_sale_id: saleId, p_method: "punto_venta", p_amount: rateVes };

    const first = await rpcAs("vendedor1", "register_payment", args);
    const second = await rpcAs("vendedor1", "register_payment", args);

    expect({ primero: first.error?.code ?? "ok", segundo: second.error?.code ?? "ok", distintos: idOf(first) !== idOf(second) }).toEqual({
      primero: "ok",
      segundo: "ok",
      distintos: true,
    });
    expect(await ledger({ sale: saleId })).toMatchObject({ pagos: 2, caja: 2, baul: 2, pagado: 2 * rateVes });
    const keys = await lab.rows("select client_request_id, client_request_hash from public.payments where sale_id = $1", [saleId]);
    expect(keys.every((row) => row.client_request_id === null && row.client_request_hash === null)).toBe(true);
  });

  it("compra: dos envíos idénticos sin clave registran dos pagos y el baúl baja dos veces", async () => {
    const purchaseId = await setup("compra", () => mkPurchase("sin-clave-compra", 10));
    const before = await vaultBalances();
    const args = { p_purchase_id: purchaseId, p_method: "efectivo_ves", p_amount: rateVes };

    const first = await rpcAs("admin", "register_payment", args);
    const second = await rpcAs("admin", "register_payment", args);

    expect({ primero: first.error?.code ?? "ok", segundo: second.error?.code ?? "ok" }).toEqual({ primero: "ok", segundo: "ok" });
    expect(await ledger({ purchase: purchaseId })).toMatchObject({
      pagos: 2,
      caja: 0,
      baul: 2,
      pagado: 2 * rateVes,
      saldos: { efectivo: Number(before.efectivo) - 2 * rateVes },
    });
  });

  it("dos claves distintas con el mismo contenido son dos pagos", async () => {
    const saleId = await setup("venta", () => mkSale("dos-claves", 10));
    const args = { p_sale_id: saleId, p_method: "punto_venta", p_amount: rateVes };

    const first = await rpcAs("vendedor1", "register_payment", { ...args, p_client_request_id: randomUUID() });
    const second = await rpcAs("vendedor1", "register_payment", { ...args, p_client_request_id: randomUUID() });

    expect({ primero: first.error?.code ?? "ok", segundo: second.error?.code ?? "ok" }).toEqual({ primero: "ok", segundo: "ok" });
    expect(await ledger({ sale: saleId })).toMatchObject({ pagos: 2, caja: 2, baul: 2, pagado: 2 * rateVes });
  });

  it("create_sale_with_payments sigue cobrando por register_payment sin clave (una sola firma viva)", async () => {
    const productId = await setup("producto", () => mkProduct("con-pagos", 5));
    seq += 1;
    const sale = await rpcAs("vendedor1", "create_sale_with_payments", {
      p_customer_id: lab.customerId,
      p_items: [{ product_id: productId, quantity: 2, unit_price_ref: 1 }],
      p_payments: [{ method: "punto_venta", amount: 2 * rateVes }],
      p_exchange_rate_id: null,
      p_ref_rate_ves: rateVes,
      p_invoice_number: `${TAG}-V${seq}`,
      p_client_request_id: randomUUID(),
    });
    const saleId = String((sale.data as Row | null)?.id);
    if (!sale.error) saleIds.push(saleId);

    expect(sale.error).toBeNull();
    const row = await one("select status::text as status from public.sales where id = $1", [saleId]);
    expect({ estado: row.status, ...(await ledger({ sale: saleId })) }).toMatchObject({ estado: "pagada", pagos: 1, caja: 1, baul: 1, pagado: 2 * rateVes });
    const signatures = await lab.rows(
      "select pronargs from pg_proc where pronamespace = 'public'::regnamespace and proname = 'register_payment'",
    );
    expect(signatures.map((row) => Number(row.pronargs))).toEqual([13]);
  });
});
