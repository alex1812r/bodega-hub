/**
 * CNF-14 · El impact de una compra predice lo que `receive_purchase_and_disassemble` /
 * `cancel_purchase` / `return_purchase` aplican.
 *
 * Por cada caso: se crea la compra por las RPC reales (supabase-js + sesión de un
 * usuario lab), se calcula el impact con el MISMO código del BFF
 * (`loadPurchaseImpactInputs` + `computePurchaseImpact`), se comprueba que calcularlo no
 * escribió nada, se ejecuta la RPC real y se compara lo aplicado con lo predicho:
 * stock y costo por producto (también los componentes de un empaque desarmado), líneas
 * desarmadas, estado de la compra, y que ni los pagos ni el baúl se mueven. En los
 * rechazos, el mensaje y el código de la RPC son los de `reason` / `reasonCode` y no
 * cambia nada.
 *
 * Corre contra la base lab local (`npm run stock-lab:test`). `pg` (rol postgres)
 * solo prepara datos y lee el resultado. Datos propios con prefijo `RIMC-<nonce>`;
 * se borran en `afterAll`. Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toRpcDisassembleList } from "../../../src/modules/purchases/services/purchaseDisassemble";
import {
  computePurchaseImpact,
  type PurchaseImpact,
  type PurchaseImpactAction,
  type PurchaseImpactDisassembleEntry,
} from "../../../src/modules/purchases/services/purchaseImpact";
import { loadPurchaseImpactInputs } from "../../../src/modules/purchases/services/purchaseImpact.server";
import type { LabRoleKey } from "../agents/base";
import { Lab } from "../scenarios/db";

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
/** Roles con `purchases.create`. Solo admin ve pagos de compras (20261010c). */
type Buyer = "admin" | "almacen";
type Line = { costRef?: number; disassemble?: boolean; product: string; quantity: number; taxRate?: number };
type ImpactOptions = { disassemble?: PurchaseImpactDisassembleEntry[]; storeId?: string };

const NONCE = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const TAG = `RIMC-${NONCE}`;
const REJECTION_CODES: Record<string, string> = {
  PT400: "BAD_REQUEST",
  PT403: "FORBIDDEN",
  PT404: "NOT_FOUND",
  PT409: "CONFLICT",
};

let lab: Lab;
let seq = 0;
const productIds: string[] = [];
const recipeIds: string[] = [];
const foreignPurchaseIds: string[] = [];
const foreignContactIds: string[] = [];

const round2 = (value: number): number => Math.round(value * 100) / 100;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

async function setup<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`SETUP ${what}: ${messageOf(error)}`);
  }
}

async function rpcAs(role: LabRoleKey, fn: string, args: Row): Promise<RpcResult> {
  const client: SupabaseClient = await setup(`sesión de ${role}`, () => lab.supa(role));
  const { data, error } = await client.rpc(fn, args);
  return { data, error };
}

async function rpcOk(role: LabRoleKey, fn: string, args: Row): Promise<Row> {
  const res = await rpcAs(role, fn, args);
  if (res.error) throw new Error(`SETUP ${fn} como ${role}: ${res.error.code ?? ""} ${res.error.message}`);
  return (res.data ?? {}) as Row;
}

async function one(text: string, params: unknown[]): Promise<Row> {
  const rows = await lab.rows(text, params);
  if (!rows[0]) throw new Error(`SETUP sin filas: ${text}`);
  return rows[0];
}

async function rate(): Promise<number> {
  const row = await one(
    "select rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
    [lab.storeId],
  );
  return Number(row.rate_ves);
}

async function mkProduct(key: string, stock: number, options: { active?: boolean; costRef?: number } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${key}-${seq}`;
  const row = await one(
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $3, 9, $4::numeric, 0, 0, true) returning id`,
    [lab.storeId, sku, `Producto ${sku}`, String(options.costRef ?? 0.5)],
  );
  const id = String(row.id);
  productIds.push(id);
  if (stock > 0) {
    await rpcOk("admin", "adjust_stock", {
      p_product_id: id,
      p_quantity_delta: stock,
      p_reason: `${TAG} inventario inicial`,
      p_type: "inventario_inicial",
    });
  }
  if (options.active === false) await lab.db.query("update public.products set is_active = false where id = $1", [id]);
  return id;
}

/** Receta activa del empaque, insertada como `postgres`. */
async function mkRecipe(pack: string, components: Array<{ id: string; units: number; weight?: number }>): Promise<void> {
  const id = randomUUID();
  const total = components.reduce((sum, component) => sum + component.units, 0);
  recipeIds.push(id);
  await lab.db.query(
    "insert into public.product_pack_conversions (id, store_id, pack_product_id, total_units, label, is_active) values ($1, $2, $3, $4, $5, true)",
    [id, lab.storeId, pack, total, TAG],
  );
  for (const component of components) {
    await lab.db.query(
      "insert into public.product_pack_components (conversion_id, store_id, unit_product_id, units_per_pack, cost_weight) values ($1, $2, $3, $4, $5::numeric)",
      [id, lab.storeId, component.id, component.units, String(component.weight ?? 1)],
    );
  }
}

/** Compra por `create_purchase` como almacén. Devuelve su id. */
async function mkPurchase(status: "pedido" | "recibido", lines: Line[]): Promise<string> {
  seq += 1;
  const rateVes = await rate();
  const items = lines.map((line) => {
    const costRef = line.costRef ?? 1;
    const taxRate = line.taxRate ?? 0;
    const subtotalRef = round2(line.quantity * costRef);
    const taxRef = round2((subtotalRef * taxRate) / 100);
    return {
      cost_currency: "ref",
      entry_mode: "unit",
      product_id: line.product,
      quantity: line.quantity,
      subtotal_ref: subtotalRef,
      subtotal_ves: round2(subtotalRef * rateVes),
      tax_rate: taxRate,
      tax_ref: taxRef,
      tax_ves: round2(taxRef * rateVes),
      unit_cost_ref: costRef,
      unit_cost_ves: round2(costRef * rateVes),
      ...(line.disassemble ? { disassemble_on_receive: true } : {}),
    };
  });
  const subtotalRef = round2(items.reduce((sum, item) => sum + item.subtotal_ref, 0));
  const taxRef = round2(items.reduce((sum, item) => sum + item.tax_ref, 0));
  const created = await rpcOk("almacen", "create_purchase", {
    p_discount_ref: 0,
    p_discount_ves: 0,
    p_items: items,
    p_purchase_number: `${TAG}-C${seq}`,
    p_ref_rate_ves: rateVes,
    p_status: status,
    p_subtotal_ref: subtotalRef,
    p_subtotal_ves: round2(subtotalRef * rateVes),
    p_supplier_id: lab.supplierId,
    p_tax_ref: taxRef,
    p_tax_ves: round2(taxRef * rateVes),
  });
  return String(created.id);
}

/** Paga la compra entera en efectivo Bs desde el baúl (con un depósito previo que lo cubre). */
async function payPurchase(purchaseId: string): Promise<string> {
  const purchase = await one("select total_ves::float8 as total_ves from public.purchases where id = $1", [purchaseId]);
  await rpcOk("admin", "register_vault_deposit", {
    p_amount_ref: 0,
    p_amount_ves: Number(purchase.total_ves),
    p_notes: `${TAG} fondo`,
  });
  const payment = await rpcOk("admin", "register_payment", {
    p_amount: Number(purchase.total_ves),
    p_method: "efectivo_ves",
    p_purchase_id: purchaseId,
  });
  return String(payment.id);
}

type Snapshot = {
  cost: Record<string, number | null>;
  disassembled: Record<string, boolean>;
  payments: Record<string, string>;
  purchase: { paidVes: number; status: string };
  reversals: Record<string, number>;
  stock: Record<string, number>;
  vault: Row | null;
  vaultMovements: number;
};

/** Todo lo que recibir, cancelar o devolver pueden tocar (y lo que NO deben tocar), leído por `pg`. */
async function snapshot(purchaseId: string, watch: string[]): Promise<Snapshot> {
  const purchase = await one(
    "select status::text as status, paid_ves::float8 as paid_ves from public.purchases where id = $1",
    [purchaseId],
  );
  const products = await lab.rows<{ cost: number | null; id: string; stock: number }>(
    `select p.id, p.current_stock as stock, p.current_cost_ref::float8 as cost from public.products p
     where p.id = any($2::uuid[]) or p.id in (select product_id from public.purchase_items where purchase_id = $1)`,
    [purchaseId, watch],
  );
  const items = await lab.rows<{ id: string; opened: boolean }>(
    "select id, disassembled_conversion_id is not null as opened from public.purchase_items where purchase_id = $1",
    [purchaseId],
  );
  const payments = await lab.rows<{ id: string; status: string }>(
    "select id, status::text as status from public.payments where purchase_id = $1",
    [purchaseId],
  );
  const reversals = await lab.rows<{ product_id: string; units: number }>(
    `select product_id, sum(quantity_delta)::int as units from public.stock_movements
     where purchase_id = $1 and type in ('ajuste_salida', 'devolucion_proveedor') group by product_id`,
    [purchaseId],
  );
  const vault = await lab.rows(
    `select balance_ves::float8 as ves, balance_efectivo_ves::float8 as efectivo, balance_ref::float8 as ref
     from public.store_vaults where store_id = $1`,
    [lab.storeId],
  );
  const vaultMovements = await one("select count(*)::int as total from public.vault_movements where store_id = $1", [
    lab.storeId,
  ]);
  return {
    cost: Object.fromEntries(products.map((row) => [row.id, row.cost === null ? null : Number(row.cost)])),
    disassembled: Object.fromEntries(items.map((row) => [row.id, row.opened])),
    payments: Object.fromEntries(payments.map((row) => [row.id, row.status])),
    purchase: { paidVes: Number(purchase.paid_ves), status: String(purchase.status) },
    reversals: Object.fromEntries(reversals.map((row) => [row.product_id, row.units])),
    stock: Object.fromEntries(products.map((row) => [row.id, row.stock])),
    vault: vault[0] ?? null,
    vaultMovements: Number(vaultMovements.total),
  };
}

/** El impact tal como lo calcula el BFF: lecturas del usuario + pagos de la compra con service role. */
async function impactOf(
  role: Buyer,
  purchaseId: string,
  action: PurchaseImpactAction,
  options: ImpactOptions = {},
): Promise<PurchaseImpact> {
  const user = await lab.supa(role);
  return computePurchaseImpact(
    await loadPurchaseImpactInputs(
      { privileged: () => lab.service(), user },
      purchaseId,
      action,
      options.storeId ?? lab.storeId,
      { canViewPayments: role === "admin", disassemble: options.disassemble ?? null },
    ),
  );
}

function applyRpc(role: Buyer, purchaseId: string, action: PurchaseImpactAction, options: ImpactOptions): Promise<RpcResult> {
  if (action === "receive") {
    return rpcAs(role, "receive_purchase_and_disassemble", {
      p_purchase_id: purchaseId,
      ...(options.disassemble ? { p_disassemble: toRpcDisassembleList(options.disassemble) } : {}),
    });
  }
  return rpcAs(role, action === "cancel" ? "cancel_purchase" : "return_purchase", { p_purchase_id: purchaseId });
}

/**
 * Pide el impact, comprueba que no escribió, ejecuta la RPC real y compara.
 * `watch`: productos que no son líneas de la compra y también se vigilan (componentes).
 * Devuelve el impact para las aserciones propias de cada caso.
 */
async function predictAndApply(
  role: Buyer,
  purchaseId: string,
  action: PurchaseImpactAction,
  watch: string[] = [],
  options: ImpactOptions = {},
): Promise<PurchaseImpact> {
  const before = await snapshot(purchaseId, watch);
  const impact = await impactOf(role, purchaseId, action, options);

  // Solo lectura: nada cambió por calcularlo.
  expect(await snapshot(purchaseId, watch)).toEqual(before);
  // El "antes" del impact es el de la base.
  expect(impact.document.status).toBe(before.purchase.status);
  for (const line of impact.stock) expect(line.stockBefore).toBe(before.stock[line.productId]);
  for (const line of impact.costs) expect(line.costRefBefore).toBe(before.cost[line.productId]);

  const applied = await applyRpc(role, purchaseId, action, options);
  const after = await snapshot(purchaseId, watch);

  if (!impact.allowed) {
    expect(applied.error?.message).toBe(impact.reason);
    expect(REJECTION_CODES[applied.error?.code ?? ""]).toBe(impact.reasonCode);
    expect(after).toEqual(before);
    return impact;
  }

  expect(applied.error).toBeNull();
  expect(impact.inexact).toBeNull();
  expect(after.purchase.status).toBe(impact.document.statusAfter);

  // Stock: lo predicho por producto; lo que el impact no nombra no se movió.
  const movedIds = new Set(impact.stock.map((line) => line.productId));
  for (const line of impact.stock) {
    expect(after.stock[line.productId]).toBe(line.stockAfter);
    expect(after.stock[line.productId] - before.stock[line.productId]).toBe(line.quantityDelta);
    if (action !== "receive") {
      // Unidades que salen por esta acción = movimientos de reversión nuevos de ese producto.
      expect((after.reversals[line.productId] ?? 0) - (before.reversals[line.productId] ?? 0)).toBe(line.quantityDelta);
    }
  }
  for (const id of Object.keys(before.stock)) {
    if (!movedIds.has(id)) expect(after.stock[id]).toBe(before.stock[id]);
  }

  // Costo: el que fija la RPC; lo que el impact no nombra conserva el suyo.
  const costIds = new Set(impact.costs.map((line) => line.productId));
  for (const line of impact.costs) expect(after.cost[line.productId]).toBe(line.costRefAfter);
  for (const id of Object.keys(before.cost)) {
    if (!costIds.has(id)) expect(after.cost[id]).toBe(before.cost[id]);
  }

  // Líneas desarmadas: exactamente las que el impact anuncia.
  const opened = new Set(impact.disassemble.map((line) => line.purchaseItemId));
  for (const [itemId, wasOpened] of Object.entries(before.disassembled)) {
    expect(after.disassembled[itemId]).toBe(wasOpened || opened.has(itemId));
  }

  // Ninguna de las tres acciones mueve dinero: pagos, pagado y baúl quedan igual.
  expect(after.payments).toEqual(before.payments);
  expect(after.purchase.paidVes).toBe(before.purchase.paidVes);
  expect(after.vault).toEqual(before.vault);
  expect(after.vaultMovements).toBe(before.vaultMovements);
  for (const line of impact.payments) expect(after.payments[line.paymentId]).toBe(line.statusAfter);

  return impact;
}

async function cleanup(): Promise<void> {
  try {
    await lab.db.query("begin");
    await lab.db.query("delete from public.purchases where id = any($1::uuid[])", [foreignPurchaseIds]);
    await lab.db.query("delete from public.contacts where id = any($1::uuid[])", [foreignContactIds]);
    if (productIds.length > 0) {
      const purchases = (await lab.rows("select distinct purchase_id as id from public.purchase_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
      const sales = (await lab.rows("select distinct sale_id as id from public.sale_items where product_id = any($1::uuid[])", [productIds])).map((r) => r.id);
      const payments = (await lab.rows("select id from public.payments where purchase_id = any($1::uuid[])", [purchases])).map((r) => r.id);
      await lab.db.query("delete from public.vault_movements where payment_id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.payments where id = any($1::uuid[])", [payments]);
      await lab.db.query("delete from public.stock_movements where product_id = any($1::uuid[])", [productIds]);
      await lab.db.query("delete from public.sales where id = any($1::uuid[])", [sales]);
      await lab.db.query("delete from public.purchases where id = any($1::uuid[])", [purchases]);
      await lab.db.query("delete from public.supplier_products where product_id = any($1::uuid[])", [productIds]);
      await lab.db.query("delete from public.product_pack_components where conversion_id = any($1::uuid[])", [recipeIds]);
      await lab.db.query("delete from public.product_pack_conversions where id = any($1::uuid[])", [recipeIds]);
      await lab.db.query("delete from public.products where id = any($1::uuid[])", [productIds]);
    }
    await lab.db.query("commit");
  } catch {
    await lab.db.query("rollback").catch(() => undefined);
    await lab.db.query("update public.products set is_active = false where id = any($1::uuid[])", [productIds]).catch(() => undefined);
  }
}

beforeAll(async () => {
  lab = await setup("abrir el laboratorio", () => Lab.open("rimc"));
});

afterAll(async () => {
  if (!lab) return;
  await cleanup();
  await lab.close();
});

describe("CNF-14 · impact de recibir una compra = lo que aplica receive_purchase_and_disassemble", () => {
  it("pedido simple: entra el stock y se fija el último costo con IVA (también en un producto inactivo y repetido)", async () => {
    const { first, purchaseId, second } = await setup("pedido de dos productos", async () => {
      const a = await mkProduct("rec-a", 4, { costRef: 0.5 });
      const b = await mkProduct("rec-b", 0, { costRef: 3 });
      const id = await mkPurchase("pedido", [
        { costRef: 2, product: a, quantity: 3, taxRate: 16 },
        { costRef: 1.25, product: b, quantity: 5 },
        { costRef: 2.1, product: a, quantity: 2, taxRate: 16 },
      ]);
      // Se desactiva después de pedirlo: recibir se permite igual.
      await lab.db.query("update public.products set is_active = false where id = $1", [b]);
      return { first: a, purchaseId: id, second: b };
    });

    const impact = await predictAndApply("almacen", purchaseId, "receive");

    expect(impact.allowed).toBe(true);
    expect(impact.document.statusAfter).toBe("recibido");
    expect(impact.disassemble).toEqual([]);
    expect(impact.payments).toEqual([]);
    const stock = new Map(impact.stock.map((line) => [line.productId, line]));
    expect(stock.get(first)).toMatchObject({ purchasedIn: 5, quantityDelta: 5, stockAfter: 9, stockBefore: 4 });
    expect(stock.get(second)).toMatchObject({ isActive: false, quantityDelta: 5, stockAfter: 5, stockBefore: 0 });
    const costs = new Map(impact.costs.map((line) => [line.productId, line]));
    expect(costs.get(first)?.source).toBe("purchase_line");
    // Manda una de las dos líneas del producto (la última por id): 2.00 × 1.16 o 2.10 × 1.16.
    expect([2.32, 2.44]).toContain(costs.get(first)?.costRefAfter);
    expect(costs.get(second)).toMatchObject({ costRefAfter: 1.25, costRefBefore: 3 });
  });

  it("con una línea marcada: el empaque queda neto 0 y la unidad sube con costo promedio", async () => {
    const { pack, purchaseId, unit } = await setup("pedido con desarme", async () => {
      const u = await mkProduct("des-u", 20, { costRef: 1 });
      const p = await mkProduct("des-p", 3, { costRef: 9 });
      await mkRecipe(p, [{ id: u, units: 10 }]);
      const id = await mkPurchase("pedido", [{ costRef: 10, disassemble: true, product: p, quantity: 2, taxRate: 16 }]);
      return { pack: p, purchaseId: id, unit: u };
    });

    const impact = await predictAndApply("almacen", purchaseId, "receive", [unit]);

    expect(impact.allowed).toBe(true);
    const stock = new Map(impact.stock.map((line) => [line.productId, line]));
    expect(stock.get(pack)).toMatchObject({ disassembledOut: 2, purchasedIn: 2, quantityDelta: 0, stockAfter: 3 });
    expect(stock.get(unit)).toMatchObject({ componentsIn: 20, quantityDelta: 20, stockAfter: 40, stockBefore: 20 });
    expect(impact.disassemble).toEqual([
      expect.objectContaining({
        components: [expect.objectContaining({ productId: unit, stockAfter: 40, stockBefore: 20, unitsIn: 20 })],
        packProductId: pack,
        packsOut: 2,
      }),
    ]);
    const costs = new Map(impact.costs.map((line) => [line.productId, line]));
    expect(costs.get(pack)).toMatchObject({ costRefAfter: 11.6, source: "purchase_line" });
    // (20 × 1.00 + 2 × 11.60) / 40 = 1.08
    expect(costs.get(unit)).toMatchObject({ costRefAfter: 1.08, costRefBefore: 1, source: "disassemble" });
  });

  it("surtido con reparto ajustado y un componente que también es línea de la compra", async () => {
    const { components, itemId, pack, purchaseId } = await setup("pedido de surtido", async () => {
      const c1 = await mkProduct("sur-1", 6, { costRef: 0.8 });
      const c2 = await mkProduct("sur-2", 0, { costRef: 0.4 });
      const c3 = await mkProduct("sur-3", 2, { costRef: 1.5 });
      const p = await mkProduct("sur-p", 0, { costRef: 5 });
      await mkRecipe(p, [
        { id: c1, units: 4, weight: 1 },
        { id: c2, units: 4, weight: 2 },
        { id: c3, units: 4, weight: 1.5 },
      ]);
      const id = await mkPurchase("pedido", [
        { costRef: 7, product: p, quantity: 3 },
        { costRef: 0.9, product: c1, quantity: 5, taxRate: 8 },
      ]);
      const item = await one("select id from public.purchase_items where purchase_id = $1 and product_id = $2", [id, p]);
      return { components: [c1, c2, c3], itemId: String(item.id), pack: p, purchaseId: id };
    });
    const [c1, c2, c3] = components;
    // 3 empaques × 12 unidades = 36, repartidas a mano; c3 no recibe nada.
    const disassemble = [
      {
        distribution: [
          { unitProductId: c1, units: 21 },
          { unitProductId: c2, units: 15 },
          { unitProductId: c3, units: 0 },
        ],
        purchaseItemId: itemId,
      },
    ];

    const impact = await predictAndApply("admin", purchaseId, "receive", components, { disassemble });

    expect(impact.allowed).toBe(true);
    const stock = new Map(impact.stock.map((line) => [line.productId, line]));
    expect(stock.get(pack)).toMatchObject({ quantityDelta: 0 });
    expect(stock.get(c1)).toMatchObject({ componentsIn: 21, purchasedIn: 5, quantityDelta: 26, stockAfter: 32 });
    expect(stock.get(c2)).toMatchObject({ componentsIn: 15, quantityDelta: 15, stockAfter: 15 });
    expect(stock.has(c3)).toBe(false);
    expect(impact.costs.map((line) => line.productId).sort()).toEqual([pack, c1, c2].sort());
  });

  it("sin lista, una línea marcada cuya receta se desactivó: el impact da el PT409 de la RPC; con [] se recibe sin desarmar", async () => {
    const { purchaseId, unit } = await setup("pedido con receta desactivada", async () => {
      const u = await mkProduct("sin-u", 0);
      const p = await mkProduct("sin-p", 0);
      await mkRecipe(p, [{ id: u, units: 6 }]);
      const id = await mkPurchase("pedido", [{ disassemble: true, product: p, quantity: 2 }]);
      await lab.db.query("update public.product_pack_conversions set is_active = false where pack_product_id = $1", [p]);
      return { purchaseId: id, unit: u };
    });

    const rejected = await predictAndApply("almacen", purchaseId, "receive", [unit]);

    expect(rejected).toMatchObject({ allowed: false, reasonCode: "CONFLICT" });
    expect(rejected.reason).toContain("Sin receta de apertura activa");
    expect(rejected.blockingProducts).toHaveLength(1);

    const plain = await predictAndApply("almacen", purchaseId, "receive", [unit], { disassemble: [] });

    expect(plain.allowed).toBe(true);
    expect(plain.disassemble).toEqual([]);
    expect(plain.stock).toEqual([expect.objectContaining({ quantityDelta: 2, stockAfter: 2, stockBefore: 0 })]);
  });

  it("ya recibida: el impact anticipa el rechazo y nada cambia", async () => {
    const purchaseId = await setup("compra recibida", async () => {
      const product = await mkProduct("ya-rec", 0);
      return mkPurchase("recibido", [{ product, quantity: 2 }]);
    });

    const impact = await predictAndApply("almacen", purchaseId, "receive");

    expect(impact).toMatchObject({
      allowed: false,
      reason: "Solo se pueden recibir compras en estado pedido",
      reasonCode: "CONFLICT",
    });
  });
});

describe("CNF-14 · impact de cancelar una compra = lo que aplica cancel_purchase", () => {
  it("pedido: se cancela sin mover stock", async () => {
    const purchaseId = await setup("pedido", async () => {
      const product = await mkProduct("can-ped", 5);
      return mkPurchase("pedido", [{ product, quantity: 3 }]);
    });

    const impact = await predictAndApply("almacen", purchaseId, "cancel");

    expect(impact).toMatchObject({ allowed: true, costs: [], stock: [] });
    expect(impact.document.statusAfter).toBe("cancelado");
  });

  it("recibida sin pagos: salen las unidades recibidas menos lo ya devuelto con un ajuste", async () => {
    const { first, purchaseId, second } = await setup("compra recibida con devolución parcial", async () => {
      const a = await mkProduct("can-a", 2);
      const b = await mkProduct("can-b", 0);
      const id = await mkPurchase("recibido", [
        { product: a, quantity: 4 },
        { product: b, quantity: 3 },
        { product: a, quantity: 1 },
      ]);
      // C15: una unidad de `a` ya volvió al proveedor con un ajuste ligado a la compra.
      await rpcOk("admin", "adjust_stock", {
        p_product_id: a,
        p_purchase_id: id,
        p_quantity_delta: -1,
        p_reason: `${TAG} devolución parcial`,
        p_type: "devolucion_proveedor",
      });
      return { first: a, purchaseId: id, second: b };
    });

    const impact = await predictAndApply("almacen", purchaseId, "cancel");

    expect(impact.allowed).toBe(true);
    const stock = new Map(impact.stock.map((line) => [line.productId, line]));
    // 2 + 5 − 1 = 6 en stock; salen 5 − 1 = 4.
    expect(stock.get(first)).toMatchObject({ quantityDelta: -4, stockAfter: 2, stockBefore: 6 });
    expect(stock.get(second)).toMatchObject({ quantityDelta: -3, stockAfter: 0, stockBefore: 3 });
    expect(impact.costs).toEqual([]);
  });

  it("recibida con un pago activo: mismo PT409 que la RPC (también para almacén, que no ve el pago); anulado el pago, pasa", async () => {
    const { paymentId, purchaseId } = await setup("compra recibida y pagada", async () => {
      const product = await mkProduct("can-pag", 0);
      const id = await mkPurchase("recibido", [{ costRef: 2, product, quantity: 4 }]);
      return { paymentId: await payPurchase(id), purchaseId: id };
    });

    // Admin ve la línea del pago que bloquea.
    const seen = await impactOf("admin", purchaseId, "cancel");
    expect(seen.payments).toEqual([
      expect.objectContaining({ effects: [], method: "efectivo_ves", outcome: "blocks_action", paymentId }),
    ]);
    expect(seen.paymentsRestricted).toBe(false);

    const blocked = await predictAndApply("almacen", purchaseId, "cancel");

    expect(blocked).toMatchObject({ allowed: false, payments: [], paymentsRestricted: true, reasonCode: "CONFLICT" });
    expect(blocked.reason).toContain("1 pago(s) activo(s) por Bs ");
    expect(blocked.document.statusAfter).toBe("recibido");

    await setup("anular el pago", () => rpcOk("admin", "cancel_payment", { p_payment_id: paymentId }));

    const impact = await predictAndApply("admin", purchaseId, "cancel");

    expect(impact.allowed).toBe(true);
    expect(impact.payments).toEqual([
      expect.objectContaining({ outcome: "already_cancelled", status: "anulado", statusAfter: "anulado" }),
    ]);
    expect(impact.stock).toEqual([expect.objectContaining({ quantityDelta: -4, stockAfter: 0, stockBefore: 4 })]);
  });
});

describe("CNF-14 · impact de devolver una compra = lo que aplica return_purchase", () => {
  it("recibida sin pagos: sale el stock con devolucion_proveedor y el costo no se revierte", async () => {
    const { product, purchaseId } = await setup("compra recibida", async () => {
      const id = await mkProduct("dev-ok", 3, { costRef: 0.5 });
      return { product: id, purchaseId: await mkPurchase("recibido", [{ costRef: 4, product: id, quantity: 6 }]) };
    });

    const impact = await predictAndApply("almacen", purchaseId, "return");

    expect(impact.allowed).toBe(true);
    expect(impact.document.statusAfter).toBe("devuelto");
    expect(impact.stock).toEqual([
      expect.objectContaining({ productId: product, quantityDelta: -6, stockAfter: 3, stockBefore: 9 }),
    ]);
    expect(impact.costs).toEqual([]);
    // El costo que fijó la compra sigue ahí.
    expect((await one("select current_cost_ref::float8 as cost from public.products where id = $1", [product])).cost).toBe(4);
  });

  it("recibida con un pago activo: PT409 y nada cambia", async () => {
    const purchaseId = await setup("compra recibida y pagada", async () => {
      const product = await mkProduct("dev-pag", 0);
      const id = await mkPurchase("recibido", [{ product, quantity: 2 }]);
      await payPurchase(id);
      return id;
    });

    const impact = await predictAndApply("admin", purchaseId, "return");

    expect(impact).toMatchObject({ allowed: false, reasonCode: "CONFLICT" });
    expect(impact.reason).toContain("Anula primero los pagos y luego devuelve la compra.");
    expect(impact.payments[0].outcome).toBe("blocks_action");
  });

  it("con stock ya vendido: el impact da el rechazo exacto, dice qué producto y cuánto falta, y nada cambia", async () => {
    const { product, purchaseId } = await setup("compra recibida y parte vendida", async () => {
      const id = await mkProduct("dev-vend", 0);
      const purchase = await mkPurchase("recibido", [{ product: id, quantity: 5 }]);
      seq += 1;
      await rpcOk("vendedor1", "create_sale", {
        p_customer_id: lab.customerId,
        p_exchange_rate_id: null,
        p_invoice_number: `${TAG}-V${seq}`,
        p_items: [{ product_id: id, quantity: 2, unit_price_ref: 1 }],
        p_ref_rate_ves: await rate(),
      });
      return { product: id, purchaseId: purchase };
    });

    const impact = await predictAndApply("almacen", purchaseId, "return");

    expect(impact).toMatchObject({
      allowed: false,
      reason: "No hay stock suficiente para revertir la compra",
      reasonCode: "CONFLICT",
    });
    expect(impact.blockingProducts).toEqual([
      expect.objectContaining({ available: 3, productId: product, required: 5 }),
    ]);
    expect(impact.stock).toEqual([expect.objectContaining({ quantityDelta: 0, stockAfter: 3, stockBefore: 3 })]);
  });

  it("un pedido no se devuelve: PT409", async () => {
    const purchaseId = await setup("pedido", async () => {
      const product = await mkProduct("dev-ped", 1);
      return mkPurchase("pedido", [{ product, quantity: 1 }]);
    });

    const impact = await predictAndApply("almacen", purchaseId, "return");

    expect(impact).toMatchObject({
      allowed: false,
      reason: "Solo se pueden devolver compras recibidas",
      reasonCode: "CONFLICT",
    });
  });

  it("empaque desarmado al recibir: devolver responde como tras abrirlo a mano (stock insuficiente del empaque)", async () => {
    const { pack, purchaseId, unit } = await setup("compra recibida y desarmada", async () => {
      const u = await mkProduct("dev-des-u", 0);
      const p = await mkProduct("dev-des-p", 0);
      await mkRecipe(p, [{ id: u, units: 6 }]);
      const id = await mkPurchase("recibido", [{ disassemble: true, product: p, quantity: 2 }]);
      return { pack: p, purchaseId: id, unit: u };
    });

    const impact = await predictAndApply("almacen", purchaseId, "return", [unit]);

    expect(impact).toMatchObject({ allowed: false, reason: "No hay stock suficiente para revertir la compra" });
    expect(impact.blockingProducts).toEqual([expect.objectContaining({ available: 0, productId: pack, required: 2 })]);
  });
});

describe("CNF-14 · el impact de compra no cruza tiendas", () => {
  it("compra de la tienda lab pedida con otra tienda → 404", async () => {
    const purchaseId = await setup("pedido", async () => {
      const product = await mkProduct("tienda", 1);
      return mkPurchase("pedido", [{ product, quantity: 1 }]);
    });

    for (const action of ["receive", "cancel", "return"] as const) {
      await expect(impactOf("almacen", purchaseId, action, { storeId: lab.defaultStoreId })).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    }
  });

  it("compra de OTRA tienda pedida por un usuario lab → 404 (con su tienda y con la ajena)", async () => {
    const purchaseId = await setup("compra en la tienda default", async () => {
      const contact = await one(
        "insert into public.contacts (store_id, name, type) values ($1, $2, 'proveedor') returning id",
        [lab.defaultStoreId, `Proveedor ${TAG}`],
      );
      foreignContactIds.push(String(contact.id));
      const purchase = await one(
        `insert into public.purchases (store_id, purchase_number, supplier_id, user_id, ref_rate_ves, status)
         values ($1, $2, $3, null, $4, 'recibido') returning id`,
        [lab.defaultStoreId, `${TAG}-OTRA`, contact.id, await rate()],
      );
      foreignPurchaseIds.push(String(purchase.id));
      return String(purchase.id);
    });

    for (const action of ["receive", "cancel", "return"] as const) {
      // Con la tienda del usuario (lo que hace el BFF): el filtro por tienda no la encuentra.
      await expect(impactOf("admin", purchaseId, action)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      // Aunque el servidor recibiera la tienda ajena, la RLS del usuario no la deja ver.
      await expect(impactOf("admin", purchaseId, action, { storeId: lab.defaultStoreId })).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    }
  });

  it("compra inexistente → 404; id mal formado → 400", async () => {
    await expect(impactOf("almacen", randomUUID(), "cancel")).rejects.toMatchObject({ status: 404 });
    await expect(impactOf("almacen", "no-es-uuid", "receive")).rejects.toMatchObject({ status: 400 });
  });
});
