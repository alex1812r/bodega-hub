/** @jest-environment node */
/**
 * INV-L2 · regresión del parche `20261011d-pack-recipe-write-lockdown.sql`.
 *
 * `save_pack_recipe` (20261011c) valida la regla de cadenas con el empaque y sus componentes bloqueados, pero
 * `authenticated` conservaba insert / update / delete sobre `product_pack_conversions` y `product_pack_components`:
 * con el JWT de admin o de almacén, un `POST /rest/v1/product_pack_conversions` dejaba la cadena RA → RB → RC sin
 * pasar por la RPC (caos Inventario, pasada 2, M1). Y `anon` tenía todos los privilegios sobre la cabecera.
 *
 * Cada test enuncia el comportamiento SANO: la receta solo se escribe por `save_pack_recipe` (o por conexión
 * `postgres` / `service_role`: migraciones y fixtures). Los casos SQL corren en una transacción que termina en
 * `rollback`, con cada sentencia bajo `set local role` + `request.jwt.claims`. El caso de PostgREST usa datos
 * confirmados (productos sin stock, que se borran al terminar) y el JWT real de cada usuario lab.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/pack-recipe-lockdown.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };
/** Usuario lab, sin sesión, o `null` = `postgres` (preparación y fixtures). */
type Actor = LabRoleKey | "anon" | null;

const PATCH = resolve(__dirname, "../../../supabase/patches/20261011d-pack-recipe-write-lockdown.sql");
const TAG = `INVL2-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TABLES = ["product_pack_conversions", "product_pack_components"] as const;
const PRIVILEGES = ["select", "insert", "update", "delete", "truncate", "references", "trigger"] as const;
const DENIED = "42501";
const SAVE = "select public.save_pack_recipe($1::uuid, $2::boolean, $3::integer, $4::text, $5::jsonb) as r";
const WRITERS: readonly LabRoleKey[] = ["admin", "almacen"];

let lab: Lab;
let db: Client;
let seq = 0;
const committed: string[] = [];

function failure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown }).code;
  return { code: typeof code === "string" ? code : "?", message: error instanceof Error ? error.message : String(error) };
}

async function sql(what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  try {
    return (await db.query<Row>(text, params)).rows;
  } catch (error) {
    const { code, message } = failure(error);
    throw new Error(`SETUP · ${what}: ${code} ${message}`);
  }
}

/** `text` en un savepoint como `actor`, con las restricciones diferidas forzadas al final. Devuelve filas o error. */
async function run(actor: Actor, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint invl2");
  try {
    if (actor !== null) await actAs(db, actor === "anon" ? null : lab.uids[actor]);
    const res = await db.query<Row>(text, params);
    await db.query("set constraints all immediate");
    await db.query("set constraints all deferred");
    await db.query("reset role");
    await db.query("release savepoint invl2");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint invl2");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

const pairParams = (pack: string, unit: string, units: number): unknown[] => [
  pack,
  true,
  units,
  null,
  JSON.stringify([{ unit_product_id: unit, units_per_pack: units }]),
];

async function product(name: string, options: { commit?: boolean } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${name}-${seq}`.toLowerCase();
  const text = `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
     values ($1, $2, $2, 9, 1, 0, 0) returning id`;
  const rows = options.commit ? await lab.rows(text, [lab.storeId, sku]) : await sql(`producto ${sku}`, text, [lab.storeId, sku]);
  const id = String(rows[0]?.id);
  if (options.commit) committed.push(id);
  return id;
}

/** Cabeceras y componentes de estos empaques, tal cual están en la base. */
async function snapshot(packs: readonly string[]): Promise<string> {
  const rows = await lab.rows(
    `select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('components',
              (select coalesce(jsonb_agg(to_jsonb(pc) order by pc.unit_product_id), '[]'::jsonb)
               from public.product_pack_components pc where pc.conversion_id = c.id)) order by c.id), '[]'::jsonb)::text as s
     from public.product_pack_conversions c where c.pack_product_id = any($1::uuid[])`,
    [packs],
  );
  return String(rows[0]?.s);
}

/** Empaques con receta activa que son, a la vez, componente de otra receta activa. */
async function chains(ids: readonly string[]): Promise<number> {
  const rows = await lab.rows(
    `select count(*)::int as n
     from public.product_pack_conversions c
     join public.product_pack_components pc on pc.unit_product_id = c.pack_product_id
     join public.product_pack_conversions outer_recipe on outer_recipe.id = pc.conversion_id
     where c.is_active and outer_recipe.is_active and c.pack_product_id = any($1::uuid[])`,
    [ids],
  );
  return Number(rows[0]?.n);
}

/** Las escrituras directas del reporte (y las equivalentes sobre los componentes), en orden. */
function directWrites(storeId: string, recipeId: string, rb: string, rc: string): Array<[string, string, unknown[]]> {
  return [
    [
      "insert cabecera (cadena RB → RC)",
      `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, total_units, is_active)
       values ($1, $2, $3, 3, 3, true) returning id`,
      [storeId, rb, rc],
    ],
    ["update cabecera", "update public.product_pack_conversions set units_per_pack = 99, total_units = 99 where id = $1 returning id", [recipeId]],
    ["delete cabecera", "delete from public.product_pack_conversions where id = $1 returning id", [recipeId]],
    [
      "insert componente",
      "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack) values ($1, $2, $3, 1) returning id",
      [recipeId, storeId, rc],
    ],
    ["update componente", "update public.product_pack_components set units_per_pack = 99 where conversion_id = $1 returning id", [recipeId]],
    ["delete componente", "delete from public.product_pack_components where conversion_id = $1 returning id", [recipeId]],
    ["truncate cabecera", "truncate public.product_pack_conversions cascade", []],
    ["truncate componentes", "truncate public.product_pack_components", []],
  ];
}

async function privileges(): Promise<Record<string, Record<string, string[]>>> {
  const rows = await lab.rows(
    `select r.role, t.name as "table",
            coalesce(array_agg(p.name order by p.ord) filter (where has_table_privilege(r.role, 'public.' || t.name, p.name)), '{}') as granted
     from unnest($1::text[]) as r(role)
     cross join unnest($2::text[]) as t(name)
     cross join unnest($3::text[]) with ordinality as p(name, ord)
     group by r.role, t.name`,
    [["anon", "authenticated", "service_role", "public"], [...TABLES], [...PRIVILEGES]],
  );
  const out: Record<string, Record<string, string[]>> = {};
  for (const row of rows) (out[String(row.role)] ??= {})[String(row.table)] = row.granted as string[];
  return out;
}

const EXPECTED_PRIVILEGES = Object.fromEntries(
  (
    [
      ["anon", []],
      ["authenticated", ["select"]],
      ["service_role", [...PRIVILEGES]],
      ["public", []],
    ] as const
  ).map(([role, granted]) => [role, Object.fromEntries(TABLES.map((table) => [table, [...granted]]))]),
);

beforeAll(async () => {
  lab = await Lab.open("invl2");
  db = await lab.pg();
});

afterAll(async () => {
  if (!lab) return;
  try {
    if (committed.length > 0) {
      await lab.rows("delete from public.product_pack_conversions where pack_product_id = any($1::uuid[])", [committed]);
      await lab.rows("delete from public.products where id = any($1::uuid[])", [committed]);
    }
  } finally {
    await lab.close();
  }
});

describe("privilegios de tabla", () => {
  it("anon no tiene ninguno, authenticated solo select y service_role todos, en las dos tablas", async () => {
    expect(await privileges()).toEqual(EXPECTED_PRIVILEGES);
  });

  it("el parche es idempotente: aplicado dos veces deja los mismos privilegios, las mismas políticas y la RPC intacta", async () => {
    await withRollback(db, async () => {
      const text = readFileSync(PATCH, "utf8");
      const begins = text.match(/^begin;\r?$/gm)?.length ?? 0;
      const commits = text.match(/^commit;\r?$/gm)?.length ?? 0;
      expect([begins, commits]).toEqual([1, 1]);
      expect(text.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
      const body = text.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "").replace(/^notify pgrst.*$/m, "");
      const policies = (): Promise<Row[]> =>
        sql(
          "políticas",
          `select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
           where schemaname = 'public' and tablename = any($1::text[]) order by 1, 2`,
          [[...TABLES]],
        );
      const before = await policies();

      await sql("aplicar el parche (1)", body);
      await sql("aplicar el parche (2)", body);

      // Dentro de la misma transacción: los privilegios se leen por la conexión que aplicó el parche.
      const rows = await sql(
        "privilegios",
        `select r.role, t.name as "table",
                coalesce(array_agg(p.name order by p.ord) filter (where has_table_privilege(r.role, 'public.' || t.name, p.name)), '{}') as granted
         from unnest($1::text[]) as r(role)
         cross join unnest($2::text[]) as t(name)
         cross join unnest($3::text[]) with ordinality as p(name, ord)
         group by r.role, t.name`,
        [["anon", "authenticated", "service_role", "public"], [...TABLES], [...PRIVILEGES]],
      );
      const granted: Record<string, Record<string, string[]>> = {};
      for (const row of rows) (granted[String(row.role)] ??= {})[String(row.table)] = row.granted as string[];
      expect(granted).toEqual(EXPECTED_PRIVILEGES);

      // RLS por tienda intacta (4 políticas, sin cambios) y sigue activada.
      expect(await policies()).toEqual(before);
      expect(before).toHaveLength(4);
      const rls = await sql("rls", "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1::text[]) order by 1", [[...TABLES]]);
      expect(rls.map((r) => r.relrowsecurity)).toEqual([true, true]);

      // La RPC es security definer y su dueño conserva la escritura: es el único camino de authenticated.
      const rpc = await sql(
        "save_pack_recipe",
        `select p.prosecdef,
                has_table_privilege(p.proowner, 'public.product_pack_conversions', 'insert, update') as header,
                has_table_privilege(p.proowner, 'public.product_pack_components', 'insert') as components,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_pack_recipe'`,
      );
      expect(rpc).toEqual([{ prosecdef: true, header: true, components: true, authenticated: true, anon: false }]);
    });
  });
});

describe("escritura directa · rechazada sin cambios", () => {
  it.each(WRITERS)("%s: insert / update / delete / truncate en las dos tablas → 42501, la receta queda igual y no hay cadena", async (role) => {
    await withRollback(db, async () => {
      const [ra, rb, rc] = [await product("ra"), await product("rb"), await product("rc")];
      const savedOut = await run(role, SAVE, pairParams(ra, rb, 6));
      if (savedOut.code !== null) throw new Error(`SETUP · receta RA → RB: ${savedOut.code} ${savedOut.message}`);
      const recipeId = String((savedOut.rows[0]?.r as Row).conversionId);
      const snap = async (): Promise<string> =>
        String(
          (
            await sql(
              "estado",
              `select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)::text || ' / ' ||
                      (select coalesce(jsonb_agg(to_jsonb(pc) order by pc.id), '[]'::jsonb)::text
                       from public.product_pack_components pc where pc.store_id = $1) as s
               from public.product_pack_conversions c where c.store_id = $1`,
              [lab.storeId],
            )
          )[0]?.s,
        );
      const before = await snap();

      const outcomes: Array<[string, string | null]> = [];
      for (const [name, text, params] of directWrites(lab.storeId, recipeId, rb, rc)) {
        outcomes.push([name, (await run(role, text, params)).code]);
      }

      expect(outcomes).toEqual(directWrites(lab.storeId, recipeId, rb, rc).map(([name]) => [name, DENIED]));
      expect(await snap()).toBe(before);
      const chained = await sql(
        "cadenas",
        `select count(*)::int as n from public.product_pack_conversions c
         join public.product_pack_components pc on pc.unit_product_id = c.pack_product_id
         join public.product_pack_conversions o on o.id = pc.conversion_id
         where c.is_active and o.is_active and c.pack_product_id = any($1::uuid[])`,
        [[ra, rb, rc]],
      );
      expect(chained[0]?.n).toBe(0);
    });
  });

  it("vendedor, contador y anon tampoco escriben; anon ni siquiera lee", async () => {
    await withRollback(db, async () => {
      const [ra, rb, rc] = [await product("ra"), await product("rb"), await product("rc")];
      const savedOut = await run("admin", SAVE, pairParams(ra, rb, 6));
      if (savedOut.code !== null) throw new Error(`SETUP · receta RA → RB: ${savedOut.code} ${savedOut.message}`);
      const recipeId = String((savedOut.rows[0]?.r as Row).conversionId);

      for (const actor of ["vendedor1", "contador", "anon"] as const) {
        const codes: Array<string | null> = [];
        for (const [, text, params] of directWrites(lab.storeId, recipeId, rb, rc)) codes.push((await run(actor, text, params)).code);
        expect([actor, [...new Set(codes)]]).toEqual([actor, [DENIED]]);
      }
      for (const table of TABLES) {
        expect([table, (await run("anon", `select count(*)::int as n from public.${table}`)).code]).toEqual([table, DENIED]);
      }
    });
  });
});

describe("lo que sigue funcionando", () => {
  it("select: admin, almacén, vendedor y contador leen la receta de su tienda con sus componentes", async () => {
    await withRollback(db, async () => {
      const [ra, rb] = [await product("ra"), await product("rb")];
      const savedOut = await run("admin", SAVE, pairParams(ra, rb, 6));
      if (savedOut.code !== null) throw new Error(`SETUP · receta RA → RB: ${savedOut.code} ${savedOut.message}`);

      for (const role of ["admin", "almacen", "vendedor1", "contador"] as const) {
        const read = await run(
          role,
          `select c.total_units, c.is_active, pc.unit_product_id, pc.units_per_pack
           from public.product_pack_conversions c join public.product_pack_components pc on pc.conversion_id = c.id
           where c.pack_product_id = $1`,
          [ra],
        );
        expect([role, read.code, read.rows]).toEqual([role, null, [{ total_units: 6, is_active: true, unit_product_id: rb, units_per_pack: 6 }]]);
      }
    });
  });

  it.each(WRITERS)("save_pack_recipe como %s: guarda, edita en sitio, reemplaza y desactiva; la apertura lee la receta", async (role) => {
    await withRollback(db, async () => {
      const [pack, b, c] = [await product("pack"), await product("b"), await product("c")];
      const call = async (params: unknown[]): Promise<Row> => {
        const out = await run(role, SAVE, params);
        if (out.code !== null) throw new Error(`save_pack_recipe: ${out.code} ${out.message}`);
        return out.rows[0]?.r as Row;
      };

      const created = await call(pairParams(pack, b, 6));
      expect(created).toMatchObject({ action: "created", totalUnits: 6 });
      expect(await call(pairParams(pack, b, 12))).toMatchObject({ action: "updated", conversionId: created.conversionId });
      const replaced = await call([
        pack,
        true,
        6,
        "Surtido",
        JSON.stringify([{ unit_product_id: b, units_per_pack: 2 }, { unit_product_id: c, units_per_pack: 4 }]),
      ]);
      expect(replaced).toMatchObject({ action: "replaced", previousConversionId: created.conversionId, label: "Surtido" });

      const state = await sql(
        "recetas",
        `select c.is_active, c.total_units, (select count(*)::int from public.product_pack_components pc where pc.conversion_id = c.id) as n
         from public.product_pack_conversions c where c.pack_product_id = $1 order by c.is_active desc`,
        [pack],
      );
      expect(state).toEqual([{ is_active: true, total_units: 6, n: 2 }, { is_active: false, total_units: 12, n: 1 }]);

      // La regla de cadenas sigue en la RPC: `b` ya sale de `pack` y no estrena receta propia.
      expect((await run(role, SAVE, pairParams(b, c, 3))).code).toBe("PT409");

      // Abrir sin stock llega hasta leer la receta (PT409 por stock, no 42501 ni PT404).
      const open = await run(role, "select public.convert_pack_to_units(p_pack_product_id => $1::uuid, p_pack_quantity => 1, p_reason => $2::text) as r", [pack, TAG]);
      expect(open.code).toBe("PT409");

      expect(await call([pack, false, null, null, null])).toMatchObject({ action: "disabled", previousConversionId: replaced.conversionId });
      expect(await sql("activas", "select 1 from public.product_pack_conversions where pack_product_id = $1 and is_active", [pack])).toEqual([]);
    });
  });

  it("postgres (migraciones y fixtures) sigue escribiendo las dos tablas", async () => {
    await withRollback(db, async () => {
      const [pack, b, c] = [await product("pack"), await product("b"), await product("c")];
      const header = await run(
        null,
        `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active)
         values ($1, $2, $3, 6, false) returning id`,
        [lab.storeId, pack, b],
      );
      const id = header.rows[0]?.id;
      const component = await run(null, "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack) values ($1, $2, $3, 2)", [id, lab.storeId, c]);
      const removed = await run(null, "delete from public.product_pack_conversions where id = $1 returning id", [id]);
      expect([header.code, component.code, removed.code, removed.rows.length]).toEqual([null, null, null, 1]);
    });
  });
});

describe("PostgREST real · el caso del reporte (caos pasada 2, M1)", () => {
  it.each(WRITERS)("JWT de %s: POST / PATCH / DELETE sobre las dos tablas → 403 sin cambios; GET 200; la RPC guarda y desactiva", async (role) => {
    const client = await lab.supa(role);
    const [ra, rb, rc] = [await product("ra", { commit: true }), await product("rb", { commit: true }), await product("rc", { commit: true })];
    const viaRpc = await client.rpc("save_pack_recipe", {
      p_pack_product_id: ra,
      p_enabled: true,
      p_total_units: 6,
      p_label: null,
      p_components: [{ unit_product_id: rb, units_per_pack: 6 }],
    });
    expect(viaRpc.error).toBeNull();
    const recipeId = String((viaRpc.data as Row).conversionId);
    const before = await snapshot([ra, rb, rc]);

    const post = await client
      .from("product_pack_conversions")
      .insert({ store_id: lab.storeId, pack_product_id: rb, unit_product_id: rc, units_per_pack: 3, total_units: 3, is_active: true });
    const patch = await client.from("product_pack_conversions").update({ units_per_pack: 99, total_units: 99 }).eq("id", recipeId);
    const remove = await client.from("product_pack_conversions").delete().eq("id", recipeId);
    const postComponent = await client.from("product_pack_components").insert({ conversion_id: recipeId, store_id: lab.storeId, unit_product_id: rc, units_per_pack: 1 });
    const patchComponent = await client.from("product_pack_components").update({ units_per_pack: 99 }).eq("conversion_id", recipeId);
    const removeComponent = await client.from("product_pack_components").delete().eq("conversion_id", recipeId);

    expect(
      [post, patch, remove, postComponent, patchComponent, removeComponent].map((res) => [res.status, res.error?.code ?? null]),
    ).toEqual(Array.from({ length: 6 }, () => [403, DENIED]));
    expect(await snapshot([ra, rb, rc])).toBe(before);
    expect(await chains([ra, rb, rc])).toBe(0);

    const read = await client
      .from("product_pack_conversions")
      .select("id, total_units, components:product_pack_components(unit_product_id, units_per_pack)")
      .eq("pack_product_id", ra);
    expect([read.status, read.data]).toEqual([200, [{ id: recipeId, total_units: 6, components: [{ unit_product_id: rb, units_per_pack: 6 }] }]]);

    const disabled = await client.rpc("save_pack_recipe", { p_pack_product_id: ra, p_enabled: false });
    expect([disabled.error, (disabled.data as Row | null)?.action]).toEqual([null, "disabled"]);
  });

  it("sin sesión (anon key): no lee ni escribe ninguna de las dos tablas", async () => {
    const anon = lab.anon();
    const [ra, rb] = [await product("ra", { commit: true }), await product("rb", { commit: true })];
    const before = await snapshot([ra, rb]);

    const results = [
      await anon.from("product_pack_conversions").select("id").limit(1),
      await anon.from("product_pack_components").select("id").limit(1),
      await anon.from("product_pack_conversions").insert({ store_id: lab.storeId, pack_product_id: ra, unit_product_id: rb, units_per_pack: 3, total_units: 3, is_active: true }),
      await anon.from("product_pack_components").delete().eq("store_id", lab.storeId),
    ];

    expect(results.map((res) => [res.status, res.error?.code ?? null])).toEqual(Array.from({ length: 4 }, () => [401, DENIED]));
    expect(await snapshot([ra, rb])).toBe(before);
  });
});
