/** @jest-environment node */
/**
 * STK-415 · regresión de capa RPC de compras e inventario (causas C6, C13, C14, C15).
 *
 * Cada test enuncia el comportamiento SANO y hoy está ROJO: reproduce un bug
 * sin corregir (la corrección es de la fase 5). Corre contra la base lab local
 * por el camino real: RPC por PostgREST con la anon key y la sesión de un
 * usuario lab; `pg` (rol postgres) solo prepara datos y lee el resultado.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/purchases-inventory.test.ts
 *
 * Datos propios con prefijo `R415-<nonce>`; se borran al terminar. Un fallo de
 * preparación lanza un error que empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { Lab } from "../scenarios/db";

type Role = "admin" | "almacen" | "vendedor1";
type RpcError = { message: string; code?: string };
type RpcOut = { data: unknown; error: RpcError | null };
type PurchaseLine =
  | { productId: string; quantity: number }
  | { productId: string; packCount: number; unitsPerPack: number };

const NONCE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const PREFIX = `R415-${NONCE}`;
/** PostgREST: no existe una función con esos nombres de parámetro. */
const UNKNOWN_SIGNATURE = "PGRST202";

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

async function rpc(role: Role, fn: string, args: Record<string, unknown>): Promise<RpcOut> {
  const client = await lab.supa(role);
  const { data, error } = await client.rpc(fn, args);
  return { data, error: error ? { message: error.message, code: error.code } : null };
}

/** RPC de preparación: si falla, el test no pudo montarse. */
async function mustRpc(what: string, role: Role, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await rpc(role, fn, args);
  if (res.error) throw new Error(`SETUP · ${what}: ${fn} → ${res.error.code ?? ""} ${res.error.message}`);
  return (res.data ?? {}) as Record<string, unknown>;
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

/** Par empaque → unidad propio (no se toca ningún par sembrado). */
async function pair(unitsPerPack: number, packStock: number, unitStock: number): Promise<{ pack: string; unit: string }> {
  const pack = await product("pack", packStock);
  const unit = await product("unit", unitStock);
  await setup(`par x${unitsPerPack}`, () =>
    lab.rows(
      `insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack)
       values ($1, $2, $3, $4)`,
      [lab.storeId, pack, unit, unitsPerPack],
    ),
  );
  return { pack, unit };
}

/** Argumentos de `create_purchase` (costo 1 REF por unidad, sin IVA ni descuento). */
function purchaseArgs(tag: string, status: "pedido" | "recibido", line: PurchaseLine): Record<string, unknown> {
  const units = "packCount" in line ? line.packCount * line.unitsPerPack : line.quantity;
  const common = {
    product_id: line.productId,
    cost_currency: "ref",
    unit_cost_ref: 1,
    unit_cost_ves: rateVes,
    subtotal_ref: units,
    subtotal_ves: units * rateVes,
    tax_rate: 0,
    tax_ref: 0,
    tax_ves: 0,
  };
  const item =
    "packCount" in line
      ? {
          ...common,
          entry_mode: "pack",
          pack_label: `Bulto x${line.unitsPerPack}`,
          pack_count: line.packCount,
          units_per_pack: line.unitsPerPack,
          pack_cost_ref: line.unitsPerPack,
          pack_cost_ves: line.unitsPerPack * rateVes,
        }
      : { ...common, entry_mode: "unit", quantity: line.quantity };
  return {
    p_supplier_id: lab.supplierId,
    p_items: [item],
    p_ref_rate_ves: rateVes,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_notes: tag,
    p_status: status,
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: units * rateVes,
    p_subtotal_ref: units,
  };
}

/**
 * Envía dos veces la MISMA petición con la misma clave de idempotencia.
 *
 * Convención asumida (la de `create_sale_with_payments`, 20260909-create-sale-with-payments.sql:57):
 * parámetro `p_client_request_id uuid`. Si la RPC todavía no lo acepta
 * (PGRST202), el doble envío se repite sin la clave, que es lo único que hoy
 * puede mandar un cliente: así el test falla por la duplicación y no por la
 * firma. Un arreglo puede devolver el documento original o rechazar el
 * segundo envío; aquí solo se cuenta lo que quedó escrito.
 */
async function sendTwice(
  role: Role,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ keyAccepted: boolean; first: RpcOut; second: RpcOut }> {
  const withKey = { ...args, p_client_request_id: randomUUID() };
  const probe = await rpc(role, fn, withKey);
  const keyAccepted = probe.error?.code !== UNKNOWN_SIGNATURE;
  const payload = keyAccepted ? withKey : args;
  const first = keyAccepted ? probe : await rpc(role, fn, payload);
  if (first.error) throw new Error(`SETUP · primer envío de ${fn}: ${first.error.code ?? ""} ${first.error.message}`);
  await sleep(25);
  const second = await rpc(role, fn, payload);
  return { keyAccepted, first, second };
}

async function count(text: string, params: unknown[]): Promise<number> {
  const rows = await lab.rows<{ n: number }>(text, params);
  return rows[0]?.n ?? 0;
}

/** `actual` debe ser uno de los resultados sanos (se compara como JSON para que el fallo enseñe ambos lados). */
function expectOneOf<T>(actual: T, sane: readonly T[]): void {
  const received = JSON.stringify(actual);
  const options = sane.map((option) => JSON.stringify(option));
  expect(received).toBe(options.includes(received) ? received : `uno de: ${options.join(" | ")}`);
}

async function cleanup(): Promise<void> {
  const db = lab.db;
  const found = await db.query<{ id: string }>("select id from public.products where sku like $1", [`${PREFIX}-%`]);
  const ids = found.rows.map((row) => row.id);
  await db.query("begin");
  try {
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

// Plan 9.1 / G5 (hipótesis H8): compras, ajustes y conversiones sin clave de idempotencia.
// Reproductor: w4-hyp `h08.dg5_double_submit` y caos/propios.md G5 (doble POST → 2 documentos, 9 vistas en 0).
// RPC sin `p_client_request_id`: create_purchase (20260905-purchase-line-subtotal-ref.sql:89), adjust_stock
// (20260813h-fix-adjust-stock-store-id.sql:12) y convert_pack_to_units (20260811-pack-unit-conversion.sql:122).
// Modelo de la convención: create_sale_with_payments (20260909-create-sale-with-payments.sql:57).
describe("C6 · compras, ajustes y conversiones sin idempotencia", () => {
  it("create_purchase: el mismo envío repetido con el mismo client_request_id deja una sola compra recibida", async () => {
    const p = await product("c6-compra", 0);
    const tag = nextTag("c6-compra-doc");

    const sent = await sendTwice("almacen", "create_purchase", purchaseArgs(tag, "recibido", { productId: p, quantity: 5 }));

    const actual = {
      compras: await count("select count(*)::int as n from public.purchases where notes = $1", [tag]),
      movimientos: await count("select count(*)::int as n from public.stock_movements where product_id = $1 and type = 'compra'", [p]),
      stock: await lab.stock(p),
    };
    // Hoy: { compras: 2, movimientos: 2, stock: 10 } (clave aceptada: sent.keyAccepted = false).
    expect({ claveAceptada: sent.keyAccepted, ...actual }).toEqual({ claveAceptada: true, compras: 1, movimientos: 1, stock: 5 });
  });

  it("adjust_stock: el mismo ajuste repetido con el mismo client_request_id mueve el stock una sola vez", async () => {
    const p = await product("c6-ajuste", 10);
    const reason = nextTag("c6-ajuste-motivo");

    const sent = await sendTwice("almacen", "adjust_stock", { p_product_id: p, p_quantity_delta: 3, p_reason: reason });

    const actual = {
      movimientos: await count("select count(*)::int as n from public.stock_movements where product_id = $1 and reason = $2", [p, reason]),
      stock: await lab.stock(p),
    };
    // Hoy: { movimientos: 2, stock: 16 }.
    expect({ claveAceptada: sent.keyAccepted, ...actual }).toEqual({ claveAceptada: true, movimientos: 1, stock: 13 });
  });

  it("convert_pack_to_units: la misma conversión repetida con el mismo client_request_id abre un solo empaque", async () => {
    const { pack, unit } = await pair(6, 5, 0);
    const reason = nextTag("c6-conversion-motivo");

    const sent = await sendTwice("almacen", "convert_pack_to_units", {
      p_pack_product_id: pack,
      p_pack_quantity: 1,
      p_reason: reason,
    });

    const actual = {
      conversiones: await count(
        "select count(distinct conversion_id)::int as n from public.stock_movements where product_id = $1 and reason = $2",
        [pack, reason],
      ),
      empaques: await lab.stock(pack),
      unidades: await lab.stock(unit),
    };
    // Hoy: { conversiones: 2, empaques: 3, unidades: 12 }.
    expect({ claveAceptada: sent.keyAccepted, ...actual }).toEqual({ claveAceptada: true, conversiones: 1, empaques: 4, unidades: 6 });
  });
});

// Plan H2 (variante) / G8: el modo empaque confía en el `units_per_pack` del cliente.
// Reproductor: w1-matrix `pack.purchase_pack_upp_mismatch` y `pack.purchase_pack_on_pack_sku`
// (qa/STK-406 C5/C6, manual-repro M17/M18); w4-hyp `h02.dg8`.
// RPC: create_purchase, rama `v_entry_mode = 'pack'` → `v_quantity := v_pack_count * v_units_per_pack`
// sin leer product_pack_conversions (20260905-purchase-line-subtotal-ref.sql:274).
describe("C13 · modo empaque de create_purchase no contrasta con el par", () => {
  it("unitsPerPack distinto al del par se rechaza o se normaliza al del par (2 empaques de un par x12 = 24 unidades)", async () => {
    const { unit } = await pair(12, 0, 0);

    const res = await rpc(
      "almacen",
      "create_purchase",
      purchaseArgs(nextTag("c13a"), "recibido", { productId: unit, packCount: 2, unitsPerPack: 10 }),
    );

    const actual = { rechazada: res.error !== null, unidadesIngresadas: await lab.stock(unit) };
    // Hoy: { rechazada: false, unidadesIngresadas: 20 }.
    expectOneOf(actual, [
      { rechazada: true, unidadesIngresadas: 0 },
      { rechazada: false, unidadesIngresadas: 24 },
    ]);
  });

  it("modo empaque sobre el SKU empaque ingresa packCount empaques o packCount×units a la unidad, nunca packCount×unitsPerPack empaques", async () => {
    const { pack, unit } = await pair(12, 5, 0);

    const res = await rpc(
      "almacen",
      "create_purchase",
      purchaseArgs(nextTag("c13b"), "recibido", { productId: pack, packCount: 2, unitsPerPack: 12 }),
    );

    const actual = {
      rechazada: res.error !== null,
      empaquesIngresados: (await lab.stock(pack)) - 5,
      unidadesIngresadas: await lab.stock(unit),
    };
    // Hoy: { rechazada: false, empaquesIngresados: 24, unidadesIngresadas: 0 } (caja 5 → 29).
    expectOneOf(actual, [
      { rechazada: true, empaquesIngresados: 0, unidadesIngresadas: 0 },
      { rechazada: false, empaquesIngresados: 2, unidadesIngresadas: 0 },
      { rechazada: false, empaquesIngresados: 0, unidadesIngresadas: 24 },
    ]);
  });
});

// Plan H1/H4 (borde): devolver una compra que nunca se recibió.
// Reproductor: qa/STK-406 C7 (manual-repro M24: `pedido` → return 200 → `devuelto` sin movimientos).
// RPC: return_purchase solo rechaza `cancelado|devuelto` y mueve stock `if status = 'recibido'`
// (20260810-rpc-store-context.sql:1087 y :1091).
describe("C14 · return_purchase acepta una compra en pedido", () => {
  it("return_purchase sobre una compra `pedido` se rechaza y la compra sigue en `pedido`", async () => {
    const p = await product("c14", 0);
    const created = await mustRpc(
      "compra en pedido",
      "almacen",
      "create_purchase",
      purchaseArgs(nextTag("c14"), "pedido", { productId: p, quantity: 10 }),
    );
    const purchaseId = String(created.id);

    const res = await rpc("almacen", "return_purchase", { p_purchase_id: purchaseId });

    const rows = await lab.rows<{ status: string }>("select status::text as status from public.purchases where id = $1", [purchaseId]);
    // Hoy: { rechazada: false, estado: "devuelto" }.
    expect({ rechazada: res.error !== null, estado: rows[0]?.status }).toEqual({ rechazada: true, estado: "pedido" });
  });
});

// Plan 8.1 "devolución parcial" / H4 (borde): no hay devolución parcial ligada al documento.
// Reproductor: w1-matrix `*.sale_return_partial` y qa/STK-406 C3 (manual-repro M14: venta de 3,
// ajuste devolucion_cliente +1, return total → +3 más: 1 unidad duplicada con reconcile en 0).
// RPC: return_sale(p_sale_id) repone `sale_items.quantity` completo sin descontar lo ya devuelto
// (20260810-rpc-store-context.sql:928); adjust_stock no acepta `sale_id` (20260813h-fix-adjust-stock-store-id.sql:12).
describe("C15 · devolución parcial sin vínculo con la venta", () => {
  it("Σ unidades repuestas por una venta ≤ unidades vendidas: tras devolver 1 de 3, la devolución total repone como mucho 2", async () => {
    const sold = 3;
    const p = await product("c15", 20);
    const sale = await mustRpc("venta de 3", "vendedor1", "create_sale", {
      p_customer_id: lab.customerId,
      p_items: [{ product_id: p, quantity: sold, unit_price_ref: 1 }],
      p_ref_rate_ves: rateVes,
      p_notes: nextTag("c15"),
      p_invoice_number: nextTag("c15-fact"),
    });
    const saleId = String(sale.id);
    const afterSale = await lab.stock(p);
    if (afterSale !== 20 - sold) throw new Error(`SETUP · la venta debía dejar el stock en ${20 - sold} y quedó en ${afterSale}`);

    // Devolución parcial con lo que hoy existe: ajuste `devolucion_cliente` (+1). Se intenta ligar a la
    // venta (`p_sale_id`); si la RPC no acepta ese parámetro se envía como lo hace hoy el BFF. Un arreglo
    // que rechace el ajuste suelto también cumple el invariante.
    const partial = { p_product_id: p, p_quantity_delta: 1, p_reason: `${PREFIX} devolución parcial`, p_type: "devolucion_cliente" };
    const linked = await rpc("admin", "adjust_stock", { ...partial, p_sale_id: saleId });
    if (linked.error?.code === UNKNOWN_SIGNATURE) await rpc("admin", "adjust_stock", partial);
    // Devolución total posterior de la misma venta.
    await rpc("vendedor1", "return_sale", { p_sale_id: saleId });

    const restocked = (await lab.stock(p)) - afterSale;
    // Hoy: 4 unidades repuestas de 3 vendidas (stock 21 con 20 iniciales).
    expect(restocked).toBeLessThanOrEqual(sold);
  });
});
