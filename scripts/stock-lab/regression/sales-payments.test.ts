/**
 * STK-412 · Regresión de las causas de capa RPC en ventas y pagos (C4, C7, C8, C10, C11, C19).
 *
 * Cada test enuncia el comportamiento SANO y hoy está ROJO: reproduce una causa
 * de `.notes/stock-integrity-gtm/causes.md` sin corregir (la corrección es de la
 * fase 5). Corre contra la base lab local (`npm run stock-lab:test`), por el
 * camino real: supabase-js con la anon key + sesión de un usuario lab. `pg`
 * (rol postgres) solo prepara datos y lee el resultado; las dos carreras (C10,
 * C11) usan conexiones `pg` con `role authenticated` + `request.jwt.claims` de
 * los vendedores lab para poder intercalar las transacciones de forma determinista.
 *
 * Datos propios con prefijo `R412-<nonce>`; se borran en `afterAll`. Un fallo
 * de preparación lanza un error que empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type SaleLine = { product_id: string; quantity: number; unit_price_ref?: number };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `R412-${NONCE}`;

let lab: Lab;
let seq = 0;
const productIds: string[] = [];

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
  return { data, error };
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

async function rate(): Promise<number> {
  const row = await one(
    "select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  return Number(row.rate_ves);
}

function nextInvoice(): string {
  seq += 1;
  return `${TAG}-V${seq}`;
}

/**
 * Producto propio. Nace con stock 0 por `pg` y recibe su stock por `adjust_stock`
 * (lab-admin), para no depender de que la base siga aceptando `current_stock`
 * escrito a mano cuando se corrija C1/C2.
 */
async function mkProduct(key: string, stock: number, price = 1): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${key}-${seq}`;
  const row = await one(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, $4, 0.5, 0, 0, true) returning id`,
    [lab.storeId, sku, `Producto ${sku}`, price],
  );
  const id = String(row.id);
  productIds.push(id);
  await rpcOk("admin", "adjust_stock", {
    p_product_id: id,
    p_quantity_delta: stock,
    p_reason: `${TAG} inventario inicial`,
    p_type: "inventario_inicial",
  });
  if ((await lab.stock(id)) !== stock) throw new Error(`SETUP producto ${sku}: stock inicial distinto de ${stock}`);
  return id;
}

/** Venta sin cobrar por `create_sale` (número de factura propio: no depende del reloj, ver C11). */
async function mkSale(role: LabRoleKey, lines: SaleLine[]): Promise<Row> {
  return rpcOk(role, "create_sale", {
    p_customer_id: lab.customerId,
    p_items: lines.map((line) => ({ unit_price_ref: 1, ...line })),
    p_exchange_rate_id: null,
    p_ref_rate_ves: await rate(),
    p_invoice_number: nextInvoice(),
  });
}

async function withPaymentsArgs(lines: SaleLine[], clientRequestId: string): Promise<Row> {
  return {
    p_customer_id: lab.customerId,
    p_items: lines.map((line) => ({ unit_price_ref: 1, ...line })),
    p_payments: [],
    p_exchange_rate_id: null,
    p_ref_rate_ves: await rate(),
    p_invoice_number: nextInvoice(),
    p_client_request_id: clientRequestId,
  };
}

async function saleRow(id: unknown): Promise<Row> {
  return one(
    "select id, status::text as status, user_id, total_ref::float8 as total_ref, total_ves::float8 as total_ves, paid_ves::float8 as paid_ves from public.sales where id = $1",
    [id],
  );
}

async function saleItems(id: unknown): Promise<Array<{ product_id: string; quantity: number }>> {
  return lab.rows<{ product_id: string; quantity: number }>(
    "select product_id, quantity from public.sale_items where sale_id = $1 order by product_id",
    [id],
  );
}

/** Los cobros en efectivo exigen sesión de caja abierta del vendedor: se abre si no hay y no se cierra. */
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
  // Otro proceso pudo abrirla a la vez: lo que importa es que quede una abierta.
  if ((await open()).length === 0) throw new Error(`SETUP caja de ${role}: ${res.error?.message ?? "sin sesión abierta"}`);
}

/** Borra todo lo creado por este archivo; si algo lo impide, deja los productos inactivos. */
async function cleanup(): Promise<void> {
  if (productIds.length === 0) return;
  try {
    await lab.db.query("begin");
    const sales = (await lab.rows("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
    const payments = (await lab.rows("select id from public.payments where sale_id = any($1::uuid[])", [sales])).map((r) => r.id);
    await lab.db.query("delete from public.cash_movements where payment_id = any($1::uuid[])", [payments]);
    await lab.db.query("delete from public.vault_movements where payment_id = any($1::uuid[])", [payments]);
    await lab.db.query("delete from public.payments where id = any($1::uuid[])", [payments]);
    await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
    await lab.db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
    await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
    await lab.db.query("commit");
  } catch {
    await lab.db.query("rollback").catch(() => undefined);
    await lab.db.query("update public.products set is_active = false where id = any($1::uuid[])", [productIds]).catch(() => undefined);
  }
}

beforeAll(async () => {
  lab = await setup("abrir el laboratorio", () => Lab.open("r412"));
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

// Hipótesis H8 · caso 9.8. Evento reproductor: `qa/STK-408/verdict.md` §3 variantes a1–a4 (misma clave, otro
// carrito → «Venta registrada» con la venta vieja) y `caos/9.8.md` "Variantes nuevas" (venta ajena / cancelada).
// `create_sale_with_payments` devuelve la venta de la clave sin comparar contenido, usuario ni estado:
// supabase/patches/20260909-create-sale-with-payments.sql:73-82.
describe("C4 · la clave de idempotencia no devuelve una venta que no corresponde", () => {
  it("C4 · la misma clave con OTRO carrito no responde con la venta vieja", async () => {
    const productId = await setup("producto", () => mkProduct("c4-carrito", 20));
    const key = randomUUID();
    const first = await setup("primera venta (×2)", async () =>
      rpcOk("vendedor1", "create_sale_with_payments", await withPaymentsArgs([{ product_id: productId, quantity: 2 }], key)),
    );

    const retry = await rpcAs(
      "vendedor1",
      "create_sale_with_payments",
      await setup("argumentos", () => withPaymentsArgs([{ product_id: productId, quantity: 3 }], key)),
    );

    let resultado = "rechazada";
    if (!retry.error) {
      const items = await saleItems((retry.data as Row).id);
      const matches = items.length === 1 && items[0]?.product_id === productId && items[0]?.quantity === 3;
      resultado = matches
        ? "venta con el carrito enviado"
        : `éxito con la venta ${(retry.data as Row).id === first.id ? "vieja" : "de otra clave"} (carrito enviado ×3, venta ×${items[0]?.quantity})`;
    }
    // Sano: 409 (misma clave, payload distinto) o, como mucho, una venta con el carrito enviado.
    expect(resultado).toMatch(/^(rechazada|venta con el carrito enviado)$/);
  });

  it("C4 · la clave de la venta de OTRO vendedor no le devuelve esa venta ajena", async () => {
    const productId = await setup("producto", () => mkProduct("c4-ajena", 20));
    const key = randomUUID();
    const lines = [{ product_id: productId, quantity: 1 }];
    await setup("venta de lab-vendedor-1", async () =>
      rpcOk("vendedor1", "create_sale_with_payments", await withPaymentsArgs(lines, key)),
    );

    const other = await rpcAs("vendedor2", "create_sale_with_payments", await setup("argumentos", () => withPaymentsArgs(lines, key)));

    let resultado = "rechazada";
    if (!other.error) {
      const sale = await saleRow((other.data as Row).id);
      resultado = sale.user_id === lab.uids.vendedor2 ? "venta propia" : "éxito con la venta de lab-vendedor-1";
    }
    expect(resultado).toMatch(/^(rechazada|venta propia)$/);
  });

  it("C4 · la clave de una venta ya CANCELADA no se responde como venta registrada", async () => {
    const productId = await setup("producto", () => mkProduct("c4-cancelada", 20));
    const key = randomUUID();
    const lines = [{ product_id: productId, quantity: 1 }];
    await setup("venta cancelada", async () => {
      const sale = await rpcOk("vendedor1", "create_sale_with_payments", await withPaymentsArgs(lines, key));
      await rpcOk("vendedor1", "cancel_sale", { p_sale_id: sale.id });
      if ((await lab.stock(productId)) !== 20) throw new Error("la cancelación no devolvió el stock");
    });

    const retry = await rpcAs("vendedor1", "create_sale_with_payments", await setup("argumentos", () => withPaymentsArgs(lines, key)));

    let resultado = "rechazada";
    if (!retry.error) {
      const sale = await saleRow((retry.data as Row).id);
      resultado = ["cancelada", "devuelta"].includes(String(sale.status))
        ? `éxito con una venta ${sale.status} (stock ${await lab.stock(productId)} de 20: no se vendió nada)`
        : "venta viva";
    }
    expect(resultado).toMatch(/^(rechazada|venta viva)$/);
  });

  // Hallazgo G15 (`causes.md`, sin test propio en fase 4): dos peticiones simultáneas con la misma clave y el
  // mismo carrito chocaban en `sales_store_client_request_unique` y la perdedora recibía 23505 → 409.
  it("C4 · dos peticiones simultáneas con la misma clave y el mismo carrito devuelven la MISMA venta (sin 23505)", async () => {
    const productId = await setup("producto", () => mkProduct("c4-carrera", 20));
    const key = randomUUID();
    const r = await setup("tasa", rate);
    const [t1, t2] = await setup("conexiones", async () => [await lab.pg(), await lab.pg()]);
    const pid2 = Number((await t2.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);

    // Sin `p_invoice_number`, como el POS. Determinista: T1 registra la venta y NO confirma; T2 envía lo mismo y queda en espera; T1 confirma.
    const call = async (client: Client): Promise<string> => {
      await client.query("begin");
      await actAs(client, lab.uids.vendedor1);
      const res = await client.query<{ id: string }>(
        `select (public.create_sale_with_payments(
           p_customer_id => $1::uuid, p_items => $2::jsonb, p_payments => '[]'::jsonb,
           p_ref_rate_ves => $3::numeric, p_client_request_id => $4::uuid)).id`,
        [lab.customerId, JSON.stringify([{ product_id: productId, quantity: 2, unit_price_ref: 1 }]), r, key],
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

    const sales = await lab.rows("select id from public.sales where store_id = $1 and client_request_id = $2", [lab.storeId, key]);
    // Sano: la segunda recibe la venta de la primera; una sola venta y el stock descontado una vez.
    expect({ segunda: second === first ? "la misma venta" : second, ventas: sales.length, stock: await lab.stock(productId) }).toEqual({
      segunda: "la misma venta",
      ventas: 1,
      stock: 18,
    });
  });
});

// Hipótesis H4 · hueco G3 · caso 9.4. Evento reproductor: ola `w5-chaos` caso `9.4.paid` (30/30), `w4-hyp`
// `h04.dg3` y `qa/STK-409/verdict.md` §3.3 (venta `devuelta`, pago `activo`, `cancel_payment` → 409).
// `return_sale` no mira los pagos de la venta: supabase/patches/20260810-rpc-store-context.sql:884 (:913-915).
describe("C7 · return_sale y los pagos activos", () => {
  it("C7 · return_sale no deja la venta devuelta con un pago activo", async () => {
    const { sale, paymentId } = await setup("venta cobrada", async () => {
      await ensureCashSession("vendedor1");
      const created = await mkSale("vendedor1", [{ product_id: await mkProduct("c7", 10), quantity: 1 }]);
      const payment = await rpcOk("vendedor1", "register_payment", {
        p_sale_id: created.id,
        p_method: "efectivo_ves",
        p_amount: Number(created.total_ves),
      });
      if ((await saleRow(created.id)).status !== "pagada") throw new Error("la venta no quedó pagada");
      return { sale: created, paymentId: payment.id };
    });

    await rpcAs("vendedor1", "return_sale", { p_sale_id: sale.id });

    const after = await saleRow(sale.id);
    const payment = await one("select status::text as status from public.payments where id = $1", [paymentId]);
    const trapped = after.status === "devuelta" && payment.status === "activo" ? 1 : 0;
    // Sano: o la devolución se rechaza hasta anular el pago (como `cancel_sale`), o lo anula/reembolsa ella misma.
    expect({ venta: after.status, pago: payment.status, pagosActivosEnVentaDevuelta: trapped }).toMatchObject({
      pagosActivosEnVentaDevuelta: 0,
    });
  });
});

// Caso propio de caos N1. Evento reproductor: `caos/propios.md` §N1 y `caos/scripts/b2-resurrect.ts`
// (2/2 corridas, 5/5 ciclos: pago 201 sobre venta `devuelta` → `pendiente_pago` → otra devolución, stock 10→15).
// `register_payment` fija el estado sin mirar el previo: supabase/patches/20260904-payment-guards.sql:289.
describe("C8 · register_payment sobre ventas en estado terminal", () => {
  beforeAll(async () => {
    await setup("caja abierta", () => ensureCashSession("vendedor1"));
  });

  it.each([
    { estado: "devuelta", reverse: "return_sale" },
    { estado: "cancelada", reverse: "cancel_sale" },
  ])("C8 · register_payment rechaza el pago de una venta $estado y no le cambia el estado", async ({ estado, reverse }) => {
    const sale = await setup(`venta ${estado}`, async () => {
      const created = await mkSale("vendedor1", [{ product_id: await mkProduct(`c8-${estado}`, 10), quantity: 1 }]);
      await rpcOk("vendedor1", reverse, { p_sale_id: created.id });
      if ((await saleRow(created.id)).status !== estado) throw new Error(`la venta no quedó ${estado}`);
      return created;
    });

    const pay = await rpcAs("vendedor1", "register_payment", { p_sale_id: sale.id, p_method: "efectivo_ves", p_amount: 1 });

    const after = await saleRow(sale.id);
    expect({ pagoRechazado: pay.error !== null, venta: after.status, cobrado: after.paid_ves }).toEqual({
      pagoRechazado: true,
      venta: estado,
      cobrado: 0,
    });
  });

  it("C8 · el ciclo pago mínimo → return_sale sobre una venta ya devuelta no vuelve a sumar stock", async () => {
    const productId = await setup("producto", () => mkProduct("c8-ciclo", 10));
    const sale = await setup("venta devuelta", async () => {
      const created = await mkSale("vendedor1", [{ product_id: productId, quantity: 1 }]);
      await rpcOk("vendedor1", "return_sale", { p_sale_id: created.id });
      if ((await lab.stock(productId)) !== 10) throw new Error("la primera devolución no dejó el stock en 10");
      return created;
    });

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await rpcAs("vendedor1", "register_payment", { p_sale_id: sale.id, p_method: "efectivo_ves", p_amount: 1 });
      await rpcAs("vendedor1", "return_sale", { p_sale_id: sale.id });
    }

    const returns = await one(
      "select count(*)::int as n from public.stock_movements where sale_id = $1 and type = 'devolucion_cliente'",
      [sale.id],
    );
    // Sano: una venta de 1 unidad se devuelve una sola vez; el stock vuelve a 10 y ahí se queda.
    expect({ stock: await lab.stock(productId), devoluciones: returns.n }).toEqual({ stock: 10, devoluciones: 1 });
  });
});

// Hueco G7 · caso 9.10. Evento reproductor: ola `w5-chaos` caso `9.10` (30/30 `500 deadlock detected`) y
// `qa/STK-407/verdict.md` C2 (seed 42 L210/L211). `create_sale` bloquea `products` en el orden de las líneas
// del cliente: supabase/patches/20260904c-sale-integrity.sql:154-168.
//
// Determinista: T1 vende [A, X, B] y T2 vende [B, Y, A]; una conexión auxiliar retiene X e Y, así que con el
// código actual T1 queda con A esperando X y T2 con B esperando Y. Al soltar X e Y cada una pide el producto
// que tiene la otra: el deadlock ocurre SIEMPRE. Con bloqueo en orden fijo (o reintento) terminan las dos.
describe("C10 · ventas cruzadas sin deadlock", () => {
  it("C10 · dos ventas con los mismos productos en orden inverso terminan las dos sin 40P01", async () => {
    const [a, b, x, y] = await setup("productos", async () => [
      await mkProduct("c10-a", 10),
      await mkProduct("c10-b", 10),
      await mkProduct("c10-x", 10),
      await mkProduct("c10-y", 10),
    ]);
    const r = await setup("tasa", rate);
    const [holder, t1, t2] = await setup("conexiones", async () => [await lab.pg(), await lab.pg(), await lab.pg()]);
    const pidOf = async (client: Client): Promise<number> =>
      Number((await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);

    /** Venta como el vendedor (auth.uid() real) en su propia transacción; siempre termina en ROLLBACK. */
    const sell = async (client: Client, role: "vendedor1" | "vendedor2", order: string[]): Promise<string> => {
      try {
        await client.query("begin");
        await actAs(client, lab.uids[role]);
        await client.query(
          "select (public.create_sale($1::uuid, $2::jsonb, null, $3::numeric, 0, 0, null, $4::text)).id",
          [lab.customerId, JSON.stringify(order.map((id) => ({ product_id: id, quantity: 1, unit_price_ref: 1 }))), r, nextInvoice()],
        );
        return "ok";
      } catch (error) {
        const code = (error as { code?: string }).code;
        return `${code ?? "error"} ${messageOf(error)}`;
      } finally {
        await client.query("rollback").catch(() => undefined);
      }
    };

    let results: string[] = [];
    try {
      const pids = await setup("pids", async () => [await pidOf(t1), await pidOf(t2)]);
      await setup("retener X e Y", async () => {
        await holder.query("begin");
        await holder.query("select id from public.products where id = any($1::uuid[]) for update", [[x, y]]);
      });
      const p1 = sell(t1, "vendedor1", [a, x, b]);
      const p2 = sell(t2, "vendedor2", [b, y, a]);
      await setup("las dos ventas en espera de un bloqueo", async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waiting = await lab.rows(
            "select pid from pg_stat_activity where pid = any($1::int[]) and wait_event_type = 'Lock'",
            [pids],
          );
          if (waiting.length === 2) return;
          await new Promise((done) => setTimeout(done, 100));
        }
        throw new Error("las ventas no llegaron a quedar bloqueadas en 10 s");
      });
      await holder.query("rollback");
      results = await Promise.all([p1, p2]);
    } finally {
      await holder.query("rollback").catch(() => undefined);
    }

    // Sano: ninguna de las dos ventas válidas muere por `40P01 deadlock detected`.
    expect(results).toEqual(["ok", "ok"]);
  });
});

// Hallazgo nuevo de 8.2 / 9.3. Evento reproductor: `qa/STK-407/verdict.md` C1 + `manual-repro.log` R1 (ronda 5:
// 23 × 201 + 1 × 409, Postgres `duplicate key … "sales_store_invoice_unique"`). El número de factura es
// 'V-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') (resolución de 1 ms) con índice único por tienda:
// supabase/patches/20260904c-sale-integrity.sql:141.
//
// Determinista con barrera: 20 conexiones (los dos vendedores, un producto cada una) esperan un advisory lock
// y, al soltarlo, ejecutan `create_sale` a la vez dentro de la base (sin red de por medio). Cada una anota
// cuándo cruzó la barrera y cuándo terminó. Una ronda es "densa" si las 20 cruzaron en menos de 18 ms: más
// ventas que milisegundos. Con la expresión actual eso produce 23505 (si además terminaron en < 18 ms, por el
// principio del palomar, SIEMPRE). El test exige 3 rondas densas sin ningún 23505; si no junta 3 rondas densas
// en 8 intentos falla con SETUP, nunca pasa por azar. Falso verde residual con el código actual: haría falta
// que, en 3 rondas seguidas, 20 inserts que arrancan en el mismo instante cayeran en 20 ms distintos.
describe("C11 · número de factura sin colisiones", () => {
  it("C11 · ventas simultáneas de la misma tienda no chocan por invoice_number (0 errores 23505)", async () => {
    const WORKERS = 20;
    const DENSE_ROUNDS = 3;
    const MAX_ROUNDS = 8;
    const barrier = 412_000_000 + Math.floor(Math.random() * 1_000_000);
    const r = await setup("tasa", rate);
    const holder = await setup("conexión de la barrera", () => lab.pg());
    const workers = await setup("conexiones y productos", async () => {
      const out: Array<{ client: Client; pid: number; block: string }> = [];
      for (let index = 0; index < WORKERS; index += 1) {
        const client = await lab.pg();
        const uid = lab.uids[index % 2 === 0 ? "vendedor1" : "vendedor2"];
        const productId = await mkProduct(`c11-${index}`, MAX_ROUNDS);
        const pid = Number((await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);
        // Rol y JWT a nivel de sesión: cada venta es su propia transacción (autocommit), como en PostgREST.
        await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
        await client.query("set role authenticated");
        // Sin `p_invoice_number`: el número lo genera la RPC. Los literales son uuid/números propios del test.
        const block = `do $r412$
          declare v_start float8; v_res text := 'ok';
          begin
            perform pg_advisory_xact_lock_shared(${barrier});
            v_start := extract(epoch from clock_timestamp()) * 1000;
            begin
              perform public.create_sale('${lab.customerId}'::uuid, '[{"product_id":"${productId}","quantity":1,"unit_price_ref":1}]'::jsonb, null, ${r}::numeric);
            exception when others then
              v_res := sqlstate || ' ' || sqlerrm;
            end;
            perform set_config('r412.res', v_start::text || '|' || (extract(epoch from clock_timestamp()) * 1000)::float8::text || '|' || v_res, false);
          end $r412$`;
        out.push({ client, pid, block });
      }
      return out;
    });

    const rounds: Array<{ startMs: number; endMs: number; codes: string[] }> = [];
    try {
      for (let round = 0; round < MAX_ROUNDS && rounds.length < DENSE_ROUNDS; round += 1) {
        const outcome = await setup(`ronda ${round + 1}`, async () => {
          await holder.query("select pg_advisory_lock($1)", [barrier]);
          let pending: Array<Promise<unknown>> = [];
          try {
            pending = workers.map(({ client, block }) => client.query(block));
            for (let attempt = 0; ; attempt += 1) {
              const waiting = await lab.rows(
                "select pid from pg_stat_activity where pid = any($1::int[]) and wait_event_type = 'Lock'",
                [workers.map((worker) => worker.pid)],
              );
              if (waiting.length === WORKERS) break;
              if (attempt >= 100) throw new Error("las ventas no llegaron a la barrera en 10 s");
              await new Promise((done) => setTimeout(done, 100));
            }
          } finally {
            await holder.query("select pg_advisory_unlock($1)", [barrier]);
          }
          await Promise.all(pending);
          const marks = await Promise.all(
            workers.map(async ({ client }) =>
              String((await client.query<{ res: string }>("select current_setting('r412.res') as res")).rows[0]?.res).split("|"),
            ),
          );
          const starts = marks.map((mark) => Number(mark[0]));
          const ends = marks.map((mark) => Number(mark[1]));
          return {
            startMs: Math.max(...starts) - Math.min(...starts),
            endMs: Math.max(...ends) - Math.min(...starts),
            codes: marks.map((mark) => mark.slice(2).join("|")),
          };
        });
        const others = outcome.codes.filter((code) => code !== "ok" && !code.startsWith("23505"));
        if (others.length > 0) throw new Error(`SETUP errores ajenos a la colisión: ${others.slice(0, 3).join(" | ")}`);
        // Ronda válida si chocó (la causa, sin más) o si fue densa: más ventas que milisegundos.
        if (outcome.codes.some((code) => code !== "ok") || outcome.startMs < WORKERS - 2) rounds.push(outcome);
      }
    } finally {
      for (const { client } of workers) await client.query("reset role").catch(() => undefined);
    }

    if (rounds.length < DENSE_ROUNDS) {
      throw new Error(`SETUP densidad insuficiente: solo ${rounds.length} de ${MAX_ROUNDS} rondas con ${WORKERS} ventas en menos de ${WORKERS - 2} ms`);
    }
    const codes = rounds.flatMap((round) => round.codes);
    // Sano: todas las ventas válidas se registran aunque caigan en el mismo milisegundo.
    expect({
      registradas: codes.filter((code) => code === "ok").length,
      duplicadas23505: codes.filter((code) => code.startsWith("23505")).length,
      ventanasMs: rounds.map((round) => `${round.startMs.toFixed(1)}→${round.endMs.toFixed(1)}`).join(", "),
    }).toMatchObject({ registradas: WORKERS * DENSE_ROUNDS, duplicadas23505: 0 });
  });
});

// Caso propio de caos N4. Evento reproductor: `caos/propios.md` §N4 y `caos/scripts/b1-bodies.ts` sondas 23, 25
// y 26 (3/3 → 201 como lab-vendedor-1). `create_sale` solo rechaza el precio exactamente 0 y recorta el total
// con `greatest(..., 0)`: supabase/patches/20260904c-sale-integrity.sql:39 (guarda de precio cero y cálculo del total).
describe("C19 · el vendedor no regala mercancía por precio o descuento", () => {
  const LIST_PRICE = 10;

  const sell = async (key: string, line: Partial<SaleLine>, discountRef: number) => {
    const productId = await setup("producto", () => mkProduct(key, 10, LIST_PRICE));
    const r = await setup("tasa", rate);
    const res = await rpcAs("vendedor1", "create_sale", {
      p_customer_id: lab.customerId,
      p_items: [{ product_id: productId, quantity: 1, ...line }],
      p_exchange_rate_id: null,
      p_ref_rate_ves: r,
      p_discount_ref: discountRef,
      p_invoice_number: nextInvoice(),
    });
    const sale = res.error ? null : await saleRow((res.data as Row).id);
    return { sale, stock: await lab.stock(productId) };
  };

  it("C19 · create_sale no deja al vendedor vender a 0,01 un producto de 10,00 de lista", async () => {
    const { sale, stock } = await sell("c19-precio", { unit_price_ref: 0.01 }, 0);

    const resultado = !sale
      ? "rechazada"
      : Number(sale.total_ref) >= LIST_PRICE
        ? "cobrada a precio de lista"
        : `vendida en ${Number(sale.total_ref).toFixed(2)} REF (lista ${LIST_PRICE.toFixed(2)}), stock ${stock}`;
    // Sano: se rechaza, o se ignora el precio del cliente y se cobra el de lista.
    expect(resultado).toMatch(/^(rechazada|cobrada a precio de lista)$/);
  });

  it.each([
    { caso: "mayor que el subtotal", discount: 50 },
    { caso: "igual al subtotal", discount: LIST_PRICE },
  ])("C19 · create_sale no registra una venta en 0 con un descuento $caso", async ({ discount }) => {
    const { sale, stock } = await sell("c19-descuento", { unit_price_ref: LIST_PRICE }, discount);

    const resultado = !sale
      ? "rechazada"
      : Number(sale.total_ref) > 0
        ? "venta con total mayor que cero"
        : `venta en ${Number(sale.total_ref).toFixed(2)} REF con descuento ${discount.toFixed(2)} sobre ${LIST_PRICE.toFixed(2)}, stock ${stock}`;
    expect(resultado).toMatch(/^(rechazada|venta con total mayor que cero)$/);
  });
});
