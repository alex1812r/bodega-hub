/** @jest-environment node */
/**
 * STK-516 · regresión de los hallazgos de la revisión de RPC (`.notes/stock-integrity-gtm/rpc-review.md`):
 * R2 (asiento de cuadre de caja ejecutable por cualquiera), R3 (compra cancelada / devuelta con pagos
 * activos), R5 (cobro concurrente con el cierre de caja) y R6 (entradas mal formadas con error crudo).
 * R1 vive en `integrity-views.test.ts` ("…y luego cancel_sale del resto").
 *
 * Cada test enuncia el comportamiento SANO (parche 20261006f-rpc-review-fixes.sql). Camino real: supabase-js
 * con la anon key + sesión de un usuario lab; `pg` (rol postgres) solo prepara datos y lee el resultado, y las
 * carreras usan conexiones `pg` con `role authenticated` + `request.jwt.claims`.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/rpc-review.test.ts
 *
 * Datos propios con prefijo `R516-<nonce>`; se borran al terminar. Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import type { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcOut = { data: unknown; error: { message: string; code?: string } | null };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `R516-${NONCE}`;

let lab: Lab;
let rateVes = 0;
let seq = 0;
const productIds: string[] = [];
const registerIds: string[] = [];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

async function setup<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`SETUP · ${what}: ${messageOf(error)}`);
  }
}

function nextTag(name: string): string {
  seq += 1;
  return `${TAG}-${name}-${seq}`;
}

async function rpc(role: LabRoleKey, fn: string, args: Row): Promise<RpcOut> {
  const client = await lab.supa(role);
  const { data, error } = await client.rpc(fn, args);
  return { data, error: error ? { message: error.message, code: error.code } : null };
}

/** RPC de preparación: si falla, el test no pudo montarse. */
async function mustRpc(what: string, role: LabRoleKey, fn: string, args: Row): Promise<Row> {
  const res = await rpc(role, fn, args);
  if (res.error) throw new Error(`SETUP · ${what}: ${fn} → ${res.error.code ?? ""} ${res.error.message}`);
  return (res.data ?? {}) as Row;
}

async function one(text: string, params: unknown[]): Promise<Row> {
  const rows = await lab.rows(text, params);
  if (!rows[0]) throw new Error(`SETUP · sin filas: ${text}`);
  return rows[0];
}

/** Producto propio; el stock inicial entra por `adjust_stock(inventario_inicial)` como lab-admin. */
async function product(name: string, stock: number): Promise<string> {
  const sku = nextTag(name);
  const row = await setup(`producto ${sku}`, () =>
    one(
      `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $3, 1, 1, 0, 0, true) returning id`,
      [lab.storeId, sku, sku],
    ),
  );
  const id = String(row.id);
  productIds.push(id);
  if (stock > 0) {
    await mustRpc(`stock inicial de ${sku}`, "admin", "adjust_stock", {
      p_product_id: id,
      p_quantity_delta: stock,
      p_reason: `${TAG} inventario inicial`,
      p_type: "inventario_inicial",
    });
  }
  return id;
}

function saleArgs(item: Row, extra: Row = {}): Row {
  return {
    p_customer_id: lab.customerId,
    p_items: [item],
    p_exchange_rate_id: null,
    p_ref_rate_ves: rateVes,
    p_invoice_number: nextTag("fact"),
    ...extra,
  };
}

function purchaseItem(productId: string, quantity: number, extra: Row = {}): Row {
  return {
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
    ...extra,
  };
}

function purchaseArgs(item: Row, quantity: number, extra: Row = {}): Row {
  return {
    p_supplier_id: lab.supplierId,
    p_items: [item],
    p_ref_rate_ves: rateVes,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_purchase_number: nextTag("compra"),
    p_status: "recibido",
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: quantity * rateVes,
    p_subtotal_ref: quantity,
    ...extra,
  };
}

/** Caja propia sin vendedor asignado y su sesión abierta por lab-admin (fondo 0: no toca el baúl). */
async function ownOpenSession(name: string): Promise<string> {
  const register = await setup(`caja ${name}`, () =>
    one("insert into public.cash_registers (store_id, name, is_active) values ($1, $2, true) returning id", [
      lab.storeId,
      nextTag(name),
    ]),
  );
  registerIds.push(String(register.id));
  const session = await mustRpc(`abrir la caja ${name}`, "admin", "open_cash_session", {
    p_register_id: register.id,
    p_opening_ves: 0,
    p_opening_ref: 0,
  });
  return String(session.id);
}

/** Efectivo físico que explican los movimientos de la sesión (misma fórmula que `close_cash_session`). */
async function sessionCash(sessionId: string): Promise<{ status: string; closing: number | null; movimientos: number }> {
  const row = await one(
    `select s.status, s.closing_ves::float8 as closing,
            (s.opening_ves + coalesce((select sum(case
               when m.type in ('sale_in', 'adjustment') then m.amount_ves
               when m.type in ('transfer_out', 'refund_out', 'change_out') then -m.amount_ves else 0 end)
             from public.cash_movements m where m.session_id = s.id), 0))::float8 as movimientos
     from public.cash_sessions s where s.id = $1`,
    [sessionId],
  );
  return { status: String(row.status), closing: row.closing === null ? null : Number(row.closing), movimientos: Number(row.movimientos) };
}

async function waitForLock(pid: number, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await lab.rows("select pid from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'", [pid]);
    if (waiting.length === 1) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`SETUP · ${what} no llegó a esperar en 10 s`);
}

async function backendPid(client: Client): Promise<number> {
  return Number((await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);
}

async function cleanup(): Promise<void> {
  const db = lab.db;
  try {
    await db.query("begin");
    const sales = (await lab.rows("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
    const purchases = (await lab.rows("select distinct purchase_id as id from public.purchase_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
    const payments = (await lab.rows("select id from public.payments where sale_id = any($1::uuid[]) or purchase_id = any($2::uuid[])", [sales, purchases])).map((r) => r.id);
    const sessions = (await lab.rows("select id from public.cash_sessions where register_id = any($1::uuid[])", [registerIds])).map((r) => r.id);
    await db.query("delete from public.cash_movements where payment_id = any($1::uuid[]) or session_id = any($2::uuid[])", [payments, sessions]);
    await db.query("delete from public.vault_movements where payment_id = any($1::uuid[])", [payments]);
    await db.query("delete from public.payments where id = any($1::uuid[])", [payments]);
    await db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
    await db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
    await db.query("delete from public.purchases where id = any($1::uuid[])", [purchases]);
    await db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
    await db.query("delete from public.cash_sessions where id = any($1::uuid[])", [sessions]);
    await db.query("delete from public.cash_registers where id = any($1::uuid[])", [registerIds]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    await db.query("update public.products set is_active = false where id = any($1::uuid[])", [productIds]).catch(() => undefined);
    await db.query("update public.cash_registers set is_active = false where id = any($1::uuid[])", [registerIds]).catch(() => undefined);
    console.warn(`STK-516: no se pudieron borrar los datos ${TAG} (quedan inactivos): ${messageOf(error)}`);
  }
}

beforeAll(async () => {
  lab = await setup("abrir la base lab", () => Lab.open("r516"));
  const row = await setup("tasa vigente", () =>
    one("select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1", [lab.storeId]),
  );
  rateVes = Number(row.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP · la tienda lab no tiene tasa de cambio");
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

// rpc-review R2: `record_cash_close_difference` es security definer, recibe tienda / sesión / responsable del
// llamante, no comprueba contexto ni rol y era ejecutable por `authenticated` vía /rpc
// (supabase/patches/20260904b-cash-lifecycle.sql:139 y :549).
describe("R2 · el asiento de cuadre de caja no se puede escribir por /rpc", () => {
  it.each(["vendedor2", "admin"] as const)(
    "R2 · %s llamando a record_cash_close_difference sobre una sesión abierta no deja movimientos",
    async (role) => {
      const sessionId = await ownOpenSession(`r2-${role}`);

      const res = await rpc(role, "record_cash_close_difference", {
        p_store_id: lab.storeId,
        p_session_id: sessionId,
        p_counted_ves: 500,
        p_counted_ref: 0,
        p_theoretical_ves: 0,
        p_theoretical_ref: 0,
        p_actor: lab.uids[role],
        p_reason: `${TAG} r2`,
      });

      const rows = await lab.rows("select type, amount_ves::float8 as amount_ves from public.cash_movements where session_id = $1", [sessionId]);
      expect({ rechazada: res.error !== null, movimientos: rows }).toEqual({ rechazada: true, movimientos: [] });
    },
  );

  it("R2 · close_cash_session sigue asentando el sobrante y el faltante del cierre", async () => {
    const over = await ownOpenSession("r2-sobrante");
    await mustRpc("cerrar con sobrante", "admin", "close_cash_session", { p_session_id: over, p_closing_ves: 7, p_closing_ref: 0 });
    const overRows = await lab.rows(
      "select type, amount_ves::float8 as amount_ves, created_by from public.cash_movements where session_id = $1",
      [over],
    );

    expect({ sesion: await sessionCash(over), movimientos: overRows }).toEqual({
      sesion: { status: "closed", closing: 7, movimientos: 7 },
      movimientos: [{ type: "adjustment", amount_ves: 7, created_by: lab.uids.admin }],
    });
  });

  it("R2 · un vendedor que no abrió la caja no puede cerrarla (ni asentar su diferencia)", async () => {
    const sessionId = await ownOpenSession("r2-ajena");

    const res = await rpc("vendedor2", "close_cash_session", { p_session_id: sessionId, p_closing_ves: 9, p_closing_ref: 0 });

    const rows = await lab.rows("select type from public.cash_movements where session_id = $1", [sessionId]);
    expect({ rechazada: res.error !== null, sesion: (await sessionCash(sessionId)).status, movimientos: rows }).toEqual({
      rechazada: true,
      sesion: "open",
      movimientos: [],
    });
  });
});

// rpc-review R3: `cancel_purchase` / `return_purchase` no miraban los pagos activos; la compra quedaba
// cancelada / devuelta con el pago `activo` y `cancel_payment` respondía PT409 para siempre
// (20261006c:882-963 y :1008-1092; bloqueo en cancel_payment_apply, 20261006b:235-237).
describe("R3 · una compra con pagos activos no se cancela ni se devuelve", () => {
  it.each([
    { fn: "cancel_purchase", final: "cancelado" },
    { fn: "return_purchase", final: "devuelto" },
  ])("R3 · $fn exige anular antes los pagos y después deja el baúl como estaba", async ({ fn, final }) => {
    const p = await product(`r3-${fn}`, 0);
    const { purchaseId, paymentId, vaultBefore } = await setup("compra recibida y pagada desde el baúl", async () => {
      const created = await mustRpc("compra", "almacen", "create_purchase", purchaseArgs(purchaseItem(p, 4), 4));
      await mustRpc("depósito al baúl", "admin", "register_vault_deposit", {
        p_amount_ves: Number(created.total_ves),
        p_amount_ref: 0,
        p_notes: `${TAG} r3`,
      });
      const before = await one("select balance_efectivo_ves::float8 as saldo from public.store_vaults where store_id = $1", [lab.storeId]);
      const payment = await mustRpc("pago de la compra", "admin", "register_payment", {
        p_purchase_id: created.id,
        p_method: "efectivo_ves",
        p_amount: Number(created.total_ves),
      });
      return { purchaseId: String(created.id), paymentId: String(payment.id), vaultBefore: Number(before.saldo) };
    });
    const state = async (): Promise<Row> => {
      const purchase = await one("select status::text as status, paid_ves::float8 as paid_ves from public.purchases where id = $1", [purchaseId]);
      const payment = await one("select status::text as status from public.payments where id = $1", [paymentId]);
      const vault = await one("select balance_efectivo_ves::float8 as saldo from public.store_vaults where store_id = $1", [lab.storeId]);
      return { compra: purchase.status, pago: payment.status, pagado: Number(purchase.paid_ves) > 0, stock: await lab.stock(p), baul: Number(vault.saldo) - vaultBefore };
    };
    const paid = await state();
    // Descuadre baúl ↔ vault_movements de la tienda: se compara antes / después (no depende de corridas previas).
    const vaultCheck = (): Promise<Row[]> =>
      lab.rows("select concepto, diferencia::float8 as diferencia from public.vault_balance_check where store_id = $1 order by concepto", [lab.storeId]);
    const checkBefore = await vaultCheck();

    const blocked = await rpc("almacen", fn, { p_purchase_id: purchaseId });

    // Sano: PT409 con mensaje para el usuario y nada se mueve (ni compra, ni stock, ni pago, ni baúl).
    expect({ code: blocked.error?.code, mensaje: blocked.error?.message ?? "", estado: await state() }).toEqual({
      code: "PT409",
      mensaje: expect.stringMatching(/pago\(s\) activo\(s\).*Anula primero los pagos/),
      estado: paid,
    });

    // El camino que sí cuadra: anular el pago (el dinero vuelve al baúl) y entonces revertir la compra.
    const cancelled = await rpc("admin", "cancel_payment", { p_payment_id: paymentId });
    const reverted = await rpc("almacen", fn, { p_purchase_id: purchaseId });
    expect({ anular: cancelled.error, revertir: reverted.error, estado: await state(), descuadre: await vaultCheck() }).toEqual({
      anular: null,
      revertir: null,
      estado: { compra: final, pago: "anulado", pagado: false, stock: 0, baul: 0 },
      descuadre: checkBefore,
    });
  });
});

// rpc-review R5(a): `register_payment` leía la sesión de caja sin bloquearla. Con `close_cash_session` en
// curso el cobro veía la sesión `open`, esperaba en el FK de `cash_movements` y entraba tras el commit en una
// sesión ya cerrada: el cierre guardado no incluía ese efectivo (20261006c:1813-1826 y :1857-1868).
describe("R5 · un cobro concurrente con el cierre de caja no queda fuera del cierre", () => {
  async function pendingSale(name: string): Promise<{ id: string; totalVes: number }> {
    const p = await product(name, 5);
    const sale = await mustRpc("venta", "admin", "create_sale", saleArgs({ product_id: p, quantity: 1, unit_price_ref: 1 }));
    return { id: String(sale.id), totalVes: Number(sale.total_ves) };
  }

  async function begin(client: Client): Promise<void> {
    await client.query("begin");
    await actAs(client, lab.uids.admin);
  }

  const PAY_SQL = "select (public.register_payment(p_sale_id => $1::uuid, p_method => 'efectivo_ves', p_amount => $2::numeric)).id";
  const CLOSE_SQL = "select (public.close_cash_session($1::uuid, $2::numeric, 0)).id";

  it("R5 · cierre sin confirmar → cobro en espera → el cierre confirma: el efectivo de la sesión cerrada cuadra con su cierre", async () => {
    const sessionId = await ownOpenSession("r5-cierre-primero");
    const sale = await setup("venta pendiente", () => pendingSale("r5a"));
    const [closer, payer] = await setup("conexiones", async () => [await lab.pg(), await lab.pg()]);
    const payerPid = await backendPid(payer);

    let outcome = "";
    try {
      await setup("cierre sin confirmar", async () => {
        await begin(closer);
        await closer.query(CLOSE_SQL, [sessionId, 0]);
      });
      await begin(payer);
      const pending = payer
        .query(PAY_SQL, [sale.id, sale.totalVes])
        .then(async () => {
          await payer.query("commit");
          return "cobro aceptado";
        })
        .catch(async (error: unknown) => {
          await payer.query("rollback").catch(() => undefined);
          return `cobro rechazado ${(error as { code?: string }).code ?? ""}`;
        });
      await waitForLock(payerPid, "el cobro");
      await closer.query("commit");
      outcome = await pending;
    } finally {
      await closer.query("rollback").catch(() => undefined);
      await payer.query("rollback").catch(() => undefined);
    }

    // Sano: el cobro se rechaza (PT409) y la sesión cerrada conserva exactamente lo que se contó.
    expect({ cobro: outcome, sesion: await sessionCash(sessionId) }).toEqual({
      cobro: "cobro rechazado PT409",
      sesion: { status: "closed", closing: 0, movimientos: 0 },
    });
  });

  it("R5 · cobro sin confirmar → cierre en espera → el cobro confirma: el cierre incluye ese efectivo", async () => {
    const sessionId = await ownOpenSession("r5-cobro-primero");
    const sale = await setup("venta pendiente", () => pendingSale("r5b"));
    const [closer, payer] = await setup("conexiones", async () => [await lab.pg(), await lab.pg()]);
    const closerPid = await backendPid(closer);

    let outcome = "";
    try {
      await setup("cobro sin confirmar", async () => {
        await begin(payer);
        await payer.query(PAY_SQL, [sale.id, sale.totalVes]);
      });
      await begin(closer);
      const pending = closer
        .query(CLOSE_SQL, [sessionId, sale.totalVes])
        .then(async () => {
          await closer.query("commit");
          return "cierre aceptado";
        })
        .catch(async (error: unknown) => {
          await closer.query("rollback").catch(() => undefined);
          return `cierre rechazado ${(error as { code?: string }).code ?? ""} ${messageOf(error)}`;
        });
      await waitForLock(closerPid, "el cierre");
      await payer.query("commit");
      outcome = await pending;
    } finally {
      await closer.query("rollback").catch(() => undefined);
      await payer.query("rollback").catch(() => undefined);
    }

    const diffs = await lab.rows("select type from public.cash_movements where session_id = $1 and type in ('adjustment', 'transfer_out')", [sessionId]);
    expect({ cierre: outcome, sesion: await sessionCash(sessionId), diferencias: diffs }).toEqual({
      cierre: "cierre aceptado",
      sesion: { status: "closed", closing: sale.totalVes, movimientos: sale.totalVes },
      diferencias: [],
    });
  });
});

// rpc-review R6: los casts del jsonb se hacían sin validar y los negativos / duplicados llegaban a los
// constraints: el usuario recibía 22P02 / 22003 / 23514 / 23505 crudos (20261006b:429-490 y :664-671;
// 20261006c:363-465).
describe("R6 · las entradas mal formadas se rechazan con un error de negocio", () => {
  let p = "";
  const BIG = 99999999999999;

  beforeAll(async () => {
    p = await product("r6", 50);
  });

  const item = (extra: Row = {}): Row => ({ product_id: p, quantity: 1, unit_price_ref: 1, ...extra });

  it.each<[string, () => Row]>([
    ["product_id que no es uuid", () => saleArgs(item({ product_id: "no-es-uuid" }))],
    ["quantity decimal", () => saleArgs(item({ quantity: 1.5 }))],
    ["quantity fuera de rango", () => saleArgs(item({ quantity: 99999999999 }))],
    ["unit_price_ref no numérico", () => saleArgs(item({ unit_price_ref: "abc" }))],
    ["unit_price_ref fuera de rango", () => saleArgs(item({ unit_price_ref: BIG }))],
    ["tasa fuera de rango", () => saleArgs(item(), { p_ref_rate_ves: BIG })],
    ["descuento negativo", () => saleArgs(item(), { p_discount_ref: -1 })],
    ["impuesto negativo", () => saleArgs(item(), { p_tax_ref: -1 })],
  ])("R6 · create_sale con %s → PT400", async (_name, args) => {
    const res = await rpc("admin", "create_sale", args());

    expect({ code: res.error?.code, stock: await lab.stock(p) }).toEqual({ code: "PT400", stock: 50 });
  });

  it.each<[string, Row]>([
    ["método de pago desconocido", { method: "bitcoin", amount: 1 }],
    ["monto no numérico", { method: "efectivo_ves", amount: "x" }],
    ["vuelto no numérico", { method: "efectivo_ves", amount: 1, change_method: "efectivo_ves", change_amount: "y" }],
    ["pago que no es un objeto", 7 as unknown as Row],
  ])("R6 · create_sale_with_payments con %s → PT400 y sin venta", async (_name, payment) => {
    const key = randomUUID();

    const res = await rpc("admin", "create_sale_with_payments", { ...saleArgs(item()), p_payments: [payment], p_client_request_id: key });

    const sales = await lab.rows("select id from public.sales where store_id = $1 and client_request_id = $2", [lab.storeId, key]);
    expect({ code: res.error?.code, ventas: sales.length, stock: await lab.stock(p) }).toEqual({ code: "PT400", ventas: 0, stock: 50 });
  });

  it.each<[string, () => Row]>([
    ["product_id que no es uuid", () => purchaseArgs(purchaseItem("no-es-uuid", 1), 1)],
    ["quantity decimal", () => purchaseArgs(purchaseItem(p, 1, { quantity: 2.5 }), 1)],
    ["tax_rate no numérico", () => purchaseArgs(purchaseItem(p, 1, { tax_rate: "iva" }), 1)],
    ["unit_cost_ref fuera de rango", () => purchaseArgs(purchaseItem(p, 1, { unit_cost_ref: BIG }), 1)],
    [
      "pack_count × units_per_pack fuera de rango",
      () =>
        purchaseArgs(
          purchaseItem(p, 1, { entry_mode: "pack", pack_label: "Bulto", pack_count: 100000, units_per_pack: 100000, pack_cost_ref: 1, pack_cost_ves: rateVes }),
          1,
        ),
    ],
    ["tasa fuera de rango", () => purchaseArgs(purchaseItem(p, 1), 1, { p_ref_rate_ves: BIG })],
  ])("R6 · create_purchase con %s → PT400", async (_name, args) => {
    const res = await rpc("almacen", "create_purchase", args());

    expect({ code: res.error?.code, stock: await lab.stock(p) }).toEqual({ code: "PT400", stock: 50 });
  });

  it("R6 · un número de factura repetido → PT409 con mensaje para el usuario", async () => {
    const args = saleArgs(item());
    await mustRpc("primera venta", "admin", "create_sale", args);

    const res = await rpc("admin", "create_sale", args);

    expect({ code: res.error?.code, mensaje: res.error?.message ?? "", stock: await lab.stock(p) }).toEqual({
      code: "PT409",
      mensaje: expect.stringContaining(String(args.p_invoice_number)),
      stock: 49,
    });
  });

  it("R6 · un número de compra repetido → PT409 con mensaje para el usuario", async () => {
    const before = await lab.stock(p);
    const args = purchaseArgs(purchaseItem(p, 1), 1);
    await mustRpc("primera compra", "almacen", "create_purchase", args);

    const res = await rpc("almacen", "create_purchase", args);

    expect({ code: res.error?.code, mensaje: res.error?.message ?? "", stock: await lab.stock(p) }).toEqual({
      code: "PT409",
      mensaje: expect.stringContaining(String(args.p_purchase_number)),
      stock: before + 1,
    });
  });

  it("R6 · las entradas válidas de siempre se siguen aceptando (número como texto, decimales largos)", async () => {
    const before = await lab.stock(p);

    const sale = await rpc("admin", "create_sale", saleArgs(item({ quantity: "2", unit_price_ref: 1.123456 })));
    const withPayments = await rpc("admin", "create_sale_with_payments", { ...saleArgs(item()), p_payments: [], p_client_request_id: randomUUID() });

    expect({ venta: sale.error, conPagos: withPayments.error, stock: await lab.stock(p) }).toEqual({
      venta: null,
      conPagos: null,
      stock: before - 3,
    });
  });
});
