/** @jest-environment node */
/**
 * PRO-14 · regresión del parche `20261009e-supplier-preferred.sql`: proveedor habitual del producto
 * (`supplier_products.is_preferred`, como mucho uno por producto y nunca un vínculo inactivo ni de un proveedor
 * inactivo), triggers "primer vínculo = habitual" y relevo, backfill y RPC `save_product_suppliers`.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en `rollback`
 * (no queda nada en la base): los datos se preparan como `postgres` y cada sentencia probada se ejecuta con
 * `set local role authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/supplier-preferred.test.ts
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
type Role = LabRoleKey | "anon";

/** Fila de `p_suppliers`: el proveedor va por su etiqueta de test. */
type Wanted = { supplier: string; cost_ref?: number | string | null; supplier_sku?: string | null; is_preferred?: boolean };

const PATCH = resolve(__dirname, "../../../supabase/patches/20261009e-supplier-preferred.sql");
const TAG = `PRO14-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

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
 * Ejecuta `text` dentro de un savepoint como el usuario lab `role` (o como `anon`, o como `postgres`). Devuelve el
 * error (SQLSTATE + mensaje) en vez de lanzarlo y deja la transacción utilizable y en el rol de la sesión.
 */
async function run(role: Role | "postgres", text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint pro14");
  try {
    if (role !== "postgres") await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint pro14");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint pro14");
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

async function product(storeId: string = lab.storeId): Promise<string> {
  seq += 1;
  const sku = `${TAG}-p${seq}`.toLowerCase();
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, 10, 6, 0, 0, true) returning id`,
    [storeId, sku],
  );
  return String(row.id);
}

/** Proveedores del escenario, por etiqueta: A, B, C activos; OFF inactivo; CLI es cliente; AJENO es de otra tienda. */
type Cast = Record<"A" | "B" | "C" | "OFF" | "CLI" | "AJENO", string>;

async function contact(label: string, type: string, storeId: string, isActive = true): Promise<string> {
  seq += 1;
  const row = await one(
    `contacto ${label}`,
    "insert into public.contacts (store_id, type, name, is_active) values ($1, $2::public.contact_type, $3, $4) returning id",
    [storeId, type, `${TAG}-${label}-${seq}`, isActive],
  );
  return String(row.id);
}

async function cast(): Promise<Cast> {
  return {
    A: await contact("A", "proveedor", lab.storeId),
    B: await contact("B", "ambos", lab.storeId),
    C: await contact("C", "proveedor", lab.storeId),
    OFF: await contact("OFF", "proveedor", lab.storeId, false),
    CLI: await contact("CLI", "cliente", lab.storeId),
    AJENO: await contact("AJENO", "proveedor", lab.defaultStoreId),
  };
}

/** Vínculos del producto: `A*` = habitual, `(off)` = inactivo, `:costo`, `#código`. Ordenados por etiqueta. */
async function links(productId: string, who: Cast): Promise<string[]> {
  const labelOf = new Map(Object.entries(who).map(([label, id]) => [id, label]));
  const rows = await sql(
    "vínculos del producto",
    `select supplier_id, is_preferred, is_active, last_cost_ref::float8 as cost, supplier_sku
     from public.supplier_products where product_id = $1`,
    [productId],
  );

  return rows
    .map(
      (row) =>
        `${labelOf.get(String(row.supplier_id)) ?? "?"}${row.is_preferred ? "*" : ""}${row.is_active ? "" : "(off)"}` +
        `${row.cost === null ? "" : `:${String(row.cost)}`}${row.supplier_sku === null ? "" : `#${String(row.supplier_sku)}`}`,
    )
    .sort();
}

function payload(wanted: readonly Wanted[], who: Cast): string {
  return JSON.stringify(wanted.map(({ supplier, ...rest }) => ({ supplier_id: who[supplier as keyof Cast] ?? supplier, ...rest })));
}

function save(role: Role, productId: string, wanted: readonly Wanted[], who: Cast): Promise<Outcome> {
  return run(role, "select public.save_product_suppliers($1::uuid, $2::jsonb) as r", [productId, payload(wanted, who)]);
}

/** Lo que respondió la RPC: SQLSTATE si falló, o el resumen del habitual con las etiquetas del escenario. */
function outcome(out: Outcome, who: Cast): string | Row {
  if (out.code) return out.code;
  const labelOf = new Map(Object.entries(who).map(([label, id]) => [id, label]));
  const result = out.rows[0]?.r as Row;
  const label = (id: unknown): string | null => (id === null ? null : (labelOf.get(String(id)) ?? "?"));

  return {
    preferred: label(result.preferred_supplier_id),
    previous: label(result.previous_preferred_supplier_id),
    changed: result.preferred_changed,
    auto: result.preferred_auto_assigned,
    suppliers: (result.suppliers as Row[]).map((row) => `${label(row.supplier_id)}${row.is_preferred ? "*" : ""}`),
  };
}

/** Vínculo insertado directo en la tabla (el camino del formulario de contactos), con el rol dado. */
function linkDirect(role: Role | "postgres", productId: string, supplierId: string, storeId: string = lab.storeId): Promise<Outcome> {
  return run(
    role,
    "insert into public.supplier_products (store_id, supplier_id, product_id) values ($1, $2, $3) returning id",
    [storeId, supplierId, productId],
  );
}

async function history(productId: string, who: Cast): Promise<string[]> {
  const labelOf = new Map(Object.entries(who).map(([label, id]) => [id, label]));
  const rows = await sql(
    "historial de costos del proveedor",
    `select sp.supplier_id, h.origin, h.new_cost_ref::float8 as cost
     from public.supplier_product_price_history h
     join public.supplier_products sp on sp.id = h.supplier_product_id
     where sp.product_id = $1`,
    [productId],
  );

  return rows.map((row) => `${labelOf.get(String(row.supplier_id)) ?? "?"}:${String(row.origin)}:${String(row.cost)}`).sort();
}

beforeAll(async () => {
  lab = await Lab.open("pro14");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261009e · forma del esquema", () => {
  it("columna boolean not null default false, check 'inactivo nunca habitual', índice único parcial y los tres triggers activos", async () => {
    const shape = await one(
      "forma",
      `select
         (select format('%s %s %s', a.atttypid::regtype, a.attnotnull, pg_get_expr(d.adbin, d.adrelid))
            from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = 'public.supplier_products'::regclass and a.attname = 'is_preferred') as columna,
         (select pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'public.supplier_products'::regclass and conname = 'supplier_products_preferred_active_check') as restriccion,
         (select pg_get_indexdef('public.uq_supplier_products_preferred'::regclass)) as indice,
         (select array_agg(tgname::text order by tgname) from pg_trigger
            where not tgisinternal and tgenabled = 'O'
              and tgname in ('trg_supplier_products_preferred_guard', 'trg_supplier_products_preferred_handoff', 'trg_contacts_release_preferred_supplier')) as triggers`,
    );

    expect(shape).toEqual({
      columna: "boolean t false",
      restriccion: "CHECK (((NOT is_preferred) OR is_active))",
      indice: "CREATE UNIQUE INDEX uq_supplier_products_preferred ON public.supplier_products USING btree (product_id) WHERE is_preferred",
      triggers: [
        "trg_contacts_release_preferred_supplier",
        "trg_supplier_products_preferred_guard",
        "trg_supplier_products_preferred_handoff",
      ],
    });
  });

  it("save_product_suppliers la ejecutan authenticated y service_role, no anon; las funciones internas no se llaman por /rpc", async () => {
    const grants = await one(
      "grants",
      `select
         has_function_privilege('authenticated', 'public.save_product_suppliers(uuid, jsonb)', 'execute') as rpc_authenticated,
         has_function_privilege('service_role', 'public.save_product_suppliers(uuid, jsonb)', 'execute') as rpc_service,
         has_function_privilege('anon', 'public.save_product_suppliers(uuid, jsonb)', 'execute') as rpc_anon,
         has_function_privilege('authenticated', 'public.supplier_products_next_preferred(uuid)', 'execute') as relevo,
         has_function_privilege('authenticated', 'public.supplier_products_preferred_guard()', 'execute') as guard,
         has_function_privilege('authenticated', 'public.supplier_products_preferred_handoff()', 'execute') as handoff,
         has_function_privilege('authenticated', 'public.contacts_release_preferred_supplier()', 'execute') as contactos`,
    );

    expect(grants).toEqual({
      rpc_authenticated: true,
      rpc_service: true,
      rpc_anon: false,
      relevo: false,
      guard: false,
      handoff: false,
      contactos: false,
    });
  });
});

describe("triggers · el primer vínculo es el habitual y el habitual nunca queda en un vínculo inactivo", () => {
  it("por el camino de contactos (insert directo como almacen): el primer vínculo queda habitual y el segundo no", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();

      const first = await linkDirect("almacen", id, who.A);
      const second = await linkDirect("admin", id, who.B);

      expect({ codes: [first.code, second.code], links: await links(id, who) }).toEqual({
        codes: [null, null],
        links: ["A*", "B"],
      });
    });
  });

  it("el alta al comprar (insert … on conflict … is_active = true) marca el habitual solo si el producto no tiene uno", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      const upsert = `insert into public.supplier_products (store_id, supplier_id, product_id, last_cost_ref, last_purchased_at)
        values ($1, $2, $3, 5, now())
        on conflict (supplier_id, product_id) do update set last_cost_ref = excluded.last_cost_ref, is_active = true`;

      await sql("compra a A", upsert, [lab.storeId, who.A, id]);
      await sql("compra a B", upsert, [lab.storeId, who.B, id]);
      const twoPurchases = await links(id, who);
      await sql("desactivar todos", "update public.supplier_products set is_active = false where product_id = $1", [id]);
      const none = await links(id, who);
      await sql("nueva compra a B", upsert, [lab.storeId, who.B, id]);

      expect({ twoPurchases, none, reactivated: await links(id, who) }).toEqual({
        twoPurchases: ["A*:5", "B:5"],
        none: ["A(off):5", "B(off):5"],
        reactivated: ["A(off):5", "B*:5"],
      });
    });
  });

  it("un vínculo de un proveedor inactivo no queda habitual al crearse, y marcarlo a mano responde PT400", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();

      await linkDirect("postgres", id, who.OFF);
      const born = await links(id, who);
      const forced = await run("admin", "update public.supplier_products set is_preferred = true where product_id = $1 returning id", [id]);

      expect({ born, forced: forced.code, after: await links(id, who) }).toEqual({ born: ["OFF"], forced: "PT400", after: ["OFF"] });
    });
  });

  it("desactivar o borrar el vínculo habitual pasa el habitual al siguiente activo (compra más reciente; si no, el más antiguo) o deja el producto sin habitual", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await linkDirect("postgres", id, who.A);
      await linkDirect("postgres", id, who.B);
      await linkDirect("postgres", id, who.C);
      await sql("B es más antiguo que C", "update public.supplier_products set created_at = now() - interval '2 days' where product_id = $1 and supplier_id = $2", [id, who.B]);
      await sql("C tiene la compra más reciente", "update public.supplier_products set last_purchased_at = now() where product_id = $1 and supplier_id = $2", [id, who.C]);

      const deactivated = await run("almacen", "select public.deactivate_supplier_product((select id from public.supplier_products where product_id = $1 and supplier_id = $2))", [id, who.A]);
      const toMostRecentPurchase = await links(id, who);
      const deleted = await run("admin", "delete from public.supplier_products where product_id = $1 and supplier_id = $2 returning id", [id, who.C]);
      const toRemaining = await links(id, who);
      await run("admin", "update public.supplier_products set is_active = false where product_id = $1 and supplier_id = $2 returning id", [id, who.B]);

      expect({ codes: [deactivated.code, deleted.code], toMostRecentPurchase, toRemaining, none: await links(id, who) }).toEqual({
        codes: [null, null],
        toMostRecentPurchase: ["A(off)", "B", "C*"],
        toRemaining: ["A(off)", "B*"],
        none: ["A(off)", "B(off)"],
      });
    });
  });

  it("desactivar al PROVEEDOR habitual (o dejarlo solo como cliente) suelta sus habituales y cada producto pasa al relevo", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const first = await product();
      const second = await product();
      await linkDirect("postgres", first, who.A);
      await linkDirect("postgres", first, who.B);
      await linkDirect("postgres", second, who.A);

      const off = await run("admin", "update public.contacts set is_active = false where id = $1 returning id", [who.A]);
      const afterOff = { first: await links(first, who), second: await links(second, who) };
      const asCustomer = await run("admin", "update public.contacts set type = 'cliente' where id = $1 returning id", [who.B]);

      expect({ codes: [off.code, asCustomer.code], afterOff, afterCustomer: await links(first, who) }).toEqual({
        codes: [null, null],
        afterOff: { first: ["A", "B*"], second: ["A"] },
        afterCustomer: ["A", "B"],
      });
    });
  });
});

describe("índice único y check · como mucho un habitual por producto y nunca uno inactivo", () => {
  it("un segundo habitual escrito a mano choca con el índice único; marcar un vínculo inactivo no lo deja habitual", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await linkDirect("postgres", id, who.A);
      await linkDirect("postgres", id, who.B);
      await linkDirect("postgres", id, who.C);
      await sql("C inactivo", "update public.supplier_products set is_active = false where product_id = $1 and supplier_id = $2", [id, who.C]);

      const second = await run("admin", "update public.supplier_products set is_preferred = true where product_id = $1 and supplier_id = $2 returning id", [id, who.B]);
      const inserted = await run(
        "admin",
        "insert into public.supplier_products (store_id, supplier_id, product_id, is_preferred) values ($1, $2, $3, true) returning id",
        [lab.storeId, await contact("D", "proveedor", lab.storeId), id],
      );
      const inactive = await run("admin", "update public.supplier_products set is_preferred = true where product_id = $1 and supplier_id = $2 returning is_preferred", [id, who.C]);

      expect({ second: second.code, inserted: inserted.code, inactive: inactive.rows, links: await links(id, who) }).toEqual({
        second: UNIQUE_VIOLATION,
        inserted: UNIQUE_VIOLATION,
        inactive: [{ is_preferred: false }],
        links: ["A*", "B", "C(off)"],
      });
    });
  });

  it("aun con los triggers apagados, el check rechaza un habitual inactivo y el índice un segundo habitual", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await linkDirect("postgres", id, who.A);
      await linkDirect("postgres", id, who.B);
      await sql("triggers apagados en esta transacción", "set local session_replication_role = replica");

      const inactivePreferred = await run("postgres", "update public.supplier_products set is_active = false where product_id = $1 and supplier_id = $2", [id, who.A]);
      const secondPreferred = await run("postgres", "update public.supplier_products set is_preferred = true where product_id = $1 and supplier_id = $2", [id, who.B]);
      await sql("triggers encendidos", "set local session_replication_role = origin");

      expect([inactivePreferred.code, secondPreferred.code]).toEqual([CHECK_VIOLATION, UNIQUE_VIOLATION]);
    });
  });
});

describe("rpc save_product_suppliers · estado deseado de los vínculos del producto", () => {
  it("dos proveedores: crea los vínculos, guarda costo (2 decimales) y código, marca el habitual pedido y registra el historial como 'vinculacion'", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();

      const saved = await save("admin", id, [{ supplier: "A", cost_ref: 5 }, { supplier: "B", cost_ref: 7.126, supplier_sku: " x1 ", is_preferred: true }], who);

      expect({ saved: outcome(saved, who), links: await links(id, who), history: await history(id, who) }).toEqual({
        saved: { preferred: "B", previous: null, changed: true, auto: false, suppliers: ["B*", "A"] },
        links: ["A:5", "B*:7.13#x1"],
        history: ["A:vinculacion:5", "B:vinculacion:7.13"],
      });
    });
  });

  it("cambiar el habitual: el anterior se apaga en la misma llamada; un costo distinto entra al historial como 'ajuste' y uno igual no añade fila", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await save("admin", id, [{ supplier: "A", cost_ref: 5, is_preferred: true }, { supplier: "B", cost_ref: 7 }], who);

      const saved = await save("almacen", id, [{ supplier: "A", cost_ref: 5 }, { supplier: "B", cost_ref: 6.5, is_preferred: true }], who);

      expect({ saved: outcome(saved, who), links: await links(id, who), history: await history(id, who) }).toEqual({
        saved: { preferred: "B", previous: "A", changed: true, auto: false, suppliers: ["B*", "A"] },
        links: ["A:5", "B*:6.5"],
        history: ["A:vinculacion:5", "B:ajuste:6.5", "B:vinculacion:7"],
      });
    });
  });

  it("sin marcar ninguno se conserva el habitual actual; sin cost_ref ni supplier_sku el vínculo no se toca", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await save("admin", id, [{ supplier: "A", cost_ref: 5, supplier_sku: "a-1" }, { supplier: "B", is_preferred: true }], who);
      const before = await one("updated_at de A", "select updated_at::text as at from public.supplier_products where product_id = $1 and supplier_id = $2", [id, who.A]);

      const saved = await save("admin", id, [{ supplier: "B" }, { supplier: "A" }], who);
      const after = await one("updated_at de A", "select updated_at::text as at from public.supplier_products where product_id = $1 and supplier_id = $2", [id, who.A]);

      expect({ saved: outcome(saved, who), links: await links(id, who), untouched: after.at === before.at, history: await history(id, who) }).toEqual({
        saved: { preferred: "B", previous: "B", changed: false, auto: false, suppliers: ["B*", "A"] },
        links: ["A:5#a-1", "B*"],
        untouched: true,
        history: ["A:vinculacion:5"],
      });
    });
  });

  it("quitar el habitual sin marcar otro: el vínculo se DESACTIVA (no se borra), el habitual pasa al primero de la lista y la respuesta lo indica", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await save("admin", id, [{ supplier: "A", is_preferred: true }, { supplier: "B" }, { supplier: "C" }], who);

      const saved = await save("admin", id, [{ supplier: "C" }, { supplier: "B" }], who);

      expect({ saved: outcome(saved, who), links: await links(id, who) }).toEqual({
        saved: { preferred: "C", previous: "A", changed: true, auto: true, suppliers: ["C*", "B"] },
        links: ["A(off)", "B", "C*"],
      });
    });
  });

  it("lista vacía: desactiva todos los vínculos y el producto queda sin habitual; volver a añadir uno lo reactiva (misma fila)", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await save("admin", id, [{ supplier: "A", is_preferred: true }, { supplier: "B" }], who);
      const rowsBefore = await one("filas", "select count(*)::int as n from public.supplier_products where product_id = $1", [id]);

      const emptied = await save("admin", id, [], who);
      const afterEmpty = await links(id, who);
      const again = await save("admin", id, [{ supplier: "B", cost_ref: 3 }], who);
      const rowsAfter = await one("filas", "select count(*)::int as n from public.supplier_products where product_id = $1", [id]);

      expect({ emptied: outcome(emptied, who), afterEmpty, again: outcome(again, who), links: await links(id, who), rows: [rowsBefore.n, rowsAfter.n], history: await history(id, who) }).toEqual({
        emptied: { preferred: null, previous: "A", changed: true, auto: true, suppliers: [] },
        afterEmpty: ["A(off)", "B(off)"],
        again: { preferred: "B", previous: null, changed: true, auto: true, suppliers: ["B*"] },
        links: ["A(off)", "B*:3"],
        rows: [2, 2],
        history: ["B:vinculacion:3"],
      });
    });
  });

  it("el mismo proveedor dos veces se FUNDE en una fila: gana la última aparición (costo y código) y es habitual si alguna lo marca", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();

      const saved = await save(
        "admin",
        id,
        [{ supplier: "A", cost_ref: 1, supplier_sku: "viejo", is_preferred: true }, { supplier: "B" }, { supplier: "A", cost_ref: 9, supplier_sku: "nuevo" }],
        who,
      );

      expect({ saved: outcome(saved, who), links: await links(id, who), history: await history(id, who) }).toEqual({
        saved: { preferred: "A", previous: null, changed: true, auto: false, suppliers: ["A*", "B"] },
        links: ["A*:9#nuevo", "B"],
        history: ["A:vinculacion:9"],
      });
    });
  });

  it("proveedor INACTIVO: PT400 en un vínculo nuevo y al marcarlo habitual; un vínculo que ya tenía se puede conservar sin marca", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await save("admin", id, [{ supplier: "A", is_preferred: true }, { supplier: "B" }], who);

      const asNew = await save("admin", id, [{ supplier: "A" }, { supplier: "OFF" }], who);
      await sql("B pasa a inactivo", "update public.contacts set is_active = false where id = $1", [who.B]);
      const asPreferred = await save("admin", id, [{ supplier: "A" }, { supplier: "B", is_preferred: true }], who);
      const kept = await save("admin", id, [{ supplier: "B" }, { supplier: "A" }], who);
      const onlyInactive = await save("admin", id, [{ supplier: "B" }], who);

      expect({
        rejected: [asNew.code, asPreferred.code],
        messages: [/inactivo: no se puede vincular/.test(asNew.message), /inactivo: no puede ser el habitual/.test(asPreferred.message)],
        kept: outcome(kept, who),
        onlyInactive: outcome(onlyInactive, who),
        links: await links(id, who),
      }).toEqual({
        rejected: ["PT400", "PT400"],
        messages: [true, true],
        kept: { preferred: "A", previous: "A", changed: false, auto: false, suppliers: ["A*", "B"] },
        onlyInactive: { preferred: null, previous: "A", changed: true, auto: true, suppliers: ["B"] },
        links: ["A(off)", "B"],
      });
    });
  });

  it("PT400 sin escribir nada: dos habituales, costo negativo / no numérico / fuera de rango, más de 50, cliente, proveedor de otra tienda o inexistente y lista que no es lista", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await save("admin", id, [{ supplier: "A", cost_ref: 5, is_preferred: true }], who);
      const fiftyOne = Array.from({ length: 51 }, (): Wanted => ({ supplier: "A" }));

      const rejected = [
        await save("admin", id, [{ supplier: "A", is_preferred: true }, { supplier: "B", is_preferred: true }], who),
        await save("admin", id, [{ supplier: "A", cost_ref: -0.01 }], who),
        await save("admin", id, [{ supplier: "A", cost_ref: "5" }], who),
        await save("admin", id, [{ supplier: "A", cost_ref: 10000000000 }], who),
        await save("admin", id, fiftyOne, who),
        await save("admin", id, [{ supplier: "CLI" }], who),
        await save("admin", id, [{ supplier: "AJENO" }], who),
        await save("admin", id, [{ supplier: randomUUID() }], who),
        await save("admin", id, [{ supplier: "no-es-uuid" }], who),
        await run("admin", "select public.save_product_suppliers($1::uuid, $2::jsonb)", [id, "{}"]),
        await run("admin", "select public.save_product_suppliers($1::uuid, null)", [id]),
      ].map((out) => out.code);

      expect({ rejected, links: await links(id, who), history: await history(id, who) }).toEqual({
        rejected: rejected.map(() => "PT400"),
        links: ["A*:5"],
        history: ["A:vinculacion:5"],
      });
    });
  });

  it("no toca el producto: mismo costo, precio, stock y updated_at después de guardar proveedores con costo", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      const read = "select current_cost_ref::text as costo, sale_price_ref::text as precio, current_stock as stock, updated_at::text as at from public.products where id = $1";
      const before = await one("producto antes", read, [id]);
      const movements = await one("movimientos antes", "select count(*)::int as n from public.stock_movements where product_id = $1", [id]);

      await save("admin", id, [{ supplier: "A", cost_ref: 99, is_preferred: true }, { supplier: "B", cost_ref: 1 }], who);

      expect({
        product: await one("producto después", read, [id]),
        movements: await one("movimientos después", "select count(*)::int as n from public.stock_movements where product_id = $1", [id]),
      }).toEqual({ product: before, movements });
    });
  });
});

describe("rpc save_product_suppliers · rol y tienda", () => {
  it("solo admin y almacen de la tienda: vendedor y contador reciben PT403, anon no puede ejecutarla, y nada se escribe", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();

      const results = [
        (await save("vendedor1", id, [{ supplier: "A" }], who)).code,
        (await save("contador", id, [{ supplier: "A" }], who)).code,
        (await save("anon", id, [{ supplier: "A" }], who)).code,
      ];
      const afterRejected = await links(id, who);
      const allowed = [(await save("almacen", id, [{ supplier: "A" }], who)).code, (await save("admin", id, [{ supplier: "A" }, { supplier: "B" }], who)).code];

      expect({ results, afterRejected, allowed, links: await links(id, who) }).toEqual({
        results: ["PT403", "PT403", INSUFFICIENT_PRIVILEGE],
        afterRejected: [],
        allowed: [null, null],
        links: ["A*", "B"],
      });
    });
  });

  it("producto de otra tienda o inexistente: PT404, y los vínculos de la otra tienda no cambian", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const foreign = await product(lab.defaultStoreId);
      await linkDirect("postgres", foreign, who.AJENO, lab.defaultStoreId);

      const results = [
        (await save("admin", foreign, [], who)).code,
        (await save("admin", foreign, [{ supplier: "A" }], who)).code,
        (await save("almacen", randomUUID(), [], who)).code,
      ];

      expect({ results, foreign: await links(foreign, who) }).toEqual({ results: ["PT404", "PT404", "PT404"], foreign: ["AJENO*"] });
    });
  });

  it("RLS: los usuarios de la tienda leen is_preferred de sus vínculos y no ven los de otra tienda; vendedor y contador no pueden marcar el habitual a mano", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const own = await product();
      const foreign = await product(lab.defaultStoreId);
      await linkDirect("postgres", own, who.A);
      await linkDirect("postgres", own, who.B);
      await linkDirect("postgres", foreign, who.AJENO, lab.defaultStoreId);
      const read = "select is_preferred from public.supplier_products where product_id = any($1::uuid[]) order by is_preferred desc";
      const mark = "update public.supplier_products set is_preferred = false where product_id = $1 returning id";

      const readers = [];
      for (const role of ["vendedor1", "contador", "almacen"] as const) readers.push((await run(role, read, [[own, foreign]])).rows);
      const writers = [(await run("vendedor1", mark, [own])).rows.length, (await run("contador", mark, [own])).rows.length, (await run("admin", mark, [foreign])).rows.length];

      expect({ readers, writers, own: await links(own, who), foreign: await links(foreign, who) }).toEqual({
        readers: [1, 2, 3].map(() => [{ is_preferred: true }, { is_preferred: false }]),
        writers: [0, 0, 0],
        own: ["A*", "B"],
        foreign: ["AJENO*"],
      });
    });
  });
});

describe("20261009e · backfill y reaplicar el parche", () => {
  it("backfill: cada producto con vínculos activos y sin habitual recibe UNO (compra más reciente; si no, el más antiguo; nunca un proveedor inactivo) y reaplicar no cambia el ya elegido", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const byPurchase = await product();
      const byAge = await product();
      const onlyInactiveLink = await product();
      const insert = `insert into public.supplier_products (store_id, supplier_id, product_id, created_at, last_purchased_at, is_active)
        values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6)`;

      // Filas "de antes del parche": sin habitual y sin pasar por los triggers.
      await sql("triggers apagados en esta transacción", "set local session_replication_role = replica");
      await sql("A viejo sin compras", insert, [lab.storeId, who.A, byPurchase, "2026-01-01", null, true]);
      await sql("B con la compra más reciente", insert, [lab.storeId, who.B, byPurchase, "2026-02-01", "2026-03-01", true]);
      await sql("OFF es el más antiguo pero su proveedor está inactivo", insert, [lab.storeId, who.OFF, byAge, "2026-01-01", "2026-05-01", true]);
      await sql("C más antiguo que A", insert, [lab.storeId, who.C, byAge, "2026-02-01", null, true]);
      await sql("A más nuevo", insert, [lab.storeId, who.A, byAge, "2026-03-01", null, true]);
      await sql("vínculo inactivo", insert, [lab.storeId, who.A, onlyInactiveLink, "2026-01-01", null, false]);
      await sql("triggers encendidos", "set local session_replication_role = origin");
      const before = [await links(byPurchase, who), await links(byAge, who), await links(onlyInactiveLink, who)];

      await sql("aplicar", patchBody());
      const first = [await links(byPurchase, who), await links(byAge, who), await links(onlyInactiveLink, who)];
      // Ahora A sería el candidato "mejor": el habitual ya elegido no se mueve.
      await sql("A compra después", "update public.supplier_products set last_purchased_at = now() where product_id = $1 and supplier_id = $2", [byPurchase, who.A]);
      await sql("reaplicar (1)", patchBody());
      await sql("reaplicar (2)", patchBody());

      expect({ before, first, again: [await links(byPurchase, who), await links(byAge, who), await links(onlyInactiveLink, who)] }).toEqual({
        before: [["A", "B"], ["A", "C", "OFF"], ["A(off)"]],
        first: [["A", "B*"], ["A", "C*", "OFF"], ["A(off)"]],
        again: [["A", "B*"], ["A", "C*", "OFF"], ["A(off)"]],
      });
    });
  });

  it("reaplicar dos veces deja la misma forma y las mismas reglas: primer vínculo habitual, un solo habitual y la RPC igual", async () => {
    await withRollback(db, async () => {
      const who = await cast();
      const id = await product();
      await save("admin", id, [{ supplier: "A" }, { supplier: "B", is_preferred: true }], who);
      const shape = `select
          (select count(*)::int from pg_constraint where conname = 'supplier_products_preferred_active_check') as checks,
          (select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'uq_supplier_products_preferred') as indexes,
          (select count(*)::int from pg_trigger where not tgisinternal and tgname in
            ('trg_supplier_products_preferred_guard', 'trg_supplier_products_preferred_handoff', 'trg_contacts_release_preferred_supplier')) as triggers,
          (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_product_suppliers') as rpcs`;
      const before = await one("forma antes", shape);

      await sql("reaplicar (1)", patchBody());
      await sql("reaplicar (2)", patchBody());

      const other = await product();
      await linkDirect("almacen", other, who.C);
      const second = await run("admin", "update public.supplier_products set is_preferred = true where product_id = $1 and supplier_id = $2 returning id", [id, who.A]);
      const saved = await save("admin", id, [{ supplier: "A", is_preferred: true }], who);

      expect({ before, after: await one("forma después", shape), kept: await links(other, who), second: second.code, saved: outcome(saved, who), links: await links(id, who) }).toEqual({
        before: { checks: 1, indexes: 1, triggers: 3, rpcs: 1 },
        after: { checks: 1, indexes: 1, triggers: 3, rpcs: 1 },
        kept: ["C*"],
        second: UNIQUE_VIOLATION,
        saved: { preferred: "A", previous: "B", changed: true, auto: false, suppliers: ["A*"] },
        links: ["A*", "B(off)"],
      });
    });
  });
});
