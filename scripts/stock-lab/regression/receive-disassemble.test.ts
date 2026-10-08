/** @jest-environment node */
/**
 * COM-14 · regresión del parche `20261010d-receive-disassemble.sql`: la línea de compra marcada «Desarmar al recibir» se
 * abre en los componentes de su receta en la MISMA transacción que la recibe (`receive_purchase_and_disassemble` para un
 * pedido; `create_purchase` para la compra que nace recibida), con el mismo stock, costo y movimientos que recibir y abrir
 * los empaques a mano; el reintento no desarma dos veces; un fallo no deja nada a medias; y una compra sin marca es la de
 * `20261010b`.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en `rollback`: los
 * datos se preparan como `postgres` y cada RPC se ejecuta con `set local role authenticated` + `request.jwt.claims` del
 * usuario lab.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/receive-disassemble.test.ts
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
  /** Costo neto por unidad en REF (por empaque si el producto es un empaque con receta). */
  costRef: number;
  quantity?: number;
  pack?: { label: string; count: number; unitsPerPack: number };
  taxRate?: number;
  /** `true` / `false` viajan en el payload; sin valor, la clave no va (cliente anterior). */
  disassemble?: unknown;
};

type Options = { status?: Status; clientRequestId?: string; previous?: boolean; role?: LabRoleKey };
type Component = { id: string; units: number; weight?: number };
type Distribution = { item: string; components?: Array<{ unit_product_id: string; units: number }> | null };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261010d-receive-disassemble.sql";
const PREVIOUS_PATCH = "20261010b-purchase-inactive-product.sql";
const PREVIOUS_NAME = "create_purchase_20261010b";
const TAG = `COM14-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const RATE = 100;
const ROLE: LabRoleKey = "almacen";

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

/** Ejecuta `text` en un savepoint con el rol indicado. Devuelve el error (SQLSTATE + mensaje) en vez de lanzarlo. */
async function run(text: string, params: unknown[] = [], role: LabRoleKey = ROLE): Promise<Outcome> {
  await db.query("savepoint com14");
  try {
    await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint com14");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint com14");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

async function must(what: string, out: Promise<Outcome>): Promise<Row[]> {
  const result = await out;
  if (result.code !== null) throw new Error(`SETUP · ${what}: ${result.code} ${result.message}`);
  return result.rows;
}

/** La definición de `name` en un parche, instalable con otro nombre. */
function functionOf(patch: string, name: string, installAs: string = name): string {
  const text = readFileSync(resolve(PATCHES, patch), "utf8");
  const match = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`).exec(text);
  if (!match) throw new Error(`SETUP · ${patch} no define ${name}`);
  return match[0].replace(`function public.${name}(`, `function public.${installAs}(`);
}

/** Producto propio creado como `postgres`; el stock entra con un movimiento `inventario_inicial`. */
async function product(label: string, options: { cost?: string; stock?: number; active?: boolean } = {}): Promise<string> {
  seq += 1;
  const name = `${TAG}-${label}-${seq}`;
  const row = await one(
    `producto ${name}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, lower($2), $2, 9, $3::numeric, 0, 0, $4) returning id`,
    [lab.storeId, name, options.cost ?? "1.00", options.active ?? true],
  );
  const id = String(row.id);
  if ((options.stock ?? 0) > 0) {
    await sql(
      `stock inicial de ${name}`,
      "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'inventario_inicial', $2, $3, $4)",
      [id, options.stock, TAG, lab.storeId],
    );
  }
  return id;
}

async function supplier(): Promise<string> {
  seq += 1;
  const row = await one("proveedor", "insert into public.contacts (store_id, type, name, is_active) values ($1, 'proveedor', $2, true) returning id", [
    lab.storeId,
    `${TAG}-proveedor-${seq}`,
  ]);
  return String(row.id);
}

/** Receta activa del empaque: un componente (par de siempre) o varios (surtido). Devuelve el id de la cabecera. */
async function recipe(pack: string, components: readonly Component[]): Promise<string> {
  const id = randomUUID();
  const total = components.reduce((sum, component) => sum + component.units, 0);
  await sql(`cabecera de receta x${total}`, "insert into public.product_pack_conversions (id, store_id, pack_product_id, total_units, label, is_active) values ($1, $2, $3, $4, $5, true)", [
    id,
    lab.storeId,
    pack,
    total,
    TAG,
  ]);
  for (const component of components) {
    await sql(
      "componente de receta",
      "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight) values ($1, $2, $3, $4, $5::numeric)",
      [id, lab.storeId, component.id, component.units, String(component.weight ?? 1)],
    );
  }
  return id;
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
    ...(line.disassemble !== undefined ? { disassemble_on_receive: line.disassemble } : {}),
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

/** `create_purchase` (vigente, o la de 20261010b instalada con otro nombre). */
function purchase(supplierId: string, lines: readonly Line[], options: Options = {}): Promise<Outcome> {
  const items = lines.map(item);
  const subtotalRef = round2(items.reduce((sum, row) => sum + Number(row.subtotal_ref), 0));
  const taxRef = round2(items.reduce((sum, row) => sum + Number(row.tax_ref), 0));

  return run(
    `select id, purchase_number, status from public.${options.previous ? PREVIOUS_NAME : "create_purchase"}(
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
    options.role,
  );
}

/** Pedido creado sin error; devuelve su id. */
async function order(supplierId: string, lines: readonly Line[]): Promise<string> {
  const rows = await must("pedido", purchase(supplierId, lines, { status: "pedido" }));
  return String(rows[0]?.id);
}

/** `receive_purchase_and_disassemble`. `disassemble` undefined = sin lista (manda la marca de la línea). */
function receive(purchaseId: string, options: { disassemble?: readonly Distribution[] | unknown; key?: string; role?: LabRoleKey } = {}): Promise<Outcome> {
  const list = Array.isArray(options.disassemble)
    ? (options.disassemble as Distribution[]).map((entry) =>
        "item" in entry ? { purchase_item_id: entry.item, ...(entry.components !== undefined ? { components: entry.components } : {}) } : entry,
      )
    : options.disassemble;

  return run(
    "select id, status from public.receive_purchase_and_disassemble($1::uuid, $2::jsonb, $3::uuid)",
    [purchaseId, list === undefined ? null : JSON.stringify(list), options.key ?? null],
    options.role,
  );
}

function receivePlain(purchaseId: string): Promise<Outcome> {
  return run("select id, status from public.receive_purchase($1::uuid)", [purchaseId]);
}

function convert(pack: string, quantity: number, components?: Array<{ unit_product_id: string; units: number }>): Promise<Outcome> {
  return run("select public.convert_pack_to_units($1::uuid, $2::integer, $3, null, $4::jsonb) as result", [
    pack,
    quantity,
    TAG,
    components ? JSON.stringify(components) : null,
  ]);
}

/** Líneas de la compra, en orden de producto: id, marca y si se desarmó. */
async function lineRows(purchaseId: string): Promise<Array<{ id: string; product: string; marca: boolean; desarmada: boolean }>> {
  const rows = await sql(
    "líneas de la compra",
    `select id, product_id, disassemble_on_receive, disassembled_conversion_id is not null as desarmada
     from public.purchase_items where purchase_id = $1 order by product_id, id`,
    [purchaseId],
  );
  return rows.map((row) => ({ id: String(row.id), product: String(row.product_id), marca: row.disassemble_on_receive === true, desarmada: row.desarmada === true }));
}

async function lineId(purchaseId: string, productId: string): Promise<string> {
  const found = (await lineRows(purchaseId)).find((line) => line.product === productId);
  if (!found) throw new Error("SETUP · la compra no tiene línea de ese producto");
  return found.id;
}

/** Stock, costo y libro (tipo, delta y saldo, en orden) de cada producto. */
async function state(ids: readonly string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (const id of ids) {
    out.push(
      await one(
        "estado del producto",
        `select p.current_stock as stock, p.current_cost_ref::text as costo,
                coalesce((select jsonb_agg(jsonb_build_object('type', m.type, 'delta', m.quantity_delta, 'after', m.stock_after) order by m.seq)
                          from public.stock_movements m where m.product_id = p.id), '[]'::jsonb) as movimientos
         from public.products p where p.id = $1`,
        [id],
      ),
    );
  }
  return out;
}

async function purchaseStatus(purchaseId: string): Promise<string> {
  return String((await one("estado de la compra", "select status from public.purchases where id = $1", [purchaseId])).status);
}

/** Lo que deja la compra en el producto, sin ids, números de documento ni fechas. */
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
       (select jsonb_agg(jsonb_build_object('activo', sp.is_active, 'costo', sp.last_cost_ref, 'costo_ves', sp.last_cost_ves, 'comprado', sp.last_purchased_at is not null))
        from public.supplier_products sp where sp.product_id = $1) as vinculos`,
    [productId],
  );
}

/** Vistas de integridad con filas para esos productos (vacío = cuadra). */
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

async function report(): Promise<Record<string, number>> {
  const row = await one("informe de integridad", "select public.stock_integrity_report($1::uuid) as report", [lab.storeId]);
  return row.report as Record<string, number>;
}

/** Empaque con receta de un componente (caja de `units`), con stock y costo previos en la unidad. */
async function boxOf(units: number, options: { packCost?: string; unitCost?: string; unitStock?: number } = {}): Promise<{ pack: string; unit: string; recipeId: string }> {
  const pack = await product("caja", { cost: options.packCost ?? "1.00" });
  const unit = await product("unidad", { cost: options.unitCost ?? "1.00", stock: options.unitStock ?? 0 });
  return { pack, unit, recipeId: await recipe(pack, [{ id: unit, units }]) };
}

/** Empaque surtido de 3 componentes (5 + 4 + 3 = 12) con pesos de costo distintos. */
async function assortment(): Promise<{ pack: string; a: string; b: string; c: string }> {
  const pack = await product("surtido", { cost: "1.00" });
  const [a, b, c] = [await product("sabor-a", { cost: "0.90", stock: 7 }), await product("sabor-b", { cost: "1.40" }), await product("sabor-c", { cost: "2.00", stock: 2 })];
  await recipe(pack, [
    { id: a, units: 5 },
    { id: b, units: 4, weight: 1.5 },
    { id: c, units: 3, weight: 2 },
  ]);
  return { pack, a, b, c };
}

beforeAll(async () => {
  lab = await Lab.open("com14");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261010d · forma del parche y de las funciones", () => {
  it("el parche es una transacción que define create_purchase, la RPC de recepción y sus 4 funciones internas, y recarga PostgREST", () => {
    const text = readFileSync(resolve(PATCHES, PATCH), "utf8");

    expect({
      begins: text.match(/^begin;\r?$/gm)?.length,
      commits: text.match(/^commit;\r?$/gm)?.length,
      funciones: text.match(/^create or replace function public\.(\w+)/gm)?.map((line) => line.replace("create or replace function public.", "")),
      notify: /^notify pgrst, 'reload schema';\r?$/m.test(text),
      redefine: /function public\.(receive_purchase|convert_pack_to_units)\(/.test(text),
    }).toEqual({
      begins: 1,
      commits: 1,
      funciones: [
        "purchase_disassemble_request_id",
        "purchase_disassemble_missing_recipes",
        "purchase_disassemble_lock",
        "purchase_disassemble_lines",
        "create_purchase",
        "receive_purchase_and_disassemble",
      ],
      notify: true,
      redefine: false,
    });
  });

  it("create_purchase es la de 20261010b más el desarme: no se pierde ninguna línea y sigue con una firma de 14 argumentos", async () => {
    const lines = (patch: string): string[] =>
      functionOf(patch, "create_purchase")
        .split(/\r?\n/)
        // Sin la coma final: dos líneas dejaron de ser las últimas de su lista.
        .map((line) => line.trim().replace(/,$/, ""));
    const [previous, current] = [lines(PREVIOUS_PATCH), lines(PATCH)];
    const kept = new Set(current);
    const known = new Set(previous);
    const added = current.filter((line) => !known.has(line) && !line.startsWith("--") && line !== "");
    const body = current.join("\n");
    const shape = await one(
      "forma de create_purchase",
      `select count(*)::int as firmas, bool_and(p.pronargs = 14 and p.prosecdef) as definer,
              bool_and(p.prosrc not ilike '%current_stock%') as sin_stock
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'`,
    );

    expect(previous.filter((line) => !kept.has(line))).toEqual([]);
    expect(added.filter((line) => /disassemble/.test(line)).length).toBeGreaterThanOrEqual(8);
    expect(body.indexOf("purchase_idempotent_replay")).toBeLessThan(body.indexOf("perform public.purchase_disassemble_lock("));
    expect(body.indexOf("and p.is_active is not true;")).toBeLessThan(body.indexOf("public.purchase_disassemble_missing_recipes("));
    expect(body.indexOf("public.purchase_disassemble_missing_recipes(")).toBeLessThan(body.indexOf("insert into public.purchase_items ("));
    expect(body.indexOf("perform public.purchase_disassemble_lines(v_purchase.id, null);")).toBeGreaterThan(body.indexOf("total_ves = v_total_ves"));
    expect(shape).toEqual({ firmas: 1, definer: true, sin_stock: true });
  });

  it("orden de bloqueos: cabeceras de receta y todos los productos por id ANTES de recibir (RPC) y antes del bloqueo de productos de create_purchase", () => {
    const wrapper = functionOf(PATCH, "receive_purchase_and_disassemble");
    const create = functionOf(PATCH, "create_purchase");
    const lock = functionOf(PATCH, "purchase_disassemble_lock");

    expect(wrapper.indexOf("for update;")).toBeLessThan(wrapper.indexOf("perform public.purchase_disassemble_lock("));
    expect(wrapper.indexOf("perform public.purchase_disassemble_lock(")).toBeLessThan(wrapper.indexOf("v_purchase := public.receive_purchase(p_purchase_id);"));
    expect(wrapper.indexOf("v_purchase := public.receive_purchase(p_purchase_id);")).toBeLessThan(wrapper.indexOf("perform public.purchase_disassemble_lines("));
    expect(create.indexOf("perform public.purchase_disassemble_lock(")).toBeGreaterThan(create.indexOf("insert into public.purchases ("));
    expect(create.indexOf("perform public.purchase_disassemble_lock(")).toBeLessThan(create.indexOf("where id = any(v_product_ids)"));
    expect(lock.indexOf("from public.product_pack_conversions c")).toBeLessThan(lock.indexOf("from public.products"));
    expect(lock.match(/order by (c\.)?id\s+for update;/g)).toHaveLength(2);
  });

  it("la RPC es security definer para authenticated / service_role; las internas no las ejecuta PostgREST; ninguna escribe el stock del producto", async () => {
    const rows = await sql(
      "forma de las funciones",
      `select p.proname as nombre, p.prosecdef as definer, coalesce(p.proconfig @> array['search_path=public'], false) as search_path,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              p.prosrc ilike '%current_stock%' as toca_stock
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('receive_purchase_and_disassemble', 'purchase_disassemble_lines', 'purchase_disassemble_lock',
                           'purchase_disassemble_missing_recipes', 'purchase_disassemble_request_id')
       order by p.proname`,
    );

    expect(rows).toEqual([
      { nombre: "purchase_disassemble_lines", definer: true, search_path: true, authenticated: false, anon: false, toca_stock: false },
      { nombre: "purchase_disassemble_lock", definer: true, search_path: true, authenticated: false, anon: false, toca_stock: false },
      { nombre: "purchase_disassemble_missing_recipes", definer: true, search_path: true, authenticated: false, anon: false, toca_stock: false },
      { nombre: "purchase_disassemble_request_id", definer: false, search_path: true, authenticated: false, anon: false, toca_stock: false },
      { nombre: "receive_purchase_and_disassemble", definer: true, search_path: true, authenticated: true, anon: false, toca_stock: false },
    ]);
  });
});

describe("pedido con línea marcada · recibir desarma en la misma transacción", () => {
  it("el empaque entra y sale (neto 0), la unidad sube empaques × unidades, la línea queda desarmada y las vistas en 0", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6, { unitCost: "1.00", unitStock: 4 });
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }]);
      const antes = { lineas: await lineRows(id), estado: await state([pack, unit]) };

      const out = await receive(id);

      // 3 cajas a 9,00 = 27,00 sobre 18 unidades; promedio con las 4 que había a 1,00: (4 + 27) / 22 = 1,41.
      expect(antes).toMatchObject({ lineas: [{ marca: true, desarmada: false }], estado: [{ stock: 0, movimientos: [] }, { stock: 4 }] });
      expect({ code: out.code, status: out.rows[0]?.status, lineas: await lineRows(id), estado: await state([pack, unit]), vistas: await integrity([pack, unit]) }).toEqual({
        code: null,
        status: "recibido",
        lineas: [{ id: antes.lineas[0]?.id, product: pack, marca: true, desarmada: true }],
        estado: [
          {
            stock: 0,
            costo: "9.00",
            movimientos: [
              { type: "compra", delta: 3, after: 3 },
              { type: "conversion_salida", delta: -3, after: 0 },
            ],
          },
          {
            stock: 22,
            costo: "1.41",
            movimientos: [
              { type: "inventario_inicial", delta: 4, after: 4 },
              { type: "conversion_entrada", delta: 18, after: 22 },
            ],
          },
        ],
        vistas: {},
      });
    });
  });

  it("la apertura queda ligada a la línea: su conversion_id es el de los dos movimientos y lleva la clave derivada de la línea", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(12);
      const id = await order(s, [{ product: pack, costRef: 6, quantity: 2, disassemble: true }]);
      await must("recibir", receive(id));

      const row = await one(
        "apertura de la línea",
        `select (select count(*)::int from public.stock_movements m where m.conversion_id = pi.disassembled_conversion_id and m.product_id = any($2::uuid[])) as movimientos,
                (select k.operation from public.stock_request_keys k where k.client_request_id = public.purchase_disassemble_request_id(pi.id)) as clave,
                (select min(m.reason) from public.stock_movements m where m.conversion_id = pi.disassembled_conversion_id) like 'Desarme al recibir C-%' as motivo
         from public.purchase_items pi where pi.purchase_id = $1`,
        [id, [pack, unit]],
      );

      expect(row).toEqual({ movimientos: 2, clave: "convert_pack_to_units", motivo: true });
    });
  });

  it.each([
    ["caja de un componente, con IVA y stock previo en la unidad", false],
    ["surtido de 3 componentes con pesos de costo", true],
  ])("diferencial · %s: mismo stock, costo y movimientos que recibir y abrir los empaques a mano", async (_title, assorted) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const build = async (): Promise<string[]> => {
        if (assorted) {
          const kit = await assortment();
          return [kit.pack, kit.a, kit.b, kit.c];
        }
        const box = await boxOf(24, { unitCost: "0.37", unitStock: 11 });
        return [box.pack, box.unit];
      };
      const [auto, manual] = [await build(), await build()];
      const line = (pack: string, disassemble?: boolean): Line => ({ product: pack, costRef: 7.77, quantity: 5, taxRate: 16, disassemble });

      const idAuto = await order(s, [line(auto[0] as string, true)]);
      const idManual = await order(s, [line(manual[0] as string)]);
      const received = await receive(idAuto);
      await must("recibir a mano", receivePlain(idManual));
      await must("abrir a mano", convert(manual[0] as string, 5));

      expect(received.code).toBeNull();
      expect(await state(auto)).toEqual(await state(manual));
      expect((await state(auto))[0]).toMatchObject({ stock: 0, costo: "9.01" });
      expect(await integrity([...auto, ...manual])).toEqual({});
    });
  });

  it("varias líneas: solo se abren las marcadas; la línea normal y la del componente comprado aparte entran como siempre", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const otra = await boxOf(10);
      const suelto = await product("suelto");
      const id = await order(s, [
        { product: pack, costRef: 12, quantity: 2, disassemble: true },
        { product: unit, costRef: 3, quantity: 5 },
        { product: otra.pack, costRef: 20, quantity: 1 },
        { product: suelto, costRef: 1.5, quantity: 4 },
      ]);

      const out = await receive(id);
      const [packState, unitState, otraPack, otraUnit, sueltoState] = await state([pack, unit, otra.pack, otra.unit, suelto]);

      // La unidad recibe su compra (5 a 3,00) y después la apertura: (5 × 3 + 24) / 17 = 2,29.
      expect(out.code).toBeNull();
      expect({ stock: packState?.stock, unidad: [unitState?.stock, unitState?.costo], otra: [otraPack?.stock, otraUnit?.stock], suelto: sueltoState?.stock }).toEqual({
        stock: 0,
        unidad: [17, "2.29"],
        otra: [1, 0],
        suelto: 4,
      });
      expect((await lineRows(id)).map((line) => line.desarmada).filter(Boolean)).toHaveLength(1);
      expect(await integrity([pack, unit, otra.pack, otra.unit, suelto])).toEqual({});
    });
  });

  it("línea por empaque sobre el producto EMPAQUE (se guarda por unidad): se abren los empaques de la línea", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 1.5, pack: { label: "Caja", count: 4, unitsPerPack: 6 }, disassemble: true }]);

      const out = await receive(id);

      expect(out.code).toBeNull();
      expect((await state([pack, unit])).map((row) => [row.stock, row.costo])).toEqual([
        [0, "9.00"],
        [24, "1.50"],
      ]);
    });
  });
});

describe("surtido · reparto ajustado en la confirmación", () => {
  it("el reparto enviado es el que entra, con el mismo resultado que abrir a mano con ese reparto", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const [auto, manual] = [await assortment(), await assortment()];
      const reparto = (kit: { a: string; b: string; c: string }) => [
        { unit_product_id: kit.a, units: 10 },
        { unit_product_id: kit.b, units: 0 },
        { unit_product_id: kit.c, units: 14 },
      ];
      const idAuto = await order(s, [{ product: auto.pack, costRef: 10, quantity: 2, disassemble: true }]);
      const idManual = await order(s, [{ product: manual.pack, costRef: 10, quantity: 2 }]);

      const out = await receive(idAuto, { disassemble: [{ item: await lineId(idAuto, auto.pack), components: reparto(auto) }] });
      await must("recibir a mano", receivePlain(idManual));
      await must("abrir a mano con reparto", convert(manual.pack, 2, reparto(manual)));

      const [autoState, manualState] = [await state([auto.pack, auto.a, auto.b, auto.c]), await state([manual.pack, manual.a, manual.b, manual.c])];

      expect(out.code).toBeNull();
      expect(autoState).toEqual(manualState);
      expect(autoState.map((row) => row.stock)).toEqual([0, 17, 0, 16]);
      expect(await integrity([auto.pack, auto.a, auto.b, auto.c])).toEqual({});
    });
  });

  it("un reparto que no suma las unidades de los empaques: PT400 y NADA recibido (la compra sigue en pedido, sin movimientos)", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const kit = await assortment();
      const ids = [kit.pack, kit.a, kit.b, kit.c];
      const id = await order(s, [{ product: kit.pack, costRef: 10, quantity: 2, disassemble: true }]);
      const antes = await state(ids);

      const out = await receive(id, { disassemble: [{ item: await lineId(id, kit.pack), components: [{ unit_product_id: kit.a, units: 5 }] }] });

      expect({ code: out.code, status: await purchaseStatus(id), estado: await state(ids), lineas: (await lineRows(id)).map((line) => line.desarmada) }).toEqual({
        code: "PT400",
        status: "pedido",
        estado: antes,
        lineas: [false],
      });
      expect(out.message).toBe("La distribucion debe sumar 24 unidades (2 empaques x 12) y suma 5");
    });
  });
});

describe("la lista de la confirmación manda sobre la marca del pedido", () => {
  it("[] = no desarmar ninguna: la línea marcada entra como empaque y queda desmarcada", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }]);

      const out = await receive(id, { disassemble: [] });

      expect({ code: out.code, lineas: (await lineRows(id)).map((line) => [line.marca, line.desarmada]), stock: (await state([pack, unit])).map((row) => row.stock) }).toEqual({
        code: null,
        lineas: [[false, false]],
        stock: [3, 0],
      });
    });
  });

  it("una línea SIN marca incluida en la lista se desarma y queda marcada; la marcada que no va en la lista, no", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const [uno, dos] = [await boxOf(6), await boxOf(8)];
      const id = await order(s, [
        { product: uno.pack, costRef: 9, quantity: 1, disassemble: true },
        { product: dos.pack, costRef: 9, quantity: 2 },
      ]);

      const out = await receive(id, { disassemble: [{ item: await lineId(id, dos.pack) }] });
      const lineas = await lineRows(id);

      expect(out.code).toBeNull();
      expect({
        uno: lineas.filter((line) => line.product === uno.pack).map((line) => [line.marca, line.desarmada]),
        dos: lineas.filter((line) => line.product === dos.pack).map((line) => [line.marca, line.desarmada]),
        stock: (await state([uno.pack, uno.unit, dos.pack, dos.unit])).map((row) => row.stock),
      }).toEqual({ uno: [[false, false]], dos: [[true, true]], stock: [1, 0, 0, 16] });
    });
  });

  it.each([
    ["no es una lista", { purchase_item_id: "x" }, "La lista de lineas a desarmar debe ser una lista"],
    ["elemento sin purchase_item_id", [{ components: null }], "Cada linea a desarmar requiere purchase_item_id"],
    ["línea de otra compra", [{ purchase_item_id: randomUUID() }], "Una linea a desarmar no pertenece a la compra"],
  ])("lista inválida (%s): PT400 y nada recibido", async (_title, list, message) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 1, disassemble: true }]);

      const out = await receive(id, { disassemble: list });

      expect({ code: out.code, message: out.message, status: await purchaseStatus(id) }).toEqual({ code: "PT400", message, status: "pedido" });
    });
  });

  it("la misma línea dos veces en la lista: PT400", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 1 }]);
      const line = await lineId(id, pack);

      const out = await receive(id, { disassemble: [{ item: line }, { item: line }] });

      expect({ code: out.code, message: out.message }).toEqual({ code: "PT400", message: "La lista de lineas a desarmar repite una linea" });
    });
  });

  it("marcar en la lista una línea cuyo producto no tiene receta: PT409 nombrando el producto y nada recibido", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const suelto = await product("sin-receta");
      const id = await order(s, [{ product: suelto, costRef: 2, quantity: 3 }]);

      const out = await receive(id, { disassemble: [{ item: await lineId(id, suelto) }] });

      expect({ code: out.code, status: await purchaseStatus(id), stock: (await state([suelto]))[0]?.stock }).toEqual({ code: "PT409", status: "pedido", stock: 0 });
      expect(out.message).toMatch(/^Sin receta de apertura activa: COM14-.*-sin-receta-\d+\. Desmarca «Desarmar al recibir» en esas líneas o activa su receta$/);
    });
  });
});

describe("idempotencia · reintentar o recibir dos veces no desarma dos veces", () => {
  it("misma clave y mismo contenido: devuelve la compra recibida y no deja ni un movimiento más", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }]);
      const key = randomUUID();

      const first = await receive(id, { key });
      const despues = await state([pack, unit]);
      const retry = await receive(id, { key });

      expect({ first: first.code, retry: retry.code, id: retry.rows[0]?.id, status: retry.rows[0]?.status, estado: await state([pack, unit]) }).toEqual({
        first: null,
        retry: null,
        id,
        status: "recibido",
        estado: despues,
      });
      expect(despues.map((row) => row.stock)).toEqual([0, 18]);
    });
  });

  it("la misma clave con otra lista: PT409 y nada cambia", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }]);
      const key = randomUUID();
      await must("recibir", receive(id, { key }));
      const despues = await state([pack, unit]);

      const out = await receive(id, { key, disassemble: [] });

      expect({ code: out.code, estado: await state([pack, unit]) }).toEqual({ code: "PT409", estado: despues });
      expect(out.message).toMatch(/^La clave de idempotencia ya se uso en otra recepcion de esta compra/);
    });
  });

  it.each([
    ["sin clave", false],
    ["con otra clave", true],
  ])("recibir dos veces %s: PT409 «Solo se pueden recibir compras en estado pedido» y sin doble desarme", async (_title, withKey) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }]);
      await must("recibir", receive(id, withKey ? { key: randomUUID() } : {}));
      const despues = await state([pack, unit]);

      const again = await receive(id, withKey ? { key: randomUUID() } : {});
      const plain = await receivePlain(id);

      expect({ again: [again.code, again.message], plain: plain.code, estado: await state([pack, unit]), vistas: await integrity([pack, unit]) }).toEqual({
        again: ["PT409", "Solo se pueden recibir compras en estado pedido"],
        plain: "PT409",
        estado: despues,
        vistas: {},
      });
    });
  });

  it("la clave de la apertura es de la línea: no admite otra apertura por este camino aunque se llame de nuevo a la función interna", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }]);
      await must("recibir", receive(id));
      await sql("otra compra del empaque", "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'ajuste_entrada', 3, $2, $3)", [pack, TAG, lab.storeId]);
      await sql("olvidar el desarme de la línea", "update public.purchase_items set disassembled_conversion_id = null where purchase_id = $1", [id]);
      const antes = await state([pack, unit]);

      const out = await run("select public.purchase_disassemble_lines($1::uuid, null)", [id]);

      // `authenticated` no ejecuta la función interna; como postgres, la clave derivada devuelve la apertura original.
      expect(out.code).toBe("42501");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: lab.uids[ROLE], role: "authenticated" })]);
      await sql("función interna como postgres", "select public.purchase_disassemble_lines($1::uuid, null)", [id]);
      expect(await state([pack, unit])).toEqual(antes);
    });
  });
});

describe("receta desactivada entre el pedido y la recepción · comportamiento definido y sin estado a medias", () => {
  it("recibir responde PT409 nombrando el producto y no recibe nada; con la línea desmarcada en la lista, la compra entra como empaque", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit, recipeId } = await boxOf(6);
      const otro = await product("otro");
      const id = await order(s, [
        { product: pack, costRef: 9, quantity: 3, disassemble: true },
        { product: otro, costRef: 2, quantity: 5 },
      ]);
      await sql("desactivar receta", "update public.product_pack_conversions set is_active = false where id = $1", [recipeId]);
      const antes = await state([pack, unit, otro]);

      const blocked = await receive(id);
      const trasFallo = { status: await purchaseStatus(id), estado: await state([pack, unit, otro]) };
      const received = await receive(id, { disassemble: [] });

      expect({ code: blocked.code, trasFallo }).toEqual({ code: "PT409", trasFallo: { status: "pedido", estado: antes } });
      expect(blocked.message).toMatch(/^Sin receta de apertura activa: COM14-.*-caja-\d+\. Desmarca «Desarmar al recibir» en esas líneas o activa su receta$/);
      expect({ code: received.code, stock: (await state([pack, unit, otro])).map((row) => row.stock), vistas: await integrity([pack, unit, otro]) }).toEqual({
        code: null,
        stock: [3, 0, 5],
        vistas: {},
      });
    });
  });

  it("receta reemplazada por otra activa: se abre con la receta VIGENTE al recibir", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit, recipeId } = await boxOf(6);
      const nueva = await product("unidad-nueva");
      const id = await order(s, [{ product: pack, costRef: 8, quantity: 2, disassemble: true }]);
      await sql("desactivar receta", "update public.product_pack_conversions set is_active = false where id = $1", [recipeId]);
      await recipe(pack, [{ id: nueva, units: 4 }]);

      const out = await receive(id);

      expect({ code: out.code, stock: (await state([pack, unit, nueva])).map((row) => row.stock), vistas: await integrity([pack, unit, nueva]) }).toEqual({
        code: null,
        stock: [0, 0, 8],
        vistas: {},
      });
    });
  });

  it("producto empaque y componente desactivados después del pedido: se recibe y se abre igual (como receive_purchase y convert_pack_to_units)", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 1, disassemble: true }]);
      await sql("desactivar productos", "update public.products set is_active = false where id = any($1::uuid[])", [[pack, unit]]);

      const out = await receive(id);

      expect({ code: out.code, stock: (await state([pack, unit])).map((row) => row.stock) }).toEqual({ code: null, stock: [0, 6] });
    });
  });
});

describe("permisos y documento", () => {
  it.each<LabRoleKey>(["vendedor1", "contador"])("%s no recibe: PT403 y la compra sigue en pedido", async (role) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack } = await boxOf(6);
      const id = await order(s, [{ product: pack, costRef: 9, quantity: 1, disassemble: true }]);

      const out = await receive(id, { role });

      expect({ code: out.code, status: await purchaseStatus(id) }).toEqual({ code: "PT403", status: "pedido" });
    });
  });

  it("compra inexistente: PT404; pedido sin líneas marcadas y sin lista: se recibe igual que con receive_purchase", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const [a, b] = [await boxOf(6), await boxOf(6)];
      const idA = await order(s, [{ product: a.pack, costRef: 9, quantity: 3, taxRate: 16 }]);
      const idB = await order(s, [{ product: b.pack, costRef: 9, quantity: 3, taxRate: 16 }]);

      const missing = await receive(randomUUID());
      const viaWrapper = await receive(idA);
      await must("recibir a mano", receivePlain(idB));

      expect({ missing: missing.code, wrapper: viaWrapper.code }).toEqual({ missing: "PT404", wrapper: null });
      expect(await state([a.pack, a.unit])).toEqual(await state([b.pack, b.unit]));
      expect(await footprint(a.pack)).toEqual(await footprint(b.pack));
    });
  });
});

describe("create_purchase · compra que nace recibida con línea marcada", () => {
  it.each([
    ["caja de un componente", false],
    ["surtido", true],
  ])("diferencial · %s: una sola llamada deja lo mismo que crear la compra y abrir los empaques a mano", async (_title, assorted) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const build = async (): Promise<string[]> => {
        if (assorted) {
          const kit = await assortment();
          return [kit.pack, kit.a, kit.b, kit.c];
        }
        const box = await boxOf(12, { unitCost: "0.55", unitStock: 9 });
        return [box.pack, box.unit];
      };
      const [auto, manual] = [await build(), await build()];

      const out = await purchase(s, [{ product: auto[0] as string, costRef: 13.33, quantity: 4, taxRate: 16, disassemble: true }]);
      await must("compra a mano", purchase(s, [{ product: manual[0] as string, costRef: 13.33, quantity: 4, taxRate: 16 }]));
      await must("abrir a mano", convert(manual[0] as string, 4));

      expect({ code: out.code, status: out.rows[0]?.status }).toEqual({ code: null, status: "recibido" });
      expect(await state(auto)).toEqual(await state(manual));
      expect((await lineRows(String(out.rows[0]?.id))).map((line) => [line.marca, line.desarmada])).toEqual([[true, true]]);
      expect(await integrity([...auto, ...manual])).toEqual({});
    });
  });

  it("pedido con línea marcada: guarda la marca y no mueve stock", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);

      const out = await purchase(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }], { status: "pedido" });

      expect({ code: out.code, lineas: (await lineRows(String(out.rows[0]?.id))).map((line) => [line.marca, line.desarmada]), stock: (await state([pack, unit])).map((row) => row.stock) }).toEqual({
        code: null,
        lineas: [[true, false]],
        stock: [0, 0],
      });
    });
  });

  it.each<Status>(["recibido", "pedido"])("compra %s con una línea marcada cuyo producto no tiene receta activa: PT400 nombrándolo y nada creado", async (status) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit, recipeId } = await boxOf(6);
      const suelto = await product("sin-receta");
      await sql("desactivar receta", "update public.product_pack_conversions set is_active = false where id = $1", [recipeId]);

      const out = await purchase(
        s,
        [
          { product: pack, costRef: 9, quantity: 3, disassemble: true },
          { product: suelto, costRef: 2, quantity: 1, disassemble: true },
          { product: unit, costRef: 2, quantity: 1 },
        ],
        { status },
      );
      const filas = await one(
        "filas creadas",
        `select (select count(*)::int from public.purchases where supplier_id = $1) as compras,
                (select count(*)::int from public.stock_movements where product_id = any($2::uuid[])) as movimientos,
                (select count(*)::int from public.supplier_products where supplier_id = $1) as vinculos`,
        [s, [pack, unit, suelto]],
      );

      expect({ code: out.code, filas }).toEqual({ code: "PT400", filas: { compras: 0, movimientos: 0, vinculos: 0 } });
      expect(out.message).toMatch(/^Sin receta de apertura activa: COM14-.*-caja-\d+, COM14-.*-sin-receta-\d+\. No se puede marcar «Desarmar al recibir» en esas líneas$/);
    });
  });

  it.each([["texto", "true"], ["número", 1], ["null", null]])("marca que no es un booleano (%s): PT400 y nada creado", async (_title, value) => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack } = await boxOf(6);

      const out = await purchase(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: value }]);

      expect({ code: out.code, message: out.message }).toEqual({ code: "PT400", message: "Marca de desarmar al recibir invalida en item de compra" });
    });
  });

  it("reintento con la misma clave: la compra original y ni un movimiento más", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const clientRequestId = randomUUID();
      const lines: Line[] = [{ product: pack, costRef: 9, quantity: 3, disassemble: true }];

      const first = await purchase(s, lines, { clientRequestId });
      const despues = await state([pack, unit]);
      const retry = await purchase(s, lines, { clientRequestId });

      expect({ first: first.code, retry: retry.code, same: retry.rows[0]?.id === first.rows[0]?.id, estado: await state([pack, unit]) }).toEqual({
        first: null,
        retry: null,
        same: true,
        estado: despues,
      });
      expect(despues.map((row) => row.stock)).toEqual([0, 18]);
    });
  });

  it("recibir (por la RPC nueva o por receive_purchase) una compra que ya nació recibida y desarmada: PT409 y sin doble desarme", async () => {
    await withRollback(db, async () => {
      const s = await supplier();
      const { pack, unit } = await boxOf(6);
      const created = await must("compra", purchase(s, [{ product: pack, costRef: 9, quantity: 3, disassemble: true }]));
      const id = String(created[0]?.id);
      const despues = await state([pack, unit]);

      const [again, plain] = [await receive(id), await receivePlain(id)];

      expect({ again: again.code, plain: plain.code, estado: await state([pack, unit]) }).toEqual({ again: "PT409", plain: "PT409", estado: despues });
    });
  });
});

describe("payload sin marca · la compra de 20261010b", () => {
  it.each<Status>(["recibido", "pedido"])("compra %s (unidad, empaque, producto empaque e IVA): misma huella con la clave ausente, con false y con la versión de 20261010b", async (status) => {
    await withRollback(db, async () => {
      await sql("create_purchase de 20261010b", functionOf(PREVIOUS_PATCH, "create_purchase", PREVIOUS_NAME));
      const s = [await supplier(), await supplier(), await supplier()];
      const build = async (): Promise<string[]> => {
        const box = await boxOf(6, { unitStock: 3 });
        return [box.pack, box.unit, await product("suelto", { stock: 2 })];
      };
      const lines = (ids: string[], disassemble?: boolean): Line[] => [
        { product: ids[0] as string, costRef: 1.5, pack: { label: "Caja", count: 2, unitsPerPack: 6 }, taxRate: 16, disassemble },
        { product: ids[1] as string, costRef: 0.4, pack: { label: "Bulto", count: 3, unitsPerPack: 6 }, disassemble },
        { product: ids[2] as string, costRef: 3.33, quantity: 7, taxRate: 8, disassemble },
      ];
      const [absent, explicit, previous] = [await build(), await build(), await build()];

      const outs = [
        await purchase(s[0] as string, lines(absent), { status }),
        await purchase(s[1] as string, lines(explicit, false), { status }),
        await purchase(s[2] as string, lines(previous), { status, previous: true }),
      ];
      const prints = async (ids: string[]): Promise<Row[]> => {
        const out: Row[] = [];
        for (const id of ids) out.push(await footprint(id));
        return out;
      };

      expect(outs.map((out) => out.code)).toEqual([null, null, null]);
      expect(await prints(absent)).toEqual(await prints(previous));
      expect(await prints(explicit)).toEqual(await prints(previous));
      expect(await integrity([...absent, ...explicit, ...previous])).toEqual({});
    });
  });

  it("la huella de idempotencia de un payload sin marca es la de 20261010b: la clave usada con la versión anterior repite con la vigente", async () => {
    await withRollback(db, async () => {
      await sql("create_purchase de 20261010b", functionOf(PREVIOUS_PATCH, "create_purchase", PREVIOUS_NAME));
      const s = await supplier();
      const p = await product("suelto");
      const clientRequestId = randomUUID();
      const lines: Line[] = [{ product: p, costRef: 2, quantity: 5 }];

      const first = await purchase(s, lines, { clientRequestId, previous: true });
      const retry = await purchase(s, lines, { clientRequestId });

      expect({ first: first.code, retry: retry.code, same: retry.rows[0]?.id === first.rows[0]?.id, stock: (await state([p]))[0]?.stock }).toEqual({
        first: null,
        retry: null,
        same: true,
        stock: 5,
      });
    });
  });
});

describe("oráculo", () => {
  it("stock_integrity_report de la tienda lab no sube tras recibir desarmando un pedido y crear una compra recibida desarmada", async () => {
    await withRollback(db, async () => {
      const antes = await report();
      const s = await supplier();
      const box = await boxOf(6, { unitStock: 5 });
      const kit = await assortment();
      const id = await order(s, [
        { product: box.pack, costRef: 9, quantity: 3, disassemble: true },
        { product: kit.pack, costRef: 10, quantity: 2, disassemble: true },
      ]);
      await must("recibir", receive(id, { key: randomUUID() }));
      await must("compra recibida", purchase(s, [{ product: box.pack, costRef: 9.5, quantity: 1, disassemble: true }]));

      expect(await report()).toEqual(antes);
    });
  });
});
