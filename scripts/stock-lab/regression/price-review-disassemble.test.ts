/** @jest-environment node */
/**
 * INT-04 · regresión del parche `20261012b-price-review-disassemble.sql`: la cola "Por revisar" atribuye a la compra el
 * costo que suben los COMPONENTES de un empaque desarmado en su recepción ("Desarmar al recibir", 20261010d). El costo
 * del componente lo fija `convert_pack_to_units` y deja un movimiento `conversion_entrada` sin `purchase_id`; lo que lo
 * une a la compra es `purchase_items.disassembled_conversion_id = stock_movements.conversion_id`. Antes del parche esos
 * productos entraban en `products_price_review` con `purchase_id` nulo y el aviso del detalle de ESA compra (PRO-10)
 * no los listaba.
 *
 * Cada test enuncia el comportamiento SANO. Todo corre por `pg` dentro de una transacción que termina en `rollback`:
 * los datos se preparan como `postgres` y cada sentencia probada se ejecuta con `set local role authenticated` +
 * `request.jwt.claims` del usuario lab. Las compras y las aperturas son reales (`create_purchase`,
 * `receive_purchase_and_disassemble`, `convert_pack_to_units`).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/price-review-disassemble.test.ts
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
type Status = "pedido" | "recibido";
type Line = { product: string; costRef: number; quantity: number; disassemble?: boolean };
type Kit = { pack: string; cola: string; naranja: string; uva: string };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const PATCH = "20261012b-price-review-disassemble.sql";
/** Constraint trigger diferido de 20261010f: el invariante se comprueba al confirmar la transacción. */
const GUARD = "public.purchases_received_disassemble_guard";
const TAG = `INT04-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
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

/**
 * Ejecuta `text` en un savepoint como el usuario lab `role`. Cada llamada equivale a UNA transacción de PostgREST:
 * como aquí todo termina en `rollback`, la comprobación diferida de 20261010f se adelanta al final de la llamada.
 */
async function run(role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint int04");
  try {
    await actAs(db, lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query(`set constraints ${GUARD} immediate`);
    await db.query(`set constraints ${GUARD} deferred`);
    await db.query("reset role");
    await db.query("release savepoint int04");
    return { rows: res.rows, code: null, message: "" };
  } catch (error) {
    await db.query("rollback to savepoint int04");
    await db.query(`set constraints ${GUARD} deferred`);
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

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

/** Producto propio creado como `postgres` (el trigger de las altas le pone su línea base de ganancia). */
async function product(label: string, costRef: number, priceRef: number): Promise<string> {
  seq += 1;
  const name = `${TAG}-${label}-${seq}`;
  const row = await one(
    `producto ${name}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, lower($2), $2, $3, $4, 0, 0, true) returning id`,
    [lab.storeId, name, priceRef, costRef],
  );
  return String(row.id);
}

/**
 * Caja surtida de 6 (2 + 2 + 2). Los sabores cuestan ref 1,50 y se venden a ref 2,20 (46,7 %, verde): abrir una caja
 * comprada a ref 12 los deja en ref 2,00 (10 %, rojo). La caja se vende a ref 30: no baja de banda con la compra.
 */
async function kit(): Promise<Kit> {
  const pack = await product("caja", 10, 30);
  const [cola, naranja, uva] = [await product("cola", 1.5, 2.2), await product("naranja", 1.5, 2.2), await product("uva", 1.5, 2.2)];
  const recipeId = randomUUID();
  await sql("cabecera de receta", "insert into public.product_pack_conversions (id, store_id, pack_product_id, total_units, label, is_active) values ($1, $2, $3, 6, $4, true)", [
    recipeId,
    lab.storeId,
    pack,
    TAG,
  ]);
  for (const unit of [cola, naranja, uva]) {
    await sql("componente de receta", "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight) values ($1, $2, $3, 2, 1)", [
      recipeId,
      lab.storeId,
      unit,
    ]);
  }
  return { pack, cola, naranja, uva };
}

/** `create_purchase` como almacén: líneas exentas. Devuelve id y número. */
async function purchase(lines: readonly Line[], status: Status = "recibido"): Promise<{ id: string; number: string }> {
  const items = lines.map((line) => {
    const subtotalRef = round2(line.quantity * line.costRef);
    return {
      product_id: line.product,
      cost_currency: "ref",
      entry_mode: "unit",
      quantity: line.quantity,
      unit_cost_ref: line.costRef,
      unit_cost_ves: round2(line.costRef * RATE),
      subtotal_ref: subtotalRef,
      subtotal_ves: round2(subtotalRef * RATE),
      tax_rate: 0,
      tax_ref: 0,
      tax_ves: 0,
      ...(line.disassemble ? { disassemble_on_receive: true } : {}),
    };
  });
  const subtotalRef = round2(items.reduce((sum, row) => sum + row.subtotal_ref, 0));
  const rows = await must(
    "almacen",
    `create_purchase ${status}`,
    `select id, purchase_number from public.create_purchase(
       p_supplier_id => $1::uuid, p_items => $2::jsonb, p_ref_rate_ves => $3::numeric, p_discount_ref => 0, p_tax_ref => 0,
       p_notes => $4, p_status => $5::public.purchase_status, p_discount_ves => 0, p_tax_ves => 0,
       p_subtotal_ves => $6::numeric, p_subtotal_ref => $7::numeric)`,
    [lab.supplierId, JSON.stringify(items), RATE, TAG, status, round2(subtotalRef * RATE), subtotalRef],
  );
  return { id: String(rows[0]?.id), number: String(rows[0]?.purchase_number) };
}

/** La fila del producto en la cola, vista como `role`; `null` si no está. */
async function review(productId: string, role: LabRoleKey = "admin"): Promise<Row | null> {
  const rows = await must(
    role,
    "cola",
    `select previous_cost_ref::float8 as costo_antes, current_cost_ref::float8 as costo_ahora, previous_band as banda_antes,
            current_band as banda_ahora, purchase_id, purchase_number, supplier_name, (purchase_received_at is not null) as con_fecha
     from public.products_price_review where product_id = $1`,
    [productId],
  );
  return rows[0] ?? null;
}

/** Ids de producto que el aviso del detalle de una compra pide: la cola filtrada por `purchase_id`. */
async function reviewOfPurchase(purchaseId: string, role: LabRoleKey = "admin"): Promise<string[]> {
  const rows = await must(role, "cola de la compra", "select product_id from public.products_price_review where purchase_id = $1 order by product_id", [purchaseId]);
  return rows.map((row) => String(row.product_id));
}

/** Stock, costo y libro de los productos: lo que el parche NO debe cambiar. */
function footprint(ids: readonly string[]): Promise<Row[]> {
  return sql(
    "huella de stock y costo",
    `select p.id, p.current_stock::float8 as stock, p.current_cost_ref::float8 as costo, p.sale_price_ref::float8 as precio,
            (select count(*)::int from public.stock_movements m where m.product_id = p.id) as movimientos,
            (select count(*)::int from public.product_price_history h where h.product_id = p.id) as historial
     from public.products p where p.id = any($1::uuid[]) order by p.id`,
    [ids],
  );
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

async function supplierName(): Promise<string> {
  return String((await one("proveedor", "select name from public.contacts where id = $1", [lab.supplierId])).name);
}

beforeAll(async () => {
  lab = await Lab.open("int04");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("products_price_review · componentes de un empaque desarmado al recibir", () => {
  it("compra que nace recibida con «Desarmar al recibir»: los 3 sabores entran en la cola con ESA compra, su número y su proveedor", async () => {
    await withRollback(db, async () => {
      const box = await kit();
      const before = await reviewOfPurchase(randomUUID());
      const bought = await purchase([{ product: box.pack, costRef: 12, quantity: 3, disassemble: true }]);
      const expected = {
        costo_antes: 1.5,
        costo_ahora: 2,
        banda_antes: "green",
        banda_ahora: "red",
        purchase_id: bought.id,
        purchase_number: bought.number,
        supplier_name: await supplierName(),
        con_fecha: true,
      };

      expect({
        antes: before,
        cola: await review(box.cola),
        naranja: await review(box.naranja),
        uva: await review(box.uva),
        avisoDeLaCompra: await reviewOfPurchase(bought.id),
        caja: await review(box.pack),
      }).toEqual({
        antes: [],
        cola: expected,
        naranja: expected,
        uva: expected,
        avisoDeLaCompra: sorted([box.cola, box.naranja, box.uva]),
        caja: null,
      });
    });
  });

  it("pedido recibido después con reparto ajustado (7 / 5 / 6): los sabores quedan atribuidos a esa compra, también para almacén", async () => {
    await withRollback(db, async () => {
      const box = await kit();
      const ordered = await purchase([{ product: box.pack, costRef: 12, quantity: 3, disassemble: true }], "pedido");
      const whileOrdered = await reviewOfPurchase(ordered.id);
      const line = await one("línea de la compra", "select id from public.purchase_items where purchase_id = $1", [ordered.id]);
      await must("almacen", "recibir y desarmar", "select id from public.receive_purchase_and_disassemble($1::uuid, $2::jsonb, null)", [
        ordered.id,
        JSON.stringify([
          {
            purchase_item_id: line.id,
            components: [
              { unit_product_id: box.cola, units: 7 },
              { unit_product_id: box.naranja, units: 5 },
              { unit_product_id: box.uva, units: 6 },
            ],
          },
        ]),
      ]);

      expect({
        enPedido: whileOrdered,
        admin: await reviewOfPurchase(ordered.id, "admin"),
        almacen: await reviewOfPurchase(ordered.id, "almacen"),
        cola: await review(box.cola, "almacen"),
      }).toEqual({
        enPedido: [],
        admin: sorted([box.cola, box.naranja, box.uva]),
        almacen: sorted([box.cola, box.naranja, box.uva]),
        cola: expect.objectContaining({ purchase_id: ordered.id, purchase_number: ordered.number, costo_antes: 1.5, costo_ahora: 2 }),
      });
    });
  });

  it("apertura a mano (sin compra que la desarme): los sabores entran en la cola SIN compra, como antes", async () => {
    await withRollback(db, async () => {
      const box = await kit();
      const bought = await purchase([{ product: box.pack, costRef: 12, quantity: 3 }]);
      await must("almacen", "abrir a mano", "select public.convert_pack_to_units($1::uuid, 3, $2, null, null) as r", [box.pack, TAG]);

      expect({ cola: await review(box.cola), avisoDeLaCompra: await reviewOfPurchase(bought.id) }).toEqual({
        cola: expect.objectContaining({ costo_antes: 1.5, costo_ahora: 2, purchase_id: null, purchase_number: null, supplier_name: null, con_fecha: false }),
        avisoDeLaCompra: [],
      });
    });
  });

  it("manda lo más reciente: una compra directa del sabor posterior al desarme se queda con él, y un desarme posterior a una compra directa también", async () => {
    await withRollback(db, async () => {
      const first = await kit();
      const disassembled = await purchase([{ product: first.pack, costRef: 12, quantity: 3, disassemble: true }]);
      const direct = await purchase([{ product: first.cola, costRef: 2.1, quantity: 2 }]);

      const second = await kit();
      const directFirst = await purchase([{ product: second.cola, costRef: 1.6, quantity: 2 }]);
      const disassembledLater = await purchase([{ product: second.pack, costRef: 12, quantity: 3, disassemble: true }]);

      expect({
        colaTrasCompraDirecta: (await review(first.cola))?.purchase_id,
        naranjaSigueConElDesarme: (await review(first.naranja))?.purchase_id,
        avisoDelDesarme: await reviewOfPurchase(disassembled.id),
        colaTrasDesarmePosterior: (await review(second.cola))?.purchase_id,
        avisoDeLaCompraDirecta: await reviewOfPurchase(directFirst.id),
      }).toEqual({
        colaTrasCompraDirecta: direct.id,
        naranjaSigueConElDesarme: disassembled.id,
        avisoDelDesarme: sorted([first.naranja, first.uva]),
        colaTrasDesarmePosterior: disassembledLater.id,
        avisoDeLaCompraDirecta: [],
      });
    });
  });

  it("«Mantener precio» y el reprecio sacan al sabor del aviso de la compra; un desarme anterior a la instantánea no vuelve a atribuirse", async () => {
    await withRollback(db, async () => {
      const box = await kit();
      const bought = await purchase([{ product: box.pack, costRef: 12, quantity: 3, disassemble: true }]);
      await must("admin", "mantener precio", "select id from public.keep_product_price($1::uuid, null)", [box.cola]);
      await must("almacen", "cambiar precio", "select id from public.update_product_price($1::uuid, 2.6, $2)", [box.naranja, TAG]);
      const afterDecisions = await reviewOfPurchase(bought.id);
      // El costo vuelve a subir por una edición (no por una compra): entra en la cola, pero sin compra.
      await sql("subir costo a mano", "update public.products set current_cost_ref = 2.5 where id = $1", [box.naranja]);

      expect({ trasDecidir: afterDecisions, naranjaTrasEdicion: (await review(box.naranja))?.purchase_id, aviso: await reviewOfPurchase(bought.id) }).toEqual({
        trasDecidir: [box.uva],
        naranjaTrasEdicion: null,
        aviso: [box.uva],
      });
    });
  });

  it("otra tienda y un vendedor no obtienen la compra por este camino: la vista sigue leyendo con el RLS de quien llama", async () => {
    await withRollback(db, async () => {
      const box = await kit();
      const bought = await purchase([{ product: box.pack, costRef: 12, quantity: 3, disassemble: true }]);
      const sellerSeesPurchase = await must("vendedor1", "compra como vendedor", "select count(*)::int as n from public.purchases where id = $1", [bought.id]);
      const sellerRow = await review(box.cola, "vendedor1");
      const meta = await one(
        "opciones de la vista",
        "select c.reloptions @> array['security_invoker=true'] as invoker, has_table_privilege('anon', c.oid, 'select') as anon from pg_class c where c.oid = 'public.products_price_review'::regclass",
      );

      expect({
        invoker: meta.invoker,
        anon: meta.anon,
        // El vendedor solo recibe la compra en la cola si su RLS ya le deja leer esa compra.
        vendedorCoherente: Number(sellerSeesPurchase[0]?.n) > 0 ? sellerRow?.purchase_id === bought.id : (sellerRow?.purchase_id ?? null) === null,
      }).toEqual({ invoker: true, anon: false, vendedorCoherente: true });
    });
  });
});

describe("20261012b · forma del parche", () => {
  it("es una transacción que solo redefine la vista y crea un índice: sin RPC, sin escrituras de stock, costo ni dinero", () => {
    const text = readFileSync(resolve(PATCHES, PATCH), "utf8");
    const code = text
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    expect({
      begins: text.match(/^begin;\r?$/gm)?.length,
      commits: text.match(/^commit;\r?$/gm)?.length,
      notify: /^notify pgrst, 'reload schema';\r?$/m.test(text),
      vista: /create or replace view public\.products_price_review\s+with \(security_invoker = true\)/.test(code),
      funciones: /create (or replace )?function/i.test(code),
      escrituras: /\b(insert into|update public\.|delete from|truncate)\b/i.test(code),
      triggers: /create (constraint )?trigger/i.test(code),
    }).toEqual({ begins: 1, commits: 1, notify: true, vista: true, funciones: false, escrituras: false, triggers: false });
  });

  it("reaplicarlo no cambia stock, costo, precio, libro ni historial, y la cola devuelve lo mismo", async () => {
    await withRollback(db, async () => {
      const box = await kit();
      const bought = await purchase([{ product: box.pack, costRef: 12, quantity: 3, disassemble: true }]);
      const ids = [box.pack, box.cola, box.naranja, box.uva];
      const before = { huella: await footprint(ids), aviso: await reviewOfPurchase(bought.id), cola: await review(box.cola) };
      const columnsBefore = await sql("columnas de la vista", "select attname, atttypid::regtype::text as tipo from pg_attribute where attrelid = 'public.products_price_review'::regclass and attnum > 0 order by attnum");

      await sql("reaplicar el parche", patchBody());
      await sql("reaplicar el parche otra vez", patchBody());

      expect({
        huella: await footprint(ids),
        aviso: await reviewOfPurchase(bought.id),
        cola: await review(box.cola),
        columnas: await sql("columnas de la vista", "select attname, atttypid::regtype::text as tipo from pg_attribute where attrelid = 'public.products_price_review'::regclass and attnum > 0 order by attnum"),
      }).toEqual({ ...before, columnas: columnsBefore });
      expect(before.aviso).toEqual(sorted([box.cola, box.naranja, box.uva]));
    });
  });
});
