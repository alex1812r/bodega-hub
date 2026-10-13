/**
 * Escenarios `pack.receive_disassemble_*` (COM-14, parche `20261010d-receive-disassemble.sql`): compra con «Desarmar al
 * recibir». La línea marcada de un empaque con receta se abre en sus componentes en la misma transacción que la recibe.
 *
 *   npm run stock-lab:scenarios -- --suite hypotheses --only pack.receive_disassemble_order,pack.receive_disassemble_parallel
 *
 * Corren con la suite `hypotheses`. La receta se crea por las tablas y las RPC se llaman por PostgREST como
 * `lab-almacen` (cada petición es su propia transacción, así que la concurrencia es real); solo
 * `pack.receive_disassemble_bff` pasa por el BFF (`POST /api/purchases`, detalle y `PATCH …/receive`).
 *
 * Convención: `expected` describe lo que haría un sistema sano; `fail` = bug reproducido.
 */
import { randomUUID } from "node:crypto";

import type { LabRoleKey } from "../agents/base";
import { createRecipe, expectClean, explain, facts, setCost } from "./assorted-pack";
import { Checks, buildPurchaseBody, outcome, type CaseCtx, type CaseDef, type CaseOutcome, type Lab, type LabProductRef, type RestResult } from "./db";

export type OrderLine = { product: LabProductRef; quantity: number; costRef: number; disassemble?: boolean };

const STOCKER: LabRoleKey = "almacen";
const RATE = 100;
const DEADLOCK_RE = /deadlock|40P01/i;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Líneas por unidad, sin IVA, con la marca solo cuando es `true` (como las envía el BFF). */
export function toOrderItems(lines: readonly OrderLine[]): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const subtotalRef = round2(line.quantity * line.costRef);
    return {
      product_id: line.product.id,
      entry_mode: "unit",
      quantity: line.quantity,
      cost_currency: "ref",
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
}

async function createPurchase(lab: Lab, t: CaseCtx, lines: readonly OrderLine[], status: "pedido" | "recibido" = "pedido"): Promise<{ id: string; res: RestResult }> {
  const items = toOrderItems(lines);
  const subtotalRef = round2(items.reduce((sum, item) => sum + Number(item.subtotal_ref), 0));
  const res = await t.rpc(STOCKER, "create_purchase", {
    p_supplier_id: lab.supplierId,
    p_items: items,
    p_ref_rate_ves: RATE,
    p_discount_ref: 0,
    p_tax_ref: 0,
    p_notes: `S403 ${t.key}`,
    p_status: status,
    p_discount_ves: 0,
    p_tax_ves: 0,
    p_subtotal_ves: round2(subtotalRef * RATE),
    p_subtotal_ref: subtotalRef,
    p_client_request_id: randomUUID(),
  });
  const id = res.data && typeof res.data === "object" ? (res.data as { id?: unknown }).id : null;
  if (res.error || typeof id !== "string") throw new Error(`No se pudo crear la compra: ${explain(res)}`);
  return { id, res };
}

function receive(t: CaseCtx, purchaseId: string, clientRequestId?: string): Promise<RestResult> {
  return t.rpc(STOCKER, "receive_purchase_and_disassemble", {
    p_purchase_id: purchaseId,
    ...(clientRequestId ? { p_client_request_id: clientRequestId } : {}),
  });
}

async function brief(lab: Lab, product: LabProductRef): Promise<Array<[string, number, number]>> {
  return (await lab.movements(product.id)).map((move) => [move.type, move.quantity_delta, move.stock_after]);
}

/** Caja de `units` unidades con su receta de un componente; la caja y la unidad parten con el stock indicado. */
async function box(lab: Lab, t: CaseCtx, units: number, stock: { pack?: number; unit?: number } = {}): Promise<{ pack: LabProductRef; unit: LabProductRef }> {
  const pack = await t.product("caja", stock.pack ?? 0);
  const unit = await t.product("unidad", stock.unit ?? 0);
  await setCost(t, pack, 6);
  await setCost(t, unit, 1);
  await createRecipe(lab, t, pack, [{ product: unit, units }]);
  return { pack, unit };
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

async function orderThenReceive(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, unit } = await box(lab, t, 6, { unit: 4 });
  const loose = await t.product("suelto", 0);
  const order = await createPurchase(lab, t, [
    { product: pack, quantity: 3, costRef: 9, disassemble: true },
    { product: loose, quantity: 5, costRef: 2 },
  ]);
  const ordered = await facts(lab, [pack, unit, loose]);
  checks.eq("el pedido no mueve stock", ordered.map((f) => f.stock), [0, 4, 0]);

  const res = await receive(t, order.id);
  checks.ok("recibir el pedido", !res.error, explain(res));
  const after = await facts(lab, [pack, unit, loose]);
  const moves = { pack: await brief(lab, pack), unit: await brief(lab, unit), loose: await brief(lab, loose) };
  // 3 cajas a 9,00 = 27,00 en 18 unidades; con las 4 que había a 1,00: (4 + 27) / 22 = 1,41.
  checks.eq("stock y costo (caja, unidad, suelto)", after, [{ stock: 0, cost: 9 }, { stock: 22, cost: 1.41 }, { stock: 5, cost: 2 }]);
  checks.eq("la caja entra y sale", moves.pack, [["compra", 3, 3], ["conversion_salida", -3, 0]]);
  checks.eq("la unidad recibe 3 × 6", moves.unit.slice(-1), [["conversion_entrada", 18, 22]]);
  checks.eq("la línea normal entra como siempre", moves.loose, [["compra", 5, 5]]);

  const again = await receive(t, order.id);
  checks.eq("recibir otra vez: 409 y sin doble desarme", [again.status, (await facts(lab, [pack, unit])).map((f) => f.stock)], [409, [0, 22]]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { caja: "neto 0 (+3 compra, −3 conversion_salida)", unidad: "+18", suelto: "+5", segunda_recepcion: 409 },
    actual: { status: res.status, estado: after, movimientos: moves, segunda: again.status },
    evidence: [`compra ${order.id}`, `caja ${pack.id}`, `unidad ${unit.id}`],
  });
}

async function receivedAtCreation(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, unit } = await box(lab, t, 12);
  const created = await createPurchase(lab, t, [{ product: pack, quantity: 2, costRef: 12, disassemble: true }], "recibido");
  const after = await facts(lab, [pack, unit]);
  checks.eq("stock y costo (caja, unidad)", after, [{ stock: 0, cost: 12 }, { stock: 24, cost: 1 }]);
  checks.eq("movimientos de la caja", await brief(lab, pack), [["compra", 2, 2], ["conversion_salida", -2, 0]]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { caja: "neto 0", unidad: "+24 a 1,00" },
    actual: { status: created.res.status, estado: after },
    evidence: [`compra ${created.id}`, `caja ${pack.id}`],
  });
}

async function parallel(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const ROUNDS = 8;
  const { pack, unit } = await box(lab, t, 6, { pack: ROUNDS });
  // Pedidos que DESARMAN la caja, pedidos que compran la unidad suelta y la caja sin desarmar, y aperturas a mano: todos a la vez.
  const disassembling: string[] = [];
  const plain: string[] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    disassembling.push((await createPurchase(lab, t, [{ product: pack, quantity: 1, costRef: 6, disassemble: true }, { product: unit, quantity: 1, costRef: 1 }])).id);
    plain.push((await createPurchase(lab, t, [{ product: unit, quantity: 2, costRef: 1 }, { product: pack, quantity: 1, costRef: 6 }])).id);
  }

  const responses = await Promise.all([
    ...disassembling.map((id) => receive(t, id)),
    ...plain.map((id) => t.rpc(STOCKER, "receive_purchase", { p_purchase_id: id })),
    ...Array.from({ length: ROUNDS }, () => t.rpc(STOCKER, "convert_pack_to_units", { p_pack_product_id: pack.id, p_pack_quantity: 1, p_reason: `S403 ${t.key}` })),
  ]);
  checks.eq("todas las operaciones simultáneas entran", responses.filter((res) => res.error).map(explain), []);
  checks.ok("sin deadlock", !responses.some((res) => DEADLOCK_RE.test(res.error?.message ?? "")));

  const after = await facts(lab, [pack, unit]);
  // Caja: 8 iniciales + 8 (desarmadas, neto 0) + 8 (sin desarmar) − 8 abiertas a mano. Unidad: 8 × (1 + 6) + 8 × 2 + 8 × 6.
  checks.eq("stock final (caja, unidad)", after.map((f) => f.stock), [ROUNDS, ROUNDS * 15]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { stock: [ROUNDS, ROUNDS * 15], deadlocks: 0, vistas: 0 },
    actual: { statuses: responses.map((res) => res.status), estado: after },
    evidence: [`caja ${pack.id}`, `unidad ${unit.id}`],
  });
}

async function doubleSubmit(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, unit } = await box(lab, t, 6);
  const order = await createPurchase(lab, t, [{ product: pack, quantity: 2, costRef: 6, disassemble: true }]);
  const key = randomUUID();

  const same = await Promise.all(Array.from({ length: 5 }, () => receive(t, order.id, key)));
  const other = await receive(t, order.id, randomUUID());
  checks.eq("5 envíos con la MISMA clave: todos devuelven la compra recibida", same.map((res) => res.status), [200, 200, 200, 200, 200]);
  checks.eq("otra clave después: 409", other.status, 409);
  const after = await facts(lab, [pack, unit]);
  checks.eq("una sola recepción y una sola apertura", [after.map((f) => f.stock), (await brief(lab, pack)).length, (await brief(lab, unit)).length], [[0, 12], 2, 1]);
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { recepciones: 1, aperturas: 1, stock: [0, 12] },
    actual: { misma_clave: same.map((res) => res.status), otra_clave: other.status, estado: after },
    evidence: [`compra ${order.id}`, `clave ${key}`],
  });
}

type DetailLine = { id?: string; productId?: string; disassembleOnReceive?: boolean; disassembled?: boolean; packRecipe?: { totalUnits?: number } };

/** Líneas del detalle de compra tal como las responde el BFF. */
function detailLines(data: unknown): DetailLine[] {
  const items = data && typeof data === "object" ? (data as { items?: unknown }).items : null;
  return Array.isArray(items) ? (items as DetailLine[]) : [];
}

async function throughBff(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const checks = new Checks();
  const { pack, unit } = await box(lab, t, 6);
  const other = await box(lab, t, 4);
  const rate = await lab.rate();
  const body = buildPurchaseBody(
    [
      { productId: pack.id, quantity: 2, unitCostRef: 6 },
      { productId: other.pack.id, quantity: 1, unitCostRef: 4 },
    ],
    { supplierId: lab.supplierId, status: "pedido", exchangeRateId: rate.id, rateVes: rate.rateVes, notes: `S403 ${t.key}`, clientRequestId: randomUUID() },
  );
  const items = body.items as Array<Record<string, unknown>>;
  if (items[0]) items[0].disassembleOnReceive = true;

  const created = await t.http(STOCKER, "POST", "/api/purchases", body);
  const createdData = created.body?.data;
  const purchaseId = createdData && typeof createdData === "object" ? (createdData as { id?: unknown }).id : null;
  if (!created.ok || typeof purchaseId !== "string") throw new Error(`No se pudo crear el pedido por el BFF: ${created.status}`);

  const ordered = detailLines((await t.http(STOCKER, "GET", `/api/purchases/${purchaseId}`)).body?.data);
  const byProduct = (lines: DetailLine[], product: LabProductRef) => lines.find((line) => line.productId === product.id);
  checks.eq(
    "el detalle del pedido trae id, marca y receta de cada línea",
    [byProduct(ordered, pack), byProduct(ordered, other.pack)].map((line) => [typeof line?.id, line?.disassembleOnReceive, line?.disassembled, line?.packRecipe?.totalUnits]),
    [["string", true, false, 6], ["string", false, false, 4]],
  );

  // La confirmación cambia de idea: se desarma la segunda línea y no la que el pedido traía marcada.
  const key = randomUUID();
  const list = { clientRequestId: key, disassemble: [{ purchaseItemId: byProduct(ordered, other.pack)?.id }] };
  const received = await t.http(STOCKER, "PATCH", `/api/purchases/${purchaseId}/receive`, list);
  const retry = await t.http(STOCKER, "PATCH", `/api/purchases/${purchaseId}/receive`, list);
  const again = await t.http(STOCKER, "PATCH", `/api/purchases/${purchaseId}/receive`, { disassemble: [] });
  checks.eq("recibir, reintento con la misma clave y segunda recepción", [received.status, retry.status, again.status], [200, 200, 409]);

  const after = await facts(lab, [pack, unit, other.pack, other.unit]);
  const lines = detailLines(received.body?.data);
  checks.eq("stock (caja marcada en el pedido, su unidad, la otra caja, su unidad)", after.map((f) => f.stock), [2, 0, 0, 4]);
  checks.eq(
    "el detalle recibido dice qué línea se desarmó",
    [byProduct(lines, pack), byProduct(lines, other.pack)].map((line) => [line?.disassembleOnReceive, line?.disassembled]),
    [[false, false], [true, true]],
  );
  await expectClean(checks, t);
  return outcome(checks, {
    expected: { recepcion: 200, reintento: 200, segunda: 409, stock: [2, 0, 0, 4] },
    actual: { statuses: [created.status, received.status, retry.status, again.status], estado: after },
    evidence: [`compra ${purchaseId}`, `clave ${key}`],
  });
}

export const RECEIVE_DISASSEMBLE_CASES: readonly CaseDef[] = [
  { id: "pack.receive_disassemble_order", title: "Compra con desarmar al recibir: pedido con línea marcada → recibir abre los empaques", hypothesis: ["H1", "H5"], run: orderThenReceive },
  { id: "pack.receive_disassemble_created_received", title: "Compra que nace recibida con línea marcada: entra y se abre en la misma llamada", hypothesis: ["H5"], run: receivedAtCreation },
  { id: "pack.receive_disassemble_parallel", title: "Recepciones con desarme, recepciones normales y aperturas a mano a la vez: stock correcto, sin deadlock", hypothesis: ["H5", "H6"], run: parallel },
  { id: "pack.receive_disassemble_double_submit", title: "Doble envío de la recepción con la MISMA clave: una recepción y una apertura", hypothesis: ["H8", "H11"], run: doubleSubmit },
  { id: "pack.receive_disassemble_bff", title: "Por el BFF: pedido con línea marcada, detalle con receta y recepción con la lista de la confirmación", hypothesis: ["H1", "H5"], run: throughBff },
];
