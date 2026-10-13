/** @jest-environment node */
/**
 * COM-02 · regresión del parche `20261010a-purchase-auto-link.sql`: `create_purchase` deja vinculada al proveedor cada
 * línea de la compra (vínculo, empaque del proveedor y proveedor habitual), rechaza con PT400 al proveedor inactivo o
 * que no es proveedor, y NO cambia líneas, movimientos, costos ni totales frente a la versión de `20261009d`.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en `rollback`
 * (no queda nada en la base): los datos se preparan como `postgres` y cada compra se ejecuta con
 * `set local role authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/purchase-auto-link.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { INTEGRITY_VIEWS, Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };
type Status = "pedido" | "recibido";

/** Línea de compra del test: por unidad (`quantity`) o por empaque (`packCount` × `unitsPerPack`). */
type Line = {
  product: string;
  /** Costo neto por unidad en REF. */
  costRef: number;
  quantity?: number;
  pack?: { label: string; count: number; unitsPerPack: number };
  taxRate?: number;
  supplierSku?: string;
};

type Options = { status?: Status; clientRequestId?: string; role?: LabRoleKey; previous?: boolean };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261010a-purchase-auto-link.sql";
const PREVIOUS_PATCH = "20261009d-assorted-pack.sql";
const PREVIOUS_NAME = "create_purchase_20261009d";
const TAG = `COM02-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const RATE = 100;

let lab: Lab;
let db: Client;
let seq = 0;

const round2 = (value: number): number => Math.round(value * 100) / 100;

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

/** Ejecuta `text` en un savepoint como el usuario lab `role`. Devuelve el error (SQLSTATE + mensaje) en vez de lanzarlo. */
async function run(role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint com02");
  try {
    await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint com02");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint com02");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

/** La definición de `create_purchase` de un parche, instalable con otro nombre. */
function functionOf(patch: string, installAs: string): string {
  const text = readFileSync(resolve(PATCHES, patch), "utf8");
  const match = /create or replace function public\.create_purchase\([\s\S]*?\n\$\$;/.exec(text);
  if (!match) throw new Error(`SETUP · ${patch} no define create_purchase`);
  return match[0].replace("function public.create_purchase(", `function public.${installAs}(`);
}

async function product(name: string, cost = "1.00"): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${name}-${seq}`.toLowerCase();
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, 9, $3::numeric, 0, 0, true) returning id`,
    [lab.storeId, sku, cost],
  );
  return String(row.id);
}

async function contact(label: string, type = "proveedor", isActive = true, storeId: string = lab.storeId): Promise<string> {
  seq += 1;
  const row = await one(
    `contacto ${label}`,
    "insert into public.contacts (store_id, type, name, is_active) values ($1, $2::public.contact_type, $3, $4) returning id",
    [storeId, type, `${TAG}-${label}-${seq}`, isActive],
  );
  return String(row.id);
}

/** Par empaque → unidad de siempre (cabecera con unidad y unidades; el trigger crea el componente). */
async function pair(pack: string, unit: string, units: number): Promise<void> {
  await sql(
    `par x${units}`,
    `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active)
     values ($1, $2, $3, $4, true)`,
    [lab.storeId, pack, unit, units],
  );
}

function item(line: Line): Row {
  const taxRate = line.taxRate ?? 0;
  const units = line.pack ? line.pack.count * line.pack.unitsPerPack : (line.quantity ?? 1);
  const subtotalRef = round2(units * line.costRef);
  const taxRef = round2((subtotalRef * taxRate) / 100);

  return {
    product_id: line.product,
    cost_currency: "ref",
    unit_cost_ref: line.costRef,
    unit_cost_ves: round2(line.costRef * RATE),
    subtotal_ref: subtotalRef,
    subtotal_ves: round2(subtotalRef * RATE),
    tax_rate: taxRate,
    tax_ref: taxRef,
    tax_ves: round2(taxRef * RATE),
    ...(line.supplierSku ? { supplier_sku: line.supplierSku } : {}),
    ...(line.pack
      ? {
          entry_mode: "pack",
          pack_label: line.pack.label,
          pack_count: line.pack.count,
          units_per_pack: line.pack.unitsPerPack,
          pack_cost_ref: round2(line.costRef * line.pack.unitsPerPack),
          pack_cost_ves: round2(line.costRef * line.pack.unitsPerPack * RATE),
        }
      : { quantity: units }),
  };
}

/** `create_purchase` (vigente, o la de 20261009d instalada con otro nombre) como `almacen` salvo que se indique otro rol. */
function purchase(supplierId: string, lines: readonly Line[], options: Options = {}): Promise<Outcome> {
  const items = lines.map(item);
  const subtotalRef = round2(items.reduce((sum, row) => sum + Number(row.subtotal_ref), 0));
  const taxRef = round2(items.reduce((sum, row) => sum + Number(row.tax_ref), 0));

  return run(
    options.role ?? "almacen",
    `select id, purchase_number from public.${options.previous ? PREVIOUS_NAME : "create_purchase"}(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0,
       p_tax_ref => $4::numeric, p_notes => $5, p_status => $6::public.purchase_status, p_discount_ves => 0,
       p_tax_ves => $7::numeric, p_subtotal_ves => $8::numeric, p_subtotal_ref => $9::numeric,
       p_client_request_id => $10::uuid)`,
    [
      supplierId,
      JSON.stringify(items),
      RATE,
      taxRef,
      TAG,
      options.status ?? "recibido",
      round2(taxRef * RATE),
      round2(subtotalRef * RATE),
      subtotalRef,
      options.clientRequestId ?? null,
    ],
  );
}

/** Vínculos del producto con sus empaques e historial, sin ids ni fechas. Ordenados por nombre del proveedor. */
async function links(productId: string): Promise<Row[]> {
  return sql(
    "vínculos del producto",
    `select
       split_part(c.name, '-', 3) as proveedor,
       sp.is_active as activo,
       sp.is_preferred as habitual,
       sp.last_cost_ref::text as costo,
       sp.last_cost_ves::text as costo_ves,
       sp.supplier_sku as codigo,
       sp.last_purchased_at is not null as comprado,
       coalesce((select jsonb_agg(jsonb_build_object('label', u.label, 'units', u.units_per_pack, 'default', u.is_default, 'active', u.is_active)
                                  order by u.is_default desc, u.units_per_pack, u.label)
                 from public.supplier_product_pack_units u where u.supplier_product_id = sp.id), '[]'::jsonb) as empaques,
       coalesce((select jsonb_agg(format('%s:%s->%s', h.origin, coalesce(h.old_cost_ref::text, '-'), h.new_cost_ref::text) order by h.old_cost_ref nulls first, h.new_cost_ref, h.origin)
                 from public.supplier_product_price_history h where h.supplier_product_id = sp.id), '[]'::jsonb) as historial
     from public.supplier_products sp
     join public.contacts c on c.id = sp.supplier_id
     where sp.product_id = $1
     order by c.name`,
    [productId],
  );
}

/** Filas que deja una compra, contadas por tabla (para comprobar que un rechazo no crea nada). */
async function counts(supplierId: string, productIds: readonly string[]): Promise<Row> {
  return one(
    "conteo de filas",
    `select
       (select count(*)::int from public.purchases where supplier_id = $1) as compras,
       (select count(*)::int from public.purchase_items where product_id = any($2::uuid[])) as lineas,
       (select count(*)::int from public.stock_movements where product_id = any($2::uuid[])) as movimientos,
       (select count(*)::int from public.supplier_products where product_id = any($2::uuid[])) as vinculos,
       (select count(*)::int from public.supplier_product_pack_units u join public.supplier_products sp on sp.id = u.supplier_product_id
        where sp.product_id = any($2::uuid[])) as empaques,
       (select count(*)::int from public.supplier_product_price_history h join public.supplier_products sp on sp.id = h.supplier_product_id
        where sp.product_id = any($2::uuid[])) as historial`,
    [supplierId, productIds],
  );
}

/** Lo que deja la compra en el producto, sin ids, números de documento ni fechas: stock, costo, líneas, movimientos y totales. */
function footprint(productId: string): Promise<Row> {
  return one(
    "huella de la compra",
    `select
       (select jsonb_agg(to_jsonb(pi) - array['id', 'purchase_id', 'product_id', 'created_at'])
        from public.purchase_items pi where pi.product_id = $1) as lineas,
       (select jsonb_agg(jsonb_build_object('type', m.type, 'quantity_delta', m.quantity_delta, 'stock_after', m.stock_after) order by m.seq)
        from public.stock_movements m where m.product_id = $1) as movimientos,
       (select jsonb_build_object('stock', p.current_stock, 'cost', p.current_cost_ref) from public.products p where p.id = $1) as producto,
       (select jsonb_agg(to_jsonb(pu) - array['id', 'purchase_number', 'supplier_id', 'created_at', 'updated_at', 'client_request_id', 'client_request_hash'])
        from public.purchases pu where pu.id in (select purchase_id from public.purchase_items where product_id = $1)) as compras`,
    [productId],
  );
}

async function integrity(ids: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const view of INTEGRITY_VIEWS) {
    const filter =
      view === "conversion_mismatches" ? "pack_product_id = any($1::uuid[]) or unit_product_id = any($1::uuid[])" : "product_id = any($1::uuid[])";
    const row = await one(`vista ${view}`, `select count(*)::int as n from public.${view} where ${filter}`, [ids]);
    if (Number(row.n) > 0) out[view] = Number(row.n);
  }
  return out;
}

beforeAll(async () => {
  lab = await Lab.open("com02");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261010a · forma de la función", () => {
  it("el parche es una transacción que solo redefine create_purchase y recarga el esquema de PostgREST", () => {
    const text = readFileSync(resolve(PATCHES, PATCH), "utf8");

    expect({
      begins: text.match(/^begin;\r?$/gm)?.length,
      commits: text.match(/^commit;\r?$/gm)?.length,
      funciones: text.match(/^create or replace function public\.(\w+)/gm),
      notify: /^notify pgrst, 'reload schema';\r?$/m.test(text),
    }).toEqual({ begins: 1, commits: 1, funciones: ["create or replace function public.create_purchase"], notify: true });
  });

  it("una sola firma de 14 argumentos, security definer con search_path, sin escribir el stock del producto y solo para authenticated / service_role", async () => {
    const shape = await one(
      "forma",
      `select count(*)::int as firmas,
              bool_and(p.pronargs = 14) as argumentos,
              bool_and(p.prosecdef) as definer,
              bool_and(p.proconfig @> array['search_path=public']) as search_path,
              bool_and(p.prosrc ilike '%v_store_id := public.assert_store_context();%') as tienda,
              bool_and(p.prosrc not ilike '%current_stock%') as sin_stock,
              bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as authenticated,
              bool_and(has_function_privilege('anon', p.oid, 'execute')) as anon
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'`,
    );

    expect(shape).toEqual({ firmas: 1, argumentos: true, definer: true, search_path: true, tienda: true, sin_stock: true, authenticated: true, anon: false });
  });

  it("es la función de 20261009d más el añadido: de la versión anterior solo desaparecen la comprobación del proveedor y el lookup del vínculo, que el parche reescribe", () => {
    const lines = (patch: string): string[] =>
      functionOf(patch, "create_purchase")
        .split(/\r?\n/)
        .map((line) => line.trim());
    const current = new Set(lines(PATCH));
    const lost = lines(PREVIOUS_PATCH).filter((line) => !current.has(line));

    // assert_contact_type + tienda pasan a un único select con PT400; el lookup del vínculo lee además is_active.
    expect(lost).toEqual([
      "perform public.assert_contact_type(p_supplier_id, array['proveedor', 'ambos']::public.contact_type[]);",
      "if not exists (",
      "from public.contacts",
      "where id = p_supplier_id",
      "select id, last_cost_ref, last_cost_ves",
      "into v_sp_id, v_old_cost_ref, v_old_cost_ves",
    ]);
  });
});

describe("vínculo automático · compra recibida", () => {
  it("producto no vinculado comprado por empaque: 1 vínculo activo con el costo de la línea (con IVA), su empaque predeterminado e historial 'compra'", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("nuevo");

      const out = await purchase(supplier, [{ product: p, costRef: 2, pack: { label: "Bulto x12", count: 3, unitsPerPack: 12 }, taxRate: 16, supplierSku: "abc-1" }]);

      expect({ code: out.code, vinculos: await links(p), stock: (await footprint(p)).producto, vistas: await integrity([p]) }).toEqual({
        code: null,
        vinculos: [
          {
            proveedor: "A",
            activo: true,
            habitual: true,
            costo: "2.32",
            costo_ves: "232.00",
            codigo: "abc-1",
            comprado: true,
            empaques: [{ label: "Bulto x12", units: 12, default: true, active: true }],
            historial: ["compra:-->2.32"],
          },
        ],
        stock: { stock: 36, cost: 2.32 },
        vistas: {},
      });
    });
  });

  it("producto no vinculado comprado por unidad: 1 vínculo con costo y SIN empaque", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("unidad");

      await purchase(supplier, [{ product: p, costRef: 3, quantity: 5 }]);

      expect(await links(p)).toEqual([
        { proveedor: "A", activo: true, habitual: true, costo: "3.00", costo_ves: "300.00", codigo: null, comprado: true, empaques: [], historial: ["compra:-->3.00"] },
      ]);
    });
  });

  it("ya vinculado: no duplica el vínculo ni añade empaques; actualiza el costo con historial 'compra' (como antes del parche)", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("vinculado");
      await purchase(supplier, [{ product: p, costRef: 2, pack: { label: "Caja", count: 1, unitsPerPack: 6 } }]);

      const again = await purchase(supplier, [{ product: p, costRef: 2.5, pack: { label: "Bulto", count: 1, unitsPerPack: 24 } }]);

      expect({ code: again.code, vinculos: await links(p) }).toEqual({
        code: null,
        vinculos: [
          {
            proveedor: "A",
            activo: true,
            habitual: true,
            costo: "2.50",
            costo_ves: "250.00",
            codigo: null,
            comprado: true,
            empaques: [{ label: "Caja", units: 6, default: true, active: true }],
            historial: ["compra:-->2.00", "compra:2.00->2.50"],
          },
        ],
      });
    });
  });

  it("el mismo producto en dos líneas con empaques distintos: 1 vínculo, 2 empaques y solo el primero predeterminado; el mismo empaque repetido no se duplica", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("dos-lineas");

      const out = await purchase(supplier, [
        { product: p, costRef: 1, pack: { label: "Caja", count: 1, unitsPerPack: 6 } },
        { product: p, costRef: 1, pack: { label: "Bulto", count: 1, unitsPerPack: 24 } },
        { product: p, costRef: 1, pack: { label: "caja", count: 2, unitsPerPack: 6 } },
      ]);
      const [link] = await links(p);

      expect({ code: out.code, total: (await links(p)).length, empaques: link?.empaques, stock: (await footprint(p)).producto }).toEqual({
        code: null,
        total: 1,
        empaques: [
          { label: "Caja", units: 6, default: true, active: true },
          { label: "Bulto", units: 24, default: false, active: true },
        ],
        stock: { stock: 42, cost: 1 },
      });
    });
  });

  it("vínculo existente pero desactivado: se reactiva el mismo (no se crea otro) y conserva sus empaques sin añadir el de la línea", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("inactivo");
      await purchase(supplier, [{ product: p, costRef: 2, pack: { label: "Caja", count: 1, unitsPerPack: 6 } }]);
      await sql("desactivar vínculo", "update public.supplier_products set is_active = false where product_id = $1", [p]);

      await purchase(supplier, [{ product: p, costRef: 2, pack: { label: "Bulto", count: 1, unitsPerPack: 24 } }]);
      const all = await links(p);

      expect({ total: all.length, activo: all[0]?.activo, habitual: all[0]?.habitual, empaques: all[0]?.empaques }).toEqual({
        total: 1,
        activo: true,
        habitual: true,
        empaques: [{ label: "Caja", units: 6, default: true, active: true }],
      });
    });
  });

  it("línea por empaque sobre el producto EMPAQUE de una receta: se guarda en modo unidad y el vínculo nace sin empaque del proveedor", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const [pack, unit] = [await product("caja"), await product("suelto")];
      await pair(pack, unit, 12);

      const out = await purchase(supplier, [{ product: pack, costRef: 1, pack: { label: "Caja x12", count: 2, unitsPerPack: 12 } }]);
      const [link] = await links(pack);

      expect({ code: out.code, costo: link?.costo, empaques: link?.empaques, stock: (await footprint(pack)).producto }).toEqual({
        code: null,
        costo: "12.00",
        empaques: [],
        stock: { stock: 2, cost: 12 },
      });
    });
  });
});

describe("vínculo automático · proveedor habitual (20261009e)", () => {
  it("el producto ya tiene habitual: el vínculo nuevo NO lo desplaza", async () => {
    await withRollback(db, async () => {
      const [a, b] = [await contact("A"), await contact("B", "ambos")];
      const p = await product("con-habitual");
      await purchase(a, [{ product: p, costRef: 2, quantity: 1 }]);

      await purchase(b, [{ product: p, costRef: 3, quantity: 1 }]);

      expect((await links(p)).map((row) => `${String(row.proveedor)}${row.habitual ? "*" : ""}`)).toEqual(["A*", "B"]);
    });
  });

  it("el producto no tiene habitual (su único vínculo está desactivado): el vínculo nuevo queda habitual", async () => {
    await withRollback(db, async () => {
      const [a, b] = [await contact("A"), await contact("B")];
      const p = await product("sin-habitual");
      await purchase(a, [{ product: p, costRef: 2, quantity: 1 }]);
      await sql("desactivar vínculo", "update public.supplier_products set is_active = false where product_id = $1", [p]);

      await purchase(b, [{ product: p, costRef: 3, quantity: 1 }]);

      expect((await links(p)).map((row) => `${String(row.proveedor)}${row.habitual ? "*" : ""}${row.activo ? "" : "(off)"}`)).toEqual(["A(off)", "B*"]);
    });
  });
});

describe("vínculo automático · compra en pedido", () => {
  it("producto no vinculado: el vínculo nace con el costo de la línea, origen 'vinculacion', sin fecha de compra y con su empaque; al recibir se registra la compra sin duplicar", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("pedido");

      const ordered = await purchase(supplier, [{ product: p, costRef: 2, pack: { label: "Bulto", count: 2, unitsPerPack: 10 } }], { status: "pedido" });
      const before = { vinculos: await links(p), stock: (await footprint(p)).producto };
      const received = await run("almacen", "select id from public.receive_purchase($1::uuid)", [ordered.rows[0]?.id]);
      const after = await links(p);

      expect({ codes: [ordered.code, received.code], before, after: after.map(({ comprado, historial, empaques }) => ({ comprado, historial, empaques })) }).toEqual({
        codes: [null, null],
        before: {
          vinculos: [
            {
              proveedor: "A",
              activo: true,
              habitual: true,
              costo: "2.00",
              costo_ves: "200.00",
              codigo: null,
              comprado: false,
              empaques: [{ label: "Bulto", units: 10, default: true, active: true }],
              historial: ["vinculacion:-->2.00"],
            },
          ],
          stock: { stock: 0, cost: 1 },
        },
        after: [
          {
            comprado: true,
            historial: ["vinculacion:-->2.00", "compra:2.00->2.00"],
            empaques: [{ label: "Bulto", units: 10, default: true, active: true }],
          },
        ],
      });
    });
  });

  it("producto ya vinculado y activo: el pedido no toca el vínculo (ni costo, ni historial, ni empaques)", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("pedido-vinculado");
      await purchase(supplier, [{ product: p, costRef: 2, quantity: 1 }]);
      const before = await links(p);

      const ordered = await purchase(supplier, [{ product: p, costRef: 9, pack: { label: "Bulto", count: 1, unitsPerPack: 10 } }], { status: "pedido" });

      expect({ code: ordered.code, vinculos: await links(p) }).toEqual({ code: null, vinculos: before });
    });
  });

  it("vínculo desactivado: el pedido lo reactiva sin cambiar su costo ni su historial", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("pedido-inactivo");
      await purchase(supplier, [{ product: p, costRef: 2, quantity: 1 }]);
      await sql("desactivar vínculo", "update public.supplier_products set is_active = false where product_id = $1", [p]);

      await purchase(supplier, [{ product: p, costRef: 9, quantity: 1 }], { status: "pedido" });

      expect((await links(p)).map(({ activo, habitual, costo, historial }) => ({ activo, habitual, costo, historial }))).toEqual([
        { activo: true, habitual: true, costo: "2.00", historial: ["compra:-->2.00"] },
      ]);
    });
  });
});

describe("proveedor que no puede comprar · PT400 y nada creado (caos 7.3)", () => {
  const CASES: Array<{ name: string; make: () => Promise<string>; message: RegExp }> = [
    { name: "proveedor inactivo", make: () => contact("OFF", "proveedor", false), message: /^El proveedor COM02-.*-OFF-\d+ está inactivo: no se puede registrar la compra$/ },
    { name: "contacto que solo es cliente", make: () => contact("CLI", "cliente"), message: /^El contacto COM02-.*-CLI-\d+ no es proveedor: no se puede registrar la compra$/ },
    { name: "proveedor de otra tienda", make: () => contact("AJENO", "proveedor", true, lab.defaultStoreId), message: /^Contacto no pertenece a tu tienda$/ },
    { name: "proveedor inexistente", make: () => Promise.resolve(randomUUID()), message: /^Proveedor no encontrado$/ },
  ];

  it.each(CASES)("$name: PT400 en español y 0 filas nuevas (compra, líneas, movimientos, vínculo, empaque, historial)", async ({ make, message }) => {
    await withRollback(db, async () => {
      const supplier = await make();
      const p = await product("rechazo");
      const lines: Line[] = [{ product: p, costRef: 2, pack: { label: "Bulto", count: 1, unitsPerPack: 12 } }];

      const received = await purchase(supplier, lines);
      const ordered = await purchase(supplier, lines, { status: "pedido" });

      expect({ codes: [received.code, ordered.code], filas: await counts(supplier, [p]) }).toEqual({
        codes: ["PT400", "PT400"],
        filas: { compras: 0, lineas: 0, movimientos: 0, vinculos: 0, empaques: 0, historial: 0 },
      });
      expect(received.message).toMatch(message);
      expect(ordered.message).toMatch(message);
    });
  });

  it("una línea inválida después de una válida: la compra se rechaza y el vínculo de la primera línea no queda", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("valida");

      const out = await purchase(supplier, [
        { product: p, costRef: 2, quantity: 1 },
        { product: randomUUID(), costRef: 2, quantity: 1 },
      ]);

      expect({ code: out.code, filas: await counts(supplier, [p]) }).toEqual({
        code: "PT404",
        filas: { compras: 0, lineas: 0, movimientos: 0, vinculos: 0, empaques: 0, historial: 0 },
      });
    });
  });

  it("un vendedor no crea compras ni vínculos: PT403", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("vendedor");

      const out = await purchase(supplier, [{ product: p, costRef: 2, quantity: 1 }], { role: "vendedor1" });

      expect({ code: out.code, vinculos: (await counts(supplier, [p])).vinculos }).toEqual({ code: "PT403", vinculos: 0 });
    });
  });
});

describe("idempotencia · reintento con el mismo clientRequestId", () => {
  it.each<Status>(["recibido", "pedido"])("compra %s reenviada: mismo documento, 1 vínculo, 1 empaque, 1 entrada de historial y el stock no se repite", async (status) => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("reintento");
      const key = randomUUID();
      const lines: Line[] = [{ product: p, costRef: 2, pack: { label: "Bulto", count: 2, unitsPerPack: 12 } }];

      const first = await purchase(supplier, lines, { status, clientRequestId: key });
      const second = await purchase(supplier, lines, { status, clientRequestId: key });

      expect({ codes: [first.code, second.code], mismo: first.rows[0]?.id === second.rows[0]?.id, filas: await counts(supplier, [p]) }).toEqual({
        codes: [null, null],
        mismo: true,
        filas: { compras: 1, lineas: 1, movimientos: status === "recibido" ? 1 : 0, vinculos: 1, empaques: 1, historial: 1 },
      });
    });
  });

  it("la misma clave con otro contenido: PT409 y el vínculo de la primera no cambia", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("otra-huella");
      const key = randomUUID();
      await purchase(supplier, [{ product: p, costRef: 2, quantity: 1 }], { clientRequestId: key });
      const before = await links(p);

      const other = await purchase(supplier, [{ product: p, costRef: 5, quantity: 3 }], { clientRequestId: key });

      expect({ code: other.code, vinculos: await links(p) }).toEqual({ code: "PT409", vinculos: before });
    });
  });
});

describe("semántica monetaria y de stock · mismo resultado que la versión de 20261009d", () => {
  type Case = { name: string; on: "loose" | "unit" | "pack"; status: Status; line: Omit<Line, "product">; linked: boolean };

  const CASES: Case[] = [
    { name: "unidad, recibida, no vinculado", on: "loose", status: "recibido", line: { costRef: 2.35, quantity: 7, taxRate: 16 }, linked: false },
    { name: "unidad, recibida, ya vinculado", on: "loose", status: "recibido", line: { costRef: 2.35, quantity: 7, taxRate: 16 }, linked: true },
    { name: "empaque (camino antiguo: producto sin receta), recibida", on: "loose", status: "recibido", line: { costRef: 1.5, pack: { label: "Bulto", count: 3, unitsPerPack: 10 } }, linked: false },
    { name: "empaque sobre la unidad de un par, recibida", on: "unit", status: "recibido", line: { costRef: 1.5, pack: { label: "Caja", count: 3, unitsPerPack: 12 } }, linked: false },
    { name: "empaque sobre el producto empaque de un par, recibida", on: "pack", status: "recibido", line: { costRef: 1.5, pack: { label: "Caja", count: 3, unitsPerPack: 12 } }, linked: false },
    { name: "empaque con unidades que no son las del par (PT400)", on: "unit", status: "recibido", line: { costRef: 1.5, pack: { label: "Caja", count: 3, unitsPerPack: 10 } }, linked: false },
    { name: "empaque, en pedido, no vinculado", on: "loose", status: "pedido", line: { costRef: 1.5, pack: { label: "Bulto", count: 3, unitsPerPack: 10 }, taxRate: 8 }, linked: false },
    { name: "unidad, en pedido, ya vinculado", on: "loose", status: "pedido", line: { costRef: 4, quantity: 2 }, linked: true },
  ];

  it.each(CASES)("$name: mismas líneas, quantity_delta, costo del producto y totales", async ({ on, status, line, linked }) => {
    await withRollback(db, async () => {
      await sql("create_purchase de 20261009d", functionOf(PREVIOUS_PATCH, PREVIOUS_NAME));
      const supplier = await contact("A");
      const build = async (): Promise<string> => {
        const [pack, unit, loose] = [await product("d-pack", "20.00"), await product("d-unit", "2.00"), await product("d-suelto", "2.00")];
        await pair(pack, unit, 12);
        const target = { unit, pack, loose }[on];
        if (linked) {
          await sql("vínculo previo", "insert into public.supplier_products (store_id, supplier_id, product_id, last_cost_ref, last_cost_ves) values ($1, $2, $3, 1, 100)", [
            lab.storeId,
            supplier,
            target,
          ]);
        }
        return target;
      };
      const [before, after] = [await build(), await build()];

      const old = await purchase(supplier, [{ ...line, product: before }], { status, previous: true });
      const current = await purchase(supplier, [{ ...line, product: after }], { status });

      expect({ code: current.code, message: current.message, huella: await footprint(after) }).toEqual({
        code: old.code,
        message: old.message,
        huella: await footprint(before),
      });
      expect(await integrity([before, after])).toEqual({});
    });
  });

  it("modo empaque por el camino antiguo (3 bultos x 10): entra un movimiento 'compra' de +30 unidades, igual que antes", async () => {
    await withRollback(db, async () => {
      const supplier = await contact("A");
      const p = await product("camino-antiguo");

      await purchase(supplier, [{ product: p, costRef: 1.5, pack: { label: "Bulto", count: 3, unitsPerPack: 10 } }]);

      expect((await footprint(p)).movimientos).toEqual([{ type: "compra", quantity_delta: 30, stock_after: 30 }]);
    });
  });
});
