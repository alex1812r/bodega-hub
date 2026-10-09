/** @jest-environment node */
/**
 * COM-15 · regresión del parche `20261010b-purchase-inactive-product.sql`: `create_purchase` rechaza con PT400 toda
 * compra (recibida o en pedido) con una línea de un producto inactivo, sin crear nada; `receive_purchase` sigue
 * recibiendo el pedido hecho antes de desactivar el producto; el reintento idempotente no cambia; y para productos
 * activos el resultado es el de la versión de `20261010a`.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en `rollback`:
 * los datos se preparan como `postgres` y cada compra se ejecuta con `set local role authenticated` +
 * `request.jwt.claims` del usuario lab. La carrera con la desactivación es real: dos conexiones y un producto y un
 * proveedor confirmados (sin stock ni documentos), que se borran al terminar.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/purchase-inactive-product.test.ts
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
};

type Options = { status?: Status; clientRequestId?: string; previous?: boolean };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261010b-purchase-inactive-product.sql";
const PREVIOUS_PATCH = "20261010a-purchase-auto-link.sql";
const PREVIOUS_NAME = "create_purchase_20261010a";
const TAG = `COM15-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const RATE = 100;
const ROLE: LabRoleKey = "almacen";
const NOTHING = { compras: 0, lineas: 0, movimientos: 0, vinculos: 0, empaques: 0, historial: 0 };

let lab: Lab;
let db: Client;
let other: Client;
let seq = 0;

const round2 = (value: number): number => Math.round(value * 100) / 100;

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

async function one(what: string, text: string, params: unknown[] = []): Promise<Row> {
  const rows = await sql(what, text, params);
  if (!rows[0]) throw new Error(`SETUP · ${what}: sin filas`);
  return rows[0];
}

/** Ejecuta `text` en un savepoint como almacén. Devuelve el error (SQLSTATE + mensaje) en vez de lanzarlo. */
async function run(text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint com15");
  try {
    await actAs(db, lab.uids[ROLE]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint com15");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint com15");
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

function productName(label: string): string {
  seq += 1;
  return `${TAG}-${label}-${seq}`;
}

async function product(label: string, options: { active?: boolean; cost?: string; storeId?: string } = {}): Promise<string> {
  const name = productName(label);
  const row = await one(
    `producto ${name}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, lower($2), $2, 9, $3::numeric, 0, 0, $4) returning id`,
    [options.storeId ?? lab.storeId, name, options.cost ?? "1.00", options.active ?? true],
  );
  return String(row.id);
}

async function deactivate(productId: string): Promise<void> {
  await sql("desactivar producto", "update public.products set is_active = false where id = $1", [productId]);
}

async function supplier(): Promise<string> {
  const row = await one("proveedor", "insert into public.contacts (store_id, type, name, is_active) values ($1, 'proveedor', $2, true) returning id", [
    lab.storeId,
    productName("proveedor"),
  ]);
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

function purchaseCall(supplierId: string, lines: readonly Line[], options: Options = {}): { text: string; params: unknown[] } {
  const items = lines.map(item);
  const subtotalRef = round2(items.reduce((sum, row) => sum + Number(row.subtotal_ref), 0));
  const taxRef = round2(items.reduce((sum, row) => sum + Number(row.tax_ref), 0));

  return {
    text: `select id, purchase_number from public.${options.previous ? PREVIOUS_NAME : "create_purchase"}(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0,
       p_tax_ref => $4::numeric, p_notes => $5, p_status => $6::public.purchase_status, p_discount_ves => 0,
       p_tax_ves => $7::numeric, p_subtotal_ves => $8::numeric, p_subtotal_ref => $9::numeric,
       p_client_request_id => $10::uuid)`,
    params: [
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
  };
}

/** `create_purchase` (vigente, o la de 20261010a instalada con otro nombre) como almacén. */
function purchase(supplierId: string, lines: readonly Line[], options: Options = {}): Promise<Outcome> {
  const { text, params } = purchaseCall(supplierId, lines, options);
  return run(text, params);
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

/** Stock, costo y libro del producto. */
function state(productId: string): Promise<Row> {
  return one(
    "estado del producto",
    `select p.current_stock as stock, p.current_cost_ref::text as costo, p.is_active as activo,
            coalesce((select jsonb_agg(jsonb_build_object('type', m.type, 'quantity_delta', m.quantity_delta, 'stock_after', m.stock_after) order by m.seq)
                      from public.stock_movements m where m.product_id = p.id), '[]'::jsonb) as movimientos
     from public.products p where p.id = $1`,
    [productId],
  );
}

/** Lo que deja la compra en el producto, sin ids, números de documento ni fechas: líneas, movimientos, producto, totales y vínculos. */
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
        from public.purchases pu where pu.id in (select purchase_id from public.purchase_items where product_id = $1)) as compras,
       (select jsonb_agg(jsonb_build_object(
                 'activo', sp.is_active, 'habitual', sp.is_preferred, 'costo', sp.last_cost_ref, 'costo_ves', sp.last_cost_ves,
                 'comprado', sp.last_purchased_at is not null,
                 'empaques', (select jsonb_agg(jsonb_build_object('label', u.label, 'units', u.units_per_pack, 'default', u.is_default) order by u.units_per_pack, u.label)
                              from public.supplier_product_pack_units u where u.supplier_product_id = sp.id),
                 'historial', (select jsonb_agg(format('%s:%s->%s', h.origin, coalesce(h.old_cost_ref::text, '-'), h.new_cost_ref::text) order by h.old_cost_ref nulls first, h.new_cost_ref, h.origin)
                               from public.supplier_product_price_history h where h.supplier_product_id = sp.id)))
        from public.supplier_products sp where sp.product_id = $1) as vinculos`,
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

/** Espera a que la conexión `pid` esté detenida en un bloqueo: la carrera queda montada, no supuesta. */
async function waitUntilBlocked(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await lab.rows("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("SETUP · la segunda conexión no llegó a esperar el bloqueo del producto");
}

/** `text` en su propia transacción de la conexión `other`, como almacén; termina siempre en `rollback`. */
async function runOnOther(text: string, params: unknown[]): Promise<Outcome> {
  await other.query("begin");
  try {
    await actAs(other, lab.uids[ROLE]);
    const res = await other.query<Row>(text, params);
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    return { rows: [], ...failure(error) };
  } finally {
    await other.query("rollback");
  }
}

beforeAll(async () => {
  lab = await Lab.open("com15");
  db = await lab.pg();
  other = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261010b · forma de la función", () => {
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
              bool_and(p.prosrc not ilike '%current_stock%') as sin_stock,
              bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as authenticated,
              bool_and(has_function_privilege('anon', p.oid, 'execute')) as anon
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'`,
    );

    expect(shape).toEqual({ firmas: 1, argumentos: true, definer: true, search_path: true, sin_stock: true, authenticated: true, anon: false });
  });

  it("es la función de 20261010a más la guarda: no se pierde ninguna línea y lo añadido va entre el bloqueo de los productos y el bucle de líneas", () => {
    const lines = (patch: string): string[] =>
      functionOf(patch, "create_purchase")
        .split(/\r?\n/)
        .map((line) => line.trim());
    const [previous, current] = [lines(PREVIOUS_PATCH), lines(PATCH)];
    const kept = new Set(current);
    const known = new Set(previous);
    const added = current.filter((line) => !known.has(line) && !line.startsWith("--"));
    const body = current.join("\n");

    expect(previous.filter((line) => !kept.has(line))).toEqual([]);
    expect(added).toEqual([
      "v_inactive_names text;",
      "v_inactive_count integer;",
      "select count(*), string_agg(p.name, ', ' order by p.name, p.id)",
      "into v_inactive_count, v_inactive_names",
      "from public.products p",
      "where p.id = any(v_product_ids)",
      "and p.store_id = v_store_id",
      "and p.is_active is not true;",
      "if v_inactive_count = 1 then",
      "message = format('El producto %s está inactivo: no se puede registrar la compra', v_inactive_names);",
      "elsif v_inactive_count > 1 then",
      "message = format('Los productos %s están inactivos: no se puede registrar la compra', v_inactive_names);",
    ]);
    expect(body.indexOf("order by id\nfor update;")).toBeGreaterThan(-1);
    expect(body.indexOf("and p.is_active is not true;")).toBeGreaterThan(body.indexOf("order by id\nfor update;"));
    expect(body.indexOf("and p.is_active is not true;")).toBeLessThan(body.indexOf("insert into public.purchase_items ("));
    expect(body.indexOf("purchase_idempotent_replay")).toBeLessThan(body.indexOf("and p.is_active is not true;"));
  });
});

describe("producto inactivo · PT400 y nada creado", () => {
  it.each<Status>(["recibido", "pedido"])("compra %s: PT400 en español nombrando el producto, 0 filas nuevas, stock, costo y libro intactos", async (status) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const p = await product("apagado", { active: false, cost: "3.00" });
      const before = await state(p);

      const out = await purchase(s, [{ product: p, costRef: 2, pack: { label: "Bulto", count: 2, unitsPerPack: 12 }, taxRate: 16 }], { status });

      expect({ code: out.code, filas: await counts(s, [p]), despues: await state(p), vistas: await integrity([p]) }).toEqual({
        code: "PT400",
        filas: NOTHING,
        despues: before,
        vistas: {},
      });
      expect(before).toEqual({ stock: 0, costo: "3.00", activo: false, movimientos: [] });
      expect(out.message).toMatch(/^El producto COM15-.*-apagado-\d+ está inactivo: no se puede registrar la compra$/);
    });
  });

  it("producto inactivo CON stock: la compra recibida no entra y el libro del producto no cambia", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const p = await product("con-stock");
      await purchase(s, [{ product: p, costRef: 2, quantity: 5 }]);
      await deactivate(p);
      const before = { estado: await state(p), filas: await counts(s, [p]) };

      const out = await purchase(s, [{ product: p, costRef: 4, quantity: 7 }]);

      expect({ code: out.code, estado: await state(p), filas: await counts(s, [p]), vistas: await integrity([p]) }).toEqual({ code: "PT400", ...before, vistas: {} });
      expect(before.estado).toMatchObject({ stock: 5, costo: "2.00", movimientos: [{ type: "compra", quantity_delta: 5, stock_after: 5 }] });
    });
  });

  it.each<Status>(["recibido", "pedido"])("compra %s con una línea inactiva entre líneas activas: se rechaza entera y las activas no quedan con línea, movimiento ni vínculo", async (status) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const [a, off, b] = [await product("activo-a"), await product("apagado", { active: false }), await product("activo-b")];

      const out = await purchase(
        s,
        [
          { product: a, costRef: 2, quantity: 1 },
          { product: off, costRef: 2, quantity: 1 },
          { product: b, costRef: 2, pack: { label: "Caja", count: 1, unitsPerPack: 6 } },
        ],
        { status },
      );

      expect({ code: out.code, filas: await counts(s, [a, off, b]), costos: [(await state(a)).costo, (await state(b)).costo] }).toEqual({
        code: "PT400",
        filas: NOTHING,
        costos: ["1.00", "1.00"],
      });
      expect(out.message).toMatch(/^El producto COM15-.*-apagado-\d+ está inactivo: no se puede registrar la compra$/);
    });
  });

  it("varios productos inactivos (uno repetido en dos líneas): el mensaje los nombra a todos, una vez y en orden alfabético", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const [z, a, on] = [await product("zeta", { active: false }), await product("alfa", { active: false }), await product("activo")];

      const out = await purchase(s, [
        { product: z, costRef: 2, quantity: 1 },
        { product: on, costRef: 2, quantity: 1 },
        { product: a, costRef: 2, quantity: 1 },
        { product: z, costRef: 2, quantity: 3 },
      ]);

      expect({ code: out.code, filas: await counts(s, [z, a, on]) }).toEqual({ code: "PT400", filas: NOTHING });
      expect(out.message).toMatch(/^Los productos COM15-.*-alfa-\d+, COM15-.*-zeta-\d+ están inactivos: no se puede registrar la compra$/);
    });
  });

  it("no cambia lo demás: producto inexistente o de otra tienda (activo o inactivo) sigue respondiendo PT404", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const foreign = await product("ajeno", { active: false, storeId: lab.defaultStoreId });

      const missing = await purchase(s, [{ product: randomUUID(), costRef: 2, quantity: 1 }]);
      const other = await purchase(s, [{ product: foreign, costRef: 2, quantity: 1 }]);

      expect({ codes: [missing.code, other.code], filas: await counts(s, [foreign]) }).toEqual({ codes: ["PT404", "PT404"], filas: NOTHING });
    });
  });
});

describe("pedido hecho antes de desactivar el producto · la recepción se permite", () => {
  it("pedido con el producto activo, se desactiva, se recibe: entra una vez, el libro cuadra y el producto sigue inactivo; un pedido NUEVO se rechaza", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const p = await product("en-camino");
      const ordered = await purchase(s, [{ product: p, costRef: 2, pack: { label: "Bulto", count: 2, unitsPerPack: 5 }, taxRate: 16 }], { status: "pedido" });
      await deactivate(p);

      const received = await run("select status::text as status from public.receive_purchase($1::uuid)", [ordered.rows[0]?.id]);
      const afterReceive = { estado: await state(p), filas: await counts(s, [p]) };
      const again = await run("select id from public.receive_purchase($1::uuid)", [ordered.rows[0]?.id]);
      const fresh = await purchase(s, [{ product: p, costRef: 2, quantity: 1 }], { status: "pedido" });

      expect({ codes: [ordered.code, received.code], status: received.rows[0]?.status, ...afterReceive, vistas: await integrity([p]) }).toEqual({
        codes: [null, null],
        status: "recibido",
        estado: { stock: 10, costo: "2.32", activo: false, movimientos: [{ type: "compra", quantity_delta: 10, stock_after: 10 }] },
        filas: { compras: 1, lineas: 1, movimientos: 1, vinculos: 1, empaques: 1, historial: 2 },
        vistas: {},
      });
      expect({ again: again.code !== null, fresh: fresh.code, estado: await state(p), filas: await counts(s, [p]) }).toEqual({
        again: true,
        fresh: "PT400",
        ...afterReceive,
      });
    });
  });
});

describe("idempotencia · el reintento no cambia", () => {
  it.each<Status>(["recibido", "pedido"])("compra %s reenviada con la misma clave tras desactivar el producto: devuelve la compra original sin repetir nada", async (status) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const p = await product("reintento");
      const key = randomUUID();
      const lines: Line[] = [{ product: p, costRef: 2, quantity: 4 }];
      const first = await purchase(s, lines, { status, clientRequestId: key });
      await deactivate(p);
      const before = { estado: await state(p), filas: await counts(s, [p]) };

      const retry = await purchase(s, lines, { status, clientRequestId: key });
      const fresh = await purchase(s, lines, { status, clientRequestId: randomUUID() });

      expect({ codes: [first.code, retry.code, fresh.code], mismo: first.rows[0]?.id === retry.rows[0]?.id, estado: await state(p), filas: await counts(s, [p]) }).toEqual({
        codes: [null, null, "PT400"],
        mismo: true,
        ...before,
      });
      expect(before.filas).toMatchObject({ compras: 1, lineas: 1, movimientos: status === "recibido" ? 1 : 0 });
    });
  });

  it("compra rechazada por producto inactivo y reenviada con la misma clave tras reactivarlo: la clave no quedó gastada y la compra entra una vez", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const p = await product("reactivado", { active: false });
      const key = randomUUID();
      const lines: Line[] = [{ product: p, costRef: 2, quantity: 4 }];

      const rejected = await purchase(s, lines, { clientRequestId: key });
      await sql("reactivar producto", "update public.products set is_active = true where id = $1", [p]);
      const accepted = await purchase(s, lines, { clientRequestId: key });
      const retry = await purchase(s, lines, { clientRequestId: key });

      expect({ codes: [rejected.code, accepted.code, retry.code], mismo: accepted.rows[0]?.id === retry.rows[0]?.id, stock: (await state(p)).stock }).toEqual({
        codes: ["PT400", null, null],
        mismo: true,
        stock: 4,
      });
    });
  });
});

describe("carrera con la desactivación · la guarda mira el producto ya bloqueado", () => {
  it("una compra que espera a una desactivación en curso ve el producto inactivo: PT400 y nada creado", async () => {
    const committed = { product: "", supplier: "" };
    try {
      committed.supplier = await supplier();
      committed.product = await product("carrera");
      const pid = Number((await sql("pid", "select pg_backend_pid() as pid", [], other))[0]?.pid);
      const { text, params } = purchaseCall(committed.supplier, [{ product: committed.product, costRef: 2, quantity: 3 }]);

      await db.query("begin");
      let pending: Promise<Outcome>;
      try {
        await db.query("select id from public.products where id = $1 for update", [committed.product]);
        pending = runOnOther(text, params);
        await waitUntilBlocked(pid);
        await db.query("update public.products set is_active = false where id = $1", [committed.product]);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
      const out = await pending;

      expect({ code: out.code, filas: await counts(committed.supplier, [committed.product]), estado: await state(committed.product) }).toEqual({
        code: "PT400",
        filas: NOTHING,
        estado: { stock: 0, costo: "1.00", activo: false, movimientos: [] },
      });
      expect(out.message).toMatch(/-carrera-\d+ está inactivo: no se puede registrar la compra$/);
    } finally {
      if (committed.product) await lab.rows("delete from public.products where id = $1", [committed.product]);
      if (committed.supplier) await lab.rows("delete from public.contacts where id = $1", [committed.supplier]);
    }
  });
});

describe("productos activos · mismo resultado que la versión de 20261010a", () => {
  type Case = { name: string; on: "loose" | "unit" | "pack"; status: Status; line: Omit<Line, "product">; linked: boolean };

  const CASES: Case[] = [
    { name: "unidad, recibida, no vinculado", on: "loose", status: "recibido", line: { costRef: 2.35, quantity: 7, taxRate: 16 }, linked: false },
    { name: "unidad, recibida, ya vinculado", on: "loose", status: "recibido", line: { costRef: 2.35, quantity: 7, taxRate: 16 }, linked: true },
    { name: "empaque (producto sin receta), recibida", on: "loose", status: "recibido", line: { costRef: 1.5, pack: { label: "Bulto", count: 3, unitsPerPack: 10 } }, linked: false },
    { name: "empaque sobre la unidad de un par, recibida", on: "unit", status: "recibido", line: { costRef: 1.5, pack: { label: "Caja", count: 3, unitsPerPack: 12 } }, linked: false },
    { name: "empaque sobre el producto empaque de un par, recibida", on: "pack", status: "recibido", line: { costRef: 1.5, pack: { label: "Caja", count: 3, unitsPerPack: 12 } }, linked: false },
    { name: "empaque con unidades que no son las del par (PT400)", on: "unit", status: "recibido", line: { costRef: 1.5, pack: { label: "Caja", count: 3, unitsPerPack: 10 } }, linked: false },
    { name: "empaque, en pedido, no vinculado", on: "loose", status: "pedido", line: { costRef: 1.5, pack: { label: "Bulto", count: 3, unitsPerPack: 10 }, taxRate: 8 }, linked: false },
    { name: "unidad, en pedido, ya vinculado", on: "loose", status: "pedido", line: { costRef: 4, quantity: 2 }, linked: true },
  ];

  it.each(CASES)("$name: mismas líneas, quantity_delta, costo del producto, totales y vínculo", async ({ on, status, line, linked }) => {
    await withRollback(db, async () => {
      await sql("create_purchase de 20261010a", functionOf(PREVIOUS_PATCH, PREVIOUS_NAME));
      const build = async (): Promise<{ supplierId: string; target: string }> => {
        const supplierId = await supplier();
        const [pack, unit, loose] = [await product("d-pack", { cost: "20.00" }), await product("d-unit", { cost: "2.00" }), await product("d-suelto", { cost: "2.00" })];
        await pair(pack, unit, 12);
        const target = { unit, pack, loose }[on];
        if (linked) {
          await sql("vínculo previo", "insert into public.supplier_products (store_id, supplier_id, product_id, last_cost_ref, last_cost_ves) values ($1, $2, $3, 1, 100)", [
            lab.storeId,
            supplierId,
            target,
          ]);
        }
        return { supplierId, target };
      };
      const [before, after] = [await build(), await build()];

      const old = await purchase(before.supplierId, [{ ...line, product: before.target }], { status, previous: true });
      const current = await purchase(after.supplierId, [{ ...line, product: after.target }], { status });

      expect({ code: current.code, message: current.message, huella: await footprint(after.target) }).toEqual({
        code: old.code,
        message: old.message,
        huella: await footprint(before.target),
      });
      expect(await integrity([before.target, after.target])).toEqual({});
    });
  });
});
