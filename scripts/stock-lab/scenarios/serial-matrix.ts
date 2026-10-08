/**
 * Matriz serie exhaustiva de la sección 8.1 del plan stock-integrity (STK-402):
 * 5 tipos de producto × todas las operaciones, declarada como datos.
 *
 * Cada celda (`<tipo>.<operación>`) crea SUS productos (`S402-<run>-…`), carga
 * el stock inicial con un ajuste `inventario_inicial` y ejecuta el flujo por el
 * BFF; `CaseHarness.op` fotografía la base antes y después de cada request.
 * Las celdas que no aplican salen como `skip` con motivo, nunca se omiten.
 *
 * No corrige nada: un `fail` aquí es un bug reproducido.
 */
import { randomUUID } from "node:crypto";

import type { JsonRecord } from "../../e2e-bodegon/client";
import type { LabRoleKey } from "../agents/base";
import type { CaseDef, CaseHarness, HttpExpectation, LabSession, MovementRef, OpResult } from "./lib";

// ---------------------------------------------------------------------------
// Tipos de producto
// ---------------------------------------------------------------------------

export const KINDS = ["iva", "noiva", "pack", "inactive", "zero"] as const;
export type Kind = (typeof KINDS)[number];

export type KindSpec = { label: string; taxRate: number; stock: number; pack: boolean; inactive: boolean };

export const KIND_SPECS: Record<Kind, KindSpec> = {
  iva: { label: "producto con IVA", taxRate: 16, stock: 20, pack: false, inactive: false },
  noiva: { label: "producto sin IVA", taxRate: 0, stock: 20, pack: false, inactive: false },
  pack: { label: "producto con empaque", taxRate: 0, stock: 20, pack: true, inactive: false },
  inactive: { label: "producto inactivo", taxRate: 0, stock: 20, pack: false, inactive: true },
  zero: { label: "producto con stock 0", taxRate: 0, stock: 0, pack: false, inactive: false },
};

export const PACK_SIZES = [6, 12, 24] as const;
export const DEFAULT_UNITS_PER_PACK = 12;
export const SALE_PRICE_REF = 2;
export const UNIT_COST_REF = 1;

const SELLER: LabRoleKey = "vendedor1";
const STOCKER: LabRoleKey = "almacen";
const ADMIN: LabRoleKey = "admin";

// ---------------------------------------------------------------------------
// Lógica pura (payloads y esperados)
// ---------------------------------------------------------------------------

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** a × b redondeado a 2 decimales con aritmética entera (igual que `round(numeric, 2)` de Postgres). */
export function mulRound2(a: number, b: number): number {
  const scaled = BigInt(Math.round(a * 100)) * BigInt(Math.round(b * 1_000_000));
  const divisor = BigInt(1_000_000);
  const negative = scaled < BigInt(0);
  const abs = negative ? -scaled : scaled;
  const rounded = (abs + divisor / BigInt(2)) / divisor;
  return (negative ? -1 : 1) * (Number(rounded) / 100);
}

/** SKU propio del ticket: `S402-<run>-<nonce>-<caso>[-sufijo]`. */
export function skuFor(runId: string, nonce: string, caseId: string, suffix = ""): string {
  const base = `S402-${runId}-${nonce}-${caseId.replace(/[^A-Za-z0-9]+/g, "-")}`;
  return suffix ? `${base}-${suffix}` : base;
}

export type Rate = { id: string | null; rateVes: number };

export type SaleTotals = { subtotalRef: number; taxRef: number; totalRef: number; totalVes: number };

/** Totales tal como los calcula `create_sale`: total_ref = subtotal + tax; total_ves = round(total_ref × tasa, 2). */
export function saleTotals(quantity: number, unitPriceRef: number, taxRate: number, rateVes: number): SaleTotals {
  const subtotalRef = round2(quantity * unitPriceRef);
  const taxRef = round2((subtotalRef * taxRate) / 100);
  const totalRef = round2(subtotalRef + taxRef);
  return { subtotalRef, taxRef, totalRef, totalVes: mulRound2(totalRef, rateVes) };
}

export function pagoMovil(amountVes: number): JsonRecord {
  return { method: "pago_movil", currency: "VES", amount: amountVes, bankName: "Banesco", phone: "04140000402", referenceCode: "0402" };
}

export type SaleMode = "paid" | "pending";

/**
 * `paid`: `clientRequestId` + `payments` → venta `pagada`.
 * `pending`: `clientRequestId` sin `payments` → queda `pendiente_pago`.
 * La clave es obligatoria en `POST /api/sales` (400 si falta): una nueva por venta.
 */
export function buildSaleBody(input: {
  mode: SaleMode;
  customerId: string;
  rate: Rate;
  productId: string;
  quantity: number;
  unitPriceRef: number;
  taxRate: number;
  clientRequestId?: string;
}): JsonRecord {
  const totals = saleTotals(input.quantity, input.unitPriceRef, input.taxRate, input.rate.rateVes);
  return {
    clientRequestId: input.clientRequestId ?? randomUUID(),
    customerId: input.customerId,
    ...(input.rate.id ? { exchangeRateId: input.rate.id } : {}),
    refRateVes: input.rate.rateVes,
    items: [{ productId: input.productId, quantity: input.quantity, unitPriceRef: input.unitPriceRef }],
    taxRef: totals.taxRef,
    discountRef: 0,
    notes: "",
    ...(input.mode === "paid" ? { payments: [pagoMovil(totals.totalVes)] } : {}),
  };
}

export type PurchaseLineSpec = { mode: "unit"; quantity: number } | { mode: "pack"; packCount: number; unitsPerPack: number };

/** Unidades que debe ingresar la línea: en modo empaque, packCount × unitsPerPack exacto (H2). */
export function purchaseUnits(line: PurchaseLineSpec): number {
  return line.mode === "unit" ? line.quantity : line.packCount * line.unitsPerPack;
}

export function buildPurchaseBody(input: {
  supplierId: string;
  status: "pedido" | "recibido";
  rate: Rate;
  productId: string;
  taxRate: number;
  line: PurchaseLineSpec;
  unitCostRef?: number;
}): JsonRecord {
  const { rate, line } = input;
  const unitCostRef = input.unitCostRef ?? UNIT_COST_REF;
  const units = purchaseUnits(line);
  const subtotalRef = round2(units * unitCostRef);
  const subtotalVes = mulRound2(subtotalRef, rate.rateVes);
  const taxRef = round2((subtotalRef * input.taxRate) / 100);
  const taxVes = mulRound2(taxRef, rate.rateVes);
  const common = {
    productId: input.productId,
    unitCostRef,
    unitCostVes: mulRound2(unitCostRef, rate.rateVes),
    costCurrency: "ref",
    taxRate: input.taxRate,
    taxRef,
    taxVes,
    subtotalRef,
    subtotalVes,
  };
  const item: JsonRecord =
    line.mode === "unit"
      ? { entryMode: "unit", quantity: line.quantity, ...common }
      : {
          entryMode: "pack",
          packLabel: `Bulto x${line.unitsPerPack}`,
          packCount: line.packCount,
          unitsPerPack: line.unitsPerPack,
          packCostRef: round2(unitCostRef * line.unitsPerPack),
          packCostVes: mulRound2(round2(unitCostRef * line.unitsPerPack), rate.rateVes),
          ...common,
        };
  return {
    supplierId: input.supplierId,
    status: input.status,
    ...(rate.id ? { exchangeRateId: rate.id } : {}),
    refRateVes: rate.rateVes,
    notes: "S402",
    subtotalRef,
    subtotalVes,
    taxRef,
    taxVes,
    discountRef: 0,
    discountVes: 0,
    items: [item],
  };
}

/** Payload EXACTO que arma el import Excel por fila (`validateProductImportRows.toProductInput`). */
export function buildImportRowBody(input: { sku: string; name: string; categoryId: string; stockInicial: number | undefined }): JsonRecord {
  return {
    sku: input.sku.toLowerCase(),
    name: input.name,
    categoryId: input.categoryId,
    salePriceRef: SALE_PRICE_REF,
    currentCostRef: UNIT_COST_REF,
    currentStock: input.stockInicial ?? 0,
    minStock: 5,
  };
}

/** Documento al que se liga una devolución por ajuste (R4: sin él, `devolucion_*` es 400). */
export type AdjustLink = { saleId?: string; purchaseId?: string };

export function buildAdjustBody(input: { productId: string; quantityDelta: number; type: string; reason: string; link?: AdjustLink }): JsonRecord {
  return {
    productId: input.productId,
    quantityDelta: input.quantityDelta,
    type: input.type,
    reason: input.reason,
    ...(input.link?.saleId ? { saleId: input.link.saleId } : {}),
    ...(input.link?.purchaseId ? { purchaseId: input.link.purchaseId } : {}),
  };
}

/** Referencia que debe llevar el movimiento del ajuste: su documento si es una devolución ligada. */
export function adjustRef(link: AdjustLink | undefined): MovementRef | null {
  if (link?.saleId) return { kind: "sale", id: link.saleId };
  if (link?.purchaseId) return { kind: "purchase", id: link.purchaseId };
  return null;
}

/** Una venta solo debe aceptarse si el producto está activo y hay stock suficiente. */
export function saleHttp(subject: { active: boolean; stock: number }, quantity: number): HttpExpectation {
  return subject.active && quantity <= subject.stock ? "accept" : "reject";
}

/**
 * COM-15 (20261010b): una compra, recibida o en pedido, solo se acepta sobre un producto activo; sobre uno
 * inactivo se rechaza sin mover nada. `observe` deja la celda en observación (variantes de empaque).
 */
export function purchaseHttp(subject: { active: boolean }, observe = false): HttpExpectation {
  if (observe) return "either";
  return subject.active ? "accept" : "reject";
}

/** Un ajuste que deja el stock negativo debe rechazarse; sobre un inactivo se observa. */
export function adjustHttp(subject: { active: boolean; stock: number }, quantityDelta: number): HttpExpectation {
  if (subject.stock + quantityDelta < 0) return "reject";
  return subject.active ? "accept" : "either";
}

// ---------------------------------------------------------------------------
// Entorno de la suite y sujeto del caso
// ---------------------------------------------------------------------------

export type SerialEnv = { categories: { iva: string; noiva: string }; supplierId: string; customerId: string };

export type SerialHarness = { h: CaseHarness; env: SerialEnv };

type Subject = {
  kind: Kind;
  id: string;
  sku: string;
  taxRate: number;
  stock: number;
  active: boolean;
  unit: { id: string; unitsPerPack: number; stock: number } | null;
};

type Ctx = SerialHarness & { kind: Kind };

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function listItems(body: JsonRecord | null): JsonRecord[] {
  const data = body?.data;
  const items = Array.isArray(data) ? data : data && typeof data === "object" ? (data as JsonRecord).items : null;
  return Array.isArray(items) ? (items.filter((item) => item && typeof item === "object") as JsonRecord[]) : [];
}

const CATEGORY_NAMES = { iva: "S402 IVA 16", noiva: "S402 SIN IVA" } as const;

async function ensureCategory(session: LabSession, name: string, taxRate: number): Promise<string> {
  const rows = await session.oracle.query<{ id: string }>(
    "select id from public.categories where store_id = $1 and name = $2 and is_active = true order by created_at limit 1",
    [session.storeId, name],
  );
  if (rows[0]?.id) return rows[0].id;
  const client = session.clients[STOCKER];
  if (!client) throw new Error("prepareSerialEnv: falta la sesión de almacén.");
  const res = await client.request("/api/categories", {
    method: "POST",
    body: JSON.stringify({ name, description: "Categoría de los escenarios STK-402", taxRate }),
  });
  const id = asString((res.body?.data as JsonRecord | undefined)?.id);
  if (!res.ok || !id) throw new Error(`No se pudo crear la categoría "${name}" (${res.status}).`);
  return id;
}

/** Categorías con y sin IVA, un proveedor y el cliente por defecto del POS de la tienda lab. */
export async function prepareSerialEnv(session: LabSession): Promise<SerialEnv> {
  const iva = await ensureCategory(session, CATEGORY_NAMES.iva, 16);
  const noiva = await ensureCategory(session, CATEGORY_NAMES.noiva, 0);
  const admin = session.clients[ADMIN];
  const seller = session.clients[SELLER];
  if (!admin || !seller) throw new Error("prepareSerialEnv: faltan las sesiones de admin y vendedor.");
  const suppliers = await admin.request("/api/contacts?type=proveedor&limit=100");
  const supplier = listItems(suppliers.body).find((item) => item.isActive !== false);
  const supplierId = asString(supplier?.id);
  if (!supplierId) throw new Error("No hay proveedores activos en la tienda lab.");
  const customers = await seller.request("/api/contacts?type=cliente&limit=100");
  const items = listItems(customers.body).filter((item) => item.isActive !== false);
  const customerId = asString((items.find((item) => item.isPosDefault === true) ?? items[0])?.id);
  if (!customerId) throw new Error("No hay clientes en la tienda lab.");
  return { categories: { iva, noiva }, supplierId, customerId };
}

async function currentRate(c: Ctx): Promise<Rate> {
  const res = await c.h.read(STOCKER, "/api/exchange-rates/current");
  const data = res.body?.data as JsonRecord | undefined;
  const rateVes = asNumber(data?.rateVes);
  if (rateVes <= 0) throw new Error("No hay tasa de cambio vigente.");
  return { id: asString(data?.id), rateVes };
}

function setupOk(result: OpResult, what: string): OpResult {
  if (!result.accepted) throw new Error(`preparación: ${what} respondió ${result.res.status}`);
  return result;
}

type SubjectOptions = { stock?: number; unitsPerPack?: number; keepActive?: boolean };

/** Crea el producto del caso (stock 0), carga el stock con `inventario_inicial` y lo desactiva si toca. */
async function createSubject(c: Ctx, options: SubjectOptions = {}): Promise<Subject> {
  const spec = KIND_SPECS[c.kind];
  const sku = skuFor(c.h.session.runId, c.h.session.nonce, c.h.caseId);
  const unitsPerPack = options.unitsPerPack ?? DEFAULT_UNITS_PER_PACK;
  const body: JsonRecord = {
    sku,
    name: `S402 ${c.h.caseId}`,
    salePriceRef: SALE_PRICE_REF,
    currentCostRef: UNIT_COST_REF,
    categoryId: spec.taxRate > 0 ? c.env.categories.iva : c.env.categories.noiva,
    minStock: 0,
    currentStock: 0,
    ...(spec.pack
      ? {
          packConversion: {
            enabled: true,
            mode: "create_unit",
            unitsPerPack,
            unitProduct: { salePriceRef: 0.25, currentCostRef: 0.1, name: `S402 ${c.h.caseId} (unidad)`, sku: `${sku}-u` },
          },
        }
      : {}),
  };
  const created = setupOk(
    await c.h.op({
      as: STOCKER,
      method: "POST",
      path: "/api/products",
      body,
      label: "crear producto",
      expect: { http: "accept", stockDelta: {}, movements: [] },
      newProducts: (data, oracle) => createdProductIds(data, oracle),
    }),
    "POST /api/products",
  );
  const id = created.id;
  if (!id) throw new Error("preparación: POST /api/products no devolvió id");
  const subject: Subject = { kind: c.kind, id, sku, taxRate: spec.taxRate, stock: 0, active: true, unit: null };
  if (spec.pack) {
    const unitId = await packUnitId(c.h, id);
    if (!unitId) throw new Error("preparación: el producto empaque no quedó con par activo");
    subject.unit = { id: unitId, unitsPerPack, stock: 0 };
  }
  c.h.evidence(`producto ${sku} = ${id}${subject.unit ? ` · unidad = ${subject.unit.id} (x${unitsPerPack})` : ""}`);
  const stock = options.stock ?? spec.stock;
  if (stock > 0) {
    setupOk(await adjust(c, subject, stock, "inventario_inicial", "accept", "stock inicial"), "ajuste inventario_inicial");
  }
  if (spec.inactive && !options.keepActive) await deactivate(c, subject);
  return subject;
}

async function packUnitId(h: CaseHarness, packProductId: string): Promise<string | null> {
  const rows = await h.oracle.query<{ unit_product_id: string }>(
    "select unit_product_id from public.product_pack_conversions where pack_product_id = $1 and is_active = true limit 1",
    [packProductId],
  );
  return rows[0]?.unit_product_id ?? null;
}

async function createdProductIds(data: JsonRecord | null, oracle: CaseHarness["oracle"]): Promise<string[]> {
  const id = asString(data?.id);
  if (!id) return [];
  const rows = await oracle.query<{ unit_product_id: string }>(
    "select unit_product_id from public.product_pack_conversions where pack_product_id = $1",
    [id],
  );
  return [id, ...rows.map((row) => row.unit_product_id)];
}

async function deactivate(c: Ctx, subject: Subject): Promise<void> {
  if (!subject.active) return;
  setupOk(
    await c.h.op({
      as: STOCKER,
      method: "DELETE",
      path: `/api/products/${subject.id}`,
      label: "desactivar producto",
      expect: { http: "accept", stockDelta: {}, movements: [] },
    }),
    "DELETE /api/products/[id]",
  );
  subject.active = false;
}

/** En el tipo `inactive`, los flujos que necesitan una venta/compra previa desactivan justo antes del paso bajo prueba. */
async function deactivateIfInactiveKind(c: Ctx, subject: Subject): Promise<void> {
  if (KIND_SPECS[c.kind].inactive) await deactivate(c, subject);
}

function applyStock(subject: Subject, productId: string, delta: number): void {
  if (productId === subject.id) subject.stock += delta;
  else if (subject.unit && productId === subject.unit.id) subject.unit.stock += delta;
}

async function adjust(
  c: Ctx,
  subject: Subject,
  quantityDelta: number,
  type: string,
  http: HttpExpectation,
  label: string,
  findingIfAccepted?: string,
  link?: AdjustLink,
): Promise<OpResult> {
  const result = await c.h.op({
    as: STOCKER,
    method: "POST",
    path: "/api/inventory/adjustments",
    body: buildAdjustBody({ productId: subject.id, quantityDelta, type, reason: `S402 ${c.h.caseId}`, link }),
    label,
    expect: {
      http,
      stockDelta: { [subject.id]: quantityDelta },
      movements: [{ productId: subject.id, type, quantityDelta }],
      ref: adjustRef(link),
      ...(findingIfAccepted ? { findingIfAccepted } : {}),
    },
  });
  if (result.accepted) applyStock(subject, subject.id, quantityDelta);
  return result;
}

type Sale = { id: string; quantity: number; totalVes: number; status: string };

async function sell(c: Ctx, subject: Subject, quantity: number, mode: SaleMode, label: string): Promise<Sale | null> {
  const rate = await currentRate(c);
  const body = buildSaleBody({
    mode,
    customerId: c.env.customerId,
    rate,
    productId: subject.id,
    quantity,
    unitPriceRef: SALE_PRICE_REF,
    taxRate: subject.taxRate,
  });
  const http = saleHttp(subject, quantity);
  const result = await c.h.op({
    as: SELLER,
    method: "POST",
    path: "/api/sales",
    body,
    label,
    expect: {
      http,
      stockDelta: { [subject.id]: -quantity },
      movements: [{ productId: subject.id, type: "venta", quantityDelta: -quantity }],
      ref: (data): MovementRef | null => (asString(data?.id) ? { kind: "sale", id: String(data?.id) } : null),
    },
    newDocs: (data) => (asString(data?.id) ? [String(data?.id)] : []),
  });
  if (!result.accepted || !result.id) {
    if (http === "accept") c.h.need(result, "la venta");
    return null;
  }
  applyStock(subject, subject.id, -quantity);
  const status = asString(result.data?.status) ?? "";
  const wanted = mode === "paid" ? "pagada" : "pendiente_pago";
  if (http === "accept" && status !== wanted) c.h.finding(`${label}: la venta quedó "${status}" y se esperaba "${wanted}"`);
  c.h.evidence(`venta ${result.id} (${status})`);
  return { id: result.id, quantity, totalVes: asNumber(result.data?.totalVes), status };
}

/** Si el paso opera sobre un producto ya desactivado, se observa en vez de exigir. */
function afterDeactivation(subject: Subject, what: string): { http: HttpExpectation; findingIfRejected?: string } {
  return subject.active ? { http: "accept" } : { http: "either", findingIfRejected: `${what} de un producto desactivado se rechaza` };
}

async function cancelSale(c: Ctx, subject: Subject, sale: Sale, http: HttpExpectation, label: string, findingIfRejected?: string): Promise<OpResult> {
  const result = await c.h.op({
    as: SELLER,
    method: "PATCH",
    path: `/api/sales/${sale.id}/cancel`,
    label,
    expect: {
      http,
      stockDelta: { [subject.id]: sale.quantity },
      movements: [{ productId: subject.id, type: "ajuste_entrada", quantityDelta: sale.quantity }],
      ref: { kind: "sale", id: sale.id },
      ...(findingIfRejected ? { findingIfRejected } : {}),
    },
  });
  if (result.accepted) applyStock(subject, subject.id, sale.quantity);
  return result;
}

async function returnSale(c: Ctx, subject: Subject, sale: Sale, http: HttpExpectation, label: string, findingIfRejected?: string): Promise<OpResult> {
  const result = await c.h.op({
    as: SELLER,
    method: "POST",
    path: `/api/sales/${sale.id}/return`,
    label,
    expect: {
      http,
      stockDelta: { [subject.id]: sale.quantity },
      movements: [{ productId: subject.id, type: "devolucion_cliente", quantityDelta: sale.quantity }],
      ref: { kind: "sale", id: sale.id },
      ...(findingIfRejected ? { findingIfRejected } : {}),
    },
  });
  if (result.accepted) applyStock(subject, subject.id, sale.quantity);
  return result;
}

async function saleStatus(c: Ctx, saleId: string): Promise<string> {
  const rows = await c.h.oracle.query<{ status: string }>("select status::text as status from public.sales where id = $1", [saleId]);
  return rows[0]?.status ?? "(sin fila)";
}

type Purchase = { id: string; productId: string; units: number };

type BuyOptions = {
  productId?: string;
  status?: "pedido" | "recibido";
  label: string;
  /** Hallazgo si el sistema acepta (variantes observacionales, con `observe`). */
  findingIfAccepted?: string;
  /** Fuerza `either` aunque el producto esté activo (variantes de empaque). */
  observe?: boolean;
  /** Unidades de stock esperadas cuando no son `purchaseUnits(line)` (C13: empaques sobre el SKU empaque). */
  units?: number;
};

async function buy(c: Ctx, subject: Subject, line: PurchaseLineSpec, options: BuyOptions): Promise<Purchase | null> {
  const rate = await currentRate(c);
  const productId = options.productId ?? subject.id;
  const status = options.status ?? "recibido";
  const units = options.units ?? purchaseUnits(line);
  const received = status === "recibido";
  const http = purchaseHttp(subject, options.observe);
  const result = await c.h.op({
    as: STOCKER,
    method: "POST",
    path: "/api/purchases",
    body: buildPurchaseBody({ supplierId: c.env.supplierId, status, rate, productId, taxRate: subject.taxRate, line }),
    label: options.label,
    expect: {
      http,
      stockDelta: received ? { [productId]: units } : {},
      movements: received ? [{ productId, type: "compra", quantityDelta: units }] : [],
      ref: (data): MovementRef | null => (asString(data?.id) ? { kind: "purchase", id: String(data?.id) } : null),
      ...(options.findingIfAccepted ? { findingIfAccepted: options.findingIfAccepted } : {}),
    },
    newDocs: (data) => (asString(data?.id) ? [String(data?.id)] : []),
  });
  if (!result.accepted || !result.id) {
    if (http === "accept") c.h.need(result, "la compra");
    c.h.note(`${options.label}: el sistema rechazó la compra (${result.res.status}) sin mover stock`);
    return null;
  }
  if (received) applyStock(subject, productId, units);
  c.h.evidence(`compra ${result.id} (${status}, ${units} uds)`);
  return { id: result.id, productId, units };
}

function purchaseStep(
  c: Ctx,
  subject: Subject,
  purchase: Purchase,
  action: "receive" | "cancel" | "return",
  http: HttpExpectation,
  label: string,
): Promise<OpResult> {
  const sign = action === "receive" ? 1 : -1;
  const type = action === "receive" ? "compra" : action === "cancel" ? "ajuste_salida" : "devolucion_proveedor";
  const delta = sign * purchase.units;
  return c.h
    .op({
      as: STOCKER,
      method: action === "return" ? "POST" : "PATCH",
      path: `/api/purchases/${purchase.id}/${action}`,
      label,
      expect: {
        http,
        stockDelta: { [purchase.productId]: delta },
        movements: [{ productId: purchase.productId, type, quantityDelta: delta }],
        ref: { kind: "purchase", id: purchase.id },
      },
    })
    .then((result) => {
      if (result.accepted) applyStock(subject, purchase.productId, delta);
      return result;
    });
}

/** Sobre un inactivo se observa; sobre un activo se exige. */
function flowHttp(subject: Subject): HttpExpectation {
  return subject.active ? "accept" : "either";
}

// ---------------------------------------------------------------------------
// Operaciones de la sección 8.1
// ---------------------------------------------------------------------------

export type OpDef = {
  key: string;
  title: string;
  hypothesis: string[];
  /** Motivo de `skip` para un tipo de producto (undefined = aplica). */
  skip?: (kind: Kind) => string | undefined;
  run: (c: Ctx) => Promise<void>;
};

const NEEDS_STOCK_TO_SELL =
  "sin stock no existe venta que cancelar o devolver; el rechazo de la venta con stock 0 lo cubren zero.sale_paid y zero.sale_pending_then_paid";
const NEEDS_PAIR = "requiere un par empaque↔unidad; este tipo de producto no tiene par";

const skipZero = (kind: Kind): string | undefined => (kind === "zero" ? NEEDS_STOCK_TO_SELL : undefined);
const skipNoPack = (kind: Kind): string | undefined => (KIND_SPECS[kind].pack ? undefined : NEEDS_PAIR);

function packPurchaseOp(unitsPerPack: number): OpDef {
  return {
    key: `purchase_received_pack_${unitsPerPack}`,
    title: `Compra recibido en modo empaque (3 bultos × ${unitsPerPack}; en el tipo empaque, sobre el SKU unidad del par x${unitsPerPack})`,
    hypothesis: ["H2"],
    run: async (c) => {
      const subject = await createSubject(c, { unitsPerPack });
      await buy(
        c,
        subject,
        { mode: "pack", packCount: 3, unitsPerPack },
        { productId: subject.unit?.id ?? subject.id, label: `compra 3×${unitsPerPack}` },
      );
    },
  };
}

function conversionOp(unitsPerPack: number): OpDef {
  return {
    key: `conversion_normal_${unitsPerPack}`,
    title: `Conversión empaque→unidad (2 empaques × ${unitsPerPack})`,
    hypothesis: ["H5"],
    skip: skipNoPack,
    run: async (c) => {
      const subject = await createSubject(c, { unitsPerPack });
      await convert(c, subject, 2, "accept", "conversión");
    },
  };
}

async function convert(c: Ctx, subject: Subject, packQuantity: number, http: HttpExpectation, label: string): Promise<OpResult> {
  const unit = subject.unit;
  if (!unit) throw new Error("convert: el sujeto no tiene par");
  const units = packQuantity * unit.unitsPerPack;
  const result = await c.h.op({
    as: STOCKER,
    method: "POST",
    path: "/api/inventory/conversions",
    body: { packProductId: subject.id, packQuantity, reason: `S402 ${c.h.caseId}` },
    label,
    expect: {
      http,
      stockDelta: { [subject.id]: -packQuantity, [unit.id]: units },
      movements: [
        { productId: subject.id, type: "conversion_salida", quantityDelta: -packQuantity },
        { productId: unit.id, type: "conversion_entrada", quantityDelta: units },
      ],
      ref: (data): MovementRef | null => (asString(data?.conversionId) ? { kind: "conversion", id: String(data?.conversionId) } : null),
    },
  });
  if (result.accepted) {
    applyStock(subject, subject.id, -packQuantity);
    applyStock(subject, unit.id, units);
  }
  return result;
}

async function newProductWithStock(c: Ctx, via: "form" | "import"): Promise<void> {
  const spec = KIND_SPECS[c.kind];
  const stock = c.kind === "zero" ? 0 : 7;
  const sku = skuFor(c.h.session.runId, c.h.session.nonce, c.h.caseId);
  const categoryId = spec.taxRate > 0 ? c.env.categories.iva : c.env.categories.noiva;
  const name = `S402 ${c.h.caseId}`;
  const body: JsonRecord =
    via === "import"
      ? buildImportRowBody({ sku, name, categoryId, stockInicial: c.kind === "zero" ? undefined : stock })
      : {
          sku,
          name,
          salePriceRef: SALE_PRICE_REF,
          currentCostRef: UNIT_COST_REF,
          categoryId,
          minStock: 0,
          currentStock: stock,
          ...(spec.pack
            ? {
                packConversion: {
                  enabled: true,
                  mode: "create_unit",
                  unitsPerPack: DEFAULT_UNITS_PER_PACK,
                  unitProduct: { salePriceRef: 0.25, currentCostRef: 0.1, name: `${name} (unidad)`, sku: `${sku}-u` },
                },
              }
            : {}),
        };
  let createdId = "";
  const created = await c.h.op({
    as: STOCKER,
    method: "POST",
    path: "/api/products",
    body,
    label: via === "import" ? "alta por import (POST por fila)" : "alta por formulario",
    expect: {
      http: "accept",
      // H9: el stock inicial debe nacer con UN movimiento inventario_inicial (libro = current_stock).
      stockDelta: (data) => (asString(data?.id) && stock > 0 ? { [String(data?.id)]: stock } : {}),
      movements: (data) =>
        asString(data?.id) && stock > 0 ? [{ productId: String(data?.id), type: "inventario_inicial", quantityDelta: stock }] : [],
      ref: null,
    },
    newProducts: async (data, oracle) => {
      const ids = await createdProductIds(data, oracle);
      createdId = ids[0] ?? "";
      return ids;
    },
  });
  if (!created.accepted || !createdId) return;
  c.h.evidence(`producto ${sku} = ${createdId} (currentStock enviado: ${stock})`);
  if (spec.inactive) {
    const subject: Subject = { kind: c.kind, id: createdId, sku, taxRate: spec.taxRate, stock, active: true, unit: null };
    await deactivate(c, subject);
  }
}

export const OPS: OpDef[] = [
  {
    key: "sale_paid",
    title: "Venta pagada (atómica, con pago)",
    hypothesis: ["H10"],
    run: async (c) => {
      const subject = await createSubject(c);
      await sell(c, subject, 2, "paid", "venta pagada");
    },
  },
  {
    key: "sale_pending_then_paid",
    title: "Venta pendiente_pago y luego pagada (el stock baja al crear; pagar no mueve)",
    hypothesis: ["H10"],
    run: async (c) => {
      const subject = await createSubject(c);
      const sale = await sell(c, subject, 2, "pending", "venta pendiente");
      if (!sale) return;
      c.h.note("el stock se descuenta al crear la venta pendiente_pago");
      const paid = await c.h.op({
        as: SELLER,
        method: "POST",
        path: "/api/payments",
        body: { saleId: sale.id, ...pagoMovil(sale.totalVes) },
        label: "pagar venta",
        expect: { http: "accept", stockDelta: {}, movements: [], ref: null },
      });
      if (paid.accepted) {
        const status = await saleStatus(c, sale.id);
        if (status !== "pagada") c.h.finding(`tras pagar el total (${sale.totalVes} Bs) la venta quedó "${status}"`);
      }
    },
  },
  {
    key: "sale_cancel_before_pay",
    title: "Venta cancelada antes de pagar, y cancelar dos veces (en inactivo: se desactiva tras vender)",
    hypothesis: ["H4"],
    skip: skipZero,
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const sale = await sell(c, subject, 2, "pending", "venta pendiente");
      if (!sale) return;
      await deactivateIfInactiveKind(c, subject);
      const flow = afterDeactivation(subject, "cancelar la venta");
      const first = await cancelSale(c, subject, sale, flow.http, "cancelar", flow.findingIfRejected);
      if (!first.accepted) return;
      await cancelSale(c, subject, sale, "reject", "cancelar por segunda vez");
    },
  },
  {
    key: "sale_cancel_after_pay",
    title: "Venta cancelada después de pagar: 400 con pago activo, anular pago, cancelar, y cancelar dos veces",
    hypothesis: ["H4", "H10"],
    skip: skipZero,
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const sale = await sell(c, subject, 2, "paid", "venta pagada");
      if (!sale) return;
      await deactivateIfInactiveKind(c, subject);
      await cancelSale(c, subject, sale, "reject", "cancelar con pago activo");
      const payments = await c.h.oracle.query<{ id: string }>(
        "select id from public.payments where sale_id = $1 and status = 'activo' order by created_at",
        [sale.id],
      );
      if (payments.length === 0) c.h.finding("la venta pagada no tiene pagos activos que anular");
      for (const payment of payments) {
        c.h.need(
          await c.h.op({
            as: ADMIN,
            method: "PATCH",
            path: `/api/payments/${payment.id}/cancel`,
            label: "anular pago",
            expect: { http: "accept", stockDelta: {}, movements: [], ref: null },
          }),
          "la anulación del pago",
        );
      }
      const flow = afterDeactivation(subject, "cancelar la venta");
      const first = await cancelSale(c, subject, sale, flow.http, "cancelar tras anular el pago", flow.findingIfRejected);
      if (!first.accepted) return;
      await cancelSale(c, subject, sale, "reject", "cancelar por segunda vez");
    },
  },
  {
    key: "sale_return_partial",
    title: "Devolución parcial de venta por ajuste devolucion_cliente: sin documento → 400; ligada a la venta (saleId) con tope vendido − ya devuelto",
    hypothesis: ["H4"],
    skip: skipZero,
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const sale = await sell(c, subject, 3, "paid", "venta pagada de 3");
      if (!sale) return;
      await deactivateIfInactiveKind(c, subject);
      // R4 (20261006g): la devolución suelta ya no existe; 400 y ni un movimiento.
      await adjust(c, subject, 1, "devolucion_cliente", "reject", "devolución de 1 SIN saleId (ajuste suelto)");
      const link = { saleId: sale.id };
      const first = await adjust(c, subject, 1, "devolucion_cliente", flowHttp(subject), "devolución parcial de 1 ligada a la venta", undefined, link);
      if (!first.accepted) return;
      // Tope: vendido 3, ya devuelto 1 → caben 2, no 3.
      await adjust(c, subject, 3, "devolucion_cliente", "reject", "devolución de 3 ligada (supera el tope: quedan 2)", undefined, link);
      const rest = await adjust(c, subject, 2, "devolucion_cliente", flowHttp(subject), "devolución de las 2 restantes ligada", undefined, link);
      if (!rest.accepted) return;
      await adjust(c, subject, 1, "devolucion_cliente", "reject", "devolución de 1 más (tope agotado)", undefined, link);
      c.h.note(`la venta ${sale.id} queda "${await saleStatus(c, sale.id)}": la devolución ligada mueve stock, no el documento ni el cobro`);
    },
  },
  {
    key: "sale_return_total",
    title: "Devolución total de venta, y devolver dos veces",
    hypothesis: ["H4"],
    skip: skipZero,
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const sale = await sell(c, subject, 2, "paid", "venta pagada");
      if (!sale) return;
      await deactivateIfInactiveKind(c, subject);
      const flow = afterDeactivation(subject, "devolver la venta");
      const first = await returnSale(c, subject, sale, flow.http, "devolver", flow.findingIfRejected);
      if (!first.accepted) return;
      // C7: return_sale anula los pagos de la venta en la misma transacción.
      const live = await c.h.oracle.query<{ id: string }>("select id from public.payments where sale_id = $1 and status = 'activo'", [sale.id]);
      if (live.length > 0) c.h.fail(`devolver: la venta ${sale.id} quedó devuelta con ${live.length} pago(s) activo(s)`);
      await returnSale(c, subject, sale, "reject", "devolver por segunda vez");
    },
  },
  {
    key: "purchase_received_unit",
    title: "Compra recibido por unidad (10); sobre un producto inactivo se rechaza sin mover stock ni libro",
    hypothesis: ["H1"],
    run: async (c) => {
      const subject = await createSubject(c);
      // COM-15: con el producto inactivo `buy` exige el rechazo (4xx, stock y movimientos intactos).
      await buy(c, subject, { mode: "unit", quantity: 10 }, { label: subject.active ? "compra 10 uds" : "compra 10 uds de un producto inactivo" });
    },
  },
  ...PACK_SIZES.map(packPurchaseOp),
  {
    key: "purchase_pack_upp_mismatch",
    title: "Compra en empaque con unitsPerPack enviado (10) distinto del par del producto (12)",
    hypothesis: ["H2"],
    skip: skipNoPack,
    run: async (c) => {
      const subject = await createSubject(c, { unitsPerPack: 12 });
      await buy(
        c,
        subject,
        { mode: "pack", packCount: 2, unitsPerPack: 10 },
        {
          productId: subject.unit?.id ?? subject.id,
          label: "compra 2×10 sobre la unidad de un par x12",
          observe: true,
          findingIfAccepted: "acepta unitsPerPack=10 aunque el par del producto es x12: entran 20 unidades (2×10), no 24, sin validar contra el par",
        },
      );
    },
  },
  {
    key: "purchase_pack_on_pack_sku",
    title: "Compra en modo empaque cargada sobre el SKU empaque (2 bultos × 12) en vez de sobre el SKU unidad",
    hypothesis: ["H2"],
    skip: skipNoPack,
    run: async (c) => {
      const subject = await createSubject(c, { unitsPerPack: 12 });
      await buy(
        c,
        subject,
        { mode: "pack", packCount: 2, unitsPerPack: 12 },
        // C13 (20261006c/f): el SKU empaque se cuenta en empaques → entran 2, no 24.
        { productId: subject.id, label: "compra 2×12 sobre el SKU empaque (+2 empaques)", units: 2 },
      );
    },
  },
  {
    key: "purchase_ordered_then_receive",
    title: "Compra pedido (no mueve stock) → recibir (entra una vez); si el producto se desactiva tras pedirlo se recibe igual, y un pedido nuevo se rechaza",
    hypothesis: ["H1", "H11"],
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const purchase = await buy(c, subject, { mode: "unit", quantity: 10 }, { status: "pedido", label: "compra pedido" });
      if (!purchase) return;
      await deactivateIfInactiveKind(c, subject);
      // COM-15: la mercancía ya pedida se recibe aunque el producto se haya desactivado después.
      const label = subject.active ? "recibir" : "recibir el pedido de un producto desactivado después de pedirlo";
      c.h.need(await purchaseStep(c, subject, purchase, "receive", "accept", label), "la recepción del pedido");
      if (subject.active) return;
      await buy(c, subject, { mode: "unit", quantity: 10 }, { status: "pedido", label: "pedido nuevo de un producto ya inactivo" });
    },
  },
  {
    key: "purchase_receive_twice",
    title: "Recibir dos veces la misma compra (en serie): la segunda se rechaza sin mover",
    hypothesis: ["H1", "H11"],
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const purchase = await buy(c, subject, { mode: "unit", quantity: 10 }, { status: "pedido", label: "compra pedido" });
      if (!purchase) return;
      await deactivateIfInactiveKind(c, subject);
      const first = await purchaseStep(c, subject, purchase, "receive", "accept", "recibir");
      if (!first.accepted) return;
      await purchaseStep(c, subject, purchase, "receive", "reject", "recibir por segunda vez");
    },
  },
  {
    key: "purchase_cancel_received",
    title: "Cancelar compra recibida sin stock vendido, y cancelar dos veces",
    hypothesis: ["H4"],
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const purchase = await buy(c, subject, { mode: "unit", quantity: 10 }, { label: "compra 10 uds" });
      if (!purchase) return;
      await deactivateIfInactiveKind(c, subject);
      const first = await purchaseStep(c, subject, purchase, "cancel", flowHttp(subject), "cancelar compra");
      if (!first.accepted) return;
      await purchaseStep(c, subject, purchase, "cancel", "reject", "cancelar por segunda vez");
    },
  },
  {
    key: "purchase_cancel_received_sold",
    title: "Cancelar compra recibida con stock ya vendido (compra 10, vende 6): rechazo sin mover",
    hypothesis: ["H4"],
    run: async (c) => {
      const subject = await createSubject(c, { stock: 0, keepActive: true });
      const purchase = await buy(c, subject, { mode: "unit", quantity: 10 }, { label: "compra 10 uds" });
      if (!purchase) return;
      const sale = await sell(c, subject, 6, "paid", "venta de 6");
      if (!sale) return;
      await deactivateIfInactiveKind(c, subject);
      await purchaseStep(c, subject, purchase, "cancel", "reject", "cancelar compra con 4 en stock");
    },
  },
  {
    key: "purchase_return_partial",
    title: "Devolución parcial de compra por ajuste devolucion_proveedor: sin documento → 400; ligada a la compra (purchaseId) con tope recibido − ya devuelto",
    hypothesis: ["H4"],
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const purchase = await buy(c, subject, { mode: "unit", quantity: 10 }, { label: "compra 10 uds" });
      if (!purchase) return;
      await deactivateIfInactiveKind(c, subject);
      // R4 (20261006g): la devolución suelta ya no existe; 400 y ni un movimiento.
      await adjust(c, subject, -3, "devolucion_proveedor", "reject", "devolución de 3 SIN purchaseId (ajuste suelto)");
      const link = { purchaseId: purchase.id };
      const first = await adjust(c, subject, -3, "devolucion_proveedor", flowHttp(subject), "devolución parcial de 3 ligada a la compra", undefined, link);
      if (!first.accepted) return;
      // Tope: recibido 10, ya devuelto 3 → caben 7, no 8.
      await adjust(c, subject, -8, "devolucion_proveedor", "reject", "devolución de 8 ligada (supera el tope: quedan 7)", undefined, link);
      const rest = await adjust(c, subject, -7, "devolucion_proveedor", flowHttp(subject), "devolución de las 7 restantes ligada", undefined, link);
      if (!rest.accepted) return;
      await adjust(c, subject, -1, "devolucion_proveedor", "reject", "devolución de 1 más (tope agotado)", undefined, link);
    },
  },
  {
    key: "purchase_return_total",
    title: "Devolver compra completa, y devolver dos veces",
    hypothesis: ["H4"],
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      const purchase = await buy(c, subject, { mode: "unit", quantity: 10 }, { label: "compra 10 uds" });
      if (!purchase) return;
      await deactivateIfInactiveKind(c, subject);
      const first = await purchaseStep(c, subject, purchase, "return", flowHttp(subject), "devolver compra");
      if (!first.accepted) return;
      await purchaseStep(c, subject, purchase, "return", "reject", "devolver por segunda vez");
    },
  },
  {
    key: "adjust_in",
    title: "Ajuste de entrada (+5)",
    hypothesis: ["H7"],
    run: async (c) => {
      const subject = await createSubject(c);
      await adjust(
        c,
        subject,
        5,
        "ajuste_entrada",
        adjustHttp(subject, 5),
        "ajuste entrada",
        subject.active ? undefined : "se puede ajustar (entrada) el stock de un producto inactivo",
      );
    },
  },
  {
    key: "adjust_out",
    title: "Ajuste de salida (−3; con stock 0 debe rechazarse)",
    hypothesis: ["H7"],
    run: async (c) => {
      const subject = await createSubject(c);
      await adjust(
        c,
        subject,
        -3,
        "ajuste_salida",
        adjustHttp(subject, -3),
        "ajuste salida",
        subject.active ? undefined : "se puede ajustar (salida) el stock de un producto inactivo",
      );
    },
  },
  {
    key: "adjust_out_over_stock",
    title: "Ajuste de salida mayor que el stock: rechazo sin movimiento",
    hypothesis: ["H7"],
    run: async (c) => {
      const subject = await createSubject(c);
      const delta = -(subject.stock + 5);
      await adjust(c, subject, delta, "ajuste_salida", adjustHttp(subject, delta), "ajuste salida mayor que el stock");
    },
  },
  ...PACK_SIZES.map(conversionOp),
  {
    key: "conversion_insufficient",
    title: "Conversión empaque→unidad sin stock suficiente: rechazo sin ninguno de los dos movimientos",
    hypothesis: ["H5"],
    skip: skipNoPack,
    run: async (c) => {
      const subject = await createSubject(c, { stock: 1 });
      await convert(c, subject, 2, "reject", "conversión de 2 con 1 empaque");
    },
  },
  {
    key: "new_product_stock_form",
    title: "Producto nuevo con stock inicial por formulario (POST /api/products con currentStock)",
    hypothesis: ["H9"],
    run: (c) => newProductWithStock(c, "form"),
  },
  {
    key: "new_product_stock_import",
    title: "Producto nuevo con stock inicial por import Excel (mismo POST /api/products por fila; no hay endpoint de import de servidor)",
    hypothesis: ["H9"],
    skip: (kind) =>
      KIND_SPECS[kind].pack ? "la plantilla de import no tiene columnas de empaque: no se puede crear un par por import" : undefined,
    run: (c) => newProductWithStock(c, "import"),
  },
  {
    key: "sale_over_stock_rejected",
    title: "Venta con cantidad > stock (pagada y pendiente): 4xx sin venta, movimiento ni pago",
    hypothesis: ["H6"],
    run: async (c) => {
      const subject = await createSubject(c);
      await sell(c, subject, subject.stock + 1, "paid", "venta pagada sobre el stock");
      await sell(c, subject, subject.stock + 1, "pending", "venta pendiente sobre el stock");
    },
  },
  {
    key: "sale_inactive_rejected",
    title: "Venta de producto desactivado (pagada y pendiente): 4xx sin venta, movimiento ni pago",
    hypothesis: ["H12"],
    run: async (c) => {
      const subject = await createSubject(c, { keepActive: true });
      await deactivate(c, subject);
      await sell(c, subject, 1, "paid", "venta pagada de inactivo");
      await sell(c, subject, 1, "pending", "venta pendiente de inactivo");
    },
  },
];

// ---------------------------------------------------------------------------
// Matriz
// ---------------------------------------------------------------------------

export function caseId(kind: Kind, opKey: string): string {
  return `${kind}.${opKey}`;
}

/** 5 tipos × todas las operaciones: una celda por combinación, sin huecos. */
export function buildSerialMatrix(): CaseDef<SerialHarness>[] {
  const cases: CaseDef<SerialHarness>[] = [];
  for (const kind of KINDS) {
    for (const op of OPS) {
      const skip = op.skip?.(kind);
      cases.push({
        id: caseId(kind, op.key),
        title: `${op.title} · ${KIND_SPECS[kind].label}`,
        hypothesis: op.hypothesis,
        ...(skip !== undefined ? { skip } : {}),
        run: (harness) => op.run({ ...harness, kind }),
      });
    }
  }
  return cases;
}

/** Líneas de `--list`: id, estado (run/skip) y título. */
export function listSerialMatrix(): string[] {
  return buildSerialMatrix().map((item) => `${item.id}\t${item.skip !== undefined ? `skip: ${item.skip}` : "run"}\t${item.title}`);
}
