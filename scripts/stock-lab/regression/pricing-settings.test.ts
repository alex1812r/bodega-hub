/** @jest-environment node */
/**
 * PRO-09 · regresión del parche `20261009b-pricing-settings.sql`: semáforo de ganancia y chips de % por tienda
 * (`app_settings.margin_yellow_from_pct`, `margin_green_from_pct`, `markup_chips_pct`) y % de ganancia sugerido por
 * categoría (`categories.default_markup_pct`).
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en `rollback`
 * (no queda nada en la base): los datos se preparan como `postgres` y cada sentencia probada se ejecuta con
 * `set local role authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/pricing-settings.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import { DEFAULT_MARGIN_THRESHOLDS, DEFAULT_MARKUP_CHIPS } from "@bodega/core";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };

const PATCH = resolve(__dirname, "../../../supabase/patches/20261009b-pricing-settings.sql");
const TAG = `PRO09-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const CHECK_VIOLATION = "23514";
/** `numeric(6,2)` no admite Infinity: lo rechaza el tipo antes de llegar a triggers y checks. */
const NUMERIC_OVERFLOW = "22003";

let lab: Lab;
let db: Client;
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
 * Ejecuta `text` dentro de un savepoint como el usuario lab `role` (o como `anon`). Devuelve el error (SQLSTATE +
 * mensaje) en vez de lanzarlo y deja la transacción utilizable y en el rol de la sesión.
 */
async function run(role: LabRoleKey | "anon", text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint pro09");
  try {
    await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint pro09");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint pro09");
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

function pricing(storeId: string = lab.storeId): Promise<Row> {
  return one(
    "ajustes de precios",
    `select margin_yellow_from_pct::text as yellow, margin_green_from_pct::text as green, markup_chips_pct::text as chips
     from public.app_settings where store_id = $1`,
    [storeId],
  );
}

/** Lo que hizo la sentencia: SQLSTATE si falló, o cuántas filas tocó. */
function result(out: Outcome): string | number {
  return out.code ?? out.rows.length;
}

function setThresholds(role: LabRoleKey | "anon", yellow: string, green: string, storeId: string = lab.storeId): Promise<Outcome> {
  return run(
    role,
    "update public.app_settings set margin_yellow_from_pct = $2::numeric, margin_green_from_pct = $3::numeric where store_id = $1 returning store_id",
    [storeId, yellow, green],
  );
}

function setChips(role: LabRoleKey | "anon", chips: string, storeId: string = lab.storeId): Promise<Outcome> {
  return run(role, "update public.app_settings set markup_chips_pct = $2::numeric[] where store_id = $1 returning store_id", [storeId, chips]);
}

async function category(storeId: string = lab.storeId): Promise<string> {
  seq += 1;
  const row = await one("categoría", "insert into public.categories (store_id, name, tax_rate) values ($1, $2, 16) returning id", [
    storeId,
    `${TAG}-cat-${seq}`,
  ]);
  return String(row.id);
}

function setMarkup(role: LabRoleKey | "anon", categoryId: string, pct: string | null): Promise<Outcome> {
  return run(role, "update public.categories set default_markup_pct = $2::numeric where id = $1 returning id", [categoryId, pct]);
}

async function markupOf(categoryId: string): Promise<unknown> {
  return (await one("% sugerido", "select default_markup_pct::text as pct from public.categories where id = $1", [categoryId])).pct;
}

beforeAll(async () => {
  lab = await Lab.open("pro09");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("app_settings · semáforo de ganancia y chips de % por tienda (20261009b)", () => {
  it("toda tienda nace con los valores por defecto de @bodega/core: rojo < 15, verde ≥ 25 y chips 12 / 20 / 30", async () => {
    const rows = await sql(
      "ajustes de todas las tiendas",
      `select distinct margin_yellow_from_pct::float8 as yellow, margin_green_from_pct::float8 as green, markup_chips_pct::float8[] as chips
       from public.app_settings where store_id = any($1::uuid[])`,
      [[lab.storeId, lab.defaultStoreId]],
    );

    expect(rows).toEqual([
      { yellow: DEFAULT_MARGIN_THRESHOLDS.low, green: DEFAULT_MARGIN_THRESHOLDS.high, chips: [...DEFAULT_MARKUP_CHIPS] },
    ]);
  });

  it("los umbrales cumplen 0 ≤ amarillo < verde ≤ 1000: invertidos, iguales o fuera de rango se rechazan; NaN responde PT400 e Infinity no cabe en la columna", async () => {
    await withRollback(db, async () => {
      const rejected = [
        await setThresholds("admin", "30", "20"),
        await setThresholds("admin", "20", "20"),
        await setThresholds("admin", "-0.01", "25"),
        await setThresholds("admin", "15", "1000.01"),
        await setThresholds("admin", "NaN", "25"),
        await setThresholds("admin", "15", "Infinity"),
      ].map(result);
      const untouched = await pricing();
      const edges = result(await setThresholds("admin", "0", "1000"));

      expect({ rejected, untouched, edges, final: await pricing() }).toEqual({
        rejected: [CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION, "PT400", NUMERIC_OVERFLOW],
        untouched: { yellow: "15.00", green: "25.00", chips: "{12.00,20.00,30.00}" },
        edges: 1,
        final: { yellow: "0.00", green: "1000.00", chips: "{12.00,20.00,30.00}" },
      });
    });
  });

  it("los chips son de 1 a 6 valores, cada uno > 0 y ≤ 1000, sin duplicados, sin NULL y en una sola dimensión", async () => {
    await withRollback(db, async () => {
      const rejected = [
        await setChips("admin", "{}"),
        await setChips("admin", "{12,20,12.00}"),
        await setChips("admin", "{12.001,12.004}"),
        await setChips("admin", "{1,2,3,4,5,6,7}"),
        await setChips("admin", "{0,20}"),
        await setChips("admin", "{-5}"),
        await setChips("admin", "{1000.01}"),
        await setChips("admin", "{12,NULL}"),
        await setChips("admin", "{{12,20},{30,40}}"),
        await setChips("admin", "{NaN}"),
        await setChips("admin", "{Infinity}"),
      ].map(result);
      const untouched = await pricing();
      const single = result(await setChips("admin", "{1000}"));
      const six = result(await setChips("admin", "{0.01,5,10,15,20,25}"));

      expect({ rejected, untouched, accepted: [single, six], final: (await pricing()).chips }).toEqual({
        rejected: [...rejected.slice(0, -1).map(() => CHECK_VIOLATION), NUMERIC_OVERFLOW],
        untouched: { yellow: "15.00", green: "25.00", chips: "{12.00,20.00,30.00}" },
        accepted: [1, 1],
        final: "{0.01,5.00,10.00,15.00,20.00,25.00}",
      });
    });
  });

  it("solo el admin de la tienda los cambia: vendedor, almacen y contador no tocan ninguna fila, nadie toca otra tienda y anon no puede; todos los leen", async () => {
    await withRollback(db, async () => {
      const others = [
        await setThresholds("vendedor1", "10", "30"),
        await setThresholds("almacen", "10", "30"),
        await setThresholds("contador", "10", "30"),
        await setChips("vendedor1", "{5}"),
        await setChips("almacen", "{5}"),
        await setChips("contador", "{5}"),
      ].map(result);
      const foreign = [await setThresholds("admin", "10", "30", lab.defaultStoreId), await setChips("admin", "{5}", lab.defaultStoreId)].map(result);
      const anon = [await setThresholds("anon", "10", "30"), await setChips("anon", "{5}")].map(result);
      const read = "select margin_yellow_from_pct::text as yellow from public.app_settings where store_id = any($1::uuid[])";
      const readers = [];
      for (const role of ["vendedor1", "almacen", "contador"] as const) {
        readers.push((await run(role, read, [[lab.storeId, lab.defaultStoreId]])).rows);
      }
      const admin = [await setThresholds("admin", "10", "30"), await setChips("admin", "{5,50}")].map(result);

      expect({ others, foreign, anon, readers, admin, lab: await pricing(), otra: await pricing(lab.defaultStoreId) }).toEqual({
        others: [0, 0, 0, 0, 0, 0],
        foreign: [0, 0],
        anon: [0, 0],
        readers: [[{ yellow: "15.00" }], [{ yellow: "15.00" }], [{ yellow: "15.00" }]],
        admin: [1, 1],
        lab: { yellow: "10.00", green: "30.00", chips: "{5.00,50.00}" },
        otra: { yellow: "15.00", green: "25.00", chips: "{12.00,20.00,30.00}" },
      });
    });
  });
});

describe("categories · % de ganancia sugerido opcional (20261009b)", () => {
  it("una categoría nace sin sugerencia; admite > 0 y ≤ 1000 y volver a NULL; 0, negativo y fuera de rango se rechazan; NaN responde PT400", async () => {
    await withRollback(db, async () => {
      const id = await category();
      const born = await markupOf(id);
      const rejected = [
        await setMarkup("admin", id, "0"),
        await setMarkup("admin", id, "-5"),
        await setMarkup("admin", id, "1000.01"),
        await setMarkup("admin", id, "NaN"),
      ].map(result);
      const untouched = await markupOf(id);
      const set = result(await setMarkup("almacen", id, "35.5"));
      const stored = await markupOf(id);
      const top = result(await setMarkup("admin", id, "1000"));
      const cleared = result(await setMarkup("admin", id, null));

      expect({ born, rejected, untouched, set, stored, top, cleared, final: await markupOf(id) }).toEqual({
        born: null,
        rejected: [CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION, "PT400"],
        untouched: null,
        set: 1,
        stored: "35.50",
        top: 1,
        cleared: 1,
        final: null,
      });
    });
  });

  it("lo escriben admin y almacen de la tienda: vendedor y contador no tocan ninguna fila, nadie toca la categoría de otra tienda y anon no puede", async () => {
    await withRollback(db, async () => {
      const own = await category();
      const foreign = await category(lab.defaultStoreId);

      const results = [
        await setMarkup("vendedor1", own, "20"),
        await setMarkup("contador", own, "20"),
        await setMarkup("admin", foreign, "20"),
        await setMarkup("almacen", foreign, "20"),
        await setMarkup("anon", own, "20"),
      ].map(result);

      expect({ results, propia: await markupOf(own), ajena: await markupOf(foreign) }).toEqual({
        results: [0, 0, 0, 0, 0],
        propia: null,
        ajena: null,
      });
    });
  });
});

describe("20261009b · reaplicar el parche", () => {
  it("aplicarlo dos veces más no falla, conserva lo que la tienda configuró y deja los mismos checks y triggers", async () => {
    await withRollback(db, async () => {
      const id = await category();
      await setThresholds("admin", "10", "30");
      await setChips("admin", "{5,50}");
      await setMarkup("admin", id, "40");
      const shape = `select
          (select count(*)::int from pg_constraint where conname in
            ('app_settings_margin_thresholds_check', 'app_settings_markup_chips_check', 'categories_default_markup_pct_check')) as checks,
          (select count(*)::int from pg_trigger where not tgisinternal and tgname like 'trg_zz_reject_non_finite_numeric_%'
            and tgrelid in ('public.app_settings'::regclass, 'public.categories'::regclass)) as triggers`;
      const before = await one("forma antes", shape);

      await sql("reaplicar (1)", patchBody());
      await sql("reaplicar (2)", patchBody());

      const stillRejects = [await setThresholds("admin", "30", "20"), await setChips("admin", "{}"), await setMarkup("admin", id, "0")].map(result);

      expect({ before, after: await one("forma después", shape), pricing: await pricing(), markup: await markupOf(id), stillRejects }).toEqual({
        before: { checks: 3, triggers: 4 },
        after: { checks: 3, triggers: 4 },
        pricing: { yellow: "10.00", green: "30.00", chips: "{5.00,50.00}" },
        markup: "40.00",
        stillRejects: [CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION],
      });
    });
  });
});
