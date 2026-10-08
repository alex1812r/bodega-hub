/** @jest-environment node */
/**
 * PRO-11 · regresión del parche `20261009c-price-review.sql`: cola "Por revisar" de precios (regla 10b). Al fijar un
 * precio se guarda el costo y la banda de ganancia del momento; si después el costo sube y la banda actual es peor
 * que la guardada, el producto entra en `products_price_review` hasta que se cambie el precio o se elija "Mantener
 * precio" (`keep_product_price`). Nada cambia un precio por su cuenta.
 *
 * Cada test enuncia el comportamiento SANO. Casi todo corre por `pg` dentro de una transacción que termina en
 * `rollback`: los datos se preparan como `postgres` y cada sentencia probada se ejecuta con `set local role
 * authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST). Las compras son reales
 * (`create_purchase` recibida, o en pedido + `receive_purchase`). El último bloque habla con PostgREST (relación
 * calculada `price_review`), que solo ve datos confirmados: crea un producto sin stock ni compras y lo borra al terminar.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/price-review.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import { DEFAULT_MARGIN_THRESHOLDS, marginBand, markupPct, priceFromMarkup } from "@bodega/core";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261009c-price-review.sql";
const PREVIOUS_PATCH = "20261006h-rls-store-scope-and-finite-guards.sql";
const TAG = `PRO11-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const RATE = 100;
const BASELINE = "Línea base de ganancia";
const KEPT = "Precio mantenido";
const SQL_BAND = { high: "green", low: "red", mid: "yellow" } as const;

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
  await db.query("savepoint pro11");
  try {
    await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint pro11");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint pro11");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

/** Como `run`, pero un error es un fallo de preparación. */
async function must(role: LabRoleKey, what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  const out = await run(role, text, params);
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

/** Texto de `create or replace function public.update_product_price(…) … $$;` dentro de un parche. */
function updateProductPriceOf(patch: string): string {
  const text = readFileSync(resolve(PATCHES, patch), "utf8");
  const match = /create or replace function public\.update_product_price\([\s\S]*?\n\$\$;/.exec(text);
  if (!match) throw new Error(`SETUP · ${patch} no define update_product_price`);
  return match[0];
}

/** Producto nuevo creado como `postgres` (el trigger de las altas le pone su línea base). */
async function product(costRef: number, priceRef: number, options: { storeId?: string; isActive?: boolean } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${seq}`.toLowerCase();
  const row = await one(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, $3, $4, 0, 0, $5) returning id`,
    [options.storeId ?? lab.storeId, sku, priceRef, costRef, options.isActive ?? true],
  );
  return String(row.id);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Compra real como `almacen`: una línea exenta por producto, 2 unidades a `costRef`. Recibida, deja ese costo en
 * `products.current_cost_ref` (exenta: el costo con IVA es el mismo). Devuelve el id de la compra.
 */
async function purchase(productIds: readonly string[], costRef: number, status: "pedido" | "recibido" = "recibido"): Promise<string> {
  const quantity = 2;
  const lineSubtotal = round2(quantity * costRef);
  const items = productIds.map((productId) => ({
    product_id: productId,
    cost_currency: "ref",
    entry_mode: "unit",
    quantity,
    unit_cost_ref: costRef,
    unit_cost_ves: round2(costRef * RATE),
    subtotal_ref: lineSubtotal,
    subtotal_ves: round2(lineSubtotal * RATE),
    tax_ref: 0,
    tax_ves: 0,
    tax_rate: 0,
  }));
  const subtotalRef = round2(lineSubtotal * productIds.length);
  const rows = await must(
    "almacen",
    `create_purchase a ${costRef}`,
    `select id from public.create_purchase(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0, p_tax_ref => 0,
       p_notes => $4, p_status => $5::public.purchase_status, p_discount_ves => 0, p_tax_ves => 0,
       p_subtotal_ves => $6::numeric, p_subtotal_ref => $7::numeric)`,
    [lab.supplierId, JSON.stringify(items), RATE, TAG, status, round2(subtotalRef * RATE), subtotalRef],
  );
  return String(rows[0]?.id);
}

async function receive(purchaseId: string): Promise<void> {
  await must("almacen", "receive_purchase", "select id from public.receive_purchase($1::uuid)", [purchaseId]);
}

function keep(role: LabRoleKey | "anon", productId: string, reason: string | null = null): Promise<Outcome> {
  return run(role, "select * from public.keep_product_price($1::uuid, $2)", [productId, reason]);
}

function setPrice(role: LabRoleKey | "anon", productId: string, price: string, reason: string | null = "Cambio"): Promise<Outcome> {
  return run(role, "select id from public.update_product_price($1::uuid, $2::numeric, $3)", [productId, price, reason]);
}

const REVIEW_COLUMNS = `previous_cost_ref::float8 as costo_antes, current_cost_ref::float8 as costo_ahora,
  round(previous_margin_pct, 1)::float8 as pct_antes, round(current_margin_pct, 1)::float8 as pct_ahora,
  previous_band as banda_antes, current_band as banda_ahora, purchase_id, purchase_number, supplier_name,
  (purchase_received_at is not null) as con_fecha`;

/** La fila del producto en la cola, vista como `role`; `null` si no está. */
async function review(productId: string, role: LabRoleKey = "admin"): Promise<Row | null> {
  const rows = await must(role, "cola", `select ${REVIEW_COLUMNS} from public.products_price_review where product_id = $1`, [productId]);
  return rows[0] ?? null;
}

/** Historial del producto en el orden en que se guardó, sin ids ni fechas. */
function history(productId: string): Promise<Row[]> {
  return sql(
    "historial",
    `select old_sale_price_ref::float8 as antes, new_sale_price_ref::float8 as despues, reason,
            cost_ref_snapshot::float8 as costo, margin_band_snapshot as banda
     from public.product_price_history where product_id = $1 order by snapshot_seq nulls first, created_at, id`,
    [productId],
  );
}

async function setThresholds(yellow: number, green: number): Promise<void> {
  await must(
    "admin",
    "umbrales",
    "update public.app_settings set margin_yellow_from_pct = $2, margin_green_from_pct = $3 where store_id = $1 returning store_id",
    [lab.storeId, yellow, green],
  );
}

/** Todos los tests parten de los umbrales por defecto (15 / 25), sea cual sea el estado de la tienda lab. */
async function inLab<T>(fn: () => Promise<T>): Promise<T> {
  return withRollback(db, async () => {
    await sql(
      "umbrales por defecto",
      "update public.app_settings set margin_yellow_from_pct = $2, margin_green_from_pct = $3 where store_id = any($1::uuid[])",
      [[lab.storeId, lab.defaultStoreId], DEFAULT_MARGIN_THRESHOLDS.low, DEFAULT_MARGIN_THRESHOLDS.high],
    );
    return fn();
  });
}

beforeAll(async () => {
  lab = await Lab.open("pro11");
  db = await lab.pg();
  if (!lab.defaultStoreId) throw new Error("SETUP · falta la tienda por defecto (segunda tienda del lab)");
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("product_margin_band · misma regla de bordes que marginBand de @bodega/core", () => {
  it("rojo por debajo de amarillo_desde, amarillo hasta verde_desde, verde desde ahí; sin % es 'none'", async () => {
    await inLab(async () => {
      const values = [-20, 0, 14.999999, 15, 15.000001, 24.999999, 25, 25.000001, 400];
      const rows = await must(
        "vendedor1",
        "bandas",
        `select v::float8 as pct, public.product_margin_band($1, v) as banda from unnest($2::numeric[]) as t(v) order by v`,
        [lab.storeId, values],
      );
      const none = await must("vendedor1", "sin costo", "select public.product_margin_band($1, null) as banda", [lab.storeId]);

      expect({ bandas: rows, sinCosto: none[0]?.banda }).toEqual({
        bandas: values.map((pct) => ({ pct, banda: SQL_BAND[marginBand(pct, DEFAULT_MARGIN_THRESHOLDS)] })),
        sinCosto: "none",
      });
    });
  });

  it("usa los umbrales de la tienda y 15 / 25 si la tienda no tiene fila de ajustes", async () => {
    await inLab(async () => {
      await setThresholds(30, 60);
      const own = await must("admin", "banda propia", "select public.product_margin_band($1, 40) as banda", [lab.storeId]);
      const missing = await sql("banda sin ajustes", "select public.product_margin_band($1, 20) as banda", [randomUUID()]);

      expect({ propia: own[0]?.banda, sinFila: missing[0]?.banda }).toEqual({ propia: "yellow", sinFila: "yellow" });
    });
  });
});

describe("products_price_review · criterio de aceptación de la cola", () => {
  it("costo 8 y precio 10 (25 %, verde) → compra recibida a 9 (11,1 %, rojo): entra con 25 → 11,1, costo 8 → 9 y ESA compra", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      const before = await review(id);
      const purchaseId = await purchase([id], 9);
      const number = await one("número de la compra", "select purchase_number from public.purchases where id = $1", [purchaseId]);
      const supplier = await one("proveedor", "select name from public.contacts where id = $1", [lab.supplierId]);

      expect({ antes: before, despues: await review(id) }).toEqual({
        antes: null,
        despues: {
          costo_antes: 8,
          costo_ahora: 9,
          pct_antes: 25,
          pct_ahora: 11.1,
          banda_antes: "green",
          banda_ahora: "red",
          purchase_id: purchaseId,
          purchase_number: number.purchase_number,
          supplier_name: supplier.name,
          con_fecha: true,
        },
      });
    });
  });

  it("«Mantener precio» lo saca de la cola con una fila de historial sin cambio de precio; otra compra a 9,5 no lo devuelve (sigue rojo)", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      await purchase([id], 9);
      const productBefore = await one("producto antes", "select to_jsonb(p) as fila from public.products p where id = $1", [id]);
      const movementsBefore = await one("movimientos antes", "select count(*)::int as n from public.stock_movements where product_id = $1", [id]);

      const kept = await keep("admin", id);
      const afterKeep = await review(id);
      const productAfter = await one("producto después", "select to_jsonb(p) as fila from public.products p where id = $1", [id]);
      const movementsAfter = await one("movimientos después", "select count(*)::int as n from public.stock_movements where product_id = $1", [id]);
      await purchase([id], 9.5);

      expect({
        code: kept.code,
        trasMantener: afterKeep,
        trasOtraCompra: await review(id),
        productoIntacto: productAfter.fila,
        movimientos: movementsAfter.n,
        historial: await history(id),
      }).toEqual({
        code: null,
        trasMantener: null,
        trasOtraCompra: null,
        productoIntacto: productBefore.fila,
        movimientos: movementsBefore.n,
        historial: [
          { antes: 10, despues: 10, reason: BASELINE, costo: 8, banda: "green" },
          { antes: 10, despues: 10, reason: KEPT, costo: 9, banda: "red" },
        ],
      });
    });
  });

  it("verde → amarillo → mantener → rojo: vuelve a la cola, ahora contra la instantánea amarilla y con la compra nueva", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      await purchase([id], 8.5);
      const yellow = await review(id);
      await keep("almacen", id, "  Lo reviso el lunes  ");
      const kept = await review(id);
      // La segunda compra entra como pedido y se recibe después: receive_purchase también fija el costo.
      const second = await purchase([id], 9, "pedido");
      const ordered = await review(id);
      await receive(second);

      expect({ amarillo: yellow, mantenido: kept, enPedido: ordered, rojo: await review(id), motivo: (await history(id))[1]?.reason }).toEqual({
        amarillo: expect.objectContaining({ banda_antes: "green", banda_ahora: "yellow", costo_antes: 8, costo_ahora: 8.5 }),
        mantenido: null,
        enPedido: null,
        rojo: expect.objectContaining({
          banda_antes: "yellow",
          banda_ahora: "red",
          costo_antes: 8.5,
          costo_ahora: 9,
          pct_antes: 17.6,
          pct_ahora: 11.1,
          purchase_id: second,
        }),
        motivo: "Lo reviso el lunes",
      });
    });
  });

  it("si el costo vuelve a bajar y la banda mejora, sale de la cola sin que nadie haga nada", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      await purchase([id], 9);
      const inQueue = await review(id);
      await purchase([id], 7.9);

      expect({ enCola: inQueue !== null, trasBajar: await review(id), historial: await history(id) }).toEqual({
        enCola: true,
        trasBajar: null,
        historial: [{ antes: 10, despues: 10, reason: BASELINE, costo: 8, banda: "green" }],
      });
    });
  });

  it("un cambio de precio que restaura la banda lo saca y guarda la instantánea nueva; uno que no la restaura lo deja fuera hasta la siguiente subida", async () => {
    await inLab(async () => {
      const restored = await product(8, 10);
      const stillRed = await product(8, 10);
      await purchase([restored, stillRed], 9);

      const a = await setPrice("admin", restored, "11.25");
      const b = await setPrice("almacen", stillRed, "9.50");
      const afterPrice = [await review(restored), await review(stillRed)];
      await purchase([stillRed], 9.4);

      expect({
        codes: [a.code, b.code],
        trasPrecio: afterPrice,
        // 9,50 sobre 9 es rojo y la instantánea también: otra subida no es "peor que rojo".
        trasOtraSubida: await review(stillRed),
        historial: (await history(restored)).slice(1),
      }).toEqual({
        codes: [null, null],
        trasPrecio: [null, null],
        trasOtraSubida: null,
        historial: [{ antes: 10, despues: 11.25, reason: "Cambio", costo: 9, banda: "green" }],
      });
    });
  });

  it("con los umbrales de la tienda cambiados, la banda actual se recalcula con los nuevos", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      await purchase([id], 9);
      const withDefaults = await review(id);
      await setThresholds(5, 10);
      const relaxed = await review(id);
      await setThresholds(5, 12);
      const yellow = await review(id);

      expect({ porDefecto: withDefaults?.banda_ahora, verdeDesde10: relaxed, verdeDesde12: yellow }).toEqual({
        porDefecto: "red",
        // 11,1 % ya es verde: no es peor que la instantánea verde.
        verdeDesde10: null,
        verdeDesde12: expect.objectContaining({ banda_antes: "green", banda_ahora: "yellow", pct_ahora: 11.1 }),
      });
    });
  });

  it("subir el costo sin cambiar de banda, bajar el precio a mano, un producto sin costo y uno inactivo no entran", async () => {
    await inLab(async () => {
      const sameBand = await product(5, 10);
      const lowered = await product(8, 10);
      const noCost = await product(0, 10);
      const inactive = await product(8, 10, { isActive: false });
      await purchase([sameBand], 6);
      await purchase([noCost], 9);
      await sql("costo del inactivo", "update public.products set current_cost_ref = 9 where id = $1", [inactive]);
      await sql("precio bajado por edición", "update public.products set sale_price_ref = 8.5 where id = $1", [lowered]);

      expect({
        mismaBanda: await review(sameBand),
        precioBajado: await review(lowered),
        sinCosto: await review(noCost),
        inactivo: await review(inactive),
        lineaBaseSinCosto: (await history(noCost))[0],
      }).toEqual({
        mismaBanda: null,
        precioBajado: null,
        sinCosto: null,
        inactivo: null,
        lineaBaseSinCosto: { antes: 10, despues: 10, reason: BASELINE, costo: 0, banda: "none" },
      });
    });
  });

  it("si el costo sube por una edición y no por una compra, entra en la cola sin compra", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      await must("admin", "edición del costo", "update public.products set current_cost_ref = 9 where id = $1 returning id", [id]);

      expect(await review(id)).toEqual(
        expect.objectContaining({ costo_antes: 8, costo_ahora: 9, purchase_id: null, purchase_number: null, supplier_name: null, con_fecha: false }),
      );
    });
  });

  it("un producto recién creado por un usuario nace con su línea base y entra en la cola en la primera subida de costo que baja su banda", async () => {
    await inLab(async () => {
      seq += 1;
      const sku = `${TAG}-alta-${seq}`.toLowerCase();
      const created = await run(
        "admin",
        `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
         values ($1, $2, $2, 10, 8, 0, 0) returning id`,
        [lab.storeId, sku],
      );
      const id = String(created.rows[0]?.id);
      const baseline = await sql(
        "línea base",
        `select old_sale_price_ref::float8 as antes, new_sale_price_ref::float8 as despues, reason, changed_by,
                cost_ref_snapshot::float8 as costo, margin_band_snapshot as banda
         from public.product_price_history where product_id = $1`,
        [id],
      );
      const purchaseId = await purchase([id], 9);

      expect({ code: created.code, lineaBase: baseline, cola: await review(id) }).toEqual({
        code: null,
        lineaBase: [{ antes: 10, despues: 10, reason: BASELINE, changed_by: lab.uids.admin, costo: 8, banda: "green" }],
        cola: expect.objectContaining({ banda_antes: "green", banda_ahora: "red", purchase_id: purchaseId }),
      });
    });
  });

  it("40 productos bajan de banda en una sola recepción: los 40 están en la cola con esa compra y el reprecio del lote los saca", async () => {
    await inLab(async () => {
      const ids: string[] = [];
      for (let i = 0; i < 40; i += 1) ids.push(await product(8, 10));
      const purchaseId = await purchase(ids, 9);

      const queued = await must(
        "admin",
        "cola de la compra",
        "select product_id from public.products_price_review where store_id = $1 and purchase_id = $2",
        [lab.storeId, purchaseId],
      );
      const newPrice = priceFromMarkup(9, 25);
      const codes = new Set<string | null>();
      for (const id of ids) codes.add((await setPrice("admin", id, String(newPrice), "Reprecio al 25 %")).code);
      const after = await must("admin", "cola tras el reprecio", "select product_id from public.products_price_review where product_id = any($1::uuid[])", [ids]);
      const prices = await sql("precios", "select distinct sale_price_ref::float8 as precio from public.products where id = any($1::uuid[])", [ids]);

      expect({
        enCola: queued.map((row) => String(row.product_id)).sort(),
        codes: [...codes],
        trasReprecio: after.length,
        precios: prices,
      }).toEqual({ enCola: [...ids].sort(), codes: [null], trasReprecio: 0, precios: [{ precio: 11.25 }] });
    });
  });
});

describe("products_price_review · seguridad (security_invoker + RLS por tienda)", () => {
  it("otra tienda no ve nada: la cola de la tienda default no aparece para los usuarios lab, y anon no la lee", async () => {
    await inLab(async () => {
      const own = await product(8, 10);
      const foreign = await product(8, 10, { storeId: lab.defaultStoreId });
      await purchase([own], 9);
      await sql("costo de la otra tienda", "update public.products set current_cost_ref = 9 where id = $1", [foreign]);
      const asPostgres = await sql("cola como postgres", "select product_id from public.products_price_review where product_id = any($1::uuid[])", [
        [own, foreign],
      ]);

      const seen: Record<string, string[]> = {};
      for (const role of ["admin", "almacen", "vendedor1", "contador"] as const) {
        const out = await run(role, "select product_id from public.products_price_review where product_id = any($1::uuid[])", [[own, foreign]]);
        seen[role] = out.code === null ? out.rows.map((row) => String(row.product_id)) : [out.code];
      }
      const anon = await run("anon", "select product_id from public.products_price_review limit 1");

      expect({ postgres: asPostgres.length, seen, anon: anon.code }).toEqual({
        postgres: 2,
        seen: { admin: [own], almacen: [own], vendedor1: [own], contador: [own] },
        anon: "42501",
      });
    });
  });

  it("keep_product_price: solo admin y almacén (PT403), solo productos de la propia tienda (PT404) y anon no la ejecuta", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      const foreign = await product(8, 10, { storeId: lab.defaultStoreId });
      const inactive = await product(8, 10, { isActive: false });

      const outcomes = {
        vendedor: await keep("vendedor1", id),
        contador: await keep("contador", id),
        anon: await keep("anon", id),
        otraTienda: await keep("admin", foreign),
        inexistente: await keep("admin", randomUUID()),
        // Igual que update_product_price: un producto inactivo no se distingue.
        inactivo: await keep("almacen", inactive),
        precioInactivo: await setPrice("almacen", inactive, "10"),
      };

      expect({
        codes: Object.fromEntries(Object.entries(outcomes).map(([key, out]) => [key, out.code])),
        mensajes: [outcomes.vendedor.message, outcomes.otraTienda.message],
        sinFilasNuevas: (await history(id)).length,
      }).toEqual({
        codes: { vendedor: "PT403", contador: "PT403", anon: "42501", otraTienda: "PT404", inexistente: "PT404", inactivo: null, precioInactivo: null },
        mensajes: ["No autorizado para mantener precios", "Producto no encontrado"],
        sinFilasNuevas: 1,
      });
    });
  });

  it("la función del trigger de la línea base no se puede llamar por /rpc", async () => {
    await inLab(async () => {
      const out = await run("admin", "select public.products_price_baseline()");

      expect(out.code).toBe("42501");
    });
  });
});

// Mismas llamadas con la función de 20261006h (reinstalada dentro de la transacción) y con la de este parche, sobre dos
// productos iguales: lo único que puede diferir son las columnas nuevas de la instantánea, que la huella no mira.
describe("update_product_price · mismo efecto en products y en las columnas previas del historial que la versión de 20261006h", () => {
  /** Todo lo que deja el cambio de precio, sin ids, sku ni fechas. */
  async function footprint(productId: string): Promise<Row> {
    return one(
      "huella del cambio de precio",
      `select
         (select to_jsonb(p) - array['id', 'sku', 'name', 'created_at', 'updated_at'] from public.products p where p.id = $1) as producto,
         (select jsonb_agg(jsonb_build_object('old', h.old_sale_price_ref, 'new', h.new_sale_price_ref, 'reason', h.reason,
            'changed_by', h.changed_by) order by h.snapshot_seq nulls last, h.created_at, h.id)
          from public.product_price_history h where h.product_id = $1 and h.reason is distinct from $2) as historial,
         (select count(*)::int from public.stock_movements m where m.product_id = $1) as movimientos`,
      [productId, BASELINE],
    );
  }

  const CALLS: Array<{ name: string; role: LabRoleKey | "anon"; price: string; reason: string | null }> = [
    { name: "admin sube el precio con motivo", role: "admin", price: "12.35", reason: "Sube el proveedor" },
    { name: "almacén lo baja por debajo del costo sin motivo", role: "almacen", price: "7.10", reason: null },
    { name: "precio 0", role: "admin", price: "0", reason: "Regalo" },
    { name: "precio con más de dos decimales", role: "admin", price: "10.129", reason: null },
    { name: "precio negativo", role: "admin", price: "-1", reason: null },
    { name: "NaN", role: "admin", price: "NaN", reason: null },
    { name: "vendedor", role: "vendedor1", price: "12", reason: null },
    { name: "contador", role: "contador", price: "12", reason: null },
    { name: "anon", role: "anon", price: "12", reason: null },
  ];

  it.each(CALLS)("$name", async ({ role, price, reason }) => {
    await inLab(async () => {
      const before = await product(8, 10);
      const after = await product(8, 10);

      await sql("update_product_price de 20261006h", updateProductPriceOf(PREVIOUS_PATCH));
      const old = await setPrice(role, before, price, reason);
      await sql("update_product_price de 20261009c", updateProductPriceOf(PATCH));
      const current = await setPrice(role, after, price, reason);

      expect({ code: current.code, message: current.message, huella: await footprint(after) }).toEqual({
        code: old.code,
        message: old.message,
        huella: await footprint(before),
      });
    });
  });

  it("producto de otra tienda o inexistente: PT404 en las dos versiones", async () => {
    await inLab(async () => {
      const foreign = await product(8, 10, { storeId: lab.defaultStoreId });
      const missing = randomUUID();

      await sql("update_product_price de 20261006h", updateProductPriceOf(PREVIOUS_PATCH));
      const old = [await setPrice("admin", foreign, "12"), await setPrice("admin", missing, "12")];
      await sql("update_product_price de 20261009c", updateProductPriceOf(PATCH));
      const current = [await setPrice("admin", foreign, "12"), await setPrice("admin", missing, "12")];

      expect(current.map((out) => [out.code, out.message])).toEqual(old.map((out) => [out.code, out.message]));
      expect(current.map((out) => out.code)).toEqual(["PT404", "PT404"]);
    });
  });

  it("la versión nueva guarda en la fila el costo vigente y la banda que deja el precio nuevo", async () => {
    await inLab(async () => {
      const id = await product(8, 10);
      await setPrice("admin", id, "9.00", "Oferta");
      await setPrice("admin", id, "9.60", null);

      const rows = (await history(id)).slice(1);
      const expected = [9, 9.6].map((price) => SQL_BAND[marginBand(markupPct(8, price), DEFAULT_MARGIN_THRESHOLDS)]);

      expect(rows).toEqual([
        { antes: 10, despues: 9, reason: "Oferta", costo: 8, banda: expected[0] },
        { antes: 9, despues: 9.6, reason: null, costo: 8, banda: expected[1] },
      ]);
      expect(expected).toEqual(["red", "yellow"]);
    });
  });
});

describe("20261009c · línea base y reaplicar el parche", () => {
  it("el backfill da línea base solo a los productos sin instantánea, no inventa el costo de las filas viejas y reaplicar no inserta nada más", async () => {
    await inLab(async () => {
      const legacy = await product(8, 10);
      const untouched = await product(8, 10);
      const queued = await product(8, 10);
      await purchase([queued], 9);
      // Producto anterior al parche: su historial no tiene instantáneas.
      await sql("historial heredado", "delete from public.product_price_history where product_id = $1", [legacy]);
      await sql(
        "fila heredada",
        "insert into public.product_price_history (product_id, old_sale_price_ref, new_sale_price_ref, reason) values ($1, 9, 10, 'Cambio viejo')",
        [legacy],
      );
      await sql("costo que subió antes del parche", "update public.products set current_cost_ref = 9 where id = $1", [legacy]);
      const total = async (): Promise<number> => Number((await one("filas", "select count(*)::int as n from public.product_price_history")).n);
      const before = await total();

      await sql("parche (1ª vez)", patchBody());
      const afterFirst = await total();
      const firstHistory = await history(legacy);
      await sql("parche (2ª vez)", patchBody());

      expect({
        nuevas: [afterFirst - before, (await total()) - afterFirst],
        heredado: firstHistory,
        intacto: await history(untouched),
        // La línea base del heredado es el costo de HOY: no entra en la cola por una subida anterior al parche.
        colaHeredado: await review(legacy),
        // Reaplicar no vuelve a tomar instantáneas: quien estaba en la cola sigue en ella.
        colaSigue: (await review(queued)) !== null,
      }).toEqual({
        nuevas: [1, 0],
        heredado: [
          { antes: 9, despues: 10, reason: "Cambio viejo", costo: null, banda: null },
          { antes: 10, despues: 10, reason: BASELINE, costo: 9, banda: "red" },
        ],
        intacto: [{ antes: 10, despues: 10, reason: BASELINE, costo: 8, banda: "green" }],
        colaHeredado: null,
        colaSigue: true,
      });
    });
  });

  it("tras reaplicar, update_product_price sigue guardando la instantánea y NaN en el costo de la instantánea responde PT400", async () => {
    await inLab(async () => {
      await sql("parche", patchBody());
      const id = await product(8, 10);
      await setPrice("admin", id, "12");
      const nan = await run(
        "admin",
        `insert into public.product_price_history (product_id, old_sale_price_ref, new_sale_price_ref, cost_ref_snapshot, margin_band_snapshot, snapshot_seq)
         values ($1, 10, 10, 'NaN'::numeric, 'green', 1)`,
        [id],
      );
      const partial = await run(
        "admin",
        "insert into public.product_price_history (product_id, old_sale_price_ref, new_sale_price_ref, margin_band_snapshot) values ($1, 10, 10, 'green')",
        [id],
      );

      expect({ ultima: (await history(id)).at(-1), nan: nan.code, incompleta: partial.code }).toEqual({
        ultima: { antes: 10, despues: 12, reason: "Cambio", costo: 8, banda: "green" },
        nan: "PT400",
        incompleta: "23514",
      });
    });
  });
});

// PostgREST solo ve datos confirmados: los productos se crean de verdad (sin stock ni compras, no tocan el libro) y se
// borran al terminar. Es el camino del BFF: alta con `select` que embebe la relación calculada y lecturas posteriores.
// (El `returning` de un update ve la cola de ANTES del cambio: por eso el BFF relee el producto tras editarlo.)
describe("PostgREST · relación calculada price_review del listado de productos", () => {
  it("el alta devuelve price_review vacío, el listado la trae tras subir el costo y price_review!inner deja solo los productos en la cola", async () => {
    const columns = "id, price_review:price_review(product_id, previous_band, current_band, previous_cost_ref, current_cost_ref, purchase_id)";
    const admin = await lab.supa("admin");
    const ids: string[] = [];

    try {
      const created = [];
      for (const suffix of ["rest-a", "rest-b"]) {
        const sku = `${TAG}-${suffix}`.toLowerCase();
        const out = await admin
          .from("products")
          .insert({ store_id: lab.storeId, sku, name: sku, sale_price_ref: 10, current_cost_ref: 8, current_stock: 0, min_stock: 0 })
          .select(columns)
          .single();
        if (out.data) ids.push(String(out.data.id));
        created.push({ error: out.error?.message ?? null, price_review: out.data?.price_review ?? null });
      }
      const [inId, outId] = ids;
      const baselines = await lab.rows(
        "select count(*)::int as n from public.product_price_history where product_id = any($1::uuid[]) and snapshot_seq is not null",
        [ids],
      );

      const edited = await admin.from("products").update({ current_cost_ref: 9 }).eq("id", inId).select("id").single();
      const vendedor = await lab.supa("vendedor1");
      const all = await vendedor.from("products").select(columns).in("id", ids).order("sku");
      const only = await vendedor.from("products").select(columns.replace("price_review(", "price_review!inner("), { count: "exact" }).in("id", ids);
      const view = await vendedor.from("products_price_review").select("product_id").in("product_id", ids);

      const expectedReview = {
        product_id: inId,
        previous_band: "green",
        current_band: "red",
        previous_cost_ref: 8,
        current_cost_ref: 9,
        purchase_id: null,
      };
      expect({
        altas: created,
        lineasBase: baselines[0]?.n,
        errores: [edited.error?.message ?? null, all.error?.message ?? null, only.error?.message ?? null, view.error?.message ?? null],
        todos: all.data,
        soloEnCola: only.data,
        cuenta: only.count,
        vista: view.data,
      }).toEqual({
        altas: [
          { error: null, price_review: null },
          { error: null, price_review: null },
        ],
        lineasBase: 2,
        errores: [null, null, null, null],
        todos: [
          { id: inId, price_review: expectedReview },
          { id: outId, price_review: null },
        ],
        soloEnCola: [{ id: inId, price_review: expectedReview }],
        cuenta: 1,
        vista: [{ product_id: inId }],
      });
    } finally {
      await lab.rows("delete from public.products where id = any($1::uuid[])", [ids]);
    }
  });
});
