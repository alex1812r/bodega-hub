/** @jest-environment node */
/**
 * CNF-10 · regresión del parche `20261015a-cash-close-diff-alert.sql`: umbral por tienda del aviso de faltante al
 * cerrar caja (`app_settings.cash_close_diff_alert_ves`).
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en `rollback`
 * (no queda nada en la base): los datos se preparan como `postgres` y cada sentencia probada se ejecuta con
 * `set local role authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/cash-close-diff-setting.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };

const PATCH = resolve(__dirname, "../../../supabase/patches/20261015a-cash-close-diff-alert.sql");
const CHECK_VIOLATION = "23514";
/** `numeric(14,2)` no admite Infinity: lo rechaza el tipo antes de llegar a triggers y checks. */
const NUMERIC_OVERFLOW = "22003";

let lab: Lab;
let db: Client;

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
 * Ejecuta `text` dentro de un savepoint como el usuario lab `role` (o como `anon`). Devuelve el error (SQLSTATE +
 * mensaje) en vez de lanzarlo y deja la transacción utilizable y en el rol de la sesión.
 */
async function run(role: LabRoleKey | "anon", text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint cnf10");
  try {
    await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint cnf10");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint cnf10");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

/** El parche sin su `begin;` / `commit;` (para aplicarlo dentro de la transacción del test) ni el `notify`. */
function patchBody(): string {
  const text = readFileSync(PATCH, "utf8");
  const begins = text.match(/^begin;\r?$/gm)?.length ?? 0;
  const commits = text.match(/^commit;\r?$/gm)?.length ?? 0;
  if (begins !== 1 || commits !== 1) throw new Error(`SETUP · el parche debe tener un begin y un commit (${begins}/${commits})`);
  return text.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "").replace(/^notify pgrst.*$/m, "");
}

async function threshold(storeId: string = lab.storeId): Promise<unknown> {
  return (
    await one("umbral de faltante", "select cash_close_diff_alert_ves::text as alert from public.app_settings where store_id = $1", [storeId])
  ).alert;
}

/** Lo que hizo la sentencia: SQLSTATE si falló, o cuántas filas tocó. */
function result(out: Outcome): string | number {
  return out.code ?? out.rows.length;
}

function setThreshold(role: LabRoleKey | "anon", value: string, storeId: string = lab.storeId): Promise<Outcome> {
  return run(role, "update public.app_settings set cash_close_diff_alert_ves = $2::numeric where store_id = $1 returning store_id", [
    storeId,
    value,
  ]);
}

function readThreshold(role: LabRoleKey | "anon", storeIds: string[]): Promise<Outcome> {
  return run(role, "select cash_close_diff_alert_ves::text as alert from public.app_settings where store_id = any($1::uuid[])", [storeIds]);
}

beforeAll(async () => {
  lab = await Lab.open("cnf10");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("app_settings.cash_close_diff_alert_ves · umbral de faltante al cerrar caja (20261015a)", () => {
  it("toda tienda nace con 0: cualquier faltante pide confirmación hasta que el admin lo cambie", async () => {
    const rows = await sql(
      "umbral de todas las tiendas",
      "select distinct cash_close_diff_alert_ves::text as alert from public.app_settings where store_id = any($1::uuid[])",
      [[lab.storeId, lab.defaultStoreId]],
    );

    expect(rows).toEqual([{ alert: "0.00" }]);
  });

  it("solo admite un monto finito ≥ 0: negativo se rechaza, NaN responde PT400 e Infinity no cabe en la columna", async () => {
    await withRollback(db, async () => {
      const rejected = [
        await setThreshold("admin", "-0.01"),
        await setThreshold("admin", "-500"),
        await setThreshold("admin", "NaN"),
        await setThreshold("admin", "Infinity"),
      ].map(result);
      const untouched = await threshold();
      const accepted = [await setThreshold("admin", "150.505"), await setThreshold("admin", "0")].map(result);
      const top = result(await setThreshold("admin", "999999999999.99"));

      expect({ rejected, untouched, accepted, top, final: await threshold() }).toEqual({
        rejected: [CHECK_VIOLATION, CHECK_VIOLATION, "PT400", NUMERIC_OVERFLOW],
        untouched: "0.00",
        accepted: [1, 1],
        top: 1,
        final: "999999999999.99",
      });
    });
  });

  it("solo el admin de la tienda lo cambia: vendedor, almacen y contador no tocan ninguna fila, nadie toca otra tienda y anon no puede", async () => {
    await withRollback(db, async () => {
      const others = [
        await setThreshold("vendedor1", "500"),
        await setThreshold("almacen", "500"),
        await setThreshold("contador", "500"),
      ].map(result);
      const foreign = result(await setThreshold("admin", "500", lab.defaultStoreId));
      const anon = result(await setThreshold("anon", "500"));
      const admin = result(await setThreshold("admin", "120"));

      expect({ others, foreign, anon, admin, lab: await threshold(), otra: await threshold(lab.defaultStoreId) }).toEqual({
        others: [0, 0, 0],
        foreign: 0,
        anon: 0,
        admin: 1,
        lab: "120.00",
        otra: "0.00",
      });
    });
  });

  it("cada usuario lee solo el umbral de su tienda: pidiendo las dos, la otra no aparece; anon no lee ninguna", async () => {
    await withRollback(db, async () => {
      await sql("umbral de la tienda lab", "update public.app_settings set cash_close_diff_alert_ves = 120 where store_id = $1", [lab.storeId]);
      await sql("umbral de la otra tienda", "update public.app_settings set cash_close_diff_alert_ves = 777 where store_id = $1", [
        lab.defaultStoreId,
      ]);

      const readers: Row[][] = [];
      for (const role of ["admin", "vendedor1", "almacen", "contador"] as const) {
        readers.push((await readThreshold(role, [lab.storeId, lab.defaultStoreId])).rows);
      }
      const anon = await readThreshold("anon", [lab.storeId, lab.defaultStoreId]);

      expect({ readers, anon: anon.rows }).toEqual({
        readers: [[{ alert: "120.00" }], [{ alert: "120.00" }], [{ alert: "120.00" }], [{ alert: "120.00" }]],
        anon: [],
      });
    });
  });

  it("es solo un aviso de interfaz: ninguna función de public lee la columna (el cierre de caja no cambia)", async () => {
    const rows = await sql(
      "funciones que nombran la columna",
      `select p.proname from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%cash_close_diff_alert_ves%'`,
    );

    expect(rows).toEqual([]);
  });
});

describe("20261015a · reaplicar el parche", () => {
  it("aplicarlo dos veces más no falla, conserva lo que la tienda configuró y deja el mismo check y los mismos triggers", async () => {
    await withRollback(db, async () => {
      await setThreshold("admin", "120");
      const shape = `select
          (select count(*)::int from pg_constraint where conname = 'app_settings_cash_close_diff_alert_check') as checks,
          (select count(*)::int from pg_trigger where not tgisinternal and tgname like 'trg_zz_reject_non_finite_numeric_%'
            and tgrelid = 'public.app_settings'::regclass) as triggers`;
      const before = await one("forma antes", shape);

      await sql("reaplicar (1)", patchBody());
      await sql("reaplicar (2)", patchBody());

      const stillRejects = [await setThreshold("admin", "-1"), await setThreshold("admin", "NaN")].map(result);

      expect({ before, after: await one("forma después", shape), alert: await threshold(), stillRejects }).toEqual({
        before: { checks: 1, triggers: 2 },
        after: { checks: 1, triggers: 2 },
        alert: "120.00",
        stillRejects: [CHECK_VIOLATION, "PT400"],
      });
    });
  });
});
