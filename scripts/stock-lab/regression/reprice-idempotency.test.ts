/**
 * @jest-environment node
 *
 * FIN-03 · regresión del parche `20261017a-reprice-idempotency.sql` (hallazgo B2 del caos global).
 *
 * `POST /api/products/price-review/reprice` llama a `reprice_product_to_markup` una vez por producto. La RPC delegaba
 * siempre en `update_product_price`, que inserta historial aunque el precio no cambie: 8 llamadas iguales dejaban 8
 * filas por producto. Y sin clave, un reintento tardío volvía a calcular y pisaba un cambio hecho entre medias.
 *
 * Ahora: con `p_client_request_id` el reintento no repite el cambio (misma clave con otro % → PT409), y un reprecio
 * que deja el mismo precio sobre una instantánea que ya guarda el costo y la banda vigentes no inserta historial. Un
 * producto en «Por revisar» sigue recibiendo su fila aunque el precio no cambie: es la que lo saca de la cola.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string; hint: string | null };

const PATCH = resolve(__dirname, "../../../supabase/patches/20261017a-reprice-idempotency.sql");
const TAG = `FIN03-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const REPRICE =
  "select sale_price_ref::float8 as precio from public.reprice_product_to_markup($1::uuid, $2::numeric, $3, $4::numeric, $5::uuid)";
const REPRICE_FOUR_ARGS =
  "select sale_price_ref::float8 as precio from public.reprice_product_to_markup($1::uuid, $2::numeric, $3, $4::numeric)";

let lab: Lab;
let db: Client;
let other: Client;
let seq = 0;
const committed: string[] = [];

function failure(error: unknown): Omit<Outcome, "rows"> {
  const e = error as { code?: unknown; hint?: unknown };
  return {
    code: typeof e.code === "string" ? e.code : "?",
    message: error instanceof Error ? error.message : String(error),
    hint: typeof e.hint === "string" ? e.hint : null,
  };
}

const OK = { code: null, message: "", hint: null };

/** Dentro de la transacción del test: `text` en un savepoint como el usuario lab `role`. */
async function run(role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint fin03");
  try {
    await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint fin03");
    return { rows: res.rows, ...OK };
  } catch (error) {
    await db.query("rollback to savepoint fin03");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

/** Transacción propia y CONFIRMADA en `client`: lo que hace una llamada /rpc de PostgREST. */
async function call(client: Client, role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  await client.query("begin");
  try {
    await actAs(client, lab.uids[role]);
    const res = await client.query<Row>(text, params);
    await client.query("commit");
    return { rows: res.rows, ...OK };
  } catch (error) {
    await client.query("rollback");
    return { rows: [], ...failure(error) };
  }
}

/** Producto como `postgres` (el trigger de las altas le pone su línea base: 1 fila de historial). */
async function product(costRef: number, priceRef: number, options: { commit?: boolean } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${seq}`.toLowerCase();
  const res = await db.query<Row>(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
     values ($1, $2, $2, $3, $4, 0, 0) returning id`,
    [lab.storeId, sku, priceRef, costRef],
  );
  const id = String(res.rows[0]?.id);
  if (options.commit) committed.push(id);
  return id;
}

async function state(id: string, client: Client = db): Promise<Row> {
  const res = await client.query<Row>(
    `select p.sale_price_ref::float8 as precio,
            (select count(*)::int from public.product_price_history h where h.product_id = p.id) as filas,
            (select count(*)::int from public.product_price_history h
              where h.product_id = p.id and h.client_request_id is not null) as con_clave,
            exists (select 1 from public.products_price_review r where r.product_id = p.id) as en_cola
     from public.products p where p.id = $1`,
    [id],
  );
  return res.rows[0] ?? {};
}

beforeAll(async () => {
  lab = await Lab.open("fin03");
  db = await lab.pg();
  other = await lab.pg();
});

afterAll(async () => {
  if (!lab) return;
  try {
    if (committed.length > 0) await lab.rows("delete from public.products where id = any($1::uuid[])", [committed]);
  } finally {
    await lab.close();
  }
});

describe("reprice_product_to_markup · clave de idempotencia (20261017a)", () => {
  it("8 llamadas iguales con la misma clave: un cambio de precio y una fila de historial, y las 8 responden el mismo precio", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 9);
      const key = randomUUID();
      const prices: unknown[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const out = await run("almacen", REPRICE, [id, 25, "Reprecio al 25 %", 8, key]);
        prices.push(out.code ?? out.rows[0]?.precio);
      }

      expect({ prices, estado: await state(id) }).toEqual({
        prices: Array(8).fill(10),
        estado: { precio: 10, filas: 2, con_clave: 1, en_cola: false },
      });
    });
  });

  it("el reintento tardío no pisa un precio fijado después, ni lo rechaza por el costo que ya cambió", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 9);
      const key = randomUUID();
      const first = await run("admin", REPRICE, [id, 25, null, 8, key]);
      const later = await run("admin", REPRICE, [id, 50, null, null, null]);
      await db.query("update public.products set current_cost_ref = 9 where id = $1", [id]);
      const before = await state(id);
      const retry = await run("admin", REPRICE, [id, 25, null, 8, key]);

      expect({ first: first.rows[0]?.precio, later: later.rows[0]?.precio, retry: [retry.code, retry.rows[0]?.precio], sinCambio: await state(id) }).toEqual({
        first: 10,
        later: 12,
        retry: [null, 12],
        sinCambio: before,
      });
      expect(before).toMatchObject({ precio: 12, filas: 3, con_clave: 1 });
    });
  });

  it("la misma clave con otro % responde PT409 (REQUEST_REUSED) sin cambiar nada; en otro producto la clave es nueva", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 9);
      const sibling = await product(8, 9);
      const key = randomUUID();
      await run("almacen", REPRICE, [id, 25, null, null, key]);
      const before = await state(id);
      const reused = await run("almacen", REPRICE, [id, 40, null, null, key]);
      const onSibling = await run("almacen", REPRICE, [sibling, 40, null, null, key]);

      expect({ reused: [reused.code, reused.hint, reused.message], sinCambio: await state(id), hermano: [onSibling.rows[0]?.precio, await state(sibling)] }).toEqual({
        reused: ["PT409", "REQUEST_REUSED", "Esta solicitud de reprecio ya se usó con otro % de ganancia"],
        sinCambio: before,
        hermano: [11.2, { precio: 11.2, filas: 2, con_clave: 1, en_cola: false }],
      });
    });
  });

  it("una fila rechazada (sin costo, costo cambiado) no consume la clave: el reintento corregido sí cambia el precio", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 9);
      const key = randomUUID();
      const stale = await run("almacen", REPRICE, [id, 25, null, 7, key]);
      const afterStale = await state(id);
      const retry = await run("almacen", REPRICE, [id, 25, null, 8, key]);

      expect({ stale: [stale.code, stale.hint], afterStale, retry: retry.rows[0]?.precio, estado: await state(id) }).toEqual({
        stale: ["PT409", "COST_CHANGED"],
        afterStale: { precio: 9, filas: 1, con_clave: 0, en_cola: false },
        retry: 10,
        estado: { precio: 10, filas: 2, con_clave: 1, en_cola: false },
      });
    });
  });

  it("dos llamadas simultáneas con la misma clave (transacciones confirmadas): un solo cambio", async () => {
    const id = await product(8, 9, { commit: true });
    const key = randomUUID();
    const outs = await Promise.all([
      call(db, "almacen", REPRICE, [id, 25, null, 8, key]),
      call(other, "almacen", REPRICE, [id, 25, null, 8, key]),
    ]);

    expect({ outs: outs.map((out) => out.code ?? out.rows[0]?.precio), estado: await state(id) }).toEqual({
      outs: [10, 10],
      estado: { precio: 10, filas: 2, con_clave: 1, en_cola: false },
    });
  });
});

describe("reprice_product_to_markup · reprecio sin cambio (20261017a)", () => {
  it("sin clave, 8 llamadas iguales dejan una sola fila: las 7 que no cambian el precio no insertan historial", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 9);
      const prices: unknown[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const out = await run("almacen", REPRICE_FOUR_ARGS, [id, 25, "Reprecio al 25 %", null]);
        prices.push(out.code ?? out.rows[0]?.precio);
      }

      expect({ prices, estado: await state(id) }).toEqual({
        prices: Array(8).fill(10),
        estado: { precio: 10, filas: 2, con_clave: 0, en_cola: false },
      });
    });
  });

  it("un producto recién creado al % que ya tiene no recibe fila; al cambiar el % sí", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 10);
      const same = await run("admin", REPRICE, [id, 25, null, null, randomUUID()]);
      const afterSame = await state(id);
      const changed = await run("admin", REPRICE, [id, 30, null, null, null]);

      expect({ same: same.rows[0]?.precio, afterSame, changed: changed.rows[0]?.precio, estado: await state(id) }).toEqual({
        same: 10,
        afterSame: { precio: 10, filas: 1, con_clave: 0, en_cola: false },
        changed: 10.4,
        estado: { precio: 10.4, filas: 2, con_clave: 0, en_cola: false },
      });
    });
  });

  it("un producto en «Por revisar» recibe su fila aunque el % deje el mismo precio, y sale de la cola", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 10);
      // Sube el costo como una compra recibida: la instantánea guarda 8, el producto cuesta 9.
      await db.query("update public.products set current_cost_ref = 9 where id = $1", [id]);
      const before = await state(id);
      // 9 × 1,1111 = 9,9999 → 10,00: el precio no cambia, la instantánea sí.
      const out = await run("almacen", REPRICE, [id, 11.11, null, 9, null]);
      const again = await run("almacen", REPRICE, [id, 11.11, null, 9, null]);

      expect({ before, out: out.rows[0]?.precio, again: again.rows[0]?.precio, estado: await state(id) }).toEqual({
        before: { precio: 10, filas: 1, con_clave: 0, en_cola: true },
        out: 10,
        again: 10,
        estado: { precio: 10, filas: 2, con_clave: 0, en_cola: false },
      });
    });
  });
});

describe("PostgREST y reaplicación (20261017a)", () => {
  it("la RPC se resuelve por nombre con y sin p_client_request_id, y el rechazo de clave reutilizada llega con code + hint", async () => {
    const almacen = await lab.supa("almacen");
    const id = await product(12, 13, { commit: true });
    const key = randomUUID();
    const args = { p_expected_cost_ref: 12, p_markup_pct: 30, p_product_id: id, p_reason: "Reprecio al 30 %" };

    const withKey = await almacen.rpc("reprice_product_to_markup", { ...args, p_client_request_id: key });
    const retry = await almacen.rpc("reprice_product_to_markup", { ...args, p_client_request_id: key });
    const withoutKey = await almacen.rpc("reprice_product_to_markup", args);
    const reused = await almacen.rpc("reprice_product_to_markup", { ...args, p_client_request_id: key, p_markup_pct: 45 });

    expect({
      withKey: [withKey.error, Number((withKey.data as Row | null)?.sale_price_ref)],
      retry: [retry.error, Number((retry.data as Row | null)?.sale_price_ref)],
      withoutKey: [withoutKey.error, Number((withoutKey.data as Row | null)?.sale_price_ref)],
      reused: [reused.error?.code, reused.error?.hint, reused.error?.message],
      estado: await state(id),
    }).toEqual({
      withKey: [null, 15.6],
      retry: [null, 15.6],
      withoutKey: [null, 15.6],
      reused: ["PT409", "REQUEST_REUSED", "Esta solicitud de reprecio ya se usó con otro % de ganancia"],
      estado: { precio: 15.6, filas: 2, con_clave: 1, en_cola: false },
    });
  });

  it("reaplicar el parche no falla, deja UNA firma (5 argumentos) y conserva las claves ya guardadas", async () => {
    const id = await product(8, 9, { commit: true });
    const key = randomUUID();
    await call(db, "admin", REPRICE, [id, 25, null, null, key]);

    await db.query(readFileSync(PATCH, "utf8"));
    await db.query(readFileSync(PATCH, "utf8"));

    const signatures = await lab.rows(
      "select pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'reprice_product_to_markup'",
    );
    const retry = await call(db, "admin", REPRICE, [id, 25, null, null, key]);

    expect({ signatures, retry: retry.code ?? retry.rows[0]?.precio, estado: await state(id) }).toEqual({
      signatures: [{ args: "p_product_id uuid, p_markup_pct numeric, p_reason text, p_expected_cost_ref numeric, p_client_request_id uuid" }],
      retry: 10,
      estado: { precio: 10, filas: 2, con_clave: 1, en_cola: false },
    });
  });
});
