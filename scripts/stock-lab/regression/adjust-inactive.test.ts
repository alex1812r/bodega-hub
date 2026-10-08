/** @jest-environment node */
/**
 * COM-15a · regresión del parche `20261011b-adjust-stock-inactive.sql`: `adjust_stock` rechaza (PT409) la entrada
 * libre de stock a un producto INACTIVO; las salidas y las devoluciones ligadas a su documento no cambian, y sobre
 * un producto activo la función se comporta igual que la de `20261006g` (test diferencial).
 *
 * Cada test enuncia el comportamiento SANO. Casi todo corre por `pg` dentro de una transacción que termina en
 * `rollback`: los datos se preparan como `postgres` (el stock entra insertando el movimiento) y cada llamada probada
 * se ejecuta con `set local role authenticated` + `request.jwt.claims` del usuario lab, en un savepoint que se
 * deshace si la llamada falla (lo que hace PostgREST con la transacción de una petición rechazada). El último bloque
 * sí pasa por PostgREST con datos confirmados que se borran al terminar.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/adjust-inactive.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };
type Step = {
  delta: number | null;
  type?: string | null;
  reason?: string | null;
  key?: string | null;
  saleId?: string | null;
  purchaseId?: string | null;
  actor?: LabRoleKey;
  /** Otro producto que el del caso (p. ej. uno que no existe). */
  product?: string;
};
/** Lo comparable de una llamada: sin id, seq ni created_at; `movement` es el ordinal del movimiento devuelto. */
type Seen = { code: string | null; message: string; movement: number | null; row: Row | null };
type Trace = { calls: Seen[]; footprint: Row };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261011b-adjust-stock-inactive.sql";
const PREVIOUS_PATCH = "20261006g-rpc-review-fixes-2.sql";
const PREVIOUS_FN = "adjust_stock_20261006g";
const SIGNATURE =
  "p_product_id uuid, p_quantity_delta integer, p_reason text, p_type stock_movement_type, p_client_request_id uuid, p_sale_id uuid, p_purchase_id uuid";
const INACTIVE_MESSAGE = "El producto esta inactivo: reactivalo antes de registrar una entrada de stock";
const VOLATILE = ["id", "seq", "created_at"];
const TAG = `COM15A-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;

let lab: Lab;
let db: Client;
let rateVes = 0;
let seq = 0;

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
 * Ejecuta la sentencia en un savepoint como `actor`. Devuelve las filas o el error (SQLSTATE + mensaje) sin lanzarlo
 * y deja la transacción utilizable y en el rol de la sesión. Si falla, no queda nada de la sentencia.
 */
async function run(actor: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint com15a_call");
  try {
    await actAs(db, lab.uids[actor]);
    const { rows } = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint com15a_call");
    return { rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint com15a_call");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

async function must(actor: LabRoleKey, what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  const out = await run(actor, text, params);
  if (out.code !== null) throw new Error(`SETUP · ${what}: ${out.code} ${out.message}`);
  return out.rows;
}

/** Texto de `create or replace function public.adjust_stock(…) … $$;` de un parche, instalable con otro nombre. */
function adjustStockOf(patch: string, installAs: string): string {
  const text = readFileSync(resolve(PATCHES, patch), "utf8");
  const match = /create or replace function public\.adjust_stock\([\s\S]*?\n\$\$;/.exec(text);
  if (!match) throw new Error(`SETUP · ${patch} no define adjust_stock`);
  return match[0].replace("function public.adjust_stock(", `function public.${installAs}(`);
}

/** El parche sin su `begin;` / `commit;` (para aplicarlo dentro de la transacción del test) ni el `notify`. */
function patchBody(): string {
  const text = readFileSync(resolve(PATCHES, PATCH), "utf8");
  const begins = text.match(/^begin;\r?$/gm)?.length ?? 0;
  const commits = text.match(/^commit;\r?$/gm)?.length ?? 0;
  if (begins !== 1 || commits !== 1) throw new Error(`SETUP · el parche debe tener un begin y un commit (${begins}/${commits})`);
  return text.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "").replace(/^notify pgrst.*$/m, "");
}

/** Instala la `adjust_stock` de 20261006g con otro nombre (dentro de la transacción del test). */
async function installPrevious(): Promise<void> {
  await sql(`instalar ${PREVIOUS_FN}`, adjustStockOf(PREVIOUS_PATCH, PREVIOUS_FN));
}

/**
 * Producto propio creado como `postgres`. Nace activo, el stock entra con un movimiento `inventario_inicial` (lo
 * aplica el trigger del libro) y, si se pide inactivo, se desactiva al final.
 */
async function product(name: string, options: { stock?: number; active?: boolean } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${name}-${seq}`.toLowerCase();
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, 1, 1, 0, 0, true) returning id`,
    [lab.storeId, sku],
  );
  const id = String(row.id);
  if ((options.stock ?? 0) > 0) {
    await sql(
      `stock inicial de ${sku}`,
      "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'inventario_inicial', $2, $3, $4)",
      [id, options.stock, TAG, lab.storeId],
    );
  }
  if (options.active === false) await setActive(id, false);
  return id;
}

async function setActive(id: string, active: boolean): Promise<void> {
  await sql(`is_active = ${active}`, "update public.products set is_active = $2 where id = $1", [id, active]);
}

/** Venta de `quantity` unidades (queda `pendiente_pago`) hecha por el vendedor lab; devuelve su id. */
async function sale(productId: string, quantity: number): Promise<string> {
  seq += 1;
  const tag = `${TAG}-venta-${seq}`;
  const rows = await must(
    "vendedor1",
    `venta de ${quantity}`,
    `select id from public.create_sale(
       p_customer_id => $1, p_items => $2::jsonb, p_ref_rate_ves => $3, p_notes => $4, p_invoice_number => $5)`,
    [lab.customerId, JSON.stringify([{ product_id: productId, quantity, unit_price_ref: 1 }]), rateVes, tag, `${tag}-fact`],
  );
  return String(rows[0]?.id);
}

/** Compra `recibido` de `quantity` unidades (costo 1 REF, sin IVA) hecha por almacén; devuelve su id. */
async function purchase(productId: string, quantity: number): Promise<string> {
  seq += 1;
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
  const rows = await must(
    "almacen",
    `compra de ${quantity}`,
    `select id from public.create_purchase(
       p_supplier_id => $1, p_items => $2::jsonb, p_ref_rate_ves => $3, p_discount_ref => 0, p_tax_ref => 0,
       p_notes => $4, p_status => 'recibido', p_discount_ves => 0, p_tax_ves => 0, p_subtotal_ves => $5,
       p_subtotal_ref => $6)`,
    [lab.supplierId, JSON.stringify([item]), rateVes, `${TAG}-compra-${seq}`, quantity * rateVes, quantity],
  );
  return String(rows[0]?.id);
}

/** Una llamada a `adjust_stock` (o a la versión anterior instalada con otro nombre) con los 7 argumentos por nombre. */
function adjust(productId: string, step: Step, fn = "adjust_stock"): Promise<Outcome> {
  return run(
    step.actor ?? "almacen",
    `select to_jsonb(m) as result
     from public.${fn}(
       p_product_id => $1, p_quantity_delta => $2, p_reason => $3, p_type => $4::public.stock_movement_type,
       p_client_request_id => $5, p_sale_id => $6, p_purchase_id => $7) m`,
    [step.product ?? productId, step.delta, step.reason ?? null, step.type ?? null, step.key ?? null, step.saleId ?? null, step.purchaseId ?? null],
  );
}

const movementOf = (out: Outcome): Row | null => (out.rows[0]?.result as Row | undefined) ?? null;

/** Todo lo que deja un ajuste: producto, su libro en orden y las claves de idempotencia de la tienda con esas claves. */
async function footprint(productId: string, keys: readonly string[] = []): Promise<Row> {
  const state = await one("estado del producto", "select current_stock, is_active from public.products where id = $1", [productId]);
  const movements = await sql(
    "movimientos del producto",
    `select type::text as type, quantity_delta, stock_after, sale_id, purchase_id, reason, created_by, store_id
     from public.stock_movements where product_id = $1 order by seq`,
    [productId],
  );
  const requests = await sql(
    "claves de idempotencia",
    `select client_request_id, operation, request_hash, user_id, store_id, result - $2::text[] as result
     from public.stock_request_keys where client_request_id = any($1::uuid[]) order by client_request_id`,
    [keys, VOLATILE],
  );
  return { stock: state.current_stock, active: state.is_active, movements, requests };
}

/**
 * Ejecuta los pasos con `fn` sobre el producto y devuelve lo que respondió cada uno y la huella final. Todo se deshace
 * al terminar: la versión anterior y la vigente parten del MISMO estado (mismo producto, mismas claves, misma huella).
 */
async function trace(fn: string, productId: string, steps: readonly Step[]): Promise<Trace> {
  await db.query("savepoint com15a_trace");
  try {
    const ids: string[] = [];
    const calls: Seen[] = [];
    for (const step of steps) {
      const out = await adjust(productId, step, fn);
      const movement = movementOf(out);
      if (!movement) {
        calls.push({ code: out.code, message: out.message, movement: null, row: null });
        continue;
      }
      const id = String(movement.id);
      if (!ids.includes(id)) ids.push(id);
      calls.push({
        code: out.code,
        message: out.message,
        movement: ids.indexOf(id),
        row: Object.fromEntries(Object.entries(movement).filter(([key]) => !VOLATILE.includes(key))),
      });
    }
    const keys = steps.flatMap((step) => (step.key ? [step.key] : []));
    return { calls, footprint: await footprint(productId, keys) };
  } finally {
    await db.query("rollback to savepoint com15a_trace");
  }
}

const codesOf = (result: Trace): Array<string | null> => result.calls.map((call) => call.code);

beforeAll(async () => {
  lab = await Lab.open("com15a");
  db = await lab.pg();
  const rate = await one(
    "tasa vigente de la tienda lab",
    "select rate_ves::float8 as rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  rateVes = Number(rate.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP · la tienda lab no tiene tasa de cambio");
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("parche 20261011b · una sola adjust_stock, la vigente", () => {
  it("20261006g es la última versión anterior a este parche", () => {
    const defining = readdirSync(PATCHES)
      .filter((file) => /^\d{8}[a-z]?-.*\.sql$/.test(file) && !file.includes("one-shot"))
      .filter((file) => /create or replace function public\.adjust_stock\(/.test(readFileSync(resolve(PATCHES, file), "utf8")))
      .sort();
    expect(defining.slice(-2)).toEqual([PREVIOUS_PATCH, PATCH]);
  });

  it("el parche es la copia literal de 20261006g más la guarda de inactivo (ninguna otra línea cambia)", () => {
    const lines = (patch: string): string[] => adjustStockOf(patch, "adjust_stock").split(/\r?\n/);
    const previous = lines(PREVIOUS_PATCH);
    const added = lines(PATCH).filter((line) => !previous.includes(line));
    const removed = previous.filter((line) => !lines(PATCH).includes(line));

    expect(removed).toEqual([]);
    expect(added.map((line) => line.trim()).filter((line) => !line.startsWith("--"))).toEqual([
      "if not v_product.is_active and p_quantity_delta > 0 and p_sale_id is null then",
      `message = '${INACTIVE_MESSAGE}';`,
    ]);
  });

  const SIGNATURES = `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
       p.prosrc ilike '%not v_product.is_active and p_quantity_delta > 0 and p_sale_id is null%' as guarded,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'adjust_stock'`;
  const EXPECTED = [{ args: SIGNATURE, definer: true, guarded: true, authenticated: true, anon: false }];

  it("la base lab tiene una sola firma (7 argumentos), security definer, con la guarda y sin execute para anon", async () => {
    expect(await sql("firmas de adjust_stock", SIGNATURES)).toEqual(EXPECTED);
  });

  it("reaplicar el parche es inocuo: misma firma única y misma definición", async () => {
    await withRollback(db, async () => {
      const before = await one("definición", "select md5(prosrc) as hash from pg_proc where proname = 'adjust_stock' and pronamespace = 'public'::regnamespace");
      await sql("reaplicar el parche", patchBody());
      await sql("reaplicar el parche otra vez", patchBody());
      const after = await one("definición", "select md5(prosrc) as hash from pg_proc where proname = 'adjust_stock' and pronamespace = 'public'::regnamespace");

      expect({ firmas: await sql("firmas de adjust_stock", SIGNATURES), hash: after.hash }).toEqual({ firmas: EXPECTED, hash: before.hash });
    });
  });
});

describe("producto INACTIVO · entrada libre", () => {
  it.each([
    ["ajuste_entrada", "ajuste_entrada"],
    ["inventario_inicial", "inventario_inicial"],
    ["sin tipo (entrada por defecto)", null],
  ])("%s: PT409 con su mensaje, sin movimiento, sin cambio de stock y sin clave consumida", async (_name, type) => {
    await withRollback(db, async () => {
      const p = await product("entrada", { stock: 20, active: false });
      const key = randomUUID();
      const before = await footprint(p, [key]);

      const out = await adjust(p, { delta: 5, type, reason: TAG, key });

      expect({ code: out.code, message: out.message, huella: await footprint(p, [key]) }).toEqual({
        code: "PT409",
        message: INACTIVE_MESSAGE,
        huella: before,
      });
      expect(before).toMatchObject({ stock: 20, active: false, requests: [] });
    });
  });

  it("producto inactivo SIN stock: también PT409 (no hay carga inicial sobre un inactivo)", async () => {
    await withRollback(db, async () => {
      const p = await product("entrada-cero", { active: false });

      const out = await adjust(p, { delta: 1, type: "inventario_inicial", actor: "admin" });

      expect({ code: out.code, huella: await footprint(p) }).toEqual({
        code: "PT409",
        huella: { stock: 0, active: false, movements: [], requests: [] },
      });
    });
  });

  it("tras reactivar el producto, reintentar con la MISMA clave registra el ajuste, y solo una vez", async () => {
    await withRollback(db, async () => {
      const p = await product("reintento", { stock: 20, active: false });
      const key = randomUUID();
      const step: Step = { delta: 5, type: "ajuste_entrada", reason: TAG, key };

      const rejected = await adjust(p, step);
      await setActive(p, true);
      const accepted = await adjust(p, step);
      const repeated = await adjust(p, step);
      const state = await footprint(p, [key]);

      expect({
        codes: [rejected.code, accepted.code, repeated.code],
        movimiento: movementOf(accepted),
        repetido: movementOf(repeated)?.id === movementOf(accepted)?.id,
        stock: state.stock,
        claves: (state.requests as Row[]).length,
        movimientos: (state.movements as Row[]).map((m) => [m.type, m.quantity_delta, m.stock_after]),
      }).toEqual({
        codes: ["PT409", null, null],
        movimiento: expect.objectContaining({ type: "ajuste_entrada", quantity_delta: 5, stock_after: 25, created_by: lab.uids.almacen }),
        repetido: true,
        stock: 25,
        claves: 1,
        movimientos: [
          ["inventario_inicial", 20, 20],
          ["ajuste_entrada", 5, 25],
        ],
      });
    });
  });

  it("un ajuste registrado con clave cuando el producto estaba activo se sigue devolviendo tras desactivarlo", async () => {
    await withRollback(db, async () => {
      const p = await product("replay", { stock: 20 });
      const key = randomUUID();
      const step: Step = { delta: 5, type: "ajuste_entrada", reason: TAG, key };

      const original = await adjust(p, step);
      await setActive(p, false);
      const retry = await adjust(p, step);
      const fresh = await adjust(p, { ...step, key: randomUUID() });

      expect({
        codes: [original.code, retry.code, fresh.code],
        mismo: movementOf(retry)?.id === movementOf(original)?.id,
        stock: (await footprint(p)).stock,
      }).toEqual({ codes: [null, null, "PT409"], mismo: true, stock: 25 });
    });
  });

  it("las guardas anteriores conservan su precedencia sobre un inactivo: PT403 de rol y PT400 de forma", async () => {
    await withRollback(db, async () => {
      const p = await product("precedencia", { stock: 20, active: false });

      const codes = [
        (await adjust(p, { delta: 5, actor: "vendedor1" })).code,
        (await adjust(p, { delta: 0 })).code,
        (await adjust(p, { delta: 5, type: "ajuste_salida" })).code,
        (await adjust(p, { delta: 5, type: "venta" })).code,
        // R4: la devolución de cliente suelta no existe; no llega a la guarda de inactivo.
        (await adjust(p, { delta: 1, type: "devolucion_cliente" })).code,
      ];

      expect(codes).toEqual(["PT403", "PT400", "PT400", "PT400", "PT400"]);
    });
  });
});

describe("producto INACTIVO · salida", () => {
  it("salida con stock: se registra con su movimiento y puede dejar el producto en cero", async () => {
    await withRollback(db, async () => {
      const p = await product("salida", { stock: 20, active: false });

      const first = await adjust(p, { delta: -3, type: "ajuste_salida", reason: `${TAG} merma` });
      const untyped = await adjust(p, { delta: -2, reason: `${TAG} corrección` });
      const rest = await adjust(p, { delta: -15, type: "ajuste_salida", reason: `${TAG} baja`, key: randomUUID() });

      expect({
        codes: [first.code, untyped.code, rest.code],
        movimiento: movementOf(first),
        huella: await footprint(p),
      }).toEqual({
        codes: [null, null, null],
        movimiento: expect.objectContaining({
          product_id: p,
          type: "ajuste_salida",
          quantity_delta: -3,
          stock_after: 17,
          reason: `${TAG} merma`,
          created_by: lab.uids.almacen,
          store_id: lab.storeId,
          sale_id: null,
          purchase_id: null,
        }),
        huella: expect.objectContaining({
          stock: 0,
          active: false,
          movements: [
            expect.objectContaining({ type: "inventario_inicial", quantity_delta: 20, stock_after: 20 }),
            expect.objectContaining({ type: "ajuste_salida", quantity_delta: -3, stock_after: 17 }),
            expect.objectContaining({ type: "ajuste_salida", quantity_delta: -2, stock_after: 15 }),
            expect.objectContaining({ type: "ajuste_salida", quantity_delta: -15, stock_after: 0 }),
          ],
        }),
      });
    });
  });

  it("salida mayor que el stock: PT409 'Stock insuficiente' como siempre, sin movimiento", async () => {
    await withRollback(db, async () => {
      const p = await product("salida-de-mas", { stock: 20, active: false });
      const before = await footprint(p);

      const out = await adjust(p, { delta: -21, type: "ajuste_salida" });

      expect({ code: out.code, message: out.message, huella: await footprint(p) }).toEqual({
        code: "PT409",
        message: "Stock insuficiente",
        huella: before,
      });
    });
  });

  it("la salida de un inactivo es idéntica a la de 20261006g (resultado, libro y claves)", async () => {
    await withRollback(db, async () => {
      await installPrevious();
      const p = await product("salida-diff", { stock: 20, active: false });
      const key = randomUUID();
      const steps: Step[] = [
        { delta: -3, type: "ajuste_salida", reason: TAG },
        { delta: -17, reason: TAG, key },
        { delta: -17, reason: TAG, key },
        { delta: -1, type: "ajuste_salida" },
      ];

      const previous = await trace(PREVIOUS_FN, p, steps);
      const current = await trace("adjust_stock", p, steps);

      expect(current).toEqual(previous);
      expect(codesOf(current)).toEqual([null, null, null, "PT409"]);
    });
  });
});

describe("producto INACTIVO · devolución LIGADA a su documento (no cambia)", () => {
  it("devolucion_cliente con p_sale_id: entra aunque el producto ya esté inactivo, con su tope, igual que en 20261006g", async () => {
    await withRollback(db, async () => {
      await installPrevious();
      const p = await product("dev-cliente", { stock: 20 });
      const saleId = await sale(p, 3);
      await setActive(p, false);
      const key = randomUUID();
      const steps: Step[] = [
        { delta: 1, type: "devolucion_cliente", saleId, reason: TAG, actor: "admin" },
        { delta: 3, type: "devolucion_cliente", saleId, reason: TAG, actor: "admin" },
        { delta: 2, type: "devolucion_cliente", saleId, reason: TAG, actor: "admin", key },
        { delta: 2, type: "devolucion_cliente", saleId, reason: TAG, actor: "admin", key },
        { delta: 1, type: "devolucion_cliente", saleId, reason: TAG, actor: "admin" },
      ];

      const previous = await trace(PREVIOUS_FN, p, steps);
      const current = await trace("adjust_stock", p, steps);

      expect(current).toEqual(previous);
      // Vendido 3: entra 1, no caben 3, entran las 2 restantes (y su reintento), tope agotado. Nunca el rechazo de inactivo.
      expect(codesOf(current)).toEqual([null, "PT409", null, null, "PT409"]);
      expect(current.calls.map((call) => call.message).filter((message) => message === INACTIVE_MESSAGE)).toEqual([]);
      expect(current.calls[0]?.row).toMatchObject({ type: "devolucion_cliente", quantity_delta: 1, stock_after: 18, sale_id: saleId });
      expect(current.footprint).toMatchObject({ stock: 20, active: false });
    });
  });

  it("devolucion_proveedor con p_purchase_id: sale aunque el producto ya esté inactivo, con su tope, igual que en 20261006g", async () => {
    await withRollback(db, async () => {
      await installPrevious();
      const p = await product("dev-proveedor", { stock: 5 });
      const purchaseId = await purchase(p, 10);
      await setActive(p, false);
      const steps: Step[] = [
        { delta: -4, type: "devolucion_proveedor", purchaseId, reason: TAG, actor: "admin" },
        { delta: -7, type: "devolucion_proveedor", purchaseId, reason: TAG, actor: "admin" },
        { delta: -6, type: "devolucion_proveedor", purchaseId, reason: TAG, actor: "admin" },
      ];

      const previous = await trace(PREVIOUS_FN, p, steps);
      const current = await trace("adjust_stock", p, steps);

      expect(current).toEqual(previous);
      expect(codesOf(current)).toEqual([null, "PT409", null]);
      expect(current.calls[0]?.row).toMatchObject({ type: "devolucion_proveedor", quantity_delta: -4, stock_after: 11, purchase_id: purchaseId });
      expect(current.footprint).toMatchObject({ stock: 5, active: false });
    });
  });
});

describe("el ÚNICO cambio frente a 20261006g", () => {
  it("entrada libre a un inactivo: la versión anterior la registraba; la vigente responde PT409 y no deja nada", async () => {
    await withRollback(db, async () => {
      await installPrevious();
      const p = await product("unico-cambio", { stock: 20, active: false });
      const steps: Step[] = [{ delta: 5, type: "ajuste_entrada", reason: TAG, key: randomUUID() }];

      const previous = await trace(PREVIOUS_FN, p, steps);
      const current = await trace("adjust_stock", p, steps);

      expect({ antes: [codesOf(previous), previous.footprint.stock], ahora: [codesOf(current), current.footprint.stock] }).toEqual({
        antes: [[null], 25],
        ahora: [["PT409"], 20],
      });
      expect(current.footprint).toMatchObject({ requests: [], movements: [expect.objectContaining({ type: "inventario_inicial" })] });
    });
  });
});

describe("producto ACTIVO · diferencial contra 20261006g (mismo resultado, mismo libro, misma idempotencia)", () => {
  const K1 = randomUUID();
  const K2 = randomUUID();
  const GHOST = randomUUID();
  const CASES: Array<{ name: string; stock: number; steps: Step[]; codes: Array<string | null> }> = [
    { name: "entrada ajuste_entrada", stock: 20, steps: [{ delta: 5, type: "ajuste_entrada", reason: "conteo" }], codes: [null] },
    { name: "entrada sin tipo ni motivo", stock: 20, steps: [{ delta: 5 }], codes: [null] },
    { name: "entrada inventario_inicial sobre stock 0, como admin", stock: 0, steps: [{ delta: 7, type: "inventario_inicial", actor: "admin" }], codes: [null] },
    { name: "salida ajuste_salida", stock: 20, steps: [{ delta: -3, type: "ajuste_salida", reason: "merma" }], codes: [null] },
    { name: "salida sin tipo hasta dejar en cero", stock: 20, steps: [{ delta: -20, reason: "baja" }], codes: [null] },
    { name: "salida mayor que el stock", stock: 20, steps: [{ delta: -21, type: "ajuste_salida" }], codes: ["PT409"] },
    {
      name: "clave repetida: entrada",
      stock: 20,
      steps: [
        { delta: 5, type: "ajuste_entrada", reason: "conteo", key: K1 },
        { delta: 5, type: "ajuste_entrada", reason: "conteo", key: K1 },
      ],
      codes: [null, null],
    },
    {
      name: "clave repetida: salida",
      stock: 20,
      steps: [
        { delta: -3, reason: "merma", key: K1 },
        { delta: -3, reason: "merma", key: K1 },
        { delta: -3, reason: "merma", key: K2 },
      ],
      codes: [null, null, null],
    },
    {
      name: "clave con otro contenido: cantidad, tipo, motivo y producto",
      stock: 20,
      steps: [
        { delta: 5, type: "ajuste_entrada", reason: "conteo", key: K1 },
        { delta: 4, type: "ajuste_entrada", reason: "conteo", key: K1 },
        { delta: 5, type: "inventario_inicial", reason: "conteo", key: K1 },
        { delta: 5, type: "ajuste_entrada", reason: "otro", key: K1 },
        { delta: 5, type: "ajuste_entrada", reason: "conteo", key: K1, product: GHOST },
        { delta: 5, type: "ajuste_entrada", reason: "conteo", key: K1 },
      ],
      codes: [null, "PT409", "PT409", "PT409", "PT409", null],
    },
    {
      name: "un rechazo con clave no la consume: la misma clave vale para el ajuste corregido",
      stock: 2,
      steps: [
        { delta: -3, type: "ajuste_salida", key: K1 },
        { delta: -2, type: "ajuste_salida", key: K1 },
      ],
      codes: ["PT409", null],
    },
    {
      name: "rechazos de forma, rol y producto",
      stock: 20,
      steps: [
        { delta: 0 },
        { delta: null },
        { delta: 5, actor: "vendedor1" },
        { delta: 5, type: "venta" },
        { delta: 5, type: "ajuste_salida" },
        { delta: -5, type: "ajuste_entrada" },
        { delta: 1, type: "devolucion_cliente" },
        { delta: -1, type: "devolucion_proveedor" },
        { delta: 5, product: GHOST },
      ],
      codes: ["PT400", "PT400", "PT403", "PT400", "PT400", "PT400", "PT400", "PT400", "PT404"],
    },
    {
      name: "secuencia encadenada de entradas, salidas, rechazo y reintento",
      stock: 10,
      steps: [
        { delta: 5, type: "ajuste_entrada", reason: "a" },
        { delta: -12, type: "ajuste_salida", reason: "b", key: K1 },
        { delta: -4, type: "ajuste_salida", reason: "c" },
        { delta: 2, reason: "d", key: K2, actor: "admin" },
        { delta: -12, type: "ajuste_salida", reason: "b", key: K1 },
        { delta: 2, reason: "d", key: K2, actor: "admin" },
      ],
      codes: [null, null, "PT409", null, null, null],
    },
  ];

  it.each(CASES)("$name", async ({ stock, steps, codes }) => {
    await withRollback(db, async () => {
      await installPrevious();
      const p = await product("activo", { stock });

      const previous = await trace(PREVIOUS_FN, p, steps);
      const current = await trace("adjust_stock", p, steps);

      expect(current).toEqual(previous);
      // El caso ejercita lo que dice (no es una igualdad entre dos fallos de preparación).
      expect(codesOf(current)).toEqual(codes);
    });
  });

  it("devolución ligada sobre un producto activo: igual que en 20261006g", async () => {
    await withRollback(db, async () => {
      await installPrevious();
      const p = await product("activo-dev", { stock: 20 });
      const saleId = await sale(p, 3);
      const purchaseId = await purchase(p, 10);
      const steps: Step[] = [
        { delta: 2, type: "devolucion_cliente", saleId, actor: "admin" },
        { delta: 2, type: "devolucion_cliente", saleId, actor: "admin" },
        { delta: -4, type: "devolucion_proveedor", purchaseId, actor: "admin" },
        { delta: 1, type: "ajuste_entrada", saleId },
      ];

      const previous = await trace(PREVIOUS_FN, p, steps);
      const current = await trace("adjust_stock", p, steps);

      expect(current).toEqual(previous);
      expect(codesOf(current)).toEqual([null, "PT409", null, "PT400"]);
    });
  });

  it("una clave guardada por la versión anterior sigue valiendo: el reintento devuelve el movimiento original", async () => {
    await withRollback(db, async () => {
      await installPrevious();
      const p = await product("activo-clave", { stock: 20 });
      const key = randomUUID();
      const step: Step = { delta: 5, type: "ajuste_entrada", reason: "conteo", key };

      const original = await adjust(p, step, PREVIOUS_FN);
      const retry = await adjust(p, step);
      const other = await adjust(p, { ...step, delta: 6 });

      expect({
        codes: [original.code, retry.code, other.code],
        igual: JSON.stringify(movementOf(retry)) === JSON.stringify(movementOf(original)),
        stock: (await footprint(p)).stock,
      }).toEqual({ codes: [null, null, "PT409"], igual: true, stock: 25 });
    });
  });
});

describe("por PostgREST (el camino del BFF y del seed)", () => {
  const created: string[] = [];
  const keys: string[] = [];

  /** Producto CONFIRMADO en la base (lo ve PostgREST); se borra en afterAll. */
  async function committed(name: string, stock: number, active: boolean): Promise<string> {
    seq += 1;
    const sku = `${TAG}-rest-${name}-${seq}`.toLowerCase();
    const rows = await lab.rows<{ id: string }>(
      `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $2, 1, 1, 0, 0, true) returning id`,
      [lab.storeId, sku],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`SETUP · producto ${sku}: el insert no devolvió id`);
    created.push(id);
    await lab.rows(
      "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'inventario_inicial', $2, $3, $4)",
      [id, stock, TAG, lab.storeId],
    );
    if (!active) await lab.rows("update public.products set is_active = false where id = $1", [id]);
    return id;
  }

  async function rpc(args: Record<string, unknown>): Promise<{ code: string | null; message: string; data: Row | null }> {
    const client = await lab.supa("almacen");
    const { data, error } = await client.rpc("adjust_stock", args);
    return { code: error?.code ?? null, message: error?.message ?? "", data: (data as Row | null) ?? null };
  }

  afterAll(async () => {
    if (!lab || created.length === 0) return;
    await lab.db.query("begin");
    try {
      await lab.db.query("delete from public.stock_request_keys where client_request_id = any($1::uuid[])", [keys]);
      await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [created]);
      await lab.db.query("delete from public.products where id = any($1::uuid[])", [created]);
      await lab.db.query("commit");
    } catch (error) {
      await lab.db.query("rollback").catch(() => undefined);
      console.warn(`COM-15a: no se pudieron borrar los datos ${TAG}: ${failure(error).message}`);
    }
  });

  it("entrada a un inactivo: el cliente recibe PT409 con el mensaje; nada queda escrito, y la clave sirve tras reactivar", async () => {
    const p = await committed("entrada", 10, false);
    const key = randomUUID();
    keys.push(key);
    const args = { p_product_id: p, p_quantity_delta: 5, p_reason: `${TAG} entrada`, p_type: "ajuste_entrada", p_client_request_id: key };

    const rejected = await rpc(args);
    const afterReject = {
      stock: await lab.stock(p),
      movimientos: (await lab.movements(p)).length,
      claves: (await lab.rows("select 1 from public.stock_request_keys where client_request_id = $1", [key])).length,
    };
    await lab.rows("update public.products set is_active = true where id = $1", [p]);
    const accepted = await rpc(args);
    const repeated = await rpc(args);

    expect({
      rechazo: [rejected.code, rejected.message],
      trasRechazo: afterReject,
      codes: [accepted.code, repeated.code],
      mismo: repeated.data?.id === accepted.data?.id,
      stock: await lab.stock(p),
      movimientos: (await lab.movements(p)).length,
    }).toEqual({
      rechazo: ["PT409", INACTIVE_MESSAGE],
      trasRechazo: { stock: 10, movimientos: 1, claves: 0 },
      codes: [null, null],
      mismo: true,
      stock: 15,
      movimientos: 2,
    });
  });

  it("salida de un inactivo: se registra; salida mayor que el stock: PT409", async () => {
    const p = await committed("salida", 10, false);

    const out = await rpc({ p_product_id: p, p_quantity_delta: -4, p_reason: `${TAG} salida`, p_type: "ajuste_salida" });
    const over = await rpc({ p_product_id: p, p_quantity_delta: -7, p_reason: `${TAG} salida de más`, p_type: "ajuste_salida" });

    expect({ codes: [out.code, over.code], movimiento: out.data, stock: await lab.stock(p) }).toEqual({
      codes: [null, "PT409"],
      movimiento: expect.objectContaining({ type: "ajuste_salida", quantity_delta: -4, stock_after: 6 }),
      stock: 6,
    });
  });
});
