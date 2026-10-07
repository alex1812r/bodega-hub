/** @jest-environment node */
/**
 * SHR-10 · regresión del parche `20261007a-tax-rates.sql`: catálogo `tax_rates`, sincronización
 * `categories.tax_rate` ↔ `tax_rate_id`, `app_settings.default_tax_rate_id`, migración de datos y
 * `create_purchase` con `tax_rate_code` por línea.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en
 * `rollback` (no queda nada en la base): los datos se preparan como `postgres` y cada sentencia probada se
 * ejecuta con `set local role authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST).
 * El camino por PostgREST de `create_purchase` (solo `tax_rate`, como los clientes actuales) lo recorren
 * `purchases-inventory.test.ts` y `rpc-review*.test.ts`.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/tax-rates.test.ts
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
type Tax = { tax_rate?: number | string; tax_rate_code?: unknown };
type Line =
  | { mode: "unit"; quantity: number; costRef: number }
  | { mode: "pack"; packCount: number; unitsPerPack: number; packCostRef: number };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261007a-tax-rates.sql";
const PREVIOUS_PATCH = "20261006h-rls-store-scope-and-finite-guards.sql";
const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `SHR10-${NONCE}`;
/** Tasa fija de los documentos de prueba: los montos en Bs salen exactos. */
const RATE = 100;

let lab: Lab;
let db: Client;
let seq = 0;

function nextTag(name: string): string {
  seq += 1;
  return `${TAG}-${name}-${seq}`;
}

/** Code de alícuota propio de la corrida (formato `tax_rates_code_format`: minúsculas, dígitos, `-` y `.`). */
function nextCode(name: string): string {
  seq += 1;
  return `t-${name}-${NONCE}-${seq}`.toLowerCase();
}

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
 * Ejecuta `text` dentro de un savepoint, como el usuario lab `role` o, con `null`, como `postgres`. Devuelve el
 * error (SQLSTATE + mensaje) en vez de lanzarlo y deja la transacción utilizable y en el rol de la sesión.
 */
async function run(role: LabRoleKey | null, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint shr10");
  try {
    if (role) await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint shr10");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint shr10");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

async function product(name: string): Promise<string> {
  const sku = nextTag(name).toLowerCase();
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, 9, 0.5, 0, 0, true) returning id`,
    [lab.storeId, sku],
  );
  return String(row.id);
}

/** Alícuota creada como `postgres` (preparación). `storeId` null = global. */
async function taxRate(storeId: string | null, code: string, pct: number, isActive: boolean): Promise<string> {
  const row = await one(
    `alícuota ${code}`,
    "insert into public.tax_rates (store_id, code, label, pct, is_active, sort_order) values ($1, $2, $3, $4, $5, 500) returning id",
    [storeId, code, `Prueba ${code}`, pct, isActive],
  );
  return String(row.id);
}

async function globalRateId(code: string): Promise<string> {
  const row = await one(`alícuota global ${code}`, "select id from public.tax_rates where store_id is null and code = $1", [code]);
  return String(row.id);
}

async function category(taxRatePct: number): Promise<string> {
  const row = await one("categoría", "insert into public.categories (store_id, name, tax_rate) values ($1, $2, $3) returning id", [
    lab.storeId,
    nextTag("cat"),
    taxRatePct,
  ]);
  return String(row.id);
}

function categoryState(id: string): Promise<Row> {
  return one(
    "estado de la categoría",
    `select c.tax_rate::text as pct, t.code, (t.store_id is null) as global
     from public.categories c left join public.tax_rates t on t.id = c.tax_rate_id where c.id = $1`,
    [id],
  );
}

/** Stock visto desde la transacción del test (`lab.stock` usa otra conexión). */
async function stock(productId: string): Promise<number> {
  const row = await one("stock", "select current_stock from public.products where id = $1", [productId]);
  return Number(row.current_stock);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * `create_purchase` de una línea como `almacen`. `pct` es el porcentaje con el que el cliente calculó el
 * impuesto de la línea; `tax` es lo que viaja en el JSON (`tax_rate`, `tax_rate_code`, ambos o ninguno).
 */
function purchase(
  productId: string,
  line: Line,
  pct: number,
  tax: Tax,
  options: { status?: "pedido" | "recibido"; requestId?: string } = {},
): Promise<Outcome> {
  const units = line.mode === "unit" ? line.quantity : line.packCount * line.unitsPerPack;
  const costRef = line.mode === "unit" ? line.costRef : round2(line.packCostRef / line.unitsPerPack);
  const subtotalRef = round2(line.mode === "unit" ? units * costRef : line.packCount * line.packCostRef);
  const taxRef = round2((subtotalRef * pct) / 100);
  const item = {
    product_id: productId,
    cost_currency: "ref",
    unit_cost_ref: costRef,
    unit_cost_ves: round2(costRef * RATE),
    subtotal_ref: subtotalRef,
    subtotal_ves: round2(subtotalRef * RATE),
    tax_ref: taxRef,
    tax_ves: round2(taxRef * RATE),
    ...tax,
    ...(line.mode === "unit"
      ? { entry_mode: "unit", quantity: line.quantity }
      : {
          entry_mode: "pack",
          pack_label: `Bulto x${line.unitsPerPack}`,
          pack_count: line.packCount,
          units_per_pack: line.unitsPerPack,
          pack_cost_ref: line.packCostRef,
          pack_cost_ves: round2(line.packCostRef * RATE),
        }),
  };
  return run(
    "almacen",
    `select id from public.create_purchase(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0, p_tax_ref => $4::numeric,
       p_notes => $5, p_status => $6::public.purchase_status, p_discount_ves => 0, p_tax_ves => $7::numeric,
       p_subtotal_ves => $8::numeric, p_subtotal_ref => $9::numeric, p_client_request_id => $10::uuid)`,
    [
      lab.supplierId,
      JSON.stringify([item]),
      RATE,
      taxRef,
      TAG,
      options.status ?? "recibido",
      round2(taxRef * RATE),
      round2(subtotalRef * RATE),
      subtotalRef,
      options.requestId ?? null,
    ],
  );
}

const UNIT: Line = { mode: "unit", quantity: 5, costRef: 2.5 };

/** Lo que guardó la línea: porcentaje congelado, code y costo final del producto. */
async function taxOf(out: Outcome, productId: string): Promise<Row> {
  if (out.code !== null) return { error: out.code };
  return one(
    "línea de la compra",
    `select pi.tax_rate::text as pct, pi.tax_rate_code as code, pi.tax_ref::text as iva,
            (select current_cost_ref::text from public.products where id = $2) as costo
     from public.purchase_items pi where pi.purchase_id = $1`,
    [out.rows[0]?.id, productId],
  );
}

/** Todo lo que escribe la compra de un producto, sin ids, números de documento ni fechas. */
async function footprint(productId: string): Promise<Row> {
  return one(
    "huella de la compra",
    `select
       (select jsonb_agg(jsonb_build_object(
          'status', pu.status, 'subtotal_ref', pu.subtotal_ref, 'subtotal_ves', pu.subtotal_ves, 'discount_ref', pu.discount_ref,
          'discount_ves', pu.discount_ves, 'tax_ref', pu.tax_ref, 'tax_ves', pu.tax_ves, 'total_ref', pu.total_ref,
          'total_ves', pu.total_ves, 'ref_rate_ves', pu.ref_rate_ves, 'paid_ves', pu.paid_ves) order by pu.created_at)
        from public.purchases pu where pu.id in (select purchase_id from public.purchase_items where product_id = $1)) as compras,
       (select jsonb_agg(to_jsonb(pi) - array['id', 'purchase_id', 'product_id', 'created_at', 'tax_rate_code'])
        from public.purchase_items pi where pi.product_id = $1) as lineas,
       (select jsonb_agg(jsonb_build_object('type', m.type, 'quantity_delta', m.quantity_delta, 'stock_after', m.stock_after,
          'con_compra', m.purchase_id is not null) order by m.seq)
        from public.stock_movements m where m.product_id = $1) as movimientos,
       (select jsonb_build_object('current_stock', p.current_stock, 'current_cost_ref', p.current_cost_ref)
        from public.products p where p.id = $1) as producto,
       (select jsonb_agg(jsonb_build_object('last_cost_ref', sp.last_cost_ref, 'last_cost_ves', sp.last_cost_ves, 'is_active', sp.is_active))
        from public.supplier_products sp where sp.product_id = $1) as proveedor,
       (select jsonb_agg(jsonb_build_object('old_cost_ref', h.old_cost_ref, 'new_cost_ref', h.new_cost_ref, 'new_cost_ves', h.new_cost_ves,
          'origin', h.origin) order by h.created_at)
        from public.supplier_product_price_history h
        join public.supplier_products sp on sp.id = h.supplier_product_id where sp.product_id = $1) as historial`,
    [productId],
  );
}

/** Texto de `create or replace function public.create_purchase(…) … $$;` dentro de un parche. */
function createPurchaseOf(patch: string): string {
  const text = readFileSync(resolve(PATCHES, patch), "utf8");
  const match = /create or replace function public\.create_purchase\([\s\S]*?\n\$\$;/.exec(text);
  if (!match) throw new Error(`SETUP · ${patch} no define create_purchase`);
  return match[0];
}

/** El parche sin su `begin;` / `commit;` (para aplicarlo dentro de la transacción del test) ni el `notify`. */
function patchBody(): string {
  const text = readFileSync(resolve(PATCHES, PATCH), "utf8");
  const begins = text.match(/^begin;\r?$/gm)?.length ?? 0;
  const commits = text.match(/^commit;\r?$/gm)?.length ?? 0;
  if (begins !== 1 || commits !== 1) throw new Error(`SETUP · ${PATCH}: se esperaba un begin y un commit (${begins}/${commits})`);
  return text.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "").replace(/^notify pgrst.*$/m, "");
}

beforeAll(async () => {
  lab = await Lab.open("shr10");
  db = await lab.pg();
  if (!lab.defaultStoreId) throw new Error("SETUP · falta la tienda por defecto (segunda tienda del lab)");
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("create_purchase · el IVA de la línea sale del catálogo tax_rates", () => {
  it("tax_rate_code 'general' sin tax_rate: la línea guarda 16 % y el code, y el costo del producto lleva ese IVA", async () => {
    await withRollback(db, async () => {
      const p = await product("general");

      const out = await purchase(p, UNIT, 16, { tax_rate_code: "general" });

      expect(await taxOf(out, p)).toEqual({ pct: "16.00", code: "general", iva: "2.00", costo: "2.90" });
    });
  });

  it("solo tax_rate 16 (cliente actual): la compra entra y la línea guarda el code 'general'", async () => {
    await withRollback(db, async () => {
      const p = await product("solo-pct");

      const out = await purchase(p, UNIT, 16, { tax_rate: 16 });

      expect(await taxOf(out, p)).toEqual({ pct: "16.00", code: "general", iva: "2.00", costo: "2.90" });
    });
  });

  it("tax_rate_code y tax_rate que coinciden: la compra entra con ese code", async () => {
    await withRollback(db, async () => {
      const p = await product("ambos");

      const out = await purchase(p, UNIT, 8, { tax_rate_code: "reducida", tax_rate: "8.00" });

      expect(await taxOf(out, p)).toEqual({ pct: "8.00", code: "reducida", iva: "1.00", costo: "2.70" });
    });
  });

  it("compra exenta (por code o por tax_rate 0): 0 %, code 'exento' y costo sin IVA", async () => {
    await withRollback(db, async () => {
      const byCode = await product("exento-code");
      const byPct = await product("exento-pct");

      const first = await purchase(byCode, UNIT, 0, { tax_rate_code: "exento" });
      const second = await purchase(byPct, UNIT, 0, { tax_rate: 0 });

      expect([await taxOf(first, byCode), await taxOf(second, byPct)]).toEqual([
        { pct: "0.00", code: "exento", iva: "0.00", costo: "2.50" },
        { pct: "0.00", code: "exento", iva: "0.00", costo: "2.50" },
      ]);
    });
  });

  it("una alícuota activa propia de la tienda se acepta por code y por porcentaje", async () => {
    await withRollback(db, async () => {
      const code = nextCode("propia");
      await taxRate(lab.storeId, code, 12, true);
      const byCode = await product("propia-code");
      const byPct = await product("propia-pct");

      const first = await purchase(byCode, UNIT, 12, { tax_rate_code: code });
      const second = await purchase(byPct, UNIT, 12, { tax_rate: 12 });

      expect([await taxOf(first, byCode), await taxOf(second, byPct)]).toEqual([
        { pct: "12.00", code, iva: "1.50", costo: "2.80" },
        { pct: "12.00", code, iva: "1.50", costo: "2.80" },
      ]);
    });
  });

  it.each<[string, number, Tax]>([
    ["tax_rate 13, que no es ninguna alícuota", 13, { tax_rate: 13 }],
    ["tax_rate_code que no existe", 16, { tax_rate_code: "no-existe" }],
    ["tax_rate_code 'general' con tax_rate 8 (no coinciden)", 16, { tax_rate_code: "general", tax_rate: 8 }],
    ["tax_rate_code 'exento' con tax_rate 16 (no coinciden)", 16, { tax_rate_code: "exento", tax_rate: 16 }],
    ["tax_rate_code que no es un texto", 16, { tax_rate_code: { code: "general" } }],
  ])("%s responde PT400 y no escribe nada", async (_name, pct, tax) => {
    await withRollback(db, async () => {
      const p = await product("rechazo");

      const out = await purchase(p, UNIT, pct, tax);

      expect({ code: out.code, huella: await footprint(p) }).toEqual({
        code: "PT400",
        huella: { compras: null, lineas: null, movimientos: null, producto: { current_stock: 0, current_cost_ref: 0.5 }, proveedor: null, historial: null },
      });
    });
  });

  it("una alícuota inactiva responde PT400 por code y por su porcentaje", async () => {
    await withRollback(db, async () => {
      const code = nextCode("inactiva");
      await taxRate(lab.storeId, code, 11, false);
      const p = await product("inactiva");

      const byCode = await purchase(p, UNIT, 11, { tax_rate_code: code });
      const byPct = await purchase(p, UNIT, 11, { tax_rate: 11 });

      expect({ codes: [byCode.code, byPct.code], stock: await stock(p) }).toEqual({ codes: ["PT400", "PT400"], stock: 0 });
    });
  });

  it("la tienda que desactiva 'reducida' con su propia fila deja de aceptarla; la global sigue activa para las demás", async () => {
    await withRollback(db, async () => {
      await taxRate(lab.storeId, "reducida", 8, false);
      const p = await product("redefinida");

      const byCode = await purchase(p, UNIT, 8, { tax_rate_code: "reducida" });
      const byPct = await purchase(p, UNIT, 8, { tax_rate: 8 });
      const other = await sql(
        "alícuotas de la otra tienda",
        "select code, is_active from public.tax_rates_for_store($1) where code = 'reducida'",
        [lab.defaultStoreId],
      );

      expect({ codes: [byCode.code, byPct.code], otraTienda: other }).toEqual({
        codes: ["PT400", "PT400"],
        otraTienda: [{ code: "reducida", is_active: true }],
      });
    });
  });

  it("la alícuota propia de OTRA tienda no sirve: PT400 por code y por porcentaje", async () => {
    await withRollback(db, async () => {
      const code = nextCode("ajena");
      await taxRate(lab.defaultStoreId, code, 9, true);
      const p = await product("ajena");

      const byCode = await purchase(p, UNIT, 9, { tax_rate_code: code });
      const byPct = await purchase(p, UNIT, 9, { tax_rate: 9 });

      expect([byCode.code, byPct.code]).toEqual(["PT400", "PT400"]);
    });
  });

  it("sin tax_rate ni tax_rate_code la línea se rechaza con el mismo error de siempre", async () => {
    await withRollback(db, async () => {
      const p = await product("sin-iva");

      const out = await purchase(p, UNIT, 0, {});

      expect({ code: out.code, mensaje: out.message }).toEqual({
        code: "PT400",
        mensaje: "Cada item debe enviar costos/subtotales/impuesto en REF y VES",
      });
    });
  });

  it("un tax_rate negativo o mayor que 100 sigue respondiendo el error de montos de siempre", async () => {
    await withRollback(db, async () => {
      const p = await product("fuera-de-rango");

      const negative = await purchase(p, UNIT, 0, { tax_rate: -5 });
      const over = await purchase(p, UNIT, 0, { tax_rate: 101 });

      expect([negative, over].map((out) => [out.code, out.message])).toEqual([
        ["PT400", "Montos invalidos en item de compra"],
        ["PT400", "Montos invalidos en item de compra"],
      ]);
    });
  });

  it("el mismo envío con tax_rate_code y la misma clave de idempotencia deja una sola compra", async () => {
    await withRollback(db, async () => {
      const p = await product("idempotente");
      const requestId = randomUUID();

      const first = await purchase(p, UNIT, 16, { tax_rate_code: "general" }, { requestId });
      const second = await purchase(p, UNIT, 16, { tax_rate_code: "general" }, { requestId });
      const other = await purchase(p, UNIT, 8, { tax_rate_code: "reducida" }, { requestId });

      expect({
        codes: [first.code, second.code, other.code],
        mismaCompra: first.rows[0]?.id === second.rows[0]?.id,
        stock: await stock(p),
      }).toEqual({ codes: [null, null, "PT409"], mismaCompra: true, stock: 5 });
    });
  });

  it("cambiar después el pct de la alícuota no toca la línea ya guardada (snapshot)", async () => {
    await withRollback(db, async () => {
      const code = nextCode("snapshot");
      const id = await taxRate(lab.storeId, code, 12, true);
      const p = await product("snapshot");
      const out = await purchase(p, UNIT, 12, { tax_rate_code: code });

      await sql("cambio legal del pct", "update public.tax_rates set pct = 15 where id = $1", [id]);

      expect(await taxOf(out, p)).toEqual({ pct: "12.00", code, iva: "1.50", costo: "2.80" });
    });
  });
});

// Mismas compras con la función de 20261006h (reinstalada dentro de la transacción) y con la de este parche,
// sobre dos productos nuevos: lo único que puede diferir es `tax_rate_code`, que la huella no mira.
describe("create_purchase · cantidades, costos y totales idénticos a la versión de 20261006h", () => {
  const CASES: Array<{ name: string; line: Line; pct: number; status: "pedido" | "recibido" }> = [
    { name: "unidad recibida al 16 %", line: { mode: "unit", quantity: 7, costRef: 2.35 }, pct: 16, status: "recibido" },
    { name: "empaque recibido exento", line: { mode: "pack", packCount: 3, unitsPerPack: 12, packCostRef: 30 }, pct: 0, status: "recibido" },
    { name: "unidad en pedido al 8 %", line: { mode: "unit", quantity: 4, costRef: 1.99 }, pct: 8, status: "pedido" },
    { name: "empaque recibido al 16 %", line: { mode: "pack", packCount: 2, unitsPerPack: 6, packCostRef: 13.37 }, pct: 16, status: "recibido" },
  ];

  it.each(CASES)("$name", async ({ line, pct, status }) => {
    await withRollback(db, async () => {
      const before = await product("antes");
      const after = await product("despues");

      await sql("create_purchase de 20261006h", createPurchaseOf(PREVIOUS_PATCH));
      const old = await purchase(before, line, pct, { tax_rate: pct }, { status });
      await sql("create_purchase de 20261007a", createPurchaseOf(PATCH));
      const current = await purchase(after, line, pct, { tax_rate: pct }, { status });

      const expected = await footprint(before);
      const units = line.mode === "unit" ? line.quantity : line.packCount * line.unitsPerPack;
      expect({ codes: [old.code, current.code], huella: await footprint(after) }).toEqual({ codes: [null, null], huella: expected });
      // La huella no está vacía: la compra recibida movió exactamente sus unidades, con stock_after puesto por el libro.
      expect(expected.movimientos).toEqual(
        status === "recibido" ? [{ type: "compra", quantity_delta: units, stock_after: units, con_compra: true }] : null,
      );
      expect((expected.lineas as Row[])[0]).toMatchObject({ quantity: units, tax_rate: pct });
    });
  });
});

describe("categories · tax_rate y tax_rate_id se sincronizan en los dos sentidos", () => {
  it("escritor nuevo: tax_rate_id al crear y al cambiar deriva tax_rate (y gana a un tax_rate distinto)", async () => {
    await withRollback(db, async () => {
      const reducida = await globalRateId("reducida");
      const general = await globalRateId("general");

      const created = await run("admin", "insert into public.categories (store_id, name, tax_rate_id) values ($1, $2, $3) returning id", [
        lab.storeId,
        nextTag("cat-nueva"),
        reducida,
      ]);
      const id = String(created.rows[0]?.id);
      const afterInsert = await categoryState(id);
      const changed = await run("almacen", "update public.categories set tax_rate_id = $2, tax_rate = 3 where id = $1 returning id", [id, general]);

      expect({ codes: [created.code, changed.code], alCrear: afterInsert, alCambiar: await categoryState(id) }).toEqual({
        codes: [null, null],
        alCrear: { pct: "8.00", code: "reducida", global: true },
        alCambiar: { pct: "16.00", code: "general", global: true },
      });
    });
  });

  it("escritor antiguo: tax_rate al crear y al cambiar fija la alícuota de ese porcentaje", async () => {
    await withRollback(db, async () => {
      const created = await run("admin", "insert into public.categories (store_id, name, tax_rate) values ($1, $2, 8) returning id", [
        lab.storeId,
        nextTag("cat-antigua"),
      ]);
      const id = String(created.rows[0]?.id);
      const afterInsert = await categoryState(id);
      const changed = await run("almacen", "update public.categories set tax_rate = 0 where id = $1 returning id", [id]);
      const byDefault = await run("admin", "insert into public.categories (store_id, name) values ($1, $2) returning id", [
        lab.storeId,
        nextTag("cat-defecto"),
      ]);

      expect({
        codes: [created.code, changed.code, byDefault.code],
        alCrear: afterInsert,
        alCambiar: await categoryState(id),
        sinNada: await categoryState(String(byDefault.rows[0]?.id)),
      }).toEqual({
        codes: [null, null, null],
        alCrear: { pct: "8.00", code: "reducida", global: true },
        alCambiar: { pct: "0.00", code: "exento", global: true },
        sinNada: { pct: "16.00", code: "general", global: true },
      });
    });
  });

  it("un porcentaje sin alícuota responde PT400 al crear y al cambiar, y la categoría no cambia", async () => {
    await withRollback(db, async () => {
      const id = await category(16);

      const updated = await run("admin", "update public.categories set tax_rate = 13 where id = $1 returning id", [id]);
      const inserted = await run("admin", "insert into public.categories (store_id, name, tax_rate) values ($1, $2, 13) returning id", [
        lab.storeId,
        nextTag("cat-13"),
      ]);

      expect({ codes: [updated.code, inserted.code], categoria: await categoryState(id) }).toEqual({
        codes: ["PT400", "PT400"],
        categoria: { pct: "16.00", code: "general", global: true },
      });
    });
  });

  it("el porcentaje de una alícuota propia de la tienda resuelve a esa alícuota; la de otra tienda no existe (PT400)", async () => {
    await withRollback(db, async () => {
      const own = nextCode("cat-propia");
      await taxRate(lab.storeId, own, 12, true);
      const foreign = await taxRate(lab.defaultStoreId, nextCode("cat-ajena"), 9, true);
      const id = await category(16);

      const byPct = await run("admin", "update public.categories set tax_rate = 12 where id = $1 returning id", [id]);
      const afterOwn = await categoryState(id);
      const foreignPct = await run("admin", "update public.categories set tax_rate = 9 where id = $1 returning id", [id]);
      const foreignId = await run("admin", "update public.categories set tax_rate_id = $2 where id = $1 returning id", [id, foreign]);

      expect({ codes: [byPct.code, foreignPct.code, foreignId.code], propia: afterOwn, final: await categoryState(id) }).toEqual({
        codes: [null, "PT400", "PT400"],
        propia: { pct: "12.00", code: own, global: false },
        final: { pct: "12.00", code: own, global: false },
      });
    });
  });

  it("cambiar el pct de una alícuota lo copia a sus categorías sin cambiarles la alícuota", async () => {
    await withRollback(db, async () => {
      const code = nextCode("propaga");
      const rate = await taxRate(lab.storeId, code, 12, true);
      // Otra alícuota con el porcentaje de destino: la categoría no debe saltar a ella.
      await taxRate(lab.storeId, nextCode("otra-15"), 15, true);
      const id = await category(12);

      const changed = await run("admin", "update public.tax_rates set pct = 15 where id = $1 returning id", [rate]);

      expect({ code: changed.code, categoria: await categoryState(id) }).toEqual({
        code: null,
        categoria: { pct: "15.00", code, global: false },
      });
    });
  });

  it("editar otros campos de la categoría no toca su IVA", async () => {
    await withRollback(db, async () => {
      const id = await category(8);

      const out = await run("almacen", "update public.categories set description = 'SHR-10' where id = $1 returning id", [id]);

      expect({ code: out.code, categoria: await categoryState(id) }).toEqual({
        code: null,
        categoria: { pct: "8.00", code: "reducida", global: true },
      });
    });
  });
});

describe("app_settings · default_tax_rate_id acompaña a default_tax_rate", () => {
  const read = (): Promise<Row> =>
    one(
      "ajustes de la tienda",
      `select s.default_tax_rate::text as pct, t.code
       from public.app_settings s left join public.tax_rates t on t.id = s.default_tax_rate_id where s.store_id = $1`,
      [lab.storeId],
    );

  it("la tienda sembrada ya tiene su alícuota por defecto; cambiar el porcentaje o la alícuota mantiene las dos columnas de acuerdo", async () => {
    await withRollback(db, async () => {
      const seeded = await read();
      const general = await globalRateId("general");

      const byPct = await run("admin", "update public.app_settings set default_tax_rate = 8 where store_id = $1 returning store_id", [lab.storeId]);
      const afterPct = await read();
      const byId = await run("admin", "update public.app_settings set default_tax_rate_id = $2 where store_id = $1 returning store_id", [
        lab.storeId,
        general,
      ]);

      expect({ codes: [byPct.code, byId.code], sembrada: seeded, porPct: afterPct, porId: await read() }).toEqual({
        codes: [null, null],
        sembrada: { pct: "0.00", code: "exento" },
        porPct: { pct: "8.00", code: "reducida" },
        porId: { pct: "16.00", code: "general" },
      });
    });
  });

  it("un porcentaje sin alícuota se sigue guardando (como hoy) y deja default_tax_rate_id vacío; una alícuota de otra tienda responde PT400", async () => {
    await withRollback(db, async () => {
      const foreign = await taxRate(lab.defaultStoreId, nextCode("ajuste-ajeno"), 9, true);

      const legacy = await run("admin", "update public.app_settings set default_tax_rate = 13 where store_id = $1 returning store_id", [lab.storeId]);
      const afterLegacy = await read();
      const wrong = await run("admin", "update public.app_settings set default_tax_rate_id = $2 where store_id = $1 returning store_id", [
        lab.storeId,
        foreign,
      ]);

      expect({ codes: [legacy.code, wrong.code], trasPct: afterLegacy, final: await read() }).toEqual({
        codes: [null, "PT400"],
        trasPct: { pct: "13.00", code: null },
        final: { pct: "13.00", code: null },
      });
    });
  });
});

describe("tax_rates · catálogo: semilla, lectura por tienda y escritura solo del admin sobre las suyas", () => {
  const insert = (role: LabRoleKey, storeId: string | null, code: string): Promise<Outcome> =>
    run(role, "insert into public.tax_rates (store_id, code, label, pct) values ($1, $2, 'Prueba', 5) returning id", [storeId, code]);

  it("semilla global: exento 0, reducida 8 y general 16, activas", async () => {
    const rows = await sql("semilla", "select code, pct::text as pct, is_active from public.tax_rates where store_id is null order by sort_order");

    expect(rows).toEqual([
      { code: "exento", pct: "0.00", is_active: true },
      { code: "reducida", pct: "8.00", is_active: true },
      { code: "general", pct: "16.00", is_active: true },
    ]);
  });

  it("cada usuario lee las globales y las de su tienda, nunca las de otra; anon no lee nada", async () => {
    await withRollback(db, async () => {
      const own = nextCode("lee-propia");
      const foreign = nextCode("lee-ajena");
      await taxRate(lab.storeId, own, 12, true);
      await taxRate(lab.defaultStoreId, foreign, 9, true);
      const visible = "select code from public.tax_rates where code = any($1::text[]) order by code";
      const codes = ["general", own, foreign];

      const seller = await run("vendedor1", visible, [codes]);
      await db.query("savepoint shr10_anon");
      await actAs(db, null);
      const anon = await db.query(visible, [codes]).then(
        () => null,
        (error: unknown) => failure(error).code,
      );
      await db.query("rollback to savepoint shr10_anon");
      await db.query("reset role");

      expect({ vendedor: seller.rows.map((row) => row.code), anon }).toEqual({ vendedor: ["general", own].sort(), anon: "42501" });
    });
  });

  it("solo el admin crea y cambia alícuotas, y solo en su tienda; nadie las borra por PostgREST", async () => {
    await withRollback(db, async () => {
      const code = nextCode("admin");
      const general = await globalRateId("general");

      const created = await insert("admin", lab.storeId, code);
      const id = created.rows[0]?.id;
      const outcomes = {
        almacenCrea: (await insert("almacen", lab.storeId, nextCode("almacen"))).code,
        adminCreaGlobal: (await insert("admin", null, nextCode("global"))).code,
        adminCreaEnOtraTienda: (await insert("admin", lab.defaultStoreId, nextCode("otra"))).code,
        adminDesactiva: (await run("admin", "update public.tax_rates set is_active = false where id = $1 returning id", [id])).rows.length,
        almacenCambia: (await run("almacen", "update public.tax_rates set is_active = true where id = $1 returning id", [id])).rows.length,
        adminCambiaGlobal: (await run("admin", "update public.tax_rates set pct = 18 where id = $1 returning id", [general])).rows.length,
        adminBorra: (await run("admin", "delete from public.tax_rates where id = $1", [id])).code,
        adminCambiaCode: (await run("admin", "update public.tax_rates set code = $2 where id = $1 returning id", [id, nextCode("renombrada")])).code,
      };
      const state = await sql("estado", "select code, is_active from public.tax_rates where id = any($1::uuid[]) order by code", [[id, general]]);

      expect({ creada: created.code, ...outcomes, estado: state }).toEqual({
        creada: null,
        almacenCrea: "42501",
        adminCreaGlobal: "42501",
        adminCreaEnOtraTienda: "42501",
        adminDesactiva: 1,
        almacenCambia: 0,
        adminCambiaGlobal: 0,
        adminBorra: "42501",
        adminCambiaCode: "PT400",
        estado: [
          { code: "general", is_active: true },
          { code, is_active: false },
        ].sort((a, b) => a.code.localeCompare(b.code, "en")),
      });
    });
  });

  it("code único por ámbito: no se repite entre globales ni dentro de una tienda; sí puede redefinirse una global en una tienda", async () => {
    await withRollback(db, async () => {
      const code = nextCode("unico");
      await taxRate(lab.storeId, code, 12, true);

      const sameStore = await run(null, "insert into public.tax_rates (store_id, code, label, pct) values ($1, $2, 'x', 1)", [lab.storeId, code]);
      const sameGlobal = await run(null, "insert into public.tax_rates (store_id, code, label, pct) values (null, 'general', 'x', 1)");
      const otherStore = await run(null, "insert into public.tax_rates (store_id, code, label, pct) values ($1, $2, 'x', 1)", [lab.defaultStoreId, code]);
      const override = await run("admin", "insert into public.tax_rates (store_id, code, label, pct) values ($1, 'general', 'General', 18) returning id", [
        lab.storeId,
      ]);
      const effective = await run("admin", "select pct::text as pct, (store_id is null) as global from public.tax_rates_for_store($1) where code = 'general'", [
        lab.storeId,
      ]);

      expect({ codes: [sameStore.code, sameGlobal.code, otherStore.code, override.code], vigente: effective.rows }).toEqual({
        codes: ["23505", "23505", null, null],
        vigente: [{ pct: "18.00", global: false }],
      });
    });
  });

  it("pct fuera de 0..100, NaN o un code con mayúsculas o espacios se rechazan", async () => {
    await withRollback(db, async () => {
      const bad = async (code: string, pct: string): Promise<string | null> =>
        (await run(null, "insert into public.tax_rates (store_id, code, label, pct) values ($1, $2, 'x', $3::numeric)", [lab.storeId, code, pct])).code;

      expect({
        negativo: await bad(nextCode("neg"), "-1"),
        mayor: await bad(nextCode("mayor"), "100.01"),
        nan: await bad(nextCode("nan"), "NaN"),
        mayusculas: await bad("General", "16"),
        espacios: await bad("iva general", "16"),
      }).toEqual({ negativo: "23514", mayor: "23514", nan: "PT400", mayusculas: "23514", espacios: "23514" });
    });
  });
});

describe("migración de 20261007a · datos anteriores al catálogo", () => {
  /** Estado de todo lo que la migración puede tocar en las dos tiendas del lab. */
  function snapshot(): Promise<Row> {
    return one(
      "estado migrado",
      `select
         (select jsonb_agg(jsonb_build_object('code', code, 'pct', pct, 'is_active', is_active, 'global', store_id is null, 'label', label)
            order by store_id nulls first, pct, code) from public.tax_rates) as alicuotas,
         (select jsonb_agg(jsonb_build_object('name', c.name, 'pct', c.tax_rate, 'code', t.code) order by c.name)
            from public.categories c left join public.tax_rates t on t.id = c.tax_rate_id where c.store_id = $1) as categorias,
         (select jsonb_agg(jsonb_build_object('pct', s.default_tax_rate, 'code', t.code) order by s.store_id)
            from public.app_settings s left join public.tax_rates t on t.id = s.default_tax_rate_id) as ajustes,
         (select jsonb_agg(jsonb_build_object('pct', pi.tax_rate, 'code', pi.tax_rate_code) order by pi.tax_rate)
            from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id where pu.notes = $2) as lineas,
         (select jsonb_agg(jsonb_build_object('code', r.code, 'categorias', r.category_names, 'por_defecto', r.is_store_default) order by r.code)
            from public.tax_rates_pending_review r) as por_revisar`,
      [lab.storeId, TAG],
    );
  }

  it("16 → general, 8 → reducida, 0 → exento, otro pct → 'otro-<pct>' inactiva en su tienda y listada; reaplicar no cambia nada", async () => {
    await withRollback(db, async () => {
      // Estado anterior al parche: columnas nuevas vacías, porcentajes libres y sin los triggers de sincronización.
      const names = { general: nextTag("m-16"), reducida: nextTag("m-8"), exento: nextTag("m-0"), raro: nextTag("m-12.5"), raro2: nextTag("m-12.5b") };
      const lines: Array<[string, number]> = [];
      for (const pct of [16, 8, 0]) lines.push([await product(`m-linea-${pct}`), pct]);
      const orphan = await product("m-linea-9");
      for (const [p, pct] of lines) {
        const out = await purchase(p, UNIT, pct, { tax_rate: pct });
        if (out.code !== null) throw new Error(`SETUP · compra al ${pct} %: ${out.code} ${out.message}`);
      }
      const orphanPurchase = await purchase(orphan, UNIT, 16, { tax_rate: 16 });
      if (orphanPurchase.code !== null) throw new Error(`SETUP · compra huérfana: ${orphanPurchase.code} ${orphanPurchase.message}`);
      await sql(
        "estado anterior al parche",
        `alter table public.categories disable trigger trg_categories_sync_tax_rate;
         alter table public.app_settings disable trigger trg_app_settings_sync_default_tax_rate;
         delete from public.categories where store_id = '${lab.storeId}' and id not in (select category_id from public.products where category_id is not null);
         update public.categories set tax_rate_id = null;
         update public.app_settings set default_tax_rate_id = null;
         update public.app_settings set default_tax_rate = 7 where store_id = '${lab.defaultStoreId}';
         update public.purchase_items set tax_rate_code = null;
         update public.purchase_items set tax_rate = 9 where purchase_id = '${String(orphanPurchase.rows[0]?.id)}';
         delete from public.tax_rates where store_id is not null`,
      );
      await sql(
        "categorías anteriores al parche",
        `insert into public.categories (store_id, name, tax_rate) values ($1, $2, 16), ($1, $3, 8), ($1, $4, 0), ($1, $5, 12.5), ($1, $6, 12.5)`,
        [lab.storeId, names.general, names.reducida, names.exento, names.raro, names.raro2],
      );
      const body = patchBody();

      await sql("primera aplicación", body);
      const first = await snapshot();
      await sql("segunda aplicación", body);
      const second = await snapshot();

      const mine = (first.categorias as Row[]).filter((row) => Object.values(names).includes(String(row.name)));
      expect({
        categorias: mine,
        sinAlicuota: (first.categorias as Row[]).filter((row) => row.code === null).length,
        alicuotasDeTienda: (first.alicuotas as Row[]).filter((row) => row.global === false),
        ajustes: (first.ajustes as Row[]).map((row) => `${String(row.pct)}:${String(row.code)}`).sort(),
        lineas: first.lineas,
        porRevisar: first.por_revisar,
      }).toEqual({
        categorias: [
          { name: names.general, pct: 16, code: "general" },
          { name: names.reducida, pct: 8, code: "reducida" },
          { name: names.exento, pct: 0, code: "exento" },
          { name: names.raro, pct: 12.5, code: "otro-12.5" },
          { name: names.raro2, pct: 12.5, code: "otro-12.5" },
        ].sort((a, b) => a.name.localeCompare(b.name, "en")),
        sinAlicuota: 0,
        alicuotasDeTienda: [
          { code: "otro-7", pct: 7, is_active: false, global: false, label: "Otro 7 %" },
          { code: "otro-12.5", pct: 12.5, is_active: false, global: false, label: "Otro 12,5 %" },
        ],
        ajustes: ["0:exento", "7:otro-7"],
        // tax_rate (snapshot) intacto; la línea al 9 % no corresponde a ninguna alícuota y queda sin code.
        lineas: [
          { pct: 0, code: "exento" },
          { pct: 8, code: "reducida" },
          { pct: 9, code: null },
          { pct: 16, code: "general" },
        ],
        porRevisar: [
          { code: "otro-12.5", categorias: [names.raro, names.raro2].sort((a, b) => a.localeCompare(b, "en")), por_defecto: false },
          { code: "otro-7", categorias: [], por_defecto: true },
        ],
      });
      expect(second).toEqual(first);
    });
  });
});
