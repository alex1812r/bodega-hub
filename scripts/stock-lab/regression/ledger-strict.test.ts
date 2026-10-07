/** @jest-environment node */
/**
 * STK-505 · libro mayor de stock en modo estricto (parche 20261006e).
 *
 * El parche 20261006a dejó dos pases TRANSITORIOS para las RPC aún no reescritas:
 * el trigger `stock_movements_apply()` se fiaba del `stock_after` que trajera el
 * llamador (y entonces no tocaba `products`), y `products_stock_guard()` dejaba
 * escribir `current_stock` a cualquier función `security definer` (`current_user
 * = 'postgres'`). Con las RPC ya reescritas (20261006b/c) ambos pases son un
 * camino para descuadrar `current_stock` del libro. Cada test enuncia el
 * comportamiento SANO (rojos hasta el parche e).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/ledger-strict.test.ts
 *
 * Datos propios con prefijo `R505-<nonce>`; se borran al terminar. Un fallo de
 * preparación lanza un error que empieza por "SETUP".
 */
import type { Client } from "pg";

import { Lab } from "../scenarios/db";

type RpcError = { code?: string; message: string } | null;

const NONCE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const PREFIX = `R505-${NONCE}`;
/** Función de prueba que imita una RPC legada: escribe `current_stock` a mano siendo `security definer`. */
const LEGACY_FN = `r505_legacy_writer_${NONCE}`;
const UNKNOWN_FUNCTION = "PGRST202";

let lab: Lab;
let seq = 0;

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

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Producto propio; el stock inicial entra por `adjust_stock(inventario_inicial)` como lab-admin. */
async function product(name: string, stock: number): Promise<string> {
  seq += 1;
  const sku = `${PREFIX}-${name}-${seq}`;
  const rows = await setup(`producto ${sku}`, () =>
    lab.rows<{ id: string }>(
      `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $3, 1, 1, 0, 0, true) returning id`,
      [lab.storeId, sku, sku],
    ),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`SETUP · producto ${sku}: el insert no devolvió id`);
  const client = await lab.supa("admin");
  const { error } = await client.rpc("adjust_stock", {
    p_product_id: id,
    p_quantity_delta: stock,
    p_reason: `${PREFIX} inventario inicial`,
    p_type: "inventario_inicial",
  });
  if (error) throw new Error(`SETUP · stock inicial de ${sku}: ${error.code ?? ""} ${error.message}`);
  return id;
}

/** Ejecuta `fn` como `postgres` en una transacción que SIEMPRE hace rollback. */
async function inRollback<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = await lab.pg();
  await db.query("begin");
  try {
    return await fn(db);
  } finally {
    await db.query("rollback").catch(() => undefined);
  }
}

async function dropLegacyFunction(): Promise<void> {
  await lab.db.query(`drop function if exists public.${LEGACY_FN}(uuid)`);
  await lab.db.query("notify pgrst, 'reload schema'");
}

beforeAll(async () => {
  lab = await setup("abrir la base lab", () => Lab.open("r505"));
});

afterAll(async () => {
  if (!lab) return;
  await dropLegacyFunction().catch(() => undefined);
  const found = await lab.db.query<{ id: string }>("select id from public.products where sku like $1", [`${PREFIX}-%`]);
  const ids = found.rows.map((row) => row.id);
  await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [ids]).catch(() => undefined);
  await lab.db.query("delete from public.products where id = any($1::uuid[])", [ids]).catch(() => undefined);
  await lab.close();
});

// Parche 20261006a, `stock_movements_apply()`: rama "Modo legado TRANSITORIO (stock_after no nulo)".
describe("STK-505 · stock_movements_apply no se fía del stock_after del llamador", () => {
  it("un movimiento insertado con stock_after inventado recibe el saldo real y mueve products.current_stock", async () => {
    const p = await product("legado", 10);

    const result = await inRollback(async (db) => {
      const inserted = await db.query<{ stock_after: number }>(
        `insert into public.stock_movements (product_id, store_id, type, quantity_delta, stock_after, reason)
         values ($1, $2, 'ajuste_entrada', 2, 99, $3) returning stock_after`,
        [p, lab.storeId, `${PREFIX} stock_after inventado`],
      );
      const current = await db.query<{ current_stock: number }>("select current_stock from public.products where id = $1", [p]);
      return { stockAfter: inserted.rows[0]?.stock_after, currentStock: current.rows[0]?.current_stock };
    });

    // Hoy (modo legado): { stockAfter: 99, currentStock: 10 } → cadena rota y libro ≠ current_stock.
    expect(result).toEqual({ stockAfter: 12, currentStock: 12 });
  });

  it("un movimiento que dejaría el stock negativo se rechaza aunque traiga un stock_after positivo", async () => {
    const p = await product("negativo", 10);

    const error = await inRollback(async (db) => {
      try {
        await db.query(
          `insert into public.stock_movements (product_id, store_id, type, quantity_delta, stock_after, reason)
           values ($1, $2, 'ajuste_salida', -25, 5, $3)`,
          [p, lab.storeId, `${PREFIX} salida sin stock`],
        );
        return null;
      } catch (caught) {
        return { code: (caught as { code?: string }).code, message: messageOf(caught) };
      }
    });

    // Hoy: null (el movimiento entra con stock_after 5 y el libro queda en −15).
    expect(error).toEqual({ code: "PT409", message: "Stock insuficiente" });
  });
});

// Parche 20261006a, `products_stock_guard()`: pase TRANSITORIO `if current_user = 'postgres' then return new`.
describe("STK-505 · products_stock_guard no deja pasar a funciones security definer", () => {
  it("una función security definer que hace update de current_stock a mano se rechaza por PostgREST", async () => {
    const p = await product("definer", 10);
    await setup("crear la función legada de prueba", async () => {
      await lab.db.query(
        `create or replace function public.${LEGACY_FN}(p_product_id uuid)
         returns integer language plpgsql security definer set search_path = public as $fn$
         declare
           v_stock integer;
         begin
           update public.products set current_stock = current_stock + 5 where id = p_product_id
           returning current_stock into v_stock;
           return v_stock;
         end;
         $fn$`,
      );
      await lab.db.query(`revoke all on function public.${LEGACY_FN}(uuid) from public, anon`);
      await lab.db.query(`grant execute on function public.${LEGACY_FN}(uuid) to authenticated`);
      await lab.db.query("notify pgrst, 'reload schema'");
    });

    try {
      const client = await lab.supa("admin");
      let error: RpcError = null;
      let data: unknown = null;
      // PostgREST tarda un instante en recargar el esquema tras el notify.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        ({ data, error } = await client.rpc(LEGACY_FN, { p_product_id: p }));
        if (error?.code !== UNKNOWN_FUNCTION) break;
        await sleep(250);
      }
      if (error?.code === UNKNOWN_FUNCTION) throw new Error("SETUP · PostgREST no llegó a ver la función de prueba");

      // Hoy: la función responde 15 y el stock queda en 15 sin movimiento.
      expect({ data, code: error?.code ?? null, stock: await lab.stock(p) }).toEqual({ data: null, code: "PT409", stock: 10 });
    } finally {
      await lab.db
        .query("update public.products set current_stock = 10 where id = $1 and current_stock <> 10", [p])
        .catch(() => undefined);
      await dropLegacyFunction();
    }
  });
});

describe("STK-505 · una sola función de public escribe current_stock", () => {
  it("solo stock_movements_apply contiene `set current_stock`", async () => {
    const rows = await lab.rows<{ proname: string }>(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and prosrc ilike '%set current_stock%' order by proname`,
    );

    // Hoy: products_stock_guard (comentario del pase transitorio) y stock_movements_apply.
    expect(rows.map((row) => row.proname)).toEqual(["stock_movements_apply"]);
  });

  it("ninguna función de public inserta movimientos indicando la columna stock_after", async () => {
    const rows = await lab.rows<{ proname: string }>(
      `select proname from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prosrc ~* 'insert\\s+into\\s+(public\\.)?stock_movements\\s*\\([^)]*stock_after'
       order by proname`,
    );

    expect(rows.map((row) => row.proname)).toEqual([]);
  });
});
