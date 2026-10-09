/** @jest-environment node */
/**
 * INT-02 · regresión del parche `20261012a-save-pack-recipe-always-disassemble.sql`.
 *
 * Compras (COM-14, `20261010e`) guardaba la preferencia «Desarmar siempre al recibir compras»
 * (`product_pack_conversions.always_disassemble_on_receive`) escribiendo la cabecera por PostgREST. Inventario
 * (INV-L2, `20261011d`) revocó la escritura directa de esa tabla: al unir las dos ramas, la preferencia ya no se
 * podía guardar (42501) y, además, `save_pack_recipe` (`20261011c`) la perdía al reemplazar una receta (la cabecera
 * nueva nacía sin ella).
 *
 * Cada test enuncia el comportamiento SANO: la preferencia se guarda por `save_pack_recipe` (sexto argumento,
 * `null` = no cambia), en la misma transacción que la receta, y se sigue LEYENDO por la tabla. Los casos SQL corren
 * en una transacción que termina en `rollback`, con cada sentencia bajo `set local role` + `request.jwt.claims`. El
 * caso de PostgREST usa datos confirmados (productos sin stock, que se borran al terminar) y el JWT real.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/pack-recipe-preference.test.ts
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
/** Usuario lab, admin de la otra tienda, sin sesión, o `null` = `postgres` (preparación). */
type Actor = LabRoleKey | "otraTienda" | "anon" | null;
type Component = { id: string; units: number; weight?: number };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = resolve(PATCHES, "20261012a-save-pack-recipe-always-disassemble.sql");
const PREVIOUS = resolve(PATCHES, "20261011c-save-pack-recipe.sql");
const TAG = `INT02-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const DENIED = "42501";
const SIX_ARGS =
  "p_pack_product_id uuid, p_enabled boolean, p_total_units integer, p_label text, p_components jsonb, p_always_disassemble_on_receive boolean";
const FIVE_ARGS = "p_pack_product_id uuid, p_enabled boolean, p_total_units integer, p_label text, p_components jsonb";
/** Llamada de 5 argumentos (BFF de INV-09, fixtures): no nombra la preferencia. */
const SAVE5 = "select public.save_pack_recipe($1::uuid, $2::boolean, $3::integer, $4::text, $5::jsonb) as r";
const SAVE6 = "select public.save_pack_recipe($1::uuid, $2::boolean, $3::integer, $4::text, $5::jsonb, $6::boolean) as r";

let lab: Lab;
let db: Client;
let seq = 0;
let otherStoreAdmin = "";
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
  await db.query("savepoint int02");
  try {
    if (actor !== null) await actAs(db, actor === "anon" ? null : actor === "otraTienda" ? otherStoreAdmin : lab.uids[actor]);
    const res = await db.query<Row>(text, params);
    await db.query("set constraints all immediate");
    await db.query("set constraints all deferred");
    await db.query("reset role");
    await db.query("release savepoint int02");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint int02");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

function params(pack: string, components: readonly Component[], label: string | null = null): unknown[] {
  return [
    pack,
    true,
    components.reduce((sum, c) => sum + c.units, 0),
    label,
    JSON.stringify(components.map((c) => ({ unit_product_id: c.id, units_per_pack: c.units, ...(c.weight === undefined ? {} : { cost_weight: c.weight }) }))),
  ];
}

/** Guarda la receta. `always`: `undefined` = llamada de 5 argumentos; `null` / booleano = sexto argumento. */
function save(actor: Actor, pack: string, components: readonly Component[], always?: boolean | null, label: string | null = null): Promise<Outcome> {
  return always === undefined ? run(actor, SAVE5, params(pack, components, label)) : run(actor, SAVE6, [...params(pack, components, label), always]);
}

async function saved(pack: string, components: readonly Component[], always?: boolean | null, label: string | null = null): Promise<Row> {
  const out = await save("almacen", pack, components, always, label);
  if (out.code !== null) throw new Error(`SETUP · guardar receta: ${out.code} ${out.message}`);
  return (out.rows[0]?.r as Row | undefined) ?? {};
}

async function product(name: string, options: { commit?: boolean; stock?: number } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${name}-${seq}`.toLowerCase();
  const text = `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
     values ($1, $2, $2, 9, 1, 0, 0) returning id`;
  const rows = options.commit ? await lab.rows(text, [lab.storeId, sku]) : await sql(`producto ${sku}`, text, [lab.storeId, sku]);
  const id = String(rows[0]?.id);
  if (options.commit) committed.push(id);
  if ((options.stock ?? 0) > 0) {
    await sql(
      `stock inicial de ${sku}`,
      "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'inventario_inicial', $2, $3, $4)",
      [id, options.stock, TAG, lab.storeId],
    );
  }
  return id;
}

/** Recetas del empaque: `[activa, preferencia]`, la activa primero y después por antigüedad. */
async function recipes(pack: string): Promise<Array<{ id: string; active: boolean; always: boolean; total: number; label: string | null }>> {
  const rows = await sql(
    "recetas",
    `select id, is_active, always_disassemble_on_receive, total_units, label
     from public.product_pack_conversions where pack_product_id = $1 order by is_active desc, created_at, id`,
    [pack],
  );
  return rows.map((r) => ({ id: String(r.id), active: r.is_active === true, always: r.always_disassemble_on_receive === true, total: Number(r.total_units), label: (r.label as string | null) ?? null }));
}

/** Stock, costo y nº de movimientos de estos productos: lo que la preferencia NO debe tocar. */
async function ledger(ids: readonly string[]): Promise<string> {
  const rows = await sql(
    "libro",
    `select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'stock', p.current_stock, 'cost', p.current_cost_ref::text,
              'moves', (select count(*) from public.stock_movements m where m.product_id = p.id)) order by p.id), '[]'::jsonb)::text as s
     from public.products p where p.id = any($1::uuid[])`,
    [ids],
  );
  return String(rows[0]?.s);
}

const patchBody = (path: string): string =>
  readFileSync(path, "utf8").replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "").replace(/^notify pgrst.*$/m, "");

const signatures = async (): Promise<string[]> =>
  (
    await sql(
      "firmas",
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'save_pack_recipe' order by p.pronargs`,
    )
  ).map((row) => String(row.args));

beforeAll(async () => {
  lab = await Lab.open("int02");
  db = await lab.pg();
  const rows = await sql(
    "admin de la otra tienda",
    "select u.id from auth.users u join public.profiles p on p.id = u.id where u.email = 'admin@example.com' and p.store_id = $1 and p.role = 'admin' and p.is_active",
    [lab.defaultStoreId],
  );
  otherStoreAdmin = String(rows[0]?.id ?? "");
  if (!otherStoreAdmin) throw new Error("SETUP · no existe el admin de la tienda default");
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

describe("parche 20261012a · firma y contrato", () => {
  it("una sola firma, de 6 argumentos (el sexto boolean con default); security definer, search_path fijo y execute solo para authenticated / service_role", async () => {
    const rows = await sql(
      "firma",
      `select pg_get_function_identity_arguments(p.oid) as args, p.pronargdefaults as defaults, p.prosecdef, p.proconfig,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service_role,
              has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_pack_recipe'`,
    );

    expect(rows).toEqual([
      { args: SIX_ARGS, defaults: 4, prosecdef: true, proconfig: ["search_path=public"], authenticated: true, service_role: true, anon: false },
    ]);
  });

  it("es una transacción, idempotente, y reaplicar 20261011c deja dos sobrecargas que este parche vuelve a dejar en una", async () => {
    await withRollback(db, async () => {
      const text = readFileSync(PATCH, "utf8");
      expect([text.match(/^begin;\r?$/gm)?.length, text.match(/^commit;\r?$/gm)?.length]).toEqual([1, 1]);
      expect(text.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);

      await sql("aplicar el parche (1)", patchBody(PATCH));
      await sql("aplicar el parche (2)", patchBody(PATCH));
      expect(await signatures()).toEqual([SIX_ARGS]);

      await sql("reaplicar 20261011c", patchBody(PREVIOUS));
      expect(await signatures()).toEqual([FIVE_ARGS, SIX_ARGS]);

      await sql("reaplicar el parche", patchBody(PATCH));
      expect(await signatures()).toEqual([SIX_ARGS]);
    });
  });

  it("el cuerpo es el de 20261011c más la preferencia: quitando las líneas de la preferencia, las dos funciones son idénticas", () => {
    const fn = (path: string): string[] => {
      const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
      const from = text.indexOf("returns jsonb\nlanguage plpgsql");
      return text.slice(from, text.indexOf("\n$$;", from)).split("\n");
    };
    const previous = fn(PREVIOUS);
    const current = fn(PATCH);
    const added = current.filter((line) => !previous.includes(line));
    const removed = previous.filter((line) => !current.includes(line));

    // Nada de 20261011c desaparece salvo las dos sentencias que ahora nombran la columna.
    expect(removed.map((line) => line.trim())).toEqual([
      "units_per_pack = p_total_units",
      "insert into public.product_pack_conversions (store_id, pack_product_id, total_units, label, is_active)",
      "values (v_store_id, p_pack_product_id, p_total_units, v_label, true)",
    ]);
    // Y todo lo añadido habla de la preferencia (o es comentario / cierre de bloque).
    expect(
      added
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("--") && !/always|v_store_id, p_pack_product_id|^insert into public\.product_pack_conversions \($|^\)$|^units_per_pack = p_total_units,$|^where id = v_existing\.id;$|^update public\.product_pack_conversions$|^end if;$/i.test(line)),
    ).toEqual([]);
  });
});

describe("guardar la preferencia por la RPC", () => {
  it("alta: sin argumento o con null nace en false; con true nace en true y el resultado la devuelve", async () => {
    await withRollback(db, async () => {
      const [u, p1, p2, p3] = [await product("u"), await product("p"), await product("p"), await product("p")];

      const five = await saved(p1, [{ id: u, units: 6 }]);
      const nul = await saved(p2, [{ id: u, units: 6 }], null);
      const yes = await saved(p3, [{ id: u, units: 6 }], true);

      expect([five.action, five.alwaysDisassembleOnReceive, nul.alwaysDisassembleOnReceive, yes.alwaysDisassembleOnReceive]).toEqual(["created", false, false, true]);
      expect([(await recipes(p1))[0]?.always, (await recipes(p2))[0]?.always, (await recipes(p3))[0]?.always]).toEqual([false, false, true]);
    });
  });

  it("misma receta: solo cambia la preferencia (action unchanged, mismo id, sin tocar componentes); repetirla no escribe; null la conserva", async () => {
    await withRollback(db, async () => {
      const [pack, a, b] = [await product("p"), await product("a"), await product("b")];
      const recipe: Component[] = [{ id: a, units: 4 }, { id: b, units: 2, weight: 3 }];
      const created = await saved(pack, recipe, undefined, "Surtido");
      const stamp = async (): Promise<unknown> => (await sql("xmin", "select xmin::text as x from public.product_pack_conversions where id = $1", [created.conversionId]))[0]?.x;

      const on = await saved(pack, recipe, true, "Surtido");
      const afterOn = await stamp();
      const again = await saved(pack, recipe, true, "Surtido");
      const afterAgain = await stamp();
      const kept = await saved(pack, recipe, null, "Surtido");
      const keptFive = await saved(pack, recipe, undefined, "Surtido");

      expect([on.action, on.conversionId, on.alwaysDisassembleOnReceive]).toEqual(["unchanged", created.conversionId, true]);
      expect([again.action, afterAgain]).toEqual(["unchanged", afterOn]);
      expect([kept.alwaysDisassembleOnReceive, keptFive.alwaysDisassembleOnReceive, await stamp()]).toEqual([true, true, afterOn]);
      expect(await recipes(pack)).toEqual([{ id: created.conversionId, active: true, always: true, total: 6, label: "Surtido" }]);

      const off = await saved(pack, recipe, false, "Surtido");
      expect([off.action, off.alwaysDisassembleOnReceive, (await recipes(pack))[0]?.always]).toEqual(["unchanged", false, false]);
    });
  });

  it("par 1 a 1 editado en sitio (misma unidad, otras unidades): conserva la preferencia sin argumento y la cambia con él, en el mismo update", async () => {
    await withRollback(db, async () => {
      const [pack, unit] = [await product("p"), await product("u")];
      const created = await saved(pack, [{ id: unit, units: 6 }], true);

      const kept = await saved(pack, [{ id: unit, units: 12 }]);
      expect([kept.action, kept.conversionId, kept.alwaysDisassembleOnReceive]).toEqual(["updated", created.conversionId, true]);
      expect(await recipes(pack)).toEqual([{ id: created.conversionId, active: true, always: true, total: 12, label: null }]);

      const off = await saved(pack, [{ id: unit, units: 24 }], false);
      expect([off.action, off.alwaysDisassembleOnReceive]).toEqual(["updated", false]);
      expect(await recipes(pack)).toEqual([{ id: created.conversionId, active: true, always: false, total: 24, label: null }]);
    });
  });

  it("receta REEMPLAZADA sin nombrar la preferencia: la cabecera nueva hereda la de la anterior (con 20261011c se perdía); con false nace sin ella", async () => {
    await withRollback(db, async () => {
      const [pack, a, b, c] = [await product("p"), await product("a"), await product("b"), await product("c")];
      const first = await saved(pack, [{ id: a, units: 6 }], true);

      const replaced = await saved(pack, [{ id: a, units: 3 }, { id: b, units: 3 }]);
      expect([replaced.action, replaced.previousConversionId, replaced.alwaysDisassembleOnReceive]).toEqual(["replaced", first.conversionId, true]);
      expect((await recipes(pack)).map((r) => [r.id, r.active, r.always])).toEqual([
        [replaced.conversionId, true, true],
        [first.conversionId, false, true],
      ]);

      const cleared = await saved(pack, [{ id: a, units: 3 }, { id: c, units: 3 }], false);
      expect([cleared.action, cleared.alwaysDisassembleOnReceive, (await recipes(pack))[0]]).toEqual([
        "replaced",
        false,
        { id: cleared.conversionId, active: true, always: false, total: 6, label: null },
      ]);
    });
  });

  it("desactivar ignora el argumento: la receta queda inactiva con su preferencia y el resultado no la nombra", async () => {
    await withRollback(db, async () => {
      const [pack, unit] = [await product("p"), await product("u")];
      const created = await saved(pack, [{ id: unit, units: 6 }], true);

      const out = await run("almacen", SAVE6, [pack, false, null, null, null, false]);
      const result = (out.rows[0]?.r as Row | undefined) ?? {};

      expect([out.code, result.action, "alwaysDisassembleOnReceive" in result]).toEqual([null, "disabled", false]);
      expect(await recipes(pack)).toEqual([{ id: created.conversionId, active: false, always: true, total: 6, label: null }]);
    });
  });

  it("no mueve stock ni costo, y un guardado rechazado (PT400 / PT409) no deja la preferencia a medias", async () => {
    await withRollback(db, async () => {
      const [pack, a, b, otherPack] = [await product("p", { stock: 5 }), await product("a", { stock: 7 }), await product("b"), await product("op")];
      const ids = [pack, a, b, otherPack];
      await saved(otherPack, [{ id: b, units: 2 }]);
      const created = await saved(pack, [{ id: a, units: 6 }]);
      const before = await ledger(ids);

      await saved(pack, [{ id: a, units: 6 }], true);
      await saved(pack, [{ id: a, units: 6 }], false);
      expect(await ledger(ids)).toBe(before);

      // Suma que no cuadra y componente que es empaque: se rechazan enteros.
      const badSum = await run("almacen", SAVE6, [pack, true, 7, null, JSON.stringify([{ unit_product_id: a, units_per_pack: 6 }]), true]);
      const chain = await save("almacen", pack, [{ id: otherPack, units: 6 }], true);

      expect([badSum.code, chain.code]).toEqual(["PT400", "PT409"]);
      expect(await recipes(pack)).toEqual([{ id: created.conversionId, active: true, always: false, total: 6, label: null }]);
      expect(await ledger(ids)).toBe(before);
    });
  });

  it("roles: admin y almacén la guardan; vendedor y contador PT403, otra tienda PT404 y anon sin execute; nadie la escribe por tabla (42501)", async () => {
    await withRollback(db, async () => {
      const [pack, unit] = [await product("p"), await product("u")];
      const created = await saved(pack, [{ id: unit, units: 6 }]);
      const direct = (actor: Actor): Promise<Outcome> =>
        run(actor, "update public.product_pack_conversions set always_disassemble_on_receive = true where id = $1 returning id", [created.conversionId]);
      const read = async (actor: Actor): Promise<unknown> => {
        const out = await run(actor, "select always_disassemble_on_receive as v from public.product_pack_conversions where id = $1", [created.conversionId]);
        return out.code ?? (out.rows.length === 0 ? "sin filas" : out.rows[0]?.v);
      };

      const directCodes: Record<string, string | null> = {};
      for (const actor of ["admin", "almacen", "vendedor1", "contador", "otraTienda", "anon"] as const) directCodes[actor] = (await direct(actor)).code;
      const afterDirect = (await recipes(pack))[0]?.always;

      const rpc: Record<string, string | null> = {};
      for (const actor of ["vendedor1", "contador", "otraTienda", "anon"] as const) rpc[actor] = (await save(actor, pack, [{ id: unit, units: 6 }], true)).code;
      const afterDenied = (await recipes(pack))[0]?.always;

      const almacen = (await save("almacen", pack, [{ id: unit, units: 6 }], true)).code;
      const reads = { vendedor: await read("vendedor1"), contador: await read("contador"), almacen: await read("almacen"), otraTienda: await read("otraTienda"), anon: await read("anon") };
      const admin = (await save("admin", pack, [{ id: unit, units: 6 }], false)).code;

      expect({ directCodes, afterDirect, rpc, afterDenied, almacen, reads, admin, final: (await recipes(pack))[0]?.always }).toEqual({
        directCodes: { admin: DENIED, almacen: DENIED, vendedor1: DENIED, contador: DENIED, otraTienda: DENIED, anon: DENIED },
        afterDirect: false,
        rpc: { vendedor1: "PT403", contador: "PT403", otraTienda: "PT404", anon: DENIED },
        afterDenied: false,
        almacen: null,
        // La lectura no cambia: toda la tienda la ve por la tabla; otra tienda no ve la fila y anon no tiene select.
        reads: { vendedor: true, contador: true, almacen: true, otraTienda: "sin filas", anon: DENIED },
        admin: null,
        final: false,
      });
    });
  });
});

describe("PostgREST (JWT real)", () => {
  it("almacén guarda la preferencia por /rpc/save_pack_recipe con 6 y con 5 argumentos (sin PGRST203), la lee por la tabla y no puede escribirla por PATCH", async () => {
    const [pack, unit] = [await product("p", { commit: true }), await product("u", { commit: true })];
    const client = await lab.supa("almacen");
    const args = { p_pack_product_id: pack, p_enabled: true, p_total_units: 6, p_label: null, p_components: [{ unit_product_id: unit, units_per_pack: 6 }] };

    const six = await client.rpc("save_pack_recipe", { ...args, p_always_disassemble_on_receive: true });
    const readOn = await client.from("product_pack_conversions").select("always_disassemble_on_receive").eq("pack_product_id", pack).eq("is_active", true).single();
    const five = await client.rpc("save_pack_recipe", args);
    const readKept = await client.from("product_pack_conversions").select("always_disassemble_on_receive").eq("pack_product_id", pack).eq("is_active", true).single();
    const patch = await client.from("product_pack_conversions").update({ always_disassemble_on_receive: false }).eq("pack_product_id", pack).select("id");
    const readAfterPatch = await client.from("product_pack_conversions").select("always_disassemble_on_receive").eq("pack_product_id", pack).eq("is_active", true).single();

    expect({
      six: [six.error?.code ?? null, (six.data as Row | null)?.alwaysDisassembleOnReceive],
      readOn: readOn.data?.always_disassemble_on_receive,
      five: [five.error?.code ?? null, (five.data as Row | null)?.action, (five.data as Row | null)?.alwaysDisassembleOnReceive],
      readKept: readKept.data?.always_disassemble_on_receive,
      patch: patch.error?.code ?? null,
      readAfterPatch: readAfterPatch.data?.always_disassemble_on_receive,
    }).toEqual({
      six: [null, true],
      readOn: true,
      five: [null, "unchanged", true],
      readKept: true,
      patch: DENIED,
      readAfterPatch: true,
    });
  });
});
