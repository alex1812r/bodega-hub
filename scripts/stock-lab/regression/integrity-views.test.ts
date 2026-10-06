/** @jest-environment node */
/**
 * STK-415 · regresión del oráculo de integridad (causa C16): falsos positivos y
 * descuadres no detectados por las vistas del parche 20261005.
 *
 * Cada test enuncia el comportamiento SANO (rojos hasta STK-504, parche
 * 20261006d-stock-integrity-views-v2.sql). Los documentos se crean por el camino real (RPC por PostgREST con
 * la anon key y la sesión de un usuario lab); `pg` (rol postgres) solo prepara
 * datos, inyecta las corrupciones dentro de una transacción que SIEMPRE hace
 * rollback y lee las vistas.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/integrity-views.test.ts
 *
 * Datos propios con prefijo `R415-<nonce>`; se borran al terminar. Un fallo de
 * preparación lanza un error que empieza por "SETUP".
 */
import type { Client } from "pg";

import { Lab, actAs, analyzeChain } from "../scenarios/db";

type Role = "admin" | "almacen" | "vendedor1";
type Report = Record<string, number>;
type Line = { productId: string; quantity: number };

const NONCE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const PREFIX = `R415-${NONCE}`;
const CREATE_SALE_SQL = "select id from public.create_sale($1::uuid, $2::jsonb, null, $3::numeric, 0, 0, $4::text, $5::text)";

let lab: Lab;
let rateVes = 0;
let seq = 0;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

async function setup<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`SETUP · ${what}: ${messageOf(error)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function nextTag(name: string): string {
  seq += 1;
  return `${PREFIX}-${name}-${seq}`;
}

function saleItems(lines: readonly Line[]): Array<Record<string, unknown>> {
  return lines.map((line) => ({ product_id: line.productId, quantity: line.quantity, unit_price_ref: 1 }));
}

/** RPC de preparación por PostgREST como usuario lab: si falla, el test no pudo montarse. */
async function mustRpc(what: string, role: Role, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const client = await lab.supa(role);
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`SETUP · ${what}: ${fn} → ${error.code ?? ""} ${error.message}`);
  return (data ?? {}) as Record<string, unknown>;
}

/** Producto propio; el stock inicial entra por `adjust_stock(inventario_inicial)` como lab-admin. */
async function product(name: string, stock: number): Promise<string> {
  const sku = nextTag(name);
  const rows = await setup(`producto ${sku}`, () =>
    lab.rows<{ id: string }>(
      `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
       values ($1, $2, $3, 1, 1, 0, 0, true) returning id`,
      [lab.storeId, sku, sku],
    ),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`SETUP · producto ${sku}: el insert no devolvió id`);
  if (stock > 0) {
    await mustRpc(`stock inicial de ${sku}`, "admin", "adjust_stock", {
      p_product_id: id,
      p_quantity_delta: stock,
      p_reason: `${PREFIX} inventario inicial`,
      p_type: "inventario_inicial",
    });
  }
  return id;
}

async function sale(name: string, lines: readonly Line[]): Promise<string> {
  const created = await mustRpc(`venta ${name}`, "vendedor1", "create_sale", {
    p_customer_id: lab.customerId,
    p_items: saleItems(lines),
    p_ref_rate_ves: rateVes,
    p_notes: nextTag(name),
    p_invoice_number: nextTag(`${name}-fact`),
  });
  return String(created.id);
}

async function receivedPurchase(name: string, productId: string, quantity: number): Promise<string> {
  const created = await mustRpc(`compra ${name}`, "almacen", "create_purchase", {
    p_supplier_id: lab.supplierId,
    p_items: [
      {
        product_id: productId,
        entry_mode: "unit",
        quantity,
        cost_currency: "ref",
        unit_cost_ref: 1,
        unit_cost_ves: rateVes,
        subtotal_ref: quantity,
        subtotal_ves: quantity * rateVes,
        tax_rate: 0,
        tax_ref: 0,
        tax_ves: 0,
      },
    ],
    p_ref_rate_ves: rateVes,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_notes: nextTag(name),
    p_purchase_number: nextTag(`${name}-num`),
    p_status: "recibido",
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: quantity * rateVes,
    p_subtotal_ref: quantity,
  });
  return String(created.id);
}

/** Filas de `stock_chain_breaks` del producto, tras comprobar que su cadena REAL es consistente. */
async function chainBreaksOfHealthyProduct(productId: string, expectedStock: number): Promise<unknown[]> {
  const stock = await lab.stock(productId);
  const chain = analyzeChain(await lab.movements(productId), stock);
  if (stock !== expectedStock || chain.ledger !== stock || !chain.reorderable || !chain.endsAtCurrentStock) {
    throw new Error(
      `SETUP · la cadena real debía ser consistente con stock ${expectedStock}: stock ${stock}, ${JSON.stringify(chain)}`,
    );
  }
  const rows = await lab.viewRows("stock_chain_breaks", [productId]);
  return rows.map((row) => ({
    type: row.type,
    quantity_delta: row.quantity_delta,
    expected_stock_after: row.expected_stock_after,
    stock_after: row.stock_after,
  }));
}

/**
 * Inyecta una corrupción como `postgres` y devuelve las claves de
 * `stock_integrity_report(tienda lab)` cuyo conteo SUBE por ella. Todo ocurre en
 * una transacción `repeatable read` que siempre hace rollback: la instantánea no
 * ve lo que escriban otros en paralelo (la diferencia es solo la inyección) y
 * nada persiste.
 */
async function reportIncrements(what: string, inject: (db: Client) => Promise<number | null>): Promise<Report> {
  const db = await lab.pg();
  const read = async (): Promise<Report> => {
    const res = await db.query<{ report: Report }>("select public.stock_integrity_report($1::uuid) as report", [lab.storeId]);
    return res.rows[0]?.report ?? {};
  };
  await db.query("begin isolation level repeatable read");
  try {
    const before = await setup(`informe previo a ${what}`, read);
    const touched = await setup(`inyectar ${what}`, () => inject(db));
    if (touched !== 1) throw new Error(`SETUP · inyectar ${what}: debía tocar 1 fila y tocó ${touched}`);
    const after = await setup(`informe tras ${what}`, read);
    const increments: Report = {};
    for (const [key, value] of Object.entries(after)) {
      if (Number(value) > Number(before[key] ?? 0)) increments[key] = Number(value) - Number(before[key] ?? 0);
    }
    return increments;
  } finally {
    await db.query("rollback").catch(() => undefined);
  }
}

/** Las 9 vistas filtradas a los productos dados: solo las que tienen filas (vacío = todo cuadra). */
async function dirtyViews(productIds: readonly string[]): Promise<Report> {
  const counts = await lab.scoped(productIds);
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count !== 0));
}

/** Ajuste de devolución ligado a su documento (STK-503): parte de lo vendido / recibido vuelve por `adjust_stock`. */
async function linkedReturn(what: string, productId: string, delta: number, document: Record<string, string>): Promise<void> {
  await mustRpc(what, "admin", "adjust_stock", {
    p_product_id: productId,
    p_quantity_delta: delta,
    p_reason: `${PREFIX} ${what}`,
    p_type: delta > 0 ? "devolucion_cliente" : "devolucion_proveedor",
    ...document,
  });
}

async function cleanup(): Promise<void> {
  const db = lab.db;
  const found = await db.query<{ id: string }>("select id from public.products where sku like $1", [`${PREFIX}-%`]);
  const ids = found.rows.map((row) => row.id);
  await db.query("begin");
  try {
    await db.query("delete from public.product_pack_conversions where pack_product_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.purchases where notes like $1", [`${PREFIX}-%`]);
    await db.query("delete from public.sales where notes like $1", [`${PREFIX}-%`]);
    await db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.products where id = any($1::uuid[])", [ids]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    await db.query("update public.products set is_active = false where id = any($1::uuid[])", [ids]).catch(() => undefined);
    console.warn(`STK-415: no se pudieron borrar los datos ${PREFIX} (quedan inactivos): ${messageOf(error)}`);
  }
}

beforeAll(async () => {
  lab = await setup("abrir la base lab", () => Lab.open("r415"));
  const rows = await setup("tasa vigente", () =>
    lab.rows<{ rate_ves: string }>(
      "select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
      [lab.storeId],
    ),
  );
  rateVes = Number(rows[0]?.rate_ves);
  if (!Number.isFinite(rateVes) || rateVes <= 0) throw new Error("SETUP · la tienda lab no tiene tasa de cambio");
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

// Plan H7 (oráculo) / G9: la vista ordena por `created_at` (= inicio de la transacción), no por el orden real.
// Reproductor: qa/STK-407 (pares de movimientos invertidos, 715 falsos positivos en 3 semillas) y
// w4-hyp `h07.dg9_interleaved_transactions` / `h07.dg9_repeated_line`.
// Vista: stock_chain_breaks, `window w as (partition by m.product_id order by m.created_at, m.id)`
// (20261005-stock-integrity-views.sql:87).
describe("C16 · stock_chain_breaks da falsos positivos por ordenar con created_at", () => {
  it("dos transacciones cuyo commit va al revés que su created_at no producen filas si la cadena real es consistente", async () => {
    const p = await product("c16a", 10);
    const s1 = await lab.pg();
    const s2 = await lab.pg();
    let committed = false;
    try {
      // S1 abre primero (fija su now() = created_at de sus movimientos) pero vende y confirma DESPUÉS que S2.
      await s1.query("begin");
      await actAs(s1, lab.uids.vendedor1);
      await s1.query("select now()");
      await sleep(50);
      await s2.query("begin");
      await actAs(s2, lab.uids.vendedor2);
      await setup("venta de 1 en S2", () =>
        s2.query(CREATE_SALE_SQL, [
          lab.customerId,
          JSON.stringify(saleItems([{ productId: p, quantity: 1 }])),
          rateVes,
          nextTag("c16a-s2"),
          nextTag("c16a-s2-fact"),
        ]),
      );
      await s2.query("commit");
      await setup("venta de 2 en S1", () =>
        s1.query(CREATE_SALE_SQL, [
          lab.customerId,
          JSON.stringify(saleItems([{ productId: p, quantity: 2 }])),
          rateVes,
          nextTag("c16a-s1"),
          nextTag("c16a-s1-fact"),
        ]),
      );
      await s1.query("commit");
      committed = true;
    } finally {
      if (!committed) {
        await s1.query("rollback").catch(() => undefined);
        await s2.query("rollback").catch(() => undefined);
      }
    }

    // Orden real: inventario 10 → venta −1 (queda 9) → venta −2 (queda 7). Hoy la vista da 2 filas.
    expect(await chainBreaksOfHealthyProduct(p, 7)).toEqual([]);
  });

  it("el mismo producto en dos líneas de un documento no produce filas", async () => {
    const p = await product("c16b", 40);
    // 12 ventas en serie, cada una con el producto en dos líneas (−1 y −2): los dos movimientos comparten
    // created_at y la vista desempata por un id aleatorio (cada documento falla con probabilidad 1/2).
    for (let i = 0; i < 12; i += 1) {
      await sale("c16b", [
        { productId: p, quantity: 1 },
        { productId: p, quantity: 2 },
      ]);
    }

    expect(await chainBreaksOfHealthyProduct(p, 4)).toEqual([]);
  });

  // Hueco de cobertura "C16 falso positivo #27" (caos/fases-1-3.md §2): misma raíz, sin test hasta STK-504.
  it("corregir a mano el created_at de un movimiento legítimo no produce filas", async () => {
    const p = await product("c16-27", 10);
    await sale("c16-27", [{ productId: p, quantity: 1 }]);
    await sale("c16-27", [{ productId: p, quantity: 2 }]);

    const db = await lab.pg();
    let rows: unknown[];
    await db.query("begin");
    try {
      // El último movimiento (venta −2) pasa a ser el más antiguo por fecha.
      const moved = await setup("mover created_at al pasado", () =>
        db.query(
          `update public.stock_movements set created_at = created_at - interval '30 days'
           where id = (select id from public.stock_movements where product_id = $1 order by seq desc limit 1)`,
          [p],
        ),
      );
      if (moved.rowCount !== 1) throw new Error(`SETUP · mover created_at debía tocar 1 fila y tocó ${moved.rowCount}`);
      rows = (await db.query("select movement_id from public.stock_chain_breaks where product_id = $1", [p])).rows;
    } finally {
      await db.query("rollback").catch(() => undefined);
    }

    expect(rows).toEqual([]);
  });
});

// Plan H7 (oráculo) / G14: descuadres reales que ninguna de las 9 vistas ve.
// Reproductor: caos/fases-1-3.md §2 (f2-views.ts, corrupciones #9, #13, #16 y #18 → "NO DETECTADO").
// Vistas: sales_without_movements parte de `sale_items` y excluye `cancelada|borrador`
// (20261005-stock-integrity-views.sql:121); purchases_without_movements solo mira `recibido` (:166);
// movements_without_document y reversal_mismatches solo miran documentos cancelados/devueltos (:229, :278).
describe("C16 · descuadres de documentos mutados que stock_integrity_report no detecta", () => {
  it("una línea de venta borrada tras la venta (su movimiento queda) aparece en alguna vista del informe", async () => {
    const a = await product("c16c-linea-a", 10);
    const b = await product("c16c-linea-b", 10);
    const saleId = await sale("c16c-linea", [
      { productId: a, quantity: 2 },
      { productId: b, quantity: 1 },
    ]);

    const increments = await reportIncrements("borrado de la línea de venta", async (db) => {
      const res = await db.query("delete from public.sale_items where sale_id = $1 and product_id = $2", [saleId, b]);
      return res.rowCount;
    });

    expect(Object.keys(increments).length).toBeGreaterThanOrEqual(1);
  });

  it("una venta cancelada (stock ya devuelto) resucitada a `pagada` aparece en alguna vista del informe", async () => {
    const p = await product("c16c-resucitada", 10);
    const saleId = await sale("c16c-resucitada", [{ productId: p, quantity: 1 }]);
    await mustRpc("cancelar la venta", "vendedor1", "cancel_sale", { p_sale_id: saleId });
    const stock = await lab.stock(p);
    if (stock !== 10) throw new Error(`SETUP · la cancelación debía devolver el stock a 10 y quedó en ${stock}`);

    const increments = await reportIncrements("venta cancelada → pagada", async (db) => {
      const res = await db.query(
        "update public.sales set status = 'pagada', paid_ves = total_ves where id = $1 and status = 'cancelada'",
        [saleId],
      );
      return res.rowCount;
    });

    expect(Object.keys(increments).length).toBeGreaterThanOrEqual(1);
  });

  it("una compra `recibido` devuelta a `pedido` por update directo (stock ya ingresado) aparece en alguna vista del informe", async () => {
    const p = await product("c16c-compra", 0);
    const purchaseId = await receivedPurchase("c16c-compra", p, 10);

    const increments = await reportIncrements("compra recibido → pedido", async (db) => {
      const res = await db.query("update public.purchases set status = 'pedido' where id = $1 and status = 'recibido'", [purchaseId]);
      return res.rowCount;
    });

    expect(Object.keys(increments).length).toBeGreaterThanOrEqual(1);
  });

  it("una venta pasada a `borrador` con su movimiento y su stock descontados aparece en alguna vista del informe", async () => {
    const p = await product("c16c-borrador", 10);
    const saleId = await sale("c16c-borrador", [{ productId: p, quantity: 3 }]);

    const increments = await reportIncrements("venta → borrador", async (db) => {
      const res = await db.query("update public.sales set status = 'borrador' where id = $1", [saleId]);
      return res.rowCount;
    });

    expect(Object.keys(increments).length).toBeGreaterThanOrEqual(1);
  });

  // Simétrico de la venta resucitada (STK-504): mismo hueco en compras.
  it("una compra cancelada (stock ya retirado) resucitada a `recibido` aparece en alguna vista del informe", async () => {
    const p = await product("c16c-compra-resucitada", 0);
    const purchaseId = await receivedPurchase("c16c-compra-resucitada", p, 10);
    await mustRpc("cancelar la compra", "almacen", "cancel_purchase", { p_purchase_id: purchaseId });
    const stock = await lab.stock(p);
    if (stock !== 0) throw new Error(`SETUP · la cancelación debía dejar el stock en 0 y quedó en ${stock}`);

    const increments = await reportIncrements("compra cancelado → recibido", async (db) => {
      const res = await db.query("update public.purchases set status = 'recibido' where id = $1 and status = 'cancelado'", [purchaseId]);
      return res.rowCount;
    });

    expect(Object.keys(increments).length).toBeGreaterThanOrEqual(1);
  });
});

// Plan H7 (oráculo) / G14: la vista compara cada conversión histórica con el `units_per_pack` VIGENTE del par.
// Reproductor: caos/9.6.md (par x12 → x24: 100 filas `ratio_mismatch` falsas) y qa/STK-409 G14 (`low.log`).
// Vista: conversion_mismatches, subconsulta `select c.units_per_pack from product_pack_conversions`
// (20261005-stock-integrity-views.sql:338-343) y filtro `unit_delta <> -pack_delta * units_per_pack`.
describe("C16 · conversion_mismatches marca conversiones antiguas al cambiar el par", () => {
  it("una conversión hecha con x6 no aparece como desajuste por cambiar después el par a x12", async () => {
    const pack = await product("c16d-pack", 3);
    const unit = await product("c16d-unit", 0);
    await setup("par x6", () =>
      lab.rows(
        `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack)
         values ($1, $2, $3, 6)`,
        [lab.storeId, pack, unit],
      ),
    );
    const converted = await mustRpc("conversión de 1 empaque", "almacen", "convert_pack_to_units", {
      p_pack_product_id: pack,
      p_pack_quantity: 1,
      p_reason: nextTag("c16d"),
    });
    const conversionId = String(converted.conversionId);
    const unitStock = await lab.stock(unit);
    if (unitStock !== 6) throw new Error(`SETUP · la conversión x6 debía dejar 6 unidades y dejó ${unitStock}`);

    const db = await lab.pg();
    const mismatches = async (): Promise<unknown[]> => {
      const res = await db.query(
        "select issue, pack_delta, unit_delta, units_per_pack from public.conversion_mismatches where conversion_id = $1",
        [conversionId],
      );
      return res.rows;
    };
    let rows: unknown[];
    await db.query("begin");
    try {
      const before = await setup("vista antes de cambiar el par", mismatches);
      if (before.length !== 0) throw new Error(`SETUP · la conversión ya estaba marcada: ${JSON.stringify(before)}`);
      const updated = await setup("cambiar el par a x12", () =>
        db.query("update public.product_pack_conversions set units_per_pack = 12 where pack_product_id = $1", [pack]),
      );
      if (updated.rowCount !== 1) throw new Error(`SETUP · cambiar el par debía tocar 1 fila y tocó ${updated.rowCount}`);
      rows = await mismatches();
    } finally {
      await db.query("rollback").catch(() => undefined);
    }

    // Hoy: [{ issue: "ratio_mismatch", pack_delta: -1, unit_delta: 6, units_per_pack: 12 }].
    expect(rows).toEqual([]);
  });
});

// STK-504: las vistas v2 miran también los documentos vivos; los flujos legítimos de STK-502/503
// (devolución parcial ligada al documento, reversión de "lo movido − ya devuelto", modo empaque
// sobre el SKU empaque) no deben dejar filas.
describe("C16 · los flujos legítimos no dejan filas en las vistas", () => {
  it("devolución parcial ligada a la venta y luego return_sale del resto", async () => {
    const p = await product("ok-venta-dev", 10);
    const saleId = await sale("ok-venta-dev", [
      { productId: p, quantity: 1 },
      { productId: p, quantity: 2 },
    ]);
    await linkedReturn("devolución parcial de cliente", p, 1, { p_sale_id: saleId });
    // Venta viva con devolución parcial ligada: 10 − 3 + 1.
    expect({ stock: await lab.stock(p), views: await dirtyViews([p]) }).toEqual({ stock: 8, views: {} });

    await mustRpc("devolver la venta", "vendedor1", "return_sale", { p_sale_id: saleId });
    expect({ stock: await lab.stock(p), views: await dirtyViews([p]) }).toEqual({ stock: 10, views: {} });
  });

  // rpc-review R1 (STK-516, parche 20261006f): cancel_sale reponía `sale_items.quantity` completo sin descontar lo ya
  // devuelto con `devolucion_cliente` ligado → stock 11 (1 unidad duplicada) y `reversal_mismatches` 1. Ahora repone
  // "vendido − ya devuelto" como return_sale / cancel_purchase.
  it("devolución parcial ligada a la venta y luego cancel_sale del resto", async () => {
    const p = await product("ok-venta-canc", 10);
    const saleId = await sale("ok-venta-canc", [{ productId: p, quantity: 3 }]);
    await linkedReturn("devolución parcial de cliente", p, 1, { p_sale_id: saleId });
    await mustRpc("cancelar la venta", "vendedor1", "cancel_sale", { p_sale_id: saleId });

    expect({ stock: await lab.stock(p), views: await dirtyViews([p]) }).toEqual({ stock: 10, views: {} });
  });

  it("devolución parcial ligada a la compra y luego return_purchase del resto", async () => {
    const p = await product("ok-compra-dev", 0);
    const purchaseId = await receivedPurchase("ok-compra-dev", p, 10);
    await linkedReturn("devolución parcial a proveedor", p, -4, { p_purchase_id: purchaseId });
    expect({ stock: await lab.stock(p), views: await dirtyViews([p]) }).toEqual({ stock: 6, views: {} });

    await mustRpc("devolver la compra", "almacen", "return_purchase", { p_purchase_id: purchaseId });
    expect({ stock: await lab.stock(p), views: await dirtyViews([p]) }).toEqual({ stock: 0, views: {} });
  });

  it("devolución parcial ligada a la compra y luego cancel_purchase del resto", async () => {
    const p = await product("ok-compra-canc", 0);
    const purchaseId = await receivedPurchase("ok-compra-canc", p, 10);
    await linkedReturn("devolución parcial a proveedor", p, -4, { p_purchase_id: purchaseId });
    await mustRpc("cancelar la compra", "almacen", "cancel_purchase", { p_purchase_id: purchaseId });

    expect({ stock: await lab.stock(p), views: await dirtyViews([p]) }).toEqual({ stock: 0, views: {} });
  });

  it("compra en modo empaque sobre el SKU empaque y sobre el SKU unidad de un par", async () => {
    const pack = await product("ok-pack", 0);
    const unit = await product("ok-unit", 0);
    await setup("par x6", () =>
      lab.rows(
        `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack)
         values ($1, $2, $3, 6)`,
        [lab.storeId, pack, unit],
      ),
    );
    for (const productId of [pack, unit]) {
      await mustRpc("compra en modo empaque", "almacen", "create_purchase", {
        p_supplier_id: lab.supplierId,
        p_items: [
          {
            product_id: productId,
            entry_mode: "pack",
            pack_label: "Bulto x6",
            pack_count: 2,
            units_per_pack: 6,
            pack_cost_ref: 6,
            pack_cost_ves: 6 * rateVes,
            cost_currency: "ref",
            unit_cost_ref: 1,
            unit_cost_ves: rateVes,
            subtotal_ref: 12,
            subtotal_ves: 12 * rateVes,
            tax_rate: 0,
            tax_ref: 0,
            tax_ves: 0,
          },
        ],
        p_ref_rate_ves: rateVes,
        p_discount_ref: 0,
        p_tax_ref: 0,
        p_notes: nextTag("ok-pack"),
        p_purchase_number: nextTag("ok-pack-num"),
        p_status: "recibido",
        p_discount_ves: 0,
        p_tax_ves: 0,
        p_subtotal_ves: 12 * rateVes,
        p_subtotal_ref: 12,
      });
    }

    // Sobre el empaque entran 2 empaques; sobre la unidad, 2 × 6 unidades.
    expect({ pack: await lab.stock(pack), unit: await lab.stock(unit), views: await dirtyViews([pack, unit]) }).toEqual({
      pack: 2,
      unit: 12,
      views: {},
    });
  });
});
