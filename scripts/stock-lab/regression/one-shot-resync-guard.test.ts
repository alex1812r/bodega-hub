/** @jest-environment node */
/**
 * STK-650 · guarda de prerrequisitos del one-shot 20261006z (resync de stock).
 *
 * La cabecera del one-shot exige los parches 20261006a…i, pero su guarda solo
 * comprobaba el parche a (trigger `stock_movements_apply` + columna `seq`). Sobre
 * una base con a pero sin el modo estricto (e) o sin las vistas v2 (d) seguía
 * adelante. Cada test enuncia el comportamiento SANO: aborta antes de tocar nada
 * y dice qué parche falta.
 *
 * El one-shot se ejecuta TAL CUAL está en el archivo (solo se le quitan por texto
 * el `begin;` y el `commit;` exteriores) dentro de una transacción que SIEMPRE
 * hace rollback. Los "sin e" / "sin d" se simulan dentro de esa transacción.
 * En la base lab no existen los dos productos de producción: con a–i aplicados
 * el archivo llega a la guarda de datos y aborta ahí ("no encontrado").
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/one-shot-resync-guard.test.ts
 *
 * Un fallo de preparación lanza un error que empieza por "SETUP".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";

import { resolveStockLabDbUrl, tryConnect, withRollback } from "../db-test-utils";
import { extractViewQueries } from "../integrity-views";

const PATCHES = resolve(__dirname, "..", "..", "..", "supabase", "patches");
const ONE_SHOT = "20261006z-one-shot-stock-resync.sql";

const MSG_DATA_GUARD = /One-shot 20261006z: producto .* no encontrado/;
const MSG_PATCH_A = /faltan prerrequisitos \(trigger stock_movements_apply activo/;
const MSG_PATCH_E = /falta el modo estricto del libro mayor/;
const FILE_PATCH_E = /20261006e-stock-ledger-strict\.sql/;
const MSG_PATCH_D = /faltan las vistas de integridad v2/;
const FILE_PATCH_D = /20261006d-stock-integrity-views-v2\.sql/;

interface Snapshot {
  products: number;
  products_hash: string;
  movements: number;
  movements_hash: string;
}

interface Attempt {
  /** Mensaje de la excepción del one-shot, o null si terminó sin error. */
  error: string | null;
  /** `products` / `stock_movements` justo antes y justo después, dentro de la transacción. */
  before: Snapshot;
  after: Snapshot;
}

let client: Client;
let baseline: Snapshot;

function readPatch(name: string): string {
  return readFileSync(resolve(PATCHES, name), "utf8").replace(/\r\n/g, "\n");
}

/** El archivo real sin su `begin;` / `commit;` exteriores (exactamente uno de cada). */
function oneShotBody(): string {
  const sql = readPatch(ONE_SHOT);
  const begins = sql.match(/^begin;$/gm) ?? [];
  const commits = sql.match(/^commit;$/gm) ?? [];
  if (begins.length !== 1 || commits.length !== 1) {
    throw new Error(`SETUP · ${ONE_SHOT}: se esperaba un begin; y un commit; exteriores (${begins.length}/${commits.length})`);
  }
  return sql.replace(/^begin;$/m, "").replace(/^commit;$/m, "");
}

/** `create or replace function public.<name>() … $$;` tal cual está en el parche. */
function functionFromPatch(patch: string, name: string): string {
  const match = new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\n\\$\\$;`).exec(readPatch(patch));
  if (!match) throw new Error(`SETUP · ${patch}: no se encontró la función ${name}()`);
  return match[0];
}

async function snapshot(tx: Client): Promise<Snapshot> {
  const result = await tx.query<Snapshot>(
    `select
       (select count(*)::int from public.products) as products,
       (select md5(coalesce(string_agg(p.id::text || ':' || p.current_stock, ',' order by p.id), ''))
          from public.products p) as products_hash,
       (select count(*)::int from public.stock_movements) as movements,
       (select md5(coalesce(string_agg(m.id::text || ':' || m.quantity_delta || ':' || m.stock_after, ',' order by m.id), ''))
          from public.stock_movements m) as movements_hash`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("SETUP · snapshot: sin fila");
  return row;
}

/** Simula el estado, ejecuta el one-shot real y deshace TODO (savepoint + rollback). */
async function attempt(simulate?: (tx: Client) => Promise<void>): Promise<Attempt> {
  const body = oneShotBody();
  return withRollback(client, async (tx) => {
    if (simulate) {
      try {
        await simulate(tx);
      } catch (error) {
        throw new Error(`SETUP · simulación: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const before = await snapshot(tx);
    await tx.query("savepoint one_shot_attempt");
    let error: string | null = null;
    try {
      await tx.query(body);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    await tx.query("rollback to savepoint one_shot_attempt");
    const after = await snapshot(tx);
    return { error, before, after };
  });
}

async function expectNothingWritten(result: Attempt): Promise<void> {
  expect(result.after).toEqual(result.before);
  expect(await snapshot(client)).toEqual(baseline);
}

beforeAll(async () => {
  const connected = await tryConnect(resolveStockLabDbUrl(), 10_000);
  if (!connected) throw new Error("SETUP · la base lab no responde (npm run stock-lab:db-up)");
  client = connected;
  baseline = await snapshot(client);
});

afterAll(async () => {
  await client?.end();
});

describe("STK-650 · one-shot 20261006z: guarda de prerrequisitos", () => {
  it("con a–i aplicados la guarda de prerrequisitos pasa y aborta la guarda de datos (productos de producción ausentes en lab)", async () => {
    const result = await attempt();

    expect(result.error).toMatch(MSG_DATA_GUARD);
    expect(result.error).not.toMatch(MSG_PATCH_A);
    expect(result.error).not.toMatch(MSG_PATCH_E);
    expect(result.error).not.toMatch(MSG_PATCH_D);
    await expectNothingWritten(result);
  });

  it("sin e (stock_movements_apply con la rama legada del parche a) aborta nombrando el parche e", async () => {
    const legacy = functionFromPatch("20261006a-stock-ledger-guards.sql", "stock_movements_apply");
    expect(legacy).toMatch(/stock_after is null/);

    const result = await attempt(async (tx) => {
      await tx.query(legacy);
    });

    expect(result.error).toMatch(MSG_PATCH_E);
    expect(result.error).toMatch(FILE_PATCH_E);
    expect(result.error).toMatch(/stock_movements_apply/);
    await expectNothingWritten(result);
  });

  it("sin e (products_stock_guard con el pase current_user del parche a) aborta nombrando el parche e", async () => {
    const legacy = functionFromPatch("20261006a-stock-ledger-guards.sql", "products_stock_guard");
    expect(legacy).toMatch(/current_user = 'postgres'/);

    const result = await attempt(async (tx) => {
      await tx.query(legacy);
    });

    expect(result.error).toMatch(MSG_PATCH_E);
    expect(result.error).toMatch(FILE_PATCH_E);
    expect(result.error).toMatch(/products_stock_guard/);
    await expectNothingWritten(result);
  });

  it.each(["trg_products_stock_guard_update", "trg_products_stock_guard_insert"])(
    "con el trigger de guarda %s de products deshabilitado aborta nombrando el parche e",
    async (trigger) => {
      const result = await attempt(async (tx) => {
        await tx.query(`alter table public.products disable trigger ${trigger}`);
      });

      expect(result.error).toMatch(MSG_PATCH_E);
      expect(result.error).toMatch(FILE_PATCH_E);
      await expectNothingWritten(result);
    },
  );

  it("sin d (falta la vista stock_chain_breaks) aborta nombrando el parche d", async () => {
    const result = await attempt(async (tx) => {
      await tx.query("drop view public.stock_chain_breaks");
    });

    expect(result.error).toMatch(MSG_PATCH_D);
    expect(result.error).toMatch(FILE_PATCH_D);
    await expectNothingWritten(result);
  });

  it("sin d (stock_chain_breaks en su forma v1: orden por created_at, sin columna seq) aborta nombrando el parche d", async () => {
    const v1 = extractViewQueries(readPatch("20261005-stock-integrity-views.sql")).stock_chain_breaks;
    expect(v1).toMatch(/order by m\.created_at/);

    const result = await attempt(async (tx) => {
      await tx.query("drop view public.stock_chain_breaks");
      await tx.query(`create view public.stock_chain_breaks with (security_invoker = true) as\n${v1}`);
    });

    expect(result.error).toMatch(MSG_PATCH_D);
    expect(result.error).toMatch(FILE_PATCH_D);
    expect(result.error).toMatch(/stock_chain_breaks/);
    await expectNothingWritten(result);
  });

  it("con el trigger stock_movements_apply deshabilitado (existe pero no dispara) aborta en la guarda del parche a", async () => {
    const result = await attempt(async (tx) => {
      await tx.query("alter table public.stock_movements disable trigger trg_stock_movements_apply");
    });

    expect(result.error).toMatch(MSG_PATCH_A);
    await expectNothingWritten(result);
  });

  it("con el trigger stock_movements_apply en modo replica (no dispara en una sesión normal) aborta en la guarda del parche a", async () => {
    const result = await attempt(async (tx) => {
      await tx.query("alter table public.stock_movements enable replica trigger trg_stock_movements_apply");
    });

    expect(result.error).toMatch(MSG_PATCH_A);
    await expectNothingWritten(result);
  });
});
