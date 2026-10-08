/** @jest-environment node */
/**
 * PRO-12 · regresión del parche `20261009d-assorted-pack.sql`: la conversión empaque → unidad pasa a RECETA
 * (cabecera `product_pack_conversions` + N `product_pack_components`), `convert_pack_to_units` acepta el reparto
 * real de la apertura (`p_components`) y reparte el costo por unidades × `cost_weight`.
 *
 * Cada test enuncia el comportamiento SANO. Casi todo corre por `pg` dentro de una transacción que termina en
 * `rollback`: los datos se preparan como `postgres` y cada sentencia probada se ejecuta con `set local role
 * authenticated` + `request.jwt.claims` del usuario (ACL y RLS de PostgREST). Tras cada sentencia se fuerzan las
 * restricciones diferidas (`set constraints all immediate`): es lo que pasa al confirmar una petición de PostgREST.
 * El último bloque sí pasa por PostgREST (datos confirmados que se borran al terminar): las llamadas y escrituras
 * que hace hoy el BFF, el commit real de una receta y la relación calculada `pack_role`.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/assorted-pack.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { INTEGRITY_VIEWS, Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };
/** Usuario lab, el admin de la otra tienda, sin sesión, o `null` = `postgres` (preparación). */
type Actor = LabRoleKey | "otherAdmin" | "anon" | null;
type Component = { id: string; units: number; weight?: number | string };
type Share = { unit_product_id: string; units: unknown };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261009d-assorted-pack.sql";
const PREVIOUS_CONVERT_PATCH = "20261006c-purchases-inventory-rpc-hardening.sql";
const PREVIOUS_PURCHASE_PATCH = "20261007a-tax-rates.sql";
const ORIGINAL_PATCH = "20260811-pack-unit-conversion.sql";
const OTHER_STORE_ADMIN_EMAIL = "admin@example.com";
const TAG = `PRO12-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
/** Tasa fija de las compras de prueba: los montos en Bs salen exactos. */
const RATE = 100;
const LEGACY_KEYS = ["conversionId", "packMovement", "packQuantity", "unitCostRef", "unitMovement", "unitQuantity", "unitsPerPack"];

let lab: Lab;
let db: Client;
let otherAdmin = "";
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
 * Ejecuta las sentencias en un savepoint como `actor` y, al final, fuerza las restricciones diferidas (el "commit"
 * de esa petición). Devuelve las filas de la última sentencia o el error (SQLSTATE + mensaje) sin lanzarlo, y deja
 * la transacción utilizable y en el rol de la sesión.
 */
async function runAll(actor: Actor, statements: ReadonlyArray<readonly [string, unknown[]?]>): Promise<Outcome> {
  await db.query("savepoint pro12");
  try {
    if (actor !== null) await actAs(db, actor === "anon" ? null : actor === "otherAdmin" ? otherAdmin : lab.uids[actor]);
    let rows: Row[] = [];
    for (const [text, params] of statements) rows = (await db.query<Row>(text, params ?? [])).rows;
    await db.query("set constraints all immediate");
    await db.query("set constraints all deferred");
    await db.query("reset role");
    await db.query("release savepoint pro12");
    return { rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint pro12");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

function run(actor: Actor, text: string, params: unknown[] = []): Promise<Outcome> {
  return runAll(actor, [[text, params]]);
}

async function must(actor: Actor, what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  const out = await run(actor, text, params);
  if (out.code !== null) throw new Error(`SETUP · ${what}: ${out.code} ${out.message}`);
  return out.rows;
}

/** El parche sin su `begin;` / `commit;` (para aplicarlo dentro de la transacción del test) ni el `notify`. */
function patchBody(): string {
  const text = readFileSync(resolve(PATCHES, PATCH), "utf8");
  const begins = text.match(/^begin;\r?$/gm)?.length ?? 0;
  const commits = text.match(/^commit;\r?$/gm)?.length ?? 0;
  if (begins !== 1 || commits !== 1) throw new Error(`SETUP · el parche debe tener un begin y un commit (${begins}/${commits})`);
  return text.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "").replace(/^notify pgrst.*$/m, "");
}

/** Texto de `create or replace function public.<name>(…) … $$;` de un parche, instalable con otro nombre. */
function functionOf(patch: string, name: string, installAs: string = name): string {
  const text = readFileSync(resolve(PATCHES, patch), "utf8");
  const match = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`).exec(text);
  if (!match) throw new Error(`SETUP · ${patch} no define ${name}`);
  return match[0].replace(`function public.${name}(`, `function public.${installAs}(`);
}

/** Producto propio creado como `postgres`; el stock entra con un movimiento `inventario_inicial` (lo aplica el trigger del libro). */
async function product(
  name: string,
  options: { cost?: string; stock?: number; storeId?: string; isActive?: boolean } = {},
): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${name}-${seq}`.toLowerCase();
  const storeId = options.storeId ?? lab.storeId;
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, 9, $3::numeric, 0, 0, $4) returning id`,
    [storeId, sku, options.cost ?? "1.00", options.isActive ?? true],
  );
  const id = String(row.id);
  if ((options.stock ?? 0) > 0) {
    await sql(
      `stock inicial de ${sku}`,
      "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'inventario_inicial', $2, $3, $4)",
      [id, options.stock, TAG, storeId],
    );
  }
  return id;
}

/** Par de siempre, escrito como lo escriben el BFF anterior y los fixtures: cabecera con unidad y unidades. */
async function pair(pack: string, unit: string, units: number, isActive = true): Promise<string> {
  const out = await must(
    null,
    `par x${units}`,
    `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active)
     select p.store_id, p.id, $2, $3, $4 from public.products p where p.id = $1 returning id`,
    [pack, unit, units, isActive],
  );
  return String(out[0]?.id);
}

function recipeStatements(pack: string, total: number, components: readonly Component[], id: string): Array<[string, unknown[]]> {
  return [
    [
      `insert into public.product_pack_conversions (id, store_id, pack_product_id, total_units, label, is_active)
       select $1, p.store_id, p.id, $3, $4, true from public.products p where p.id = $2`,
      [id, pack, total, `${TAG} surtido`],
    ],
    ...components.map((c): [string, unknown[]] => [
      `insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight)
       select $1, p.store_id, $2, $3, $4::numeric from public.products p where p.id = $5`,
      [id, c.id, c.units, String(c.weight ?? 1), pack],
    ]),
  ];
}

/** Receta nueva (cabecera + componentes en una transacción). Devuelve el id de la cabecera. */
async function recipe(pack: string, total: number, components: readonly Component[]): Promise<string> {
  const id = randomUUID();
  const out = await runAll(null, recipeStatements(pack, total, components, id));
  if (out.code !== null) throw new Error(`SETUP · receta de ${total}: ${out.code} ${out.message}`);
  return id;
}

type ConvertOptions = { reason?: string | null; requestId?: string | null; components?: unknown; previous?: boolean };

/** `convert_pack_to_units` vigente o, con `previous`, la de 20261006c instalada con otro nombre. */
function convert(actor: Actor, pack: string, quantity: number | null, options: ConvertOptions = {}): Promise<Outcome> {
  const reason = options.reason === undefined ? TAG : options.reason;
  if (options.previous) {
    return run(actor, "select public.convert_pack_to_units_20261006c($1::uuid, $2::integer, $3::text, $4::uuid) as result", [
      pack,
      quantity,
      reason,
      options.requestId ?? null,
    ]);
  }
  return run(
    actor,
    `select public.convert_pack_to_units(
       p_pack_product_id => $1::uuid, p_pack_quantity => $2::integer, p_reason => $3::text,
       p_client_request_id => $4::uuid, p_components => $5::jsonb) as result`,
    [pack, quantity, reason, options.requestId ?? null, options.components === undefined ? null : JSON.stringify(options.components)],
  );
}

const resultOf = (out: Outcome): Row | null => (out.rows[0]?.result as Row | undefined) ?? null;

/** Stock y costo (texto exacto) de cada producto, en el orden pedido. */
async function state(ids: readonly string[]): Promise<Array<{ stock: number; cost: string }>> {
  const rows = await sql("estado", "select id, current_stock, current_cost_ref::text as cost from public.products where id = any($1::uuid[])", [ids]);
  return ids.map((id) => {
    const row = rows.find((r) => r.id === id);
    return { stock: Number(row?.current_stock), cost: String(row?.cost) };
  });
}

/** Movimientos de conversión de los productos, en el orden del libro: [índice del producto, tipo, delta, saldo]. */
async function conversionMoves(ids: readonly string[]): Promise<Array<[number, string, number, number]>> {
  const rows = await sql(
    "movimientos de conversión",
    `select product_id, type::text as type, quantity_delta, stock_after from public.stock_movements
     where product_id = any($1::uuid[]) and conversion_id is not null order by seq`,
    [ids],
  );
  return rows.map((r) => [ids.indexOf(String(r.product_id)), String(r.type), Number(r.quantity_delta), Number(r.stock_after)]);
}

/** Conteo de las 9 vistas de integridad acotado a los productos dados, visto desde la transacción del test. */
async function integrity(ids: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const view of INTEGRITY_VIEWS) {
    const filter = view === "conversion_mismatches" ? "pack_product_id = any($1::uuid[]) or unit_product_id = any($1::uuid[])" : "product_id = any($1::uuid[])";
    const row = await one(`vista ${view}`, `select count(*)::int as n from public.${view} where ${filter}`, [ids]);
    if (Number(row.n) > 0) out[view] = Number(row.n);
  }
  return out;
}

const share = (id: string, units: unknown): Share => ({ unit_product_id: id, units });
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Un empaque con stock 5 y costo `packCost`, y tres productos sueltos sin stock. */
async function assortedFixture(packCost = "6.00"): Promise<{ pack: string; a: string; b: string; c: string }> {
  const pack = await product("surtido", { cost: packCost, stock: 5 });
  const [a, b, c] = [await product("a", { cost: "0.00" }), await product("b", { cost: "0.00" }), await product("c", { cost: "0.00" })].sort();
  return { pack, a, b, c };
}

beforeAll(async () => {
  lab = await Lab.open("pro12");
  db = await lab.pg();
  if (!lab.defaultStoreId) throw new Error("SETUP · falta la tienda por defecto (segunda tienda del lab)");
  const other = await one(
    `usuario ${OTHER_STORE_ADMIN_EMAIL} de la tienda default`,
    `select u.id from auth.users u join public.profiles p on p.id = u.id
     where u.email = $1 and p.store_id = $2 and p.role = 'admin' and p.is_active`,
    [OTHER_STORE_ADMIN_EMAIL, lab.defaultStoreId],
  );
  otherAdmin = String(other.id);
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("migración · cada par de siempre queda como cabecera + 1 componente", () => {
  /** Deja `product_pack_conversions` como estaba antes del parche (dentro de la transacción del test). */
  async function revertToPairModel(): Promise<void> {
    await sql("volver al modelo 1 a 1", [
      "drop table public.product_pack_components cascade",
      "drop trigger trg_product_pack_conversions_sync_component_ins on public.product_pack_conversions",
      "drop trigger trg_product_pack_conversions_sync_component_upd on public.product_pack_conversions",
      "drop trigger trg_zz_pack_recipe_sum on public.product_pack_conversions",
      "alter table public.product_pack_conversions drop column total_units, drop column label",
      "alter table public.product_pack_conversions alter column unit_product_id set not null",
      "drop index public.idx_product_pack_conversions_unit_product_id",
      "create unique index uq_product_pack_conversions_unit_active on public.product_pack_conversions(unit_product_id) where is_active = true",
      functionOf(ORIGINAL_PATCH, "validate_product_pack_conversion"),
    ].join(";\n"));
  }

  const HEADERS = `select id, store_id, pack_product_id, unit_product_id, units_per_pack, is_active, created_at::text as created_at,
                          updated_at::text as updated_at from public.product_pack_conversions order by id`;

  it("aplicado sobre pares 1 a 1 (activos, inactivos y de otra tienda): misma cabecera con total_units = units_per_pack y un componente con las mismas unidades y peso 1; reaplicarlo no cambia nada", async () => {
    await withRollback(db, async () => {
      await revertToPairModel();
      const [p1, u1, p2, u2] = [await product("m-pack"), await product("m-unit"), await product("m-pack-off"), await product("m-unit-off")];
      const [p3, u3] = [await product("m-pack-otra", { storeId: lab.defaultStoreId }), await product("m-unit-otra", { storeId: lab.defaultStoreId })];
      await sql(
        "pares anteriores al parche",
        `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active)
         values ($1, $2, $3, 6, true), ($1, $4, $5, 24, false), ($6, $7, $8, 12, true)`,
        [lab.storeId, p1, u1, p2, u2, lab.defaultStoreId, p3, u3],
      );
      const before = await sql("pares antes", HEADERS);

      await sql("parche 20261009d", patchBody());
      const after = await sql(
        "recetas después",
        `select c.id, c.store_id, c.pack_product_id, c.unit_product_id, c.units_per_pack, c.is_active, c.created_at::text as created_at,
                c.updated_at::text as updated_at, c.total_units, c.label,
                (select jsonb_agg(jsonb_build_object('store_id', pc.store_id, 'unit_product_id', pc.unit_product_id,
                   'units_per_pack', pc.units_per_pack, 'cost_weight', pc.cost_weight::text))
                 from public.product_pack_components pc where pc.conversion_id = c.id) as components
         from public.product_pack_conversions c order by c.id`,
      );
      const snapshot = async (): Promise<Row> =>
        one(
          "contenido de las dos tablas",
          `select (select jsonb_agg(to_jsonb(c) order by c.id) from public.product_pack_conversions c) as cabeceras,
                  (select jsonb_agg(to_jsonb(pc) order by pc.id) from public.product_pack_components pc) as componentes`,
        );
      const first = await snapshot();
      await sql("parche 20261009d otra vez", patchBody());

      expect(before.length).toBeGreaterThanOrEqual(3);
      expect(after).toEqual(
        before.map((row) => ({
          ...row,
          total_units: row.units_per_pack,
          label: null,
          components: [{ store_id: row.store_id, unit_product_id: row.unit_product_id, units_per_pack: row.units_per_pack, cost_weight: "1" }],
        })),
      );
      expect(await snapshot()).toEqual(first);
    });
  });

  it("un par migrado se abre igual que antes del parche (mismo stock, costo y movimientos)", async () => {
    await withRollback(db, async () => {
      await revertToPairModel();
      const [pack, unit] = [await product("m-abre-pack", { cost: "7.77", stock: 4 }), await product("m-abre-unit", { cost: "1.33", stock: 5 })];
      await sql("par anterior al parche", "insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack) values ($1, $2, $3, 6)", [
        lab.storeId,
        pack,
        unit,
      ]);
      await sql("parche 20261009d", patchBody());

      const out = await convert("almacen", pack, 2);

      // 2 × 7,77 = 15,54 sobre 12 unidades; promedio con las 5 que había a 1,33: (6,65 + 15,54) / 17 = 1,31.
      expect({ code: out.code, estado: await state([pack, unit]), movimientos: await conversionMoves([pack, unit]) }).toEqual({
        code: null,
        estado: [
          { stock: 2, cost: "7.77" },
          { stock: 17, cost: "1.31" },
        ],
        movimientos: [
          [0, "conversion_salida", -2, 2],
          [1, "conversion_entrada", 12, 17],
        ],
      });
    });
  });
});

describe("convert_pack_to_units · con 1 componente hace lo mismo que la versión de 20261006c", () => {
  type Fixture = { packCost: string; packStock: number; unitCost: string; unitStock: number; units: number; link?: boolean; packActive?: boolean; unitActive?: boolean };
  type Call = { actor: Actor; quantity: number | null; reason?: string | null; keyed?: boolean };

  const BASE: Fixture = { packCost: "7.77", packStock: 5, unitCost: "1.33", unitStock: 5, units: 6 };

  const CASES: Array<{ name: string; fixture?: Partial<Fixture>; call?: Partial<Call> }> = [
    { name: "unidad sin stock: toma el costo del empaque repartido", fixture: { unitStock: 0 } },
    { name: "unidad con stock: promedio ponderado con redondeo", call: { quantity: 3 } },
    { name: "empaque x24 con costo que no divide exacto", fixture: { packCost: "10.00", units: 24, unitCost: "0.41", unitStock: 7 }, call: { quantity: 2 } },
    { name: "empaque con costo 0", fixture: { packCost: "0.00", unitCost: "2.00", unitStock: 10 } },
    { name: "empaque de 0,01 en 7 unidades (costo unitario 0,00)", fixture: { packCost: "0.01", units: 7, unitStock: 0 } },
    { name: "muchos empaques de golpe", fixture: { packStock: 1000, units: 24, packCost: "123456.78", unitStock: 3 }, call: { quantity: 1000 } },
    { name: "admin con motivo nulo", call: { actor: "admin", reason: null } },
    { name: "con clave de idempotencia", call: { keyed: true } },
    { name: "unidad inactiva", fixture: { unitActive: false } },
    { name: "empaque inactivo", fixture: { packActive: false } },
    { name: "0 empaques", call: { quantity: 0 } },
    { name: "cantidad negativa", call: { quantity: -2 } },
    { name: "cantidad nula", call: { quantity: null } },
    { name: "más empaques de los que hay", call: { quantity: 6 } },
    { name: "producto sin receta", fixture: { link: false } },
    { name: "vendedor", call: { actor: "vendedor1" } },
    { name: "contador", call: { actor: "contador" } },
    { name: "admin de otra tienda", call: { actor: "otherAdmin" } },
    { name: "sin sesión", call: { actor: "anon" } },
  ];

  /** La función de 20261006c con otro nombre y con sus mismos grants (sin anon). Lee el par de las columnas de compatibilidad. */
  async function installPrevious(): Promise<void> {
    await sql(
      "convert_pack_to_units de 20261006c",
      [
        functionOf(PREVIOUS_CONVERT_PATCH, "convert_pack_to_units", "convert_pack_to_units_20261006c"),
        "revoke all on function public.convert_pack_to_units_20261006c(uuid, integer, text, uuid) from public, anon",
        "grant execute on function public.convert_pack_to_units_20261006c(uuid, integer, text, uuid) to authenticated, service_role",
      ].join(";\n"),
    );
  }

  async function build(f: Fixture): Promise<{ pack: string; unit: string }> {
    const pack = await product("d-pack", { cost: f.packCost, stock: f.packStock, isActive: f.packActive });
    const unit = await product("d-unit", { cost: f.unitCost, stock: f.unitStock, isActive: f.unitActive });
    if (f.link !== false) await pair(pack, unit, f.units);
    return { pack, unit };
  }

  /** Todo lo que deja la conversión en el par, sin ids, sku ni fechas. */
  function footprint(pack: string, unit: string): Promise<Row> {
    return one(
      "huella de la conversión",
      `select
         (select jsonb_agg(to_jsonb(p) - array['id', 'sku', 'name', 'barcode', 'created_at', 'updated_at'] order by (p.id = $1) desc)
          from public.products p where p.id in ($1, $2)) as productos,
         (select jsonb_agg((to_jsonb(m) - array['id', 'product_id', 'created_at', 'conversion_id', 'seq'])
                  || jsonb_build_object('empaque', m.product_id = $1, 'con_conversion', m.conversion_id is not null) order by m.seq)
          from public.stock_movements m where m.product_id in ($1, $2)) as movimientos,
         (select count(distinct m.conversion_id)::int from public.stock_movements m where m.product_id in ($1, $2)) as conversiones,
         (select count(*)::int from public.stock_request_keys k where k.result -> 'packMovement' ->> 'product_id' = $1::text) as claves`,
      [pack, unit],
    );
  }

  const movement = (value: unknown, productId: string, conversionId: unknown): Row => {
    const { id, product_id, conversion_id, created_at, ...rest } = (value ?? {}) as Row;
    return { ...rest, tieneId: typeof id === "string", tieneFecha: typeof created_at === "string", delProducto: product_id === productId, deLaConversion: conversion_id === conversionId };
  };

  /** Las claves del resultado que ya existían, sin ids ni fechas. */
  function legacy(out: Outcome, pack: string, unit: string): Row | null {
    const result = resultOf(out);
    if (!result) return null;
    return {
      unitsPerPack: result.unitsPerPack,
      packQuantity: result.packQuantity,
      unitQuantity: result.unitQuantity,
      unitCostRef: result.unitCostRef,
      packMovement: movement(result.packMovement, pack, result.conversionId),
      unitMovement: movement(result.unitMovement, unit, result.conversionId),
    };
  }

  it("20261006c es la última versión anterior a este parche", () => {
    const defining = readdirSync(PATCHES)
      .filter((file) => /^\d{8}[a-z]?-.*\.sql$/.test(file) && !file.includes("one-shot"))
      .filter((file) => /create or replace function public\.convert_pack_to_units\(/.test(readFileSync(resolve(PATCHES, file), "utf8")))
      .sort();
    expect(defining.slice(-2)).toEqual([PREVIOUS_CONVERT_PATCH, PATCH]);
  });

  it.each(CASES)("$name", async ({ fixture, call }) => {
    await withRollback(db, async () => {
      const f = { ...BASE, ...fixture };
      const c: Call = { actor: "almacen", quantity: 1, ...call };
      await installPrevious();
      const before = await build(f);
      const after = await build(f);
      const options = (): ConvertOptions => ({ ...(c.reason === undefined ? {} : { reason: c.reason }), requestId: c.keyed ? randomUUID() : null });

      const old = await convert(c.actor, before.pack, c.quantity, { ...options(), previous: true });
      const current = await convert(c.actor, after.pack, c.quantity, options());

      expect({ code: current.code, message: current.message, resultado: legacy(current, after.pack, after.unit), huella: await footprint(after.pack, after.unit) }).toEqual({
        code: old.code,
        message: old.message.replace("_20261006c", ""),
        resultado: legacy(old, before.pack, before.unit),
        huella: await footprint(before.pack, before.unit),
      });
      const result = resultOf(current);
      if (result) expect(Object.keys(result).sort()).toEqual([...LEGACY_KEYS, "components", "totalUnits"].sort());
    });
  });

  it("los rechazos de siempre conservan su código (PT400 / PT403 / PT404 / PT409)", async () => {
    await withRollback(db, async () => {
      const { pack } = await build(BASE);
      const loose = await product("d-suelto", { stock: 3 });

      const codes = [
        (await convert("almacen", pack, 0)).code,
        (await convert("vendedor1", pack, 1)).code,
        (await convert("almacen", loose, 1)).code,
        (await convert("otherAdmin", pack, 1)).code,
        (await convert("almacen", pack, 6)).code,
      ];

      expect(codes).toEqual(["PT400", "PT403", "PT404", "PT404", "PT409"]);
    });
  });

  it("una clave guardada por la versión anterior sigue valiendo: el reintento devuelve el resultado original sin mover nada", async () => {
    await withRollback(db, async () => {
      await installPrevious();
      const { pack, unit } = await build(BASE);
      const requestId = randomUUID();

      const original = await convert("almacen", pack, 2, { requestId, previous: true });
      const retry = await convert("almacen", pack, 2, { requestId });
      const other = await convert("almacen", pack, 1, { requestId });

      expect({ codes: [original.code, retry.code, other.code], igual: JSON.stringify(resultOf(retry)) === JSON.stringify(resultOf(original)) }).toEqual({
        codes: [null, null, "PT409"],
        igual: true,
      });
      expect(await conversionMoves([pack, unit])).toEqual([
        [0, "conversion_salida", -2, 3],
        [1, "conversion_entrada", 12, 17],
      ]);
    });
  });
});

describe("convert_pack_to_units · receta surtida", () => {
  it("receta 2-2-2 sin distribución: cada componente recibe sus unidades × empaques, una salida y una entrada por componente con el mismo conversion_id", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);

      const out = await convert("almacen", pack, 2);
      const result = resultOf(out);
      const conversions = await one(
        "conversion_id de los movimientos",
        "select count(distinct conversion_id)::int as n, count(*)::int as movimientos from public.stock_movements where product_id = any($1::uuid[]) and conversion_id is not null",
        [[pack, a, b, c]],
      );

      expect({ code: out.code, estado: await state([pack, a, b, c]), movimientos: await conversionMoves([pack, a, b, c]), conversions }).toEqual({
        code: null,
        estado: [
          { stock: 3, cost: "6.00" },
          { stock: 4, cost: "1.00" },
          { stock: 4, cost: "1.00" },
          { stock: 4, cost: "1.00" },
        ],
        movimientos: [
          [0, "conversion_salida", -2, 3],
          [1, "conversion_entrada", 4, 4],
          [2, "conversion_entrada", 4, 4],
          [3, "conversion_entrada", 4, 4],
        ],
        conversions: { n: 1, movimientos: 4 },
      });
      expect({
        totalUnits: result?.totalUnits,
        unitsPerPack: result?.unitsPerPack,
        unitQuantity: result?.unitQuantity,
        unitCostRef: result?.unitCostRef,
        primeraEntrada: (result?.unitMovement as Row | undefined)?.product_id,
        components: (result?.components as Row[] | undefined)?.map((x) => [x.unitProductId, x.units, x.allocatedValueRef, x.unitCostRef, x.newCostRef, x.isActive, (x.movement as Row).quantity_delta]),
      }).toEqual({
        totalUnits: 6,
        unitsPerPack: 6,
        unitQuantity: 12,
        unitCostRef: 1,
        primeraEntrada: a,
        components: [
          [a, 4, 4, 1, 1, true, 4],
          [b, 4, 4, 1, 1, true, 4],
          [c, 4, 4, 1, 1, true, 4],
        ],
      });
      expect(await integrity([pack, a, b, c])).toEqual({});
    });
  });

  it("distribución real 3-1-2: entra lo que se contó, no lo que dice la receta", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);

      const out = await convert("almacen", pack, 1, { components: [share(b, 1), share(a, 3), share(c, 2)] });

      expect({ code: out.code, estado: await state([pack, a, b, c]), movimientos: await conversionMoves([pack, a, b, c]), vistas: await integrity([pack, a, b, c]) }).toEqual({
        code: null,
        estado: [
          { stock: 4, cost: "6.00" },
          { stock: 3, cost: "1.00" },
          { stock: 1, cost: "1.00" },
          { stock: 2, cost: "1.00" },
        ],
        movimientos: [
          [0, "conversion_salida", -1, 4],
          [1, "conversion_entrada", 3, 3],
          [2, "conversion_entrada", 1, 1],
          [3, "conversion_entrada", 2, 2],
        ],
        vistas: {},
      });
    });
  });

  it("los componentes con 0 unidades (enviados u omitidos) no reciben movimiento ni cambian de costo", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);
      await sql("costo previo de b y c", "update public.products set current_cost_ref = 3.33 where id = any($1::uuid[])", [[b, c]]);

      const explicit = await convert("almacen", pack, 1, { components: [share(a, 6), share(b, 0), share(c, 0)] });
      const omitted = await convert("almacen", pack, 1, { components: [share(c, 6)] });

      expect({ codes: [explicit.code, omitted.code], estado: await state([pack, a, b, c]), movimientos: await conversionMoves([pack, a, b, c]) }).toEqual({
        codes: [null, null],
        estado: [
          { stock: 3, cost: "6.00" },
          { stock: 6, cost: "1.00" },
          { stock: 0, cost: "3.33" },
          { stock: 6, cost: "1.00" },
        ],
        movimientos: [
          [0, "conversion_salida", -1, 4],
          [1, "conversion_entrada", 6, 6],
          [0, "conversion_salida", -1, 3],
          [3, "conversion_entrada", 6, 6],
        ],
      });
      expect((resultOf(explicit)?.components as Row[]).map((x) => x.unitProductId)).toEqual([a]);
    });
  });

  it.each<[string, (ids: { a: string; b: string; c: string; other: string }) => unknown]>([
    ["suma de menos", ({ a, b, c }) => [share(a, 2), share(b, 2), share(c, 1)]],
    ["suma de más", ({ a, b, c }) => [share(a, 3), share(b, 2), share(c, 2)]],
    ["lista vacía", () => []],
    ["producto que no es componente de la receta", ({ a, b, other }) => [share(a, 2), share(b, 2), share(other, 2)]],
    ["componente repetido", ({ a, b }) => [share(a, 2), share(b, 2), share(a, 2)]],
    ["unidades negativas", ({ a, b, c }) => [share(a, 7), share(b, -1), share(c, 0)]],
    ["unidades con decimales", ({ a, b, c }) => [share(a, 2.5), share(b, 1.5), share(c, 2)]],
    ["unidades como texto", ({ a, b, c }) => [share(a, "2"), share(b, 2), share(c, 2)]],
    ["unidades fuera de rango", ({ a }) => [share(a, 99999999999)]],
    ["sin unit_product_id", ({ b, c }) => [{ units: 2 }, share(b, 2), share(c, 2)]],
    ["unit_product_id que no es un uuid", ({ b, c }) => [share("no-es-uuid", 2), share(b, 2), share(c, 2)]],
    ["elemento que no es un objeto", ({ a }) => [a, 6]],
    ["objeto en vez de lista", ({ a }) => share(a, 6)],
    ["texto en vez de lista", () => "6"],
  ])("distribución inválida (%s): PT400 y no se mueve nada", async (_name, build) => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      const other = await product("ajeno");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);
      const before = await state([pack, a, b, c, other]);

      const out = await convert("almacen", pack, 1, { components: build({ a, b, c, other }), requestId: randomUUID() });
      const keys = await one("claves guardadas", "select count(*)::int as n from public.stock_request_keys where result -> 'packMovement' ->> 'product_id' = $1", [pack]);

      expect({ code: out.code, estado: await state([pack, a, b, c, other]), movimientos: await conversionMoves([pack, a, b, c, other]), claves: keys.n }).toEqual({
        code: "PT400",
        estado: before,
        movimientos: [],
        claves: 0,
      });
    });
  });

  it("p_components null (de SQL o de JSON) es abrir con la receta", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      await recipe(pack, 6, [{ id: a, units: 1 }, { id: b, units: 2 }, { id: c, units: 3 }]);

      const jsonNull = await run("almacen", "select public.convert_pack_to_units($1::uuid, 1, $2, null, 'null'::jsonb) as result", [pack, TAG]);
      const fourArgs = await run("almacen", "select public.convert_pack_to_units($1::uuid, 1, $2, null) as result", [pack, TAG]);
      const twoArgs = await run("almacen", "select public.convert_pack_to_units($1::uuid, 1) as result", [pack]);

      expect({ codes: [jsonNull.code, fourArgs.code, twoArgs.code], stock: (await state([pack, a, b, c])).map((x) => x.stock) }).toEqual({
        codes: [null, null, null],
        stock: [2, 3, 6, 9],
      });
    });
  });

  it("pesos de costo distintos: el valor del empaque se reparte por unidades × peso y la suma repartida es exactamente el valor transferido", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("10.01");
      await sql("stock y costo previos de a", "insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id) values ($1, 'inventario_inicial', 10, $2, $3)", [a, TAG, lab.storeId]);
      await sql("costo previo de a", "update public.products set current_cost_ref = 1.00 where id = $1", [a]);
      await recipe(pack, 6, [{ id: a, units: 2, weight: 1 }, { id: b, units: 2, weight: 3 }, { id: c, units: 2, weight: "0.5" }]);

      const out = await convert("almacen", pack, 1);
      const components = (resultOf(out)?.components ?? []) as Row[];
      const total = await one("suma repartida", "select sum((x ->> 'allocatedValueRef')::numeric)::text as total from jsonb_array_elements($1::jsonb) x", [JSON.stringify(components)]);

      // Pesos 2×1, 2×3, 2×0,5 = 2 / 6 / 1 sobre 9. a = 10,01 × 2/9 = 2,2244; c = 1,1122; b (el mayor) se queda el resto: 6,6734.
      expect({ code: out.code, reparto: components.map((x) => [x.unitProductId, x.costWeight, x.allocatedValueRef, x.unitCostRef, x.newCostRef]), total: total.total }).toEqual({
        code: null,
        reparto: [
          [a, 1, 2.2244, 1.11, 1.02],
          [b, 3, 6.6734, 3.34, 3.34],
          [c, 0.5, 1.1122, 0.56, 0.56],
        ],
        total: "10.0100",
      });
      expect(await state([pack, a, b, c])).toEqual([
        { stock: 4, cost: "10.01" },
        { stock: 12, cost: "1.02" },
        { stock: 2, cost: "3.34" },
        { stock: 2, cost: "0.56" },
      ]);
    });
  });

  it("pesos iguales: el residuo del redondeo va al componente de mayor id y el reparto con distribución real usa las unidades recibidas", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("0.10");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);

      const byRecipe = await convert("almacen", pack, 1);
      const real = await convert("almacen", pack, 1, { components: [share(a, 4), share(b, 1), share(c, 1)] });
      const shares = (out: Outcome): unknown[] => ((resultOf(out)?.components ?? []) as Row[]).map((x) => [x.unitProductId, x.units, x.allocatedValueRef]);

      // Receta: 0,10 / 3 = 0,0333 y el último por id se queda 0,0334. Real 4-1-1: b y c 0,0167; a (el mayor) 0,0666.
      expect({ codes: [byRecipe.code, real.code], receta: shares(byRecipe), real: shares(real) }).toEqual({
        codes: [null, null],
        receta: [
          [a, 2, 0.0333],
          [b, 2, 0.0333],
          [c, 2, 0.0334],
        ],
        real: [
          [a, 4, 0.0666],
          [b, 1, 0.0167],
          [c, 1, 0.0167],
        ],
      });
    });
  });

  it("idempotencia con distribución: el reintento devuelve lo mismo sin duplicar; la misma clave con otro reparto o sin reparto es PT409", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);
      const requestId = randomUUID();
      const components = [share(a, 3), share(b, 1), share(c, 2)];

      const first = await convert("almacen", pack, 1, { requestId, components });
      const retry = await convert("almacen", pack, 1, { requestId, components });
      const otherShares = await convert("almacen", pack, 1, { requestId, components: [share(a, 2), share(b, 2), share(c, 2)] });
      const noShares = await convert("almacen", pack, 1, { requestId });
      const otherUser = await convert("admin", pack, 1, { requestId, components });

      expect({
        codes: [first.code, retry.code, otherShares.code, noShares.code, otherUser.code],
        igual: JSON.stringify(resultOf(retry)) === JSON.stringify(resultOf(first)),
        stock: (await state([pack, a, b, c])).map((x) => x.stock),
        movimientos: (await conversionMoves([pack, a, b, c])).length,
      }).toEqual({ codes: [null, null, "PT409", "PT409", "PT409"], igual: true, stock: [4, 3, 1, 2], movimientos: 4 });
    });
  });

  it("componente inactivo: el empaque se abre igual (como hoy con una unidad inactiva) y el resultado lo marca", async () => {
    await withRollback(db, async () => {
      const pack = await product("surtido", { cost: "6.00", stock: 2 });
      const [a, b] = [await product("activo"), await product("inactivo", { isActive: false })].sort();
      await recipe(pack, 4, [{ id: a, units: 2 }, { id: b, units: 2 }]);
      const inactive = await one("inactivo", "select id from public.products where id = any($1::uuid[]) and not is_active", [[a, b]]);

      const out = await convert("almacen", pack, 1);

      expect({
        code: out.code,
        stock: (await state([pack, a, b])).map((x) => x.stock),
        activos: ((resultOf(out)?.components ?? []) as Row[]).map((x) => [x.unitProductId, x.isActive]),
      }).toEqual({ code: null, stock: [1, 2, 2], activos: [a, b].map((id) => [id, id !== inactive.id]) });
    });
  });

  it("el mismo producto unidad en dos recetas: las dos aperturas suman en su stock y su costo es el promedio ponderado de ambas", async () => {
    await withRollback(db, async () => {
      const [box, mix] = [await product("caja", { cost: "6.00", stock: 3 }), await product("mixto", { cost: "9.00", stock: 3 })];
      const [shared, extra] = [await product("compartido", { cost: "0.00" }), await product("extra", { cost: "0.00" })];
      await pair(box, shared, 6);
      await recipe(mix, 6, [{ id: shared, units: 2 }, { id: extra, units: 4 }]);

      const first = await convert("almacen", box, 1);
      const second = await convert("almacen", mix, 1);
      const roles = await sql("roles", "select product_id, is_pack, is_component, component_recipes from public.product_pack_roles where product_id = any($1::uuid[])", [[box, mix, shared, extra]]);

      // Caja: 6 unidades a 1,00. Mixto: 9,00 × 2/6 = 3,00 para 2 unidades → (6 × 1,00 + 3,00) / 8 = 1,125 → 1,13.
      expect({ codes: [first.code, second.code], estado: await state([box, mix, shared, extra]), vistas: await integrity([box, mix, shared, extra]) }).toEqual({
        codes: [null, null],
        estado: [
          { stock: 2, cost: "6.00" },
          { stock: 2, cost: "9.00" },
          { stock: 8, cost: "1.13" },
          { stock: 4, cost: "1.50" },
        ],
        vistas: {},
      });
      expect([box, mix, shared, extra].map((id) => roles.find((r) => r.product_id === id))).toEqual([
        { product_id: box, is_pack: true, is_component: false, component_recipes: 0 },
        { product_id: mix, is_pack: true, is_component: false, component_recipes: 0 },
        { product_id: shared, is_pack: false, is_component: true, component_recipes: 2 },
        { product_id: extra, is_pack: false, is_component: true, component_recipes: 1 },
      ]);
    });
  });

  it("vendedor y contador no abren un surtido (PT403) y el admin de otra tienda no lo encuentra (PT404)", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);
      const components = [share(a, 6)];

      const codes = [
        (await convert("vendedor1", pack, 1, { components })).code,
        (await convert("contador", pack, 1)).code,
        (await convert("otherAdmin", pack, 1, { components })).code,
        (await convert("admin", pack, 1, { components })).code,
      ];

      expect({ codes, stock: (await state([pack, a])).map((x) => x.stock) }).toEqual({ codes: ["PT403", "PT403", "PT404", null], stock: [4, 6] });
    });
  });
});

describe("recetas · invariante de la suma y validaciones", () => {
  it("cabecera + N componentes en una transacción: pasa si suman total_units y falla con PT400 al confirmar si no", async () => {
    await withRollback(db, async () => {
      const [p1, p2, p3] = [await product("r-pack"), await product("r-pack"), await product("r-pack")];
      const [a, b, c] = [await product("r-a"), await product("r-b"), await product("r-c")];

      const ok = await runAll("almacen", recipeStatements(p1, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }], randomUUID()));
      const short = await runAll("almacen", recipeStatements(p2, 6, [{ id: a, units: 2 }, { id: b, units: 2 }], randomUUID()));
      const empty = await runAll("almacen", recipeStatements(p3, 6, [], randomUUID()));
      const saved = await sql("recetas guardadas", "select pack_product_id from public.product_pack_conversions where pack_product_id = any($1::uuid[])", [[p1, p2, p3]]);

      expect({ codes: [ok.code, short.code, empty.code], mensajes: [short.message, empty.message], guardadas: saved.map((r) => r.pack_product_id) }).toEqual({
        codes: [null, "PT400", "PT400"],
        mensajes: ["Los componentes de la receta suman 4 unidades y el empaque declara 6", "La receta activa de un empaque debe tener al menos un componente"],
        guardadas: [p1],
      });
    });
  });

  it("una receta inactiva puede estar incompleta; activarla, quitarle un componente o cambiar unidades exige que cuadre", async () => {
    await withRollback(db, async () => {
      const [pack, a, b] = [await product("r-pack"), await product("r-a"), await product("r-b")];
      const header = await must("almacen", "cabecera inactiva", "insert into public.product_pack_conversions (store_id, pack_product_id, total_units, is_active) values ($1, $2, 6, false) returning id", [lab.storeId, pack]);
      const id = String(header[0]?.id);
      const add = (unit: string, units: number): Promise<Outcome> =>
        run("almacen", "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack) values ($1, $2, $3, $4)", [id, lab.storeId, unit, units]);

      const firstComponent = await add(a, 2);
      const tooEarly = await run("almacen", "update public.product_pack_conversions set is_active = true where id = $1", [id]);
      const secondComponent = await add(b, 4);
      const activate = await run("almacen", "update public.product_pack_conversions set is_active = true where id = $1", [id]);
      const remove = await run("almacen", "delete from public.product_pack_components where conversion_id = $1 and unit_product_id = $2", [id, b]);
      const changeUnits = await run("almacen", "update public.product_pack_components set units_per_pack = 5 where conversion_id = $1 and unit_product_id = $2", [id, b]);
      const changeTotal = await run("almacen", "update public.product_pack_conversions set total_units = 7 where id = $1", [id]);
      const both = await runAll("almacen", [
        ["update public.product_pack_conversions set total_units = 7 where id = $1", [id]],
        ["update public.product_pack_components set units_per_pack = 5 where conversion_id = $1 and unit_product_id = $2", [id, b]],
      ]);
      const deactivate = await runAll("almacen", [
        ["update public.product_pack_conversions set is_active = false where id = $1", [id]],
        ["delete from public.product_pack_components where conversion_id = $1", [id]],
      ]);

      expect([firstComponent, tooEarly, secondComponent, activate, remove, changeUnits, changeTotal, both, deactivate].map((out) => out.code)).toEqual([
        null,
        "PT400",
        null,
        null,
        "PT400",
        "PT400",
        "PT400",
        null,
        null,
      ]);
    });
  });

  it("validaciones del componente: no el propio empaque, no otra tienda, no cambiar de receta, unidades > 0, peso > 0 y finito, sin repetir producto", async () => {
    await withRollback(db, async () => {
      const [pack, otherPack, a, b] = [await product("v-pack"), await product("v-pack-2"), await product("v-a"), await product("v-b")];
      const foreign = await product("v-otra-tienda", { storeId: lab.defaultStoreId });
      const id = await recipe(pack, 6, [{ id: a, units: 6 }]);
      const otherId = await recipe(otherPack, 6, [{ id: a, units: 6 }]);
      const insert = (unit: string, units: number, weight: string): Promise<Outcome> =>
        runAll("almacen", [
          ["update public.product_pack_conversions set is_active = false where id = $1", [id]],
          ["insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight) values ($1, $2, $3, $4, $5::numeric)", [id, lab.storeId, unit, units, weight]],
        ]);

      const outcomes = {
        elPropioEmpaque: await insert(pack, 1, "1"),
        otraTienda: await insert(foreign, 1, "1"),
        unidadesCero: await insert(b, 0, "1"),
        pesoCero: await insert(b, 1, "0"),
        pesoNegativo: await insert(b, 1, "-1"),
        pesoNaN: await insert(b, 1, "NaN"),
        pesoInfinito: await insert(b, 1, "Infinity"),
        repetido: await insert(a, 1, "1"),
        cambiarDeReceta: await run("almacen", "update public.product_pack_components set conversion_id = $2 where conversion_id = $1", [id, otherId]),
        pesoNaNAlEditar: await run("almacen", "update public.product_pack_components set cost_weight = 'NaN' where conversion_id = $1", [id]),
        valido: await insert(b, 1, "2.5"),
      };

      expect(Object.fromEntries(Object.entries(outcomes).map(([name, out]) => [name, out.code]))).toEqual({
        elPropioEmpaque: "PT400",
        otraTienda: "PT400",
        unidadesCero: "23514",
        pesoCero: "23514",
        pesoNegativo: "23514",
        pesoNaN: "PT400",
        pesoInfinito: "PT400",
        repetido: "23505",
        cambiarDeReceta: "PT400",
        pesoNaNAlEditar: "PT400",
        valido: null,
      });
      expect(outcomes.pesoNaN.message).toBe("Valor numerico invalido en cost_weight: debe ser un numero finito");
    });
  });

  it("compatibilidad: escribir la cabecera como antes mantiene la receta de 1 componente, y editar componentes mantiene unit_product_id / units_per_pack", async () => {
    await withRollback(db, async () => {
      const [pack, a, b] = [await product("c-pack"), await product("c-a"), await product("c-b")];
      const read = async (): Promise<Row> =>
        one(
          "receta",
          `select c.unit_product_id, c.units_per_pack, c.total_units,
                  (select jsonb_agg(jsonb_build_array(pc.unit_product_id, pc.units_per_pack) order by pc.unit_product_id)
                   from public.product_pack_components pc where pc.conversion_id = c.id) as components
           from public.product_pack_conversions c where c.pack_product_id = $1`,
          [pack],
        );
      const steps: Row[] = [];
      const step = async (name: string, out: Outcome): Promise<void> => {
        steps.push({ paso: name, code: out.code, ...(await read()) });
      };

      await step("insert como el BFF anterior", await run("almacen", "insert into public.product_pack_conversions (pack_product_id, store_id, unit_product_id, units_per_pack, is_active) values ($1, $2, $3, 6, true)", [pack, lab.storeId, a]));
      await step("update de unidades como el BFF anterior", await run("almacen", "update public.product_pack_conversions set unit_product_id = $2, units_per_pack = 12 where pack_product_id = $1", [pack, a]));
      await step("update de la unidad como el BFF anterior", await run("almacen", "update public.product_pack_conversions set unit_product_id = $2, units_per_pack = 8 where pack_product_id = $1", [pack, b]));
      await step("vaciar la unidad a mano", await run("almacen", "update public.product_pack_conversions set unit_product_id = null where pack_product_id = $1", [pack]));
      await step(
        "pasa a surtida (b 3 + a 5)",
        await runAll("almacen", [
          ["update public.product_pack_components set units_per_pack = 3 where unit_product_id = $2 and conversion_id = (select id from public.product_pack_conversions where pack_product_id = $1)", [pack, b]],
          ["insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack) select id, store_id, $2, 5 from public.product_pack_conversions where pack_product_id = $1", [pack, a]],
        ]),
      );
      await step(
        "vuelve a 1 componente (a 8)",
        await runAll("almacen", [
          ["delete from public.product_pack_components where unit_product_id = $2 and conversion_id = (select id from public.product_pack_conversions where pack_product_id = $1)", [pack, b]],
          ["update public.product_pack_components set units_per_pack = 8 where unit_product_id = $2 and conversion_id = (select id from public.product_pack_conversions where pack_product_id = $1)", [pack, a]],
        ]),
      );
      await step("el BFF anterior pisa una surtida", await runAll("almacen", [
        ["insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack) select id, store_id, $2, 2 from public.product_pack_conversions where pack_product_id = $1", [pack, b]],
        ["update public.product_pack_conversions set total_units = 10 where pack_product_id = $1", [pack]],
        ["update public.product_pack_conversions set unit_product_id = $2, units_per_pack = 4 where pack_product_id = $1", [pack, b]],
      ]));

      const [first, second] = [a, b].sort();
      expect(steps).toEqual([
        { paso: "insert como el BFF anterior", code: null, unit_product_id: a, units_per_pack: 6, total_units: 6, components: [[a, 6]] },
        { paso: "update de unidades como el BFF anterior", code: null, unit_product_id: a, units_per_pack: 12, total_units: 12, components: [[a, 12]] },
        { paso: "update de la unidad como el BFF anterior", code: null, unit_product_id: b, units_per_pack: 8, total_units: 8, components: [[b, 8]] },
        { paso: "vaciar la unidad a mano", code: "PT400", unit_product_id: b, units_per_pack: 8, total_units: 8, components: [[b, 8]] },
        { paso: "pasa a surtida (b 3 + a 5)", code: null, unit_product_id: null, units_per_pack: 8, total_units: 8, components: [[first, first === a ? 5 : 3], [second, second === a ? 5 : 3]] },
        { paso: "vuelve a 1 componente (a 8)", code: null, unit_product_id: a, units_per_pack: 8, total_units: 8, components: [[a, 8]] },
        { paso: "el BFF anterior pisa una surtida", code: null, unit_product_id: b, units_per_pack: 4, total_units: 4, components: [[b, 4]] },
      ]);
    });
  });

  it("índices: el único del lado unidad ya no existe (un producto sale de varios empaques) y sigue habiendo una sola receta activa por empaque", async () => {
    await withRollback(db, async () => {
      const [p1, p2, unit] = [await product("i-pack"), await product("i-pack"), await product("i-unit")];
      const unique = await sql(
        "índices únicos",
        `select x.indexname, x.indexdef from pg_indexes x join pg_class c on c.relname = x.indexname join pg_index i on i.indexrelid = c.oid
         where x.schemaname = 'public' and x.tablename = 'product_pack_conversions' and i.indisunique and not i.indisprimary order by 1`,
      );

      const first = await run("almacen", "insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack) values ($1, $2, $3, 6)", [lab.storeId, p1, unit]);
      const sameUnit = await run("almacen", "insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack) values ($1, $2, $3, 12)", [lab.storeId, p2, unit]);
      const samePack = await run("almacen", "insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack) values ($1, $2, $3, 24)", [lab.storeId, p1, unit]);
      const samePackInactive = await run("almacen", "insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active) values ($1, $2, $3, 24, false)", [lab.storeId, p1, unit]);

      expect({ unicos: unique, codes: [first.code, sameUnit.code, samePack.code, samePackInactive.code] }).toEqual({
        unicos: [
          {
            indexname: "uq_product_pack_conversions_pack_active",
            indexdef: "CREATE UNIQUE INDEX uq_product_pack_conversions_pack_active ON public.product_pack_conversions USING btree (pack_product_id) WHERE (is_active = true)",
          },
        ],
        codes: [null, null, "23505", null],
      });
    });
  });
});

describe("product_pack_components · RLS por tienda y por rol", () => {
  it("vendedor y contador leen las recetas de su tienda y no las escriben; almacén y admin sí; otra tienda y anon no ven ni escriben nada", async () => {
    await withRollback(db, async () => {
      const [pack, a, b] = [await product("s-pack"), await product("s-a"), await product("s-b")];
      const id = await recipe(pack, 6, [{ id: a, units: 6 }]);
      const [foreignPack, foreignUnit] = [await product("s-pack-otra", { storeId: lab.defaultStoreId }), await product("s-unit-otra", { storeId: lab.defaultStoreId })];
      const foreignId = await recipe(foreignPack, 6, [{ id: foreignUnit, units: 6 }]);
      const count = (actor: Actor, conversion: string): Promise<Outcome> => run(actor, "select count(*)::int as n from public.product_pack_components where conversion_id = $1", [conversion]);
      const write = async (actor: Actor): Promise<Array<string | number | null>> => {
        const insert = await runAll(actor, [
          ["update public.product_pack_conversions set total_units = 7 where id = $1", [id]],
          ["insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack) values ($1, $2, $3, 1)", [id, lab.storeId, b]],
        ]);
        const update = await run(actor, "update public.product_pack_components set cost_weight = 2 where conversion_id = $1 returning id", [id]);
        const remove = await run(actor, "delete from public.product_pack_components where conversion_id = $1 and unit_product_id = $2 returning id", [id, b]);
        return [insert.code, update.code ?? update.rows.length, remove.code ?? remove.rows.length];
      };

      const reads = {
        vendedor: (await count("vendedor1", id)).rows[0]?.n,
        contador: (await count("contador", id)).rows[0]?.n,
        almacen: (await count("almacen", id)).rows[0]?.n,
        almacenOtraTienda: (await count("almacen", foreignId)).rows[0]?.n,
        otraTienda: (await count("otherAdmin", id)).rows[0]?.n,
        otraTiendaLaSuya: (await count("otherAdmin", foreignId)).rows[0]?.n,
        anon: (await count("anon", id)).code,
      };
      const writes = {
        vendedor: await write("vendedor1"),
        contador: await write("contador"),
        otraTienda: await write("otherAdmin"),
        anon: await write("anon"),
      };
      const crossStore = await run(
        "otherAdmin",
        "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack) values ($1, $2, $3, 1)",
        [id, lab.defaultStoreId, foreignUnit],
      );
      const untouched = await one("receta intacta", "select count(*)::int as n, min(cost_weight)::text as peso from public.product_pack_components where conversion_id = $1", [id]);
      const allowed = { almacen: await write("almacen"), admin: await write("admin") };

      expect({ reads, writes, cruzado: crossStore.code, intacta: untouched }).toEqual({
        reads: { vendedor: 1, contador: 1, almacen: 1, almacenOtraTienda: 0, otraTienda: 0, otraTiendaLaSuya: 1, anon: "42501" },
        // El update de la cabecera no afecta filas (RLS) y el insert del componente lo corta su política.
        writes: { vendedor: ["42501", 0, 0], contador: ["42501", 0, 0], otraTienda: ["42501", 0, 0], anon: ["42501", "42501", "42501"] },
        cruzado: "PT400",
        intacta: { n: 1, peso: "1" },
      });
      // Cambiar solo total_units no toca el componente: con el segundo componente (1) la receta suma 7. Al borrarlo
      // deja de cuadrar: PT400 y no se borra.
      expect(allowed).toEqual({ almacen: [null, 2, "PT400"], admin: ["23505", 2, "PT400"] });
    });
  });
});

describe("conversion_mismatches · recetas de N componentes", () => {
  it("una apertura sana no deja filas; una entrada de un producto ajeno a la receta es missing_link y unas unidades que no cuadran, ratio_mismatch", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      const stranger = await product("ajeno");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);
      const rows = (): Promise<Row[]> =>
        sql("conversion_mismatches", "select pack_product_id, unit_delta, pack_delta, units_per_pack, issue from public.conversion_mismatches where pack_product_id = $1 order by issue", [pack]);
      const inject = (conversionId: unknown, productId: string, delta: number): Promise<Row[]> =>
        sql(
          "movimiento inyectado",
          "insert into public.stock_movements (product_id, type, quantity_delta, conversion_id, reason, store_id) values ($1, 'conversion_entrada', $2, $3, $4, $5)",
          [productId, delta, conversionId, TAG, lab.storeId],
        );

      const healthy = await convert("almacen", pack, 1, { components: [share(a, 3), share(b, 1), share(c, 2)] });
      const clean = await rows();
      const second = await convert("almacen", pack, 2);
      const cleanAfterTwo = await rows();
      await inject(resultOf(healthy)?.conversionId, stranger, 6);
      await inject(resultOf(second)?.conversionId, a, 1);

      // Primera: entran 6 unidades de un producto que no es de la receta. Segunda: 13 unidades en 2 empaques.
      expect({ sanas: [clean, cleanAfterTwo], inyectadas: await rows() }).toEqual({
        sanas: [[], []],
        inyectadas: [
          { pack_product_id: pack, unit_delta: 12, pack_delta: -1, units_per_pack: 12, issue: "missing_link" },
          { pack_product_id: pack, unit_delta: 13, pack_delta: -2, units_per_pack: null, issue: "ratio_mismatch" },
        ],
      });
    });
  });

  it("con 1 componente la vista da lo mismo que la de 20261006d sobre los mismos movimientos (sana, sin enlace, sin entrada, proporción rota)", async () => {
    await withRollback(db, async () => {
      const make = async (): Promise<{ pack: string; unit: string }> => {
        const [pack, unit] = [await product("v-pack", { cost: "6.00", stock: 9 }), await product("v-unit")];
        await pair(pack, unit, 6);
        return { pack, unit };
      };
      const [ok, unlinked, lonely, broken] = [await make(), await make(), await make(), await make()];
      for (const item of [ok, unlinked, lonely, broken]) await convert("almacen", item.pack, 2);
      await sql("par borrado", "delete from public.product_pack_conversions where pack_product_id = $1", [unlinked.pack]);
      await sql(
        "salida sin entrada",
        "insert into public.stock_movements (product_id, type, quantity_delta, conversion_id, reason, store_id) values ($1, 'conversion_salida', -1, gen_random_uuid(), $2, $3)",
        [lonely.pack, TAG, lab.storeId],
      );
      await sql(
        "entrada de más",
        `insert into public.stock_movements (product_id, type, quantity_delta, conversion_id, reason, store_id)
         select $2, 'conversion_entrada', 1, m.conversion_id, $3, $4 from public.stock_movements m where m.product_id = $1 and m.conversion_id is not null`,
        [broken.pack, broken.unit, TAG, lab.storeId],
      );
      const packs = [ok, unlinked, lonely, broken].map((item) => item.pack);
      const read = (view: string): Promise<Row[]> =>
        sql(view, `select pack_product_id, unit_product_id, pack_delta, unit_delta, units_per_pack, issue, current_units_per_pack from ${view} where pack_product_id = any($1::uuid[]) order by pack_product_id, issue`, [packs]);
      const previous = readFileSync(resolve(PATCHES, "20261006d-stock-integrity-views-v2.sql"), "utf8").replace(/\r\n/g, "\n");
      const body = /-- view: conversion_mismatches\ncreate or replace view public\.conversion_mismatches\nwith \(security_invoker = true\) as\n([\s\S]*?)\n;\n/.exec(previous);
      if (!body) throw new Error("SETUP · 20261006d no define conversion_mismatches");
      await sql("vista de 20261006d con otro nombre", `create view public.conversion_mismatches_20261006d as ${body[1]}`);

      const current = await read("public.conversion_mismatches");

      expect(current).toEqual(await read("public.conversion_mismatches_20261006d"));
      expect(current.map((row) => row.issue).sort()).toEqual(["missing_entrada", "missing_link", "ratio_mismatch"]);
    });
  });
});

describe("create_purchase · modo empaque con recetas", () => {
  type Line = { product: string; packCount: number; unitsPerPack: number; packCostRef: number };

  /** `create_purchase` (vigente o la de 20261007a instalada con otro nombre) de una línea exenta en modo empaque, como `almacen`. */
  function purchase(line: Line, previous = false): Promise<Outcome> {
    const costRef = round2(line.packCostRef / line.unitsPerPack);
    const subtotalRef = round2(line.packCount * line.packCostRef);
    const item = {
      product_id: line.product,
      cost_currency: "ref",
      unit_cost_ref: costRef,
      unit_cost_ves: round2(costRef * RATE),
      subtotal_ref: subtotalRef,
      subtotal_ves: round2(subtotalRef * RATE),
      tax_ref: 0,
      tax_ves: 0,
      tax_rate: 0,
      entry_mode: "pack",
      pack_label: `Bulto x${line.unitsPerPack}`,
      pack_count: line.packCount,
      units_per_pack: line.unitsPerPack,
      pack_cost_ref: line.packCostRef,
      pack_cost_ves: round2(line.packCostRef * RATE),
    };
    return run(
      "almacen",
      `select id from public.${previous ? "create_purchase_20261007a" : "create_purchase"}(
         p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0, p_tax_ref => 0,
         p_notes => $4, p_status => 'recibido'::public.purchase_status, p_discount_ves => 0, p_tax_ves => 0,
         p_subtotal_ves => $5::numeric, p_subtotal_ref => $6::numeric)`,
      [lab.supplierId, JSON.stringify([item]), RATE, TAG, round2(subtotalRef * RATE), subtotalRef],
    );
  }

  /** Lo que deja la compra en el producto, sin ids, números de documento ni fechas. */
  function footprint(productId: string): Promise<Row> {
    return one(
      "huella de la compra",
      `select
         (select jsonb_agg(to_jsonb(pi) - array['id', 'purchase_id', 'product_id', 'created_at']) from public.purchase_items pi where pi.product_id = $1) as lineas,
         (select jsonb_agg(jsonb_build_object('type', m.type, 'quantity_delta', m.quantity_delta, 'stock_after', m.stock_after) order by m.seq)
          from public.stock_movements m where m.product_id = $1) as movimientos,
         (select jsonb_build_object('stock', p.current_stock, 'cost', p.current_cost_ref) from public.products p where p.id = $1) as producto,
         (select jsonb_agg(jsonb_build_object('total_ref', pu.total_ref, 'total_ves', pu.total_ves, 'status', pu.status))
          from public.purchases pu where pu.id in (select purchase_id from public.purchase_items where product_id = $1)) as compras`,
      [productId],
    );
  }

  const PAIR_CASES: Array<{ name: string; on: "unit" | "pack" | "loose"; unitsPerPack: number; code: string | null }> = [
    { name: "sobre la unidad con las unidades del par", on: "unit", unitsPerPack: 12, code: null },
    { name: "sobre la unidad con otras unidades", on: "unit", unitsPerPack: 10, code: "PT400" },
    { name: "sobre el empaque con las unidades del par", on: "pack", unitsPerPack: 12, code: null },
    { name: "sobre el empaque con otras unidades", on: "pack", unitsPerPack: 10, code: "PT400" },
    { name: "sobre un producto sin receta", on: "loose", unitsPerPack: 10, code: null },
  ];

  it.each(PAIR_CASES)("par de 1 componente, $name: mismo resultado que la versión de 20261007a", async ({ on, unitsPerPack, code }) => {
    await withRollback(db, async () => {
      await sql("create_purchase de 20261007a", functionOf(PREVIOUS_PURCHASE_PATCH, "create_purchase", "create_purchase_20261007a"));
      const build = async (): Promise<string> => {
        const [pack, unit, loose] = [await product("c-pack", { cost: "20.00", stock: 2 }), await product("c-unit", { cost: "2.00", stock: 5 }), await product("c-suelto", { cost: "2.00" })];
        await pair(pack, unit, 12);
        return { unit, pack, loose }[on];
      };
      const [before, after] = [await build(), await build()];
      const line = { packCount: 3, unitsPerPack, packCostRef: 30 };

      const old = await purchase({ ...line, product: before }, true);
      const current = await purchase({ ...line, product: after });

      expect({ code: current.code, message: current.message, huella: await footprint(after) }).toEqual({ code: old.code, message: old.message, huella: await footprint(before) });
      expect(current.code).toBe(code);
    });
  });

  it("un producto unidad que sale de dos empaques (x6 y x12) se compra con las unidades de cualquiera de los dos, y con otras no", async () => {
    await withRollback(db, async () => {
      const [six, twelve, unit] = [await product("c-x6"), await product("c-x12"), await product("c-unit", { cost: "1.00" })];
      await pair(six, unit, 6);
      await pair(twelve, unit, 12);

      const bySix = await purchase({ product: unit, packCount: 2, unitsPerPack: 6, packCostRef: 6 });
      const byTwelve = await purchase({ product: unit, packCount: 1, unitsPerPack: 12, packCostRef: 12 });
      const byTen = await purchase({ product: unit, packCount: 1, unitsPerPack: 10, packCostRef: 10 });

      expect({ codes: [bySix.code, byTwelve.code, byTen.code], mensaje: byTen.message, stock: (await state([unit]))[0]?.stock }).toEqual({
        codes: [null, null, "PT400"],
        mensaje: "Las unidades por empaque enviadas (10) no coinciden con la conversion registrada del producto (6, 12)",
        stock: 24,
      });
    });
  });

  it("empaque surtido en modo empaque: ingresan EMPAQUES al costo del empaque y las unidades enviadas deben ser el total de la receta; sus componentes no quedan atados a ella", async () => {
    await withRollback(db, async () => {
      const { pack, a, b, c } = await assortedFixture("6.00");
      await recipe(pack, 6, [{ id: a, units: 2 }, { id: b, units: 2 }, { id: c, units: 2 }]);

      const wrong = await purchase({ product: pack, packCount: 4, unitsPerPack: 5, packCostRef: 9 });
      const right = await purchase({ product: pack, packCount: 4, unitsPerPack: 6, packCostRef: 9 });
      const component = await purchase({ product: a, packCount: 2, unitsPerPack: 24, packCostRef: 24 });
      const line = await one("línea del empaque", "select entry_mode, quantity, pack_count, units_per_pack, unit_cost_ref::text as unit_cost_ref from public.purchase_items where product_id = $1", [pack]);

      // create_purchase deja en el producto el costo de la compra: el del EMPAQUE (9,00), no el de una unidad.
      expect({ codes: [wrong.code, right.code, component.code], estado: await state([pack, a]), linea: line, vistas: await integrity([pack, a, b, c]) }).toEqual({
        codes: ["PT400", null, null],
        estado: [
          { stock: 9, cost: "9.00" },
          { stock: 48, cost: "1.00" },
        ],
        linea: { entry_mode: "unit", quantity: 4, pack_count: null, units_per_pack: null, unit_cost_ref: "9.00" },
        vistas: {},
      });
    });
  });
});

// PostgREST solo ve datos confirmados: los productos se crean de verdad y se borran al terminar. Son las llamadas y
// escrituras que hace hoy el BFF (`packConversion.server.ts`, `inventory.server.ts`) y el commit real de una receta.
describe("PostgREST · el BFF de hoy sigue funcionando y una receta se confirma por peticiones", () => {
  const LINKED = "id, sku, name, sale_price_ref, current_cost_ref, current_stock";
  const BFF_SELECT = `id, pack_product_id, unit_product_id, units_per_pack, pack_product:products!pack_product_id(${LINKED}), unit_product:products!unit_product_id(${LINKED})`;
  const PREFIX = `${TAG}-rest`.toLowerCase();

  async function committedProduct(name: string, stock: number): Promise<string> {
    seq += 1;
    const sku = `${PREFIX}-${name}-${seq}`;
    const rows = await lab.rows<{ id: string }>(
      `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $2, 9, 6, 0, 0, true) returning id`,
      [lab.storeId, sku],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`SETUP · producto ${sku}: el insert no devolvió id`);
    if (stock > 0) {
      const admin = await lab.supa("admin");
      const { error } = await admin.rpc("adjust_stock", { p_product_id: id, p_quantity_delta: stock, p_reason: TAG, p_type: "inventario_inicial" });
      if (error) throw new Error(`SETUP · stock inicial de ${sku}: ${error.message}`);
    }
    return id;
  }

  async function cleanup(): Promise<void> {
    const found = await lab.rows<{ id: string }>("select id from public.products where sku like $1", [`${PREFIX}-%`]);
    const ids = found.map((row) => row.id);
    await lab.db.query("begin");
    try {
      await lab.db.query("delete from public.stock_request_keys where result -> 'packMovement' ->> 'product_id' = any($1::text[])", [ids]);
      await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [ids]);
      await lab.db.query("delete from public.products where id = any($1::uuid[])", [ids]);
      await lab.db.query("commit");
    } catch (error) {
      await lab.db.query("rollback").catch(() => undefined);
      await lab.db.query("update public.products set is_active = false where id = any($1::uuid[])", [ids]).catch(() => undefined);
      console.warn(`PRO-12: no se pudieron borrar los datos ${PREFIX} (quedan inactivos): ${failure(error).message}`);
    }
  }

  afterAll(async () => {
    if (lab) await cleanup();
  });

  it("par 1 a 1 por las tablas y la RPC como las usa el BFF anterior: enlazar, leer con sus embebidos, abrir (con y sin clave), cambiar las unidades y desactivar", async () => {
    const almacen = await lab.supa("almacen");
    const [pack, unit] = [await committedProduct("pack", 5), await committedProduct("unit", 0)];
    const requestId = randomUUID();

    const linked = await almacen.from("product_pack_conversions").insert({ pack_product_id: pack, store_id: lab.storeId, unit_product_id: unit, units_per_pack: 6, is_active: true });
    const read = await almacen.from("product_pack_conversions").select(BFF_SELECT).eq("store_id", lab.storeId).eq("is_active", true).or(`pack_product_id.eq.${unit},unit_product_id.eq.${unit}`).maybeSingle();
    const plain = await almacen.rpc("convert_pack_to_units", { p_pack_product_id: pack, p_pack_quantity: 1, p_reason: TAG });
    const keyed = await almacen.rpc("convert_pack_to_units", { p_pack_product_id: pack, p_pack_quantity: 1, p_reason: TAG, p_client_request_id: requestId });
    const retried = await almacen.rpc("convert_pack_to_units", { p_pack_product_id: pack, p_pack_quantity: 1, p_reason: TAG, p_client_request_id: requestId });
    const existing = await almacen.from("product_pack_conversions").select("id").eq("store_id", lab.storeId).eq("pack_product_id", pack).eq("is_active", true).maybeSingle();
    const relinked = await almacen.from("product_pack_conversions").update({ unit_product_id: unit, units_per_pack: 12 }).eq("id", String(existing.data?.id));
    const afterRelink = await almacen.rpc("convert_pack_to_units", { p_pack_product_id: pack, p_pack_quantity: 1, p_reason: TAG });
    const components = await lab.rows("select unit_product_id, units_per_pack from public.product_pack_components where conversion_id = $1", [existing.data?.id]);
    const disabled = await almacen.from("product_pack_conversions").update({ is_active: false }).eq("store_id", lab.storeId).eq("pack_product_id", pack).eq("is_active", true);
    const afterDisable = await almacen.rpc("convert_pack_to_units", { p_pack_product_id: pack, p_pack_quantity: 1, p_reason: TAG });
    const embedded = read.data as { unit_product_id: string; units_per_pack: number; pack_product: unknown; unit_product: unknown } | null;
    const first = (value: unknown): Row | undefined => (Array.isArray(value) ? value[0] : value) as Row | undefined;

    expect({
      errores: [linked.error, read.error, plain.error, keyed.error, retried.error, existing.error, relinked.error, afterRelink.error, disabled.error].map((error) => error?.message ?? null),
      lectura: { unit: embedded?.unit_product_id, units: embedded?.units_per_pack, empaque: first(embedded?.pack_product)?.id, unidad: first(embedded?.unit_product)?.id },
      abrir: [plain.data, keyed.data, afterRelink.data].map((data) => [Object.keys(data as Row).sort().filter((key) => LEGACY_KEYS.includes(key)), (data as Row).unitQuantity, ((data as Row).unitMovement as Row).product_id]),
      reintento: (retried.data as Row | null)?.conversionId === (keyed.data as Row | null)?.conversionId,
      componentes: components,
      desactivada: afterDisable.error?.code,
      stock: await lab.stocks([pack, unit]),
      vistas: await lab.scoped([pack, unit]),
    }).toEqual({
      errores: [null, null, null, null, null, null, null, null, null],
      lectura: { unit, units: 6, empaque: pack, unidad: unit },
      abrir: [
        [LEGACY_KEYS, 6, unit],
        [LEGACY_KEYS, 6, unit],
        [LEGACY_KEYS, 12, unit],
      ],
      reintento: true,
      componentes: [{ unit_product_id: unit, units_per_pack: 12 }],
      desactivada: "PT404",
      stock: { [pack]: 2, [unit]: 24 },
      vistas: Object.fromEntries(INTEGRITY_VIEWS.map((view) => [view, 0])),
    });
  });

  it("receta surtida por peticiones: una cabecera activa sin componentes no se confirma (PT400); inactiva → componentes → activar sí, y se abre con su reparto real", async () => {
    const almacen = await lab.supa("almacen");
    const [pack, a, b, c] = [await committedProduct("surtido", 3), await committedProduct("a", 0), await committedProduct("b", 0), await committedProduct("c", 0)];

    const active = await almacen.from("product_pack_conversions").insert({ pack_product_id: pack, store_id: lab.storeId, total_units: 6, is_active: true });
    const afterActive = await lab.rows("select id from public.product_pack_conversions where pack_product_id = $1", [pack]);
    const header = await almacen.from("product_pack_conversions").insert({ pack_product_id: pack, store_id: lab.storeId, total_units: 6, label: "Surtido 3 sabores", is_active: false }).select("id").single();
    const id = String(header.data?.id);
    const partial = await almacen.from("product_pack_components").insert([
      { conversion_id: id, store_id: lab.storeId, unit_product_id: a, units_per_pack: 2 },
      { conversion_id: id, store_id: lab.storeId, unit_product_id: b, units_per_pack: 2 },
    ]);
    const tooEarly = await almacen.from("product_pack_conversions").update({ is_active: true }).eq("id", id);
    const rest = await almacen.from("product_pack_components").insert({ conversion_id: id, store_id: lab.storeId, unit_product_id: c, units_per_pack: 2, cost_weight: 2 });
    const activated = await almacen.from("product_pack_conversions").update({ is_active: true }).eq("id", id);
    const opened = await almacen.rpc("convert_pack_to_units", {
      p_pack_product_id: pack,
      p_pack_quantity: 1,
      p_reason: TAG,
      p_client_request_id: randomUUID(),
      p_components: [share(a, 3), share(b, 1), share(c, 2)],
    });
    const badSum = await almacen.rpc("convert_pack_to_units", { p_pack_product_id: pack, p_pack_quantity: 1, p_reason: TAG, p_components: [share(a, 3)] });
    const state = await lab.rows("select is_active, unit_product_id, units_per_pack, total_units, label from public.product_pack_conversions where id = $1", [id]);

    expect({
      activaSinComponentes: [active.error?.code, active.status, afterActive.length],
      pasos: [header.error, partial.error, rest.error, activated.error, opened.error].map((error) => error?.message ?? null),
      activarAntes: [tooEarly.error?.code, tooEarly.error?.message],
      sumaMala: [badSum.error?.code, badSum.status],
      cabecera: state,
      entradas: ((opened.data as Row | null)?.components as Row[] | undefined)?.map((x) => [x.unitProductId, x.units]),
      stock: await lab.stocks([pack, a, b, c]),
      vistas: await lab.scoped([pack, a, b, c]),
    }).toEqual({
      activaSinComponentes: ["PT400", 400, 0],
      pasos: [null, null, null, null, null],
      activarAntes: ["PT400", "Los componentes de la receta suman 4 unidades y el empaque declara 6"],
      sumaMala: ["PT400", 400],
      cabecera: [{ is_active: true, unit_product_id: null, units_per_pack: 6, total_units: 6, label: "Surtido 3 sabores" }],
      entradas: [[a, 3], [b, 1], [c, 2]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      stock: { [pack]: 2, [a]: 3, [b]: 1, [c]: 2 },
      vistas: Object.fromEntries(INTEGRITY_VIEWS.map((view) => [view, 0])),
    });
  });

  it("pack_role: el rol de empaque de un producto se lee y se filtra desde products sin listas de ids", async () => {
    const vendedor = await lab.supa("vendedor1");
    const [pack, unit, loose] = [await committedProduct("rol-pack", 0), await committedProduct("rol-unit", 0), await committedProduct("rol-suelto", 0)];
    await lab.rows("insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack) values ($1, $2, $3, 6)", [lab.storeId, pack, unit]);
    const columns = "id, pack_role:pack_role(is_pack, is_component, component_recipes)";

    const all = await vendedor.from("products").select(columns).in("id", [pack, unit, loose]);
    const unlinked = await vendedor
      .from("products")
      .select(columns.replace("pack_role(", "pack_role!inner("), { count: "exact" })
      .like("sku", `${PREFIX}-rol-%`)
      .eq("pack_role.is_pack", false)
      .eq("pack_role.is_component", false);
    const view = await vendedor.from("product_pack_roles").select("product_id, is_pack, is_component").in("product_id", [pack, unit, loose]);
    const anon = await lab.anon().from("product_pack_roles").select("product_id").in("product_id", [pack]);
    const role = (rows: unknown, id: string): unknown => {
      const found = (rows as Array<{ id: string; pack_role: unknown }> | null)?.find((row) => row.id === id)?.pack_role;
      return Array.isArray(found) ? found[0] : found;
    };

    expect({
      errores: [all.error?.message ?? null, unlinked.error?.message ?? null, view.error?.message ?? null],
      roles: [pack, unit, loose].map((id) => role(all.data, id)),
      sinVinculo: [(unlinked.data as Array<{ id: string }> | null)?.map((row) => row.id), unlinked.count],
      vista: view.data?.length,
      anon: anon.data?.length ?? anon.error?.code,
    }).toEqual({
      errores: [null, null, null],
      roles: [
        { is_pack: true, is_component: false, component_recipes: 0 },
        { is_pack: false, is_component: true, component_recipes: 1 },
        { is_pack: false, is_component: false, component_recipes: 0 },
      ],
      sinVinculo: [[loose], 1],
      vista: 3,
      anon: "42501",
    });
  });
});
