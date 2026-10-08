/** @jest-environment node */
/**
 * INV-09 · regresión del parche `20261011c-save-pack-recipe.sql` (decisión D28c).
 *
 * Guardar la receta de un empaque eran varias peticiones de PostgREST compensadas a mano por el BFF, y la regla de
 * cadenas (un producto no es a la vez empaque de una receta activa y componente de otra) solo vivía en el BFF: dos
 * guardados simultáneos (A con componente B, y B con componente C) pasaban ambos y dejaban la cadena A → B → C.
 * `save_pack_recipe` lo hace en una transacción, con el empaque y sus componentes bloqueados por id.
 *
 * Cada test enuncia el comportamiento SANO. Las carreras son reales: conexiones `pg` propias con datos confirmados
 * (productos sin stock, que se borran al terminar), montadas con una tercera conexión que retiene el producto
 * compartido hasta que las dos llamadas están esperando su bloqueo. El resto corre dentro de una transacción que
 * termina en `rollback`, con cada sentencia probada bajo `set local role authenticated` + `request.jwt.claims` y las
 * restricciones diferidas forzadas al final (el "commit" de esa petición).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/pack-recipe-atomic.test.ts
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
/** Usuario lab, el admin de la otra tienda, sin sesión, o `null` = `postgres` (preparación). */
type Actor = LabRoleKey | "otherAdmin" | "anon" | null;
type Component = { id: string; units: unknown; weight?: unknown };
type RecipeState = { id: string; active: boolean; total: number; label: string | null; unit: string | null; components: string };

const PATCH = resolve(__dirname, "../../../supabase/patches/20261011c-save-pack-recipe.sql");
const OTHER_STORE_ADMIN_EMAIL = "admin@example.com";
const TAG = `INV09-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
/** Repeticiones de cada carrera (la mitad en cada orden de llegada). */
const ROUNDS = 12;

const SAVE = "select public.save_pack_recipe($1::uuid, $2::boolean, $3::integer, $4::text, $5::jsonb) as r";
const UNIT_IS_PACK = "El producto unidad es un empaque con receta activa: no puede salir de otro empaque.";
const COMPONENT_IS_PACK = "Un componente es un empaque con receta activa: no puede salir de otro empaque.";

let lab: Lab;
let db: Client;
let first: Client;
let second: Client;
let gate: Client;
let otherAdmin = "";
let seq = 0;
const committed: string[] = [];

function failure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown }).code;
  return { code: typeof code === "string" ? code : "?", message: error instanceof Error ? error.message : String(error) };
}

/** SQL de preparación / lectura como `postgres`. Si falla, el test no pudo montarse. */
async function sql(what: string, text: string, params: unknown[] = [], client: Client = db): Promise<Row[]> {
  try {
    return (await client.query<Row>(text, params)).rows;
  } catch (error) {
    const { code, message } = failure(error);
    throw new Error(`SETUP · ${what}: ${code} ${message}`);
  }
}

function userOf(actor: Exclude<Actor, null>): string | null {
  if (actor === "anon") return null;
  return actor === "otherAdmin" ? otherAdmin : lab.uids[actor];
}

/**
 * Dentro de la transacción del test: `text` en un savepoint como `actor` y, al final, las restricciones diferidas
 * (lo que pasa al confirmar una petición de PostgREST). Devuelve las filas o el error sin lanzarlo.
 */
async function run(actor: Actor, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint inv09");
  try {
    if (actor !== null) await actAs(db, userOf(actor));
    const res = await db.query<Row>(text, params);
    await db.query("set constraints all immediate");
    await db.query("set constraints all deferred");
    await db.query("reset role");
    await db.query("release savepoint inv09");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint inv09");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

/** Transacción propia y CONFIRMADA en `client` como el usuario lab `role`: lo que hace una llamada /rpc de PostgREST. */
async function call(client: Client, role: LabRoleKey, text: string, params: unknown[]): Promise<Outcome> {
  await client.query("begin");
  try {
    await actAs(client, lab.uids[role]);
    const res = await client.query<Row>(text, params);
    await client.query("commit");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await client.query("rollback");
    return { rows: [], ...failure(error) };
  }
}

function saveParams(pack: string, components: readonly Component[] | null, options: { total?: unknown; label?: string | null } = {}): unknown[] {
  if (components === null) return [pack, false, null, null, null];
  const total = options.total === undefined ? components.reduce((sum, c) => sum + Number(c.units), 0) : options.total;
  const payload = components.map((c) => ({
    unit_product_id: c.id,
    units_per_pack: c.units,
    ...(c.weight === undefined ? {} : { cost_weight: c.weight }),
  }));
  return [pack, true, total, options.label ?? null, JSON.stringify(payload)];
}

/** `save_pack_recipe` dentro de la transacción del test. `components: null` = desactivar. */
function save(actor: Actor, pack: string, components: readonly Component[] | null, options: { total?: unknown; label?: string | null } = {}): Promise<Outcome> {
  return run(actor, SAVE, saveParams(pack, components, options));
}

const resultOf = (out: Outcome): Row => (out.rows[0]?.r as Row | undefined) ?? {};

async function saved(actor: Actor, pack: string, components: readonly Component[] | null, options: { total?: unknown; label?: string | null } = {}): Promise<Row> {
  const out = await save(actor, pack, components, options);
  if (out.code !== null) throw new Error(`SETUP · guardar receta: ${out.code} ${out.message}`);
  return resultOf(out);
}

/** Producto como `postgres`. `commit`: fuera de la transacción del test (se borra al final). `stock` entra por el libro. */
async function product(name: string, options: { storeId?: string; commit?: boolean; stock?: number; cost?: string } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${name}-${seq}`.toLowerCase();
  const storeId = options.storeId ?? lab.storeId;
  const client = options.commit ? gate : db;
  const rows = await sql(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
     values ($1, $2, $2, 9, $3::numeric, 0, 0) returning id`,
    [storeId, sku, options.cost ?? "1.00"],
    client,
  );
  const id = String(rows[0]?.id);
  if (options.commit) committed.push(id);
  if ((options.stock ?? 0) > 0) {
    await sql(
      `stock inicial de ${sku}`,
      "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'inventario_inicial', $2, $3, $4)",
      [id, options.stock, TAG, storeId],
      client,
    );
  }
  return id;
}

const key = (components: readonly Component[]): string =>
  [...components]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => `${c.id}:${String(c.units)}:${String(c.weight ?? 1)}`)
    .join(",");

/** Todas las recetas (activas e inactivas) de un empaque, con sus componentes como texto `id:unidades:peso`. */
async function recipesOf(pack: string, client: Client = db): Promise<RecipeState[]> {
  const rows = await sql(
    "recetas",
    `select c.id, c.is_active, c.total_units, c.label, c.unit_product_id,
            (select coalesce(string_agg(pc.unit_product_id::text || ':' || pc.units_per_pack || ':' || pc.cost_weight::float8::text, ','
                                        order by pc.unit_product_id::text), '')
             from public.product_pack_components pc where pc.conversion_id = c.id) as components
     from public.product_pack_conversions c where c.pack_product_id = $1 order by c.is_active desc, c.id`,
    [pack],
    client,
  );
  return rows.map((r) => ({
    id: String(r.id),
    active: r.is_active === true,
    total: Number(r.total_units),
    label: (r.label as string | null) ?? null,
    unit: (r.unit_product_id as string | null) ?? null,
    components: String(r.components),
  }));
}

/**
 * Lo que nunca puede quedar entre estos productos: `chains` = un empaque con receta activa que es componente de otra
 * receta activa; `broken` = receta activa sin componentes o que no suma; `orphans` = cabecera sin componentes.
 */
async function invariants(ids: readonly string[], client: Client = db): Promise<{ chains: number; broken: number; orphans: number; active: number }> {
  const rows = await sql(
    "invariantes",
    `select
       (select count(*)::int
        from public.product_pack_conversions c
        join public.product_pack_components pc on pc.unit_product_id = c.pack_product_id
        join public.product_pack_conversions outer_recipe on outer_recipe.id = pc.conversion_id
        where c.is_active and outer_recipe.is_active and c.pack_product_id = any($1::uuid[])) as chains,
       (select count(*)::int
        from public.product_pack_conversions c
        where c.is_active and c.pack_product_id = any($1::uuid[])
          and c.total_units is distinct from
              (select coalesce(sum(pc.units_per_pack), 0) from public.product_pack_components pc where pc.conversion_id = c.id)) as broken,
       (select count(*)::int
        from public.product_pack_conversions c
        where c.pack_product_id = any($1::uuid[])
          and not exists (select 1 from public.product_pack_components pc where pc.conversion_id = c.id)) as orphans,
       (select count(*)::int
        from public.product_pack_conversions c
        where c.is_active and c.pack_product_id = any($1::uuid[])) as active`,
    [ids],
    client,
  );
  const row = rows[0] ?? {};
  return { chains: Number(row.chains), broken: Number(row.broken), orphans: Number(row.orphans), active: Number(row.active) };
}

async function mismatches(ids: readonly string[]): Promise<number> {
  const rows = await sql(
    "conversion_mismatches",
    "select count(*)::int as n from public.conversion_mismatches where pack_product_id = any($1::uuid[]) or unit_product_id = any($1::uuid[])",
    [ids],
  );
  return Number(rows[0]?.n);
}

async function stockOf(ids: readonly string[]): Promise<number[]> {
  const rows = await sql("stock", "select id, current_stock from public.products where id = any($1::uuid[])", [ids]);
  return ids.map((id) => Number(rows.find((r) => r.id === id)?.current_stock));
}

function convert(actor: Actor, pack: string, quantity: number): Promise<Outcome> {
  return run(
    actor,
    `select public.convert_pack_to_units(
       p_pack_product_id => $1::uuid, p_pack_quantity => $2::integer, p_reason => $3::text) as r`,
    [pack, quantity, TAG],
  );
}

async function pidOf(client: Client): Promise<number> {
  return Number((await sql("pid", "select pg_backend_pid() as pid", [], client))[0]?.pid);
}

/** Espera a que la conexión `pid` esté detenida en un bloqueo: la carrera queda montada, no supuesta. */
async function waitUntilBlocked(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rows = await lab.rows("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("SETUP · la conexión no llegó a esperar el bloqueo del producto compartido");
}

/**
 * Dos guardados a la vez: `gate` retiene el producto compartido, las dos llamadas arrancan (en ese orden) y quedan
 * esperando su bloqueo, y solo entonces `gate` lo suelta. Devuelve los dos resultados en el orden de `calls`.
 */
async function simultaneous(shared: string, calls: ReadonlyArray<readonly [Client, LabRoleKey, unknown[]]>): Promise<Outcome[]> {
  const pids: number[] = [];
  for (const [client] of calls) pids.push(await pidOf(client));
  const pending: Promise<Outcome>[] = [];
  await gate.query("begin");
  try {
    await gate.query("select id from public.products where id = $1 for update", [shared]);
    for (const [index, [client, role, params]] of calls.entries()) {
      pending.push(call(client, role, SAVE, params));
      await waitUntilBlocked(pids[index] ?? 0);
    }
    await gate.query("commit");
  } catch (error) {
    await gate.query("rollback");
    await Promise.allSettled(pending);
    throw error;
  }
  return Promise.all(pending);
}

beforeAll(async () => {
  lab = await Lab.open("inv09");
  db = await lab.pg();
  first = await lab.pg();
  second = await lab.pg();
  gate = await lab.pg();
  const other = await sql(
    `usuario ${OTHER_STORE_ADMIN_EMAIL} de la tienda default`,
    `select u.id from auth.users u join public.profiles p on p.id = u.id
     where u.email = $1 and p.store_id = $2 and p.role = 'admin' and p.is_active`,
    [OTHER_STORE_ADMIN_EMAIL, lab.defaultStoreId],
  );
  if (!other[0]) throw new Error("SETUP · falta el admin de la tienda default");
  otherAdmin = String(other[0].id);
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

describe("parche 20261011c", () => {
  it("es idempotente: aplicado dos veces deja una sola firma, security definer y sin execute para anon", async () => {
    await withRollback(db, async () => {
      const text = readFileSync(PATCH, "utf8");
      const begins = text.match(/^begin;\r?$/gm)?.length ?? 0;
      const commits = text.match(/^commit;\r?$/gm)?.length ?? 0;
      expect([begins, commits]).toEqual([1, 1]);
      expect(text.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
      const body = text.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "").replace(/^notify pgrst.*$/m, "");
      await sql("aplicar el parche (1)", body);
      await sql("aplicar el parche (2)", body);

      const rows = await sql(
        "firmas",
        `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('service_role', p.oid, 'execute') as service_role,
                has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_pack_recipe'`,
      );

      expect(rows).toEqual([
        {
          args: "p_pack_product_id uuid, p_enabled boolean, p_total_units integer, p_label text, p_components jsonb",
          prosecdef: true,
          proconfig: ["search_path=public"],
          authenticated: true,
          service_role: true,
          anon: false,
        },
      ]);
    });
  });
});

describe("semántica · la que tenía el BFF", () => {
  it("crea, no escribe la misma receta, renombra, edita en sitio el par y reemplaza al cambiar productos", async () => {
    await withRollback(db, async () => {
      const pack = await product("pack");
      const [b, c, d] = [await product("b"), await product("c"), await product("d")];

      // Par nuevo: cabecera con las columnas de compatibilidad al día.
      const created = await saved("admin", pack, [{ id: b, units: 6 }]);
      expect(created).toMatchObject({ action: "created", previousConversionId: null, totalUnits: 6, label: null });
      const pairId = String(created.conversionId);
      expect(await recipesOf(pack)).toEqual([
        { id: pairId, active: true, total: 6, label: null, unit: b, components: key([{ id: b, units: 6 }]) },
      ]);

      // La misma: no escribe nada.
      expect(await saved("almacen", pack, [{ id: b, units: 6 }])).toMatchObject({ action: "unchanged", conversionId: pairId });

      // Misma unidad, otras unidades: mismo id.
      expect(await saved("admin", pack, [{ id: b, units: 12 }])).toMatchObject({ action: "updated", conversionId: pairId, totalUnits: 12 });
      expect(await recipesOf(pack)).toEqual([
        { id: pairId, active: true, total: 12, label: null, unit: b, components: key([{ id: b, units: 12 }]) },
      ]);

      // De par a surtido: receta nueva; la anterior queda inactiva con su componente intacto.
      const assorted: Component[] = [{ id: b, units: 2 }, { id: c, units: 4, weight: 1.5 }];
      const replaced = await saved("admin", pack, assorted, { label: "  Surtido 6  " });
      const assortedId = String(replaced.conversionId);
      expect(replaced).toMatchObject({ action: "replaced", previousConversionId: pairId, label: "Surtido 6", totalUnits: 6 });
      expect(assortedId).not.toBe(pairId);
      expect((replaced.components as Row[]).map((item) => [item.unitProductId, item.unitsPerPack, Number(item.costWeight)]).sort()).toEqual(
        [[b, 2, 1], [c, 4, 1.5]].sort(),
      );
      expect(await recipesOf(pack)).toEqual(
        [
          { id: assortedId, active: true, total: 6, label: "Surtido 6", unit: null, components: key(assorted) },
          { id: pairId, active: false, total: 12, label: null, unit: b, components: key([{ id: b, units: 12 }]) },
        ].sort((x, y) => Number(y.active) - Number(x.active)),
      );

      // Misma receta surtida (otro orden de envío): no escribe; con otro nombre, solo el nombre.
      expect(await saved("admin", pack, [...assorted].reverse(), { label: "Surtido 6" })).toMatchObject({ action: "unchanged", conversionId: assortedId });
      expect(await saved("admin", pack, assorted, { label: "Otro nombre" })).toMatchObject({ action: "renamed", conversionId: assortedId, label: "Otro nombre" });
      expect(await saved("admin", pack, assorted, { label: "   " })).toMatchObject({ action: "renamed", conversionId: assortedId, label: null });

      // Otro peso u otro producto: receta nueva.
      const reweighted = await saved("admin", pack, [{ id: b, units: 2 }, { id: c, units: 4, weight: 2 }]);
      expect(reweighted).toMatchObject({ action: "replaced", previousConversionId: assortedId });
      const swapped = await saved("admin", pack, [{ id: d, units: 6 }]);
      expect(swapped).toMatchObject({ action: "replaced", previousConversionId: reweighted.conversionId });

      const all = await recipesOf(pack);
      expect(all.filter((r) => r.active)).toEqual([
        { id: String(swapped.conversionId), active: true, total: 6, label: null, unit: d, components: key([{ id: d, units: 6 }]) },
      ]);
      expect(all).toHaveLength(4);
      expect(await invariants([pack, b, c, d])).toEqual({ chains: 0, broken: 0, orphans: 0, active: 1 });

      // Desactivar, y desactivar lo ya desactivado.
      expect(await saved("almacen", pack, null)).toMatchObject({ action: "disabled", conversionId: null, previousConversionId: swapped.conversionId });
      expect(await saved("almacen", pack, null)).toMatchObject({ action: "none", conversionId: null, previousConversionId: null });
      expect((await recipesOf(pack)).filter((r) => r.active)).toEqual([]);
      expect(await recipesOf(pack)).toHaveLength(4);
    });
  });
});

describe("atomicidad · un fallo deja la receta anterior intacta y nada huérfano", () => {
  it("componente inexistente, suma que no cuadra y un fallo a mitad de la escritura", async () => {
    await withRollback(db, async () => {
      const pack = await product("pack");
      const [b, c, d] = [await product("b"), await product("c"), await product("d")];
      await saved("admin", pack, [{ id: b, units: 2 }, { id: c, units: 4 }], { label: "Vigente" });
      const before = await recipesOf(pack);
      expect(before).toHaveLength(1);

      const missing = await save("admin", pack, [{ id: d, units: 3 }, { id: randomUUID(), units: 3 }]);
      expect([missing.code, missing.message]).toEqual(["PT404", "Producto componente no encontrado."]);
      expect(await recipesOf(pack)).toEqual(before);

      const sum = await save("admin", pack, [{ id: d, units: 3 }, { id: c, units: 2 }], { total: 6 });
      expect([sum.code, sum.message]).toEqual(["PT400", "Los componentes suman 5 unidades y el empaque declara 6."]);
      expect(await recipesOf(pack)).toEqual(before);

      // A mitad: la receta vigente ya está desactivada y la cabecera nueva insertada cuando falla un componente.
      await sql(
        "trigger que rompe el segundo insert",
        `create function pg_temp.inv09_boom() returns trigger language plpgsql as $f$
         begin raise exception using errcode = 'PT400', message = 'inv09 fallo a mitad'; end $f$`,
      );
      await sql(
        "trigger que rompe el segundo insert",
        `create trigger zz_inv09_boom before insert on public.product_pack_components
         for each row when (new.units_per_pack = 777) execute function pg_temp.inv09_boom()`,
      );
      const midway = await save("admin", pack, [{ id: d, units: 777 }, { id: c, units: 3 }]);
      expect([midway.code, midway.message]).toEqual(["PT400", "inv09 fallo a mitad"]);
      expect(await recipesOf(pack)).toEqual(before);
      expect(await invariants([pack, b, c, d])).toEqual({ chains: 0, broken: 0, orphans: 0, active: 1 });

      // Lo mismo al estrenar receta: no queda ni cabecera.
      const fresh = await product("pack-nuevo");
      const midwayNew = await save("admin", fresh, [{ id: d, units: 777 }, { id: c, units: 3 }]);
      expect(midwayNew.code).toBe("PT400");
      expect(await recipesOf(fresh)).toEqual([]);
    });
  });
});

describe("reglas · PT400 / PT403 / PT404 / PT409 y otra tienda", () => {
  it("PT403: solo admin y almacén; anon no puede ejecutarla", async () => {
    await withRollback(db, async () => {
      const [pack, b] = [await product("pack"), await product("b")];
      for (const role of ["vendedor1", "contador"] as const) {
        const out = await save(role, pack, [{ id: b, units: 6 }]);
        expect([role, out.code]).toEqual([role, "PT403"]);
        const off = await save(role, pack, null);
        expect([role, off.code]).toEqual([role, "PT403"]);
      }
      expect((await save("anon", pack, [{ id: b, units: 6 }])).code).toBe("42501");
      expect(await recipesOf(pack)).toEqual([]);
    });
  });

  it("PT400: forma de la receta, con los textos del contrato", async () => {
    await withRollback(db, async () => {
      const pack = await product("pack");
      const [b, c] = [await product("b"), await product("c")];
      const many = Array.from({ length: 21 }, () => ({ id: randomUUID(), units: 1 }));
      const cases: Array<[string, () => Promise<Outcome>, string]> = [
        ["sin lista", () => run("admin", SAVE, [pack, true, 6, null, null]), "Los componentes del empaque deben ser una lista."],
        ["lista que no es lista", () => run("admin", SAVE, [pack, true, 6, null, JSON.stringify({ a: 1 })]), "Los componentes del empaque deben ser una lista."],
        ["cero componentes", () => save("admin", pack, [], { total: 6 }), "Un empaque lleva entre 1 y 20 componentes."],
        ["21 componentes", () => save("admin", pack, many), "Un empaque lleva entre 1 y 20 componentes."],
        ["componente que no es objeto", () => run("admin", SAVE, [pack, true, 6, null, JSON.stringify([5])]), "Cada componente del empaque requiere su producto y sus unidades."],
        ["producto que no es uuid", () => save("admin", pack, [{ id: "no-es-uuid", units: 6 }]), "Selecciona el producto de cada componente."],
        ["repetido", () => save("admin", pack, [{ id: b, units: 3 }, { id: b, units: 3 }]), "Un producto no puede repetirse entre los componentes del empaque."],
        ["unidades cero", () => save("admin", pack, [{ id: b, units: 0 }, { id: c, units: 6 }]), "Las unidades de cada componente deben ser un entero mayor a cero."],
        ["unidades negativas", () => save("admin", pack, [{ id: b, units: -1 }, { id: c, units: 7 }]), "Las unidades de cada componente deben ser un entero mayor a cero."],
        ["unidades con decimales", () => save("admin", pack, [{ id: b, units: 2.5 }, { id: c, units: 3.5 }], { total: 6 }), "Las unidades de cada componente deben ser un entero mayor a cero."],
        ["unidades como texto", () => save("admin", pack, [{ id: b, units: "3" }, { id: c, units: 3 }], { total: 6 }), "Las unidades de cada componente deben ser un entero mayor a cero."],
        ["peso cero", () => save("admin", pack, [{ id: b, units: 3, weight: 0 }, { id: c, units: 3 }]), "El peso de costo de cada componente debe ser un número mayor a cero."],
        ["peso negativo", () => save("admin", pack, [{ id: b, units: 3, weight: -2 }, { id: c, units: 3 }]), "El peso de costo de cada componente debe ser un número mayor a cero."],
        ["peso no finito (texto)", () => save("admin", pack, [{ id: b, units: 3, weight: "NaN" }, { id: c, units: 3 }]), "El peso de costo de cada componente debe ser un número mayor a cero."],
        ["sin total", () => save("admin", pack, [{ id: b, units: 3 }, { id: c, units: 3 }], { total: null }), "Indica el total de unidades del empaque (mínimo 2)."],
        ["total 1", () => save("admin", pack, [{ id: b, units: 1 }]), "Indica el total de unidades del empaque (mínimo 2)."],
        ["suma distinta del total", () => save("admin", pack, [{ id: b, units: 3 }, { id: c, units: 2 }], { total: 6 }), "Los componentes suman 5 unidades y el empaque declara 6."],
        ["nombre de 81 caracteres", () => save("admin", pack, [{ id: b, units: 6 }], { label: "x".repeat(81) }), "El nombre de la receta admite hasta 80 caracteres."],
        ["el empaque como unidad", () => save("admin", pack, [{ id: pack, units: 6 }]), "El empaque y la unidad deben ser productos distintos."],
        ["el empaque entre los componentes", () => save("admin", pack, [{ id: pack, units: 3 }, { id: b, units: 3 }]), "El empaque no puede ser componente de sí mismo."],
        ["sin empaque", () => run("admin", SAVE, [null, true, 6, null, JSON.stringify([{ unit_product_id: b, units_per_pack: 6 }])]), "Selecciona el producto del empaque."],
        ["sin enabled", () => run("admin", SAVE, [pack, null, 6, null, null]), "Indica si el empaque está activo."],
      ];
      for (const [name, pending, message] of cases) {
        const out = await pending();
        expect([name, out.code, out.message]).toEqual([name, "PT400", message]);
      }
      expect(await recipesOf(pack)).toEqual([]);

      // Un nombre de 80 caracteres y un peso ausente o null son válidos.
      const ok = await save("admin", pack, [{ id: b, units: 3, weight: null }, { id: c, units: 3 }], { label: "x".repeat(80) });
      expect(ok.code).toBeNull();
    });
  });

  it("PT404: empaque o componente inexistente o de otra tienda; otra tienda no ve ni toca la receta", async () => {
    await withRollback(db, async () => {
      const [pack, b, c] = [await product("pack"), await product("b"), await product("c")];
      const [foreignPack, foreignUnit] = [
        await product("pack-otra", { storeId: lab.defaultStoreId }),
        await product("unit-otra", { storeId: lab.defaultStoreId }),
      ];

      const cases: Array<[string, () => Promise<Outcome>, string]> = [
        ["empaque inexistente", () => save("admin", randomUUID(), [{ id: b, units: 6 }]), "Producto no encontrado."],
        ["empaque de otra tienda", () => save("admin", foreignPack, [{ id: b, units: 6 }]), "Producto no encontrado."],
        ["desactivar un empaque de otra tienda", () => save("admin", foreignPack, null), "Producto no encontrado."],
        ["unidad inexistente", () => save("admin", pack, [{ id: randomUUID(), units: 6 }]), "Producto unidad no encontrado."],
        ["unidad de otra tienda", () => save("admin", pack, [{ id: foreignUnit, units: 6 }]), "Producto unidad no encontrado."],
        ["componente de otra tienda", () => save("admin", pack, [{ id: b, units: 3 }, { id: foreignUnit, units: 3 }]), "Producto componente no encontrado."],
        ["el admin de otra tienda sobre este empaque", () => save("otherAdmin", pack, [{ id: foreignUnit, units: 6 }]), "Producto no encontrado."],
      ];
      for (const [name, pending, message] of cases) {
        const out = await pending();
        expect([name, out.code, out.message]).toEqual([name, "PT404", message]);
      }
      expect(await recipesOf(pack)).toEqual([]);

      // La receta de esta tienda no la desactiva el admin de la otra.
      await saved("admin", pack, [{ id: b, units: 3 }, { id: c, units: 3 }]);
      expect((await save("otherAdmin", pack, null)).code).toBe("PT404");
      expect((await recipesOf(pack)).filter((r) => r.active)).toHaveLength(1);

      // Cada tienda guarda la suya, con su store_id.
      await saved("otherAdmin", foreignPack, [{ id: foreignUnit, units: 6 }]);
      const stores = await sql(
        "tienda de cada receta",
        "select pack_product_id, store_id from public.product_pack_conversions where pack_product_id = any($1::uuid[]) and is_active",
        [[pack, foreignPack]],
      );
      expect(Object.fromEntries(stores.map((r) => [r.pack_product_id, r.store_id]))).toEqual({
        [pack]: lab.storeId,
        [foreignPack]: lab.defaultStoreId,
      });
    });
  });

  it("PT409: la regla de cadenas en los dos sentidos, con los textos del BFF", async () => {
    await withRollback(db, async () => {
      const [a, b, c, d, x] = [await product("a"), await product("b"), await product("c"), await product("d"), await product("x")];
      await sql("nombre del empaque", "update public.products set name = '  Caja INV09  ' where id = $1", [a]);
      await saved("admin", a, [{ id: b, units: 6 }]);

      // Un componente no puede ser el empaque de una receta activa.
      const unitIsPack = await save("admin", x, [{ id: a, units: 6 }]);
      expect([unitIsPack.code, unitIsPack.message]).toEqual(["PT409", UNIT_IS_PACK]);
      const componentIsPack = await save("admin", x, [{ id: c, units: 3 }, { id: a, units: 3 }]);
      expect([componentIsPack.code, componentIsPack.message]).toEqual(["PT409", COMPONENT_IS_PACK]);

      // Y el simétrico: un componente de una receta activa no estrena receta propia.
      const packIsComponent = await save("admin", b, [{ id: c, units: 3 }, { id: d, units: 3 }]);
      expect([packIsComponent.code, packIsComponent.message]).toEqual([
        "PT409",
        "Este producto ya es unidad de Caja INV09; no puede ser a la vez un empaque.",
      ]);
      expect(await recipesOf(x)).toEqual([]);
      expect(await recipesOf(b)).toEqual([]);

      // Un componente SÍ puede salir de varios empaques.
      expect((await save("admin", x, [{ id: b, units: 4 }])).code).toBeNull();

      // Con la receta desactivada, la regla deja de aplicar en los dos sentidos.
      await saved("admin", a, null);
      await saved("admin", x, null);
      expect((await save("admin", b, [{ id: c, units: 3 }, { id: d, units: 3 }])).code).toBeNull();
      expect(await invariants([a, b, c, d, x])).toMatchObject({ chains: 0, broken: 0 });
    });
  });

  it("datos anteriores a la regla (ya era empaque y componente): edita y reemplaza su receta, pero no la reestrena", async () => {
    await withRollback(db, async () => {
      const [a, b, c, x] = [await product("a"), await product("b"), await product("c"), await product("x")];
      const original = await saved("admin", a, [{ id: b, units: 6 }]);
      // La cadena X -> A escrita por tabla, como pudo quedar antes de la regla.
      await sql(
        "cadena heredada",
        `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active)
         values ($1, $2, $3, 4, true)`,
        [lab.storeId, x, a],
      );
      await sql("restricciones", "set constraints all immediate");
      await sql("restricciones", "set constraints all deferred");

      expect(await saved("admin", a, [{ id: b, units: 12 }])).toMatchObject({ action: "updated", conversionId: original.conversionId });
      expect(await saved("admin", a, [{ id: b, units: 2 }, { id: c, units: 2 }])).toMatchObject({ action: "replaced" });

      await saved("admin", a, null);
      const again = await save("admin", a, [{ id: b, units: 6 }]);
      expect(again.code).toBe("PT409");
      expect(again.message).toMatch(/^Este producto ya es unidad de .+; no puede ser a la vez un empaque\.$/);
    });
  });
});

describe("apertura · las recetas guardadas por la RPC se abren como antes", () => {
  it("par y surtido: convert_pack_to_units reparte según la receta y conversion_mismatches sigue en 0", async () => {
    await withRollback(db, async () => {
      const [pairPack, pack] = [await product("par", { stock: 5, cost: "6.00" }), await product("surtido", { stock: 5, cost: "6.00" })];
      const [b, c, d] = [await product("b", { cost: "0.00" }), await product("c", { cost: "0.00" }), await product("d", { cost: "0.00" })];
      const ids = [pairPack, pack, b, c, d];

      await saved("admin", pairPack, [{ id: d, units: 6 }]);
      const pairOut = await convert("almacen", pairPack, 2);
      expect(pairOut.code).toBeNull();
      expect(resultOf(pairOut)).toMatchObject({ packQuantity: 2, unitQuantity: 12, unitsPerPack: 6, totalUnits: 6 });

      await saved("admin", pack, [{ id: b, units: 2 }, { id: c, units: 4, weight: 2 }], { label: "Surtido" });
      const out = await convert("almacen", pack, 1);
      expect(out.code).toBeNull();
      expect(resultOf(out)).toMatchObject({ packQuantity: 1, unitQuantity: 6, totalUnits: 6 });

      expect(await stockOf(ids)).toEqual([3, 4, 2, 4, 12]);
      expect(await mismatches(ids)).toBe(0);
    });
  });

  it("reemplazar o editar una receta ya usada no rompe sus conversiones históricas", async () => {
    await withRollback(db, async () => {
      const [pairPack, pack] = [await product("par", { stock: 5, cost: "6.00" }), await product("surtido", { stock: 5, cost: "6.00" })];
      const [b, c, d] = [await product("b", { cost: "0.00" }), await product("c", { cost: "0.00" }), await product("d", { cost: "0.00" })];
      const ids = [pairPack, pack, b, c, d];

      const used = await saved("admin", pack, [{ id: b, units: 2 }, { id: c, units: 4 }]);
      expect((await convert("almacen", pack, 1)).code).toBeNull();
      const usedPair = await saved("admin", pairPack, [{ id: b, units: 6 }]);
      expect((await convert("almacen", pairPack, 1)).code).toBeNull();
      expect(await mismatches(ids)).toBe(0);

      // Surtido usado -> otra receta: la usada queda inactiva con sus dos componentes.
      const next = await saved("admin", pack, [{ id: d, units: 6 }]);
      expect(next).toMatchObject({ action: "replaced", previousConversionId: used.conversionId });
      expect((await recipesOf(pack)).find((r) => r.id === used.conversionId)).toMatchObject({
        active: false,
        components: key([{ id: b, units: 2 }, { id: c, units: 4 }]),
      });
      // Par usado -> mismas unidad, otras unidades: en sitio.
      expect(await saved("admin", pairPack, [{ id: b, units: 12 }])).toMatchObject({ action: "updated", conversionId: usedPair.conversionId });
      expect(await mismatches(ids)).toBe(0);

      // Las recetas nuevas se abren y la historia sigue cuadrando.
      expect((await convert("almacen", pack, 1)).code).toBeNull();
      expect((await convert("almacen", pairPack, 1)).code).toBeNull();
      expect(await stockOf(ids)).toEqual([3, 3, 2 + 6 + 12, 4, 6]);
      expect(await mismatches(ids)).toBe(0);

      // Desactivada: no se abre; las conversiones hechas siguen cuadrando.
      await saved("admin", pack, null);
      expect((await convert("almacen", pack, 1)).code).toBe("PT404");
      expect(await mismatches(ids)).toBe(0);
    });
  });
});

describe("concurrencia · dos conexiones reales", () => {
  it(`A←B y B←C a la vez (${ROUNDS} veces, en los dos órdenes): gana exactamente uno, el otro PT409, nunca hay cadena`, async () => {
    const winners = { outer: 0, inner: 0 };

    for (let round = 0; round < ROUNDS; round += 1) {
      const [a, b, c, d] = [
        await product("a", { commit: true }),
        await product("b", { commit: true }),
        await product("c", { commit: true }),
        await product("d", { commit: true }),
      ];
      const ids = [a, b, c, d];
      // Pares en las rondas pares, surtido en el interior en las impares.
      const outer = saveParams(a, [{ id: b, units: 6 }]);
      const inner = round % 2 === 0 ? saveParams(b, [{ id: c, units: 6 }]) : saveParams(b, [{ id: c, units: 3 }, { id: d, units: 3 }]);
      const outerFirst = round % 4 < 2;
      const [x, y] = await simultaneous(
        b,
        outerFirst
          ? [[first, "admin", outer], [second, "almacen", inner]]
          : [[first, "admin", inner], [second, "almacen", outer]],
      );
      const [outerOut, innerOut] = outerFirst ? [x, y] : [y, x];
      if (!outerOut || !innerOut) throw new Error("SETUP · faltan resultados de la carrera");

      const codes = [outerOut.code, innerOut.code];
      expect([round, [...codes].sort()]).toEqual([round, ["PT409", null].sort()]);

      if (outerOut.code === null) {
        winners.outer += 1;
        // Ganó A←B: B ya sale de A y no puede estrenar receta.
        expect(innerOut.message).toMatch(/^Este producto ya es unidad de .+; no puede ser a la vez un empaque\.$/);
        expect((await recipesOf(b, gate))).toEqual([]);
        expect((await recipesOf(a, gate)).map((r) => [r.active, r.components])).toEqual([[true, key([{ id: b, units: 6 }])]]);
      } else {
        winners.inner += 1;
        // Ganó B←…: B ya es empaque y no puede salir de A.
        expect(outerOut.message).toBe(UNIT_IS_PACK);
        expect(await recipesOf(a, gate)).toEqual([]);
        expect((await recipesOf(b, gate)).map((r) => r.active)).toEqual([true]);
      }

      expect([round, await invariants(ids, gate)]).toEqual([round, { chains: 0, broken: 0, orphans: 0, active: 1 }]);
    }

    expect(winners.outer + winners.inner).toBe(ROUNDS);
  });

  it(`dos guardados simultáneos de la MISMA receta de A (${ROUNDS} veces): una sola receta, activa y completa`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [a, b, c] = [await product("a", { commit: true }), await product("b", { commit: true }), await product("c", { commit: true })];
      const recipe: Component[] = round % 2 === 0 ? [{ id: b, units: 2 }, { id: c, units: 4, weight: 1.5 }] : [{ id: b, units: 6 }];
      const [x, y] = await simultaneous(a, [
        [first, "admin", saveParams(a, recipe, { label: "Misma" })],
        [second, "almacen", saveParams(a, recipe, { label: "Misma" })],
      ]);

      expect([round, x?.code, y?.code]).toEqual([round, null, null]);
      expect([resultOf(x ?? { rows: [], code: null, message: "" }).action, resultOf(y ?? { rows: [], code: null, message: "" }).action].sort()).toEqual([
        "created",
        "unchanged",
      ]);
      // Una sola cabecera: el segundo no dejó otra, ni activa ni inactiva.
      expect((await recipesOf(a, gate)).map((r) => [r.active, r.label, r.components])).toEqual([[true, "Misma", key(recipe)]]);
      expect([round, await invariants([a, b, c], gate)]).toEqual([round, { chains: 0, broken: 0, orphans: 0, active: 1 }]);
    }
  });

  it(`dos recetas DISTINTAS para el mismo empaque a la vez (${ROUNDS} veces): las dos se aplican en serie y queda una activa`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [a, b, c] = [await product("a", { commit: true }), await product("b", { commit: true }), await product("c", { commit: true })];
      const [x, y] = await simultaneous(a, [
        [first, "admin", saveParams(a, [{ id: b, units: 6 }])],
        [second, "almacen", saveParams(a, [{ id: c, units: 3 }, { id: b, units: 3 }])],
      ]);

      expect([round, x?.code, y?.code]).toEqual([round, null, null]);
      const all = await recipesOf(a, gate);
      expect(all.map((r) => r.active)).toEqual([true, false]);
      expect([key([{ id: b, units: 6 }]), key([{ id: c, units: 3 }, { id: b, units: 3 }])]).toContain(all[0]?.components);
      expect(all[1]?.components).not.toBe("");
      expect([round, await invariants([a, b, c], gate)]).toEqual([round, { chains: 0, broken: 0, orphans: 0, active: 1 }]);
    }
  });

  it("guardar mientras otro DESACTIVA la receta del componente: el resultado depende del orden, nunca queda cadena", async () => {
    for (let round = 0; round < 4; round += 1) {
      const [a, b, c] = [await product("a", { commit: true }), await product("b", { commit: true }), await product("c", { commit: true })];
      // B es empaque (B←C). A la vez: se desactiva la receta de B y A intenta usar B como unidad.
      const setup = await call(first, "admin", SAVE, saveParams(b, [{ id: c, units: 6 }]));
      if (setup.code !== null) throw new Error(`SETUP · receta de B: ${setup.code} ${setup.message}`);
      const disable = saveParams(b, null);
      const use = saveParams(a, [{ id: b, units: 6 }]);
      const disableFirst = round % 2 === 0;
      const [x, y] = await simultaneous(
        b,
        disableFirst ? [[first, "admin", disable], [second, "almacen", use]] : [[first, "admin", use], [second, "almacen", disable]],
      );
      const [disableOut, useOut] = disableFirst ? [x, y] : [y, x];

      expect(disableOut?.code).toBeNull();
      // O B ya no era empaque cuando A lo miró (se guarda), o lo era todavía (PT409 con el texto de siempre).
      if (useOut?.code !== null) {
        expect([useOut?.code, useOut?.message]).toEqual(["PT409", UNIT_IS_PACK]);
      }
      expect([round, await invariants([a, b, c], gate)]).toMatchObject([round, { chains: 0, broken: 0, orphans: 0 }]);
    }
  });
});
