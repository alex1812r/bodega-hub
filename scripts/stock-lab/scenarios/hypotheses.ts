/**
 * Suite `hypotheses` (STK-403, plan stock-integrity fase 4): al menos un
 * escenario ejecutado contra la base lab por cada hipótesis H1..H12.
 *
 *   npx tsx scripts/stock-lab/scenarios/hypotheses.ts --run <id> [--only a,b] [--list] [--out <dir>]
 *
 * Convención: `expected` describe lo que haría un sistema sano. `fail` = el bug
 * se reprodujo; `pass` = este escenario lo descarta; `finding` = el stock queda
 * bien pero hay un hallazgo (p. ej. 500 donde tocaba 4xx).
 *
 * `hypothesis_verdict` habla de la hipótesis LITERAL del plan. En los casos de
 * hueco (`*.dg*`, G1..G9 de la revisión estática) el veredicto puede ser `fail`
 * (el hueco existe) con `hypothesis_verdict = descartada` (ese hueco no es el
 * mecanismo que la hipótesis describe); el `detail` lo dice en cada caso.
 *
 * La CLI corre además los casos `pack.assorted_*` de `./assorted-pack` (PRO-12:
 * empaque surtido), que usan el mismo runner y no pasan por el BFF.
 *
 * Todo se hace sobre productos propios `s403-<run>-…`. Los casos que corrompen
 * datos a propósito (update directo, cambio de `store_id`) lo dejan anotado en
 * `steps` como `SQL …` y nunca tocan filas de otros prefijos.
 */
import { randomUUID } from "node:crypto";

import type { ApiResponse } from "../../e2e-bodegon/client";
import type { LabRoleKey } from "../agents/base";
import { ASSORTED_PACK_CASES } from "./assorted-pack";
import { RECEIVE_DISASSEMBLE_CASES } from "./receive-disassemble";
import {
  Checks,
  actAs,
  analyzeChain,
  dataOf,
  errorOf,
  fmtMove,
  idOf,
  is2xx,
  is4xx,
  mustId,
  outcome,
  round2,
  runSuite,
  type CaseCtx,
  type CaseDef,
  type CaseOutcome,
  type HypothesisVerdict,
  type Lab,
  type LabProductRef,
  type Movement,
  type RestResult,
} from "./db";

type Seller = "vendedor1" | "vendedor2";

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

export type StatusSummary = { ok: number; rejected4xx: number; errors5xx: number; statuses: number[] };

export function summarizeStatuses(statuses: readonly number[]): StatusSummary {
  return {
    ok: statuses.filter(is2xx).length,
    rejected4xx: statuses.filter(is4xx).length,
    errors5xx: statuses.filter((status) => status >= 500).length,
    statuses: [...statuses],
  };
}

export function sumDelta(moves: ReadonlyArray<Pick<Movement, "type" | "quantity_delta">>, type?: string): number {
  return moves.filter((move) => !type || move.type === type).reduce((sum, move) => sum + move.quantity_delta, 0);
}

export const STOCK_RPCS = [
  "create_sale",
  "cancel_sale",
  "return_sale",
  "create_purchase",
  "receive_purchase",
  "cancel_purchase",
  "return_purchase",
  "adjust_stock",
  "convert_pack_to_units",
  "create_sale_with_payments",
  "register_payment",
  "cancel_payment",
] as const;

export type D0FunctionRow = {
  proname: string;
  owner: string;
  prosecdef: boolean;
  proconfig: string[] | null;
  rolbypassrls: boolean;
  rolsuper: boolean;
};

/**
 * Precondiciones de H12 (D0): cada RPC existe una sola vez, es `security
 * definer`, fija `search_path=public` y su dueño puede saltarse RLS (es el
 * dueño de las tablas, superusuario o `bypassrls`). Devuelve los problemas.
 */
export function d0Problems(
  rows: readonly D0FunctionRow[],
  tableOwners: readonly string[],
  expected: readonly string[] = STOCK_RPCS,
): string[] {
  const problems: string[] = [];
  for (const name of expected) {
    const matches = rows.filter((row) => row.proname === name);
    if (matches.length === 0) {
      problems.push(`${name}: no existe`);
      continue;
    }
    if (matches.length > 1) problems.push(`${name}: ${matches.length} sobrecargas vivas`);
    for (const row of matches) {
      if (!row.prosecdef) problems.push(`${name}: no es security definer`);
      if (!(row.proconfig ?? []).some((entry) => entry.replace(/\s|"/g, "") === "search_path=public")) {
        problems.push(`${name}: search_path no fijado a public`);
      }
      const ownsTables = tableOwners.every((owner) => owner === row.owner);
      if (!ownsTables && !row.rolbypassrls && !row.rolsuper) {
        problems.push(`${name}: su dueño (${row.owner}) no es el de las tablas ni tiene bypassrls`);
      }
    }
  }
  return problems;
}

export type DoubleSubmitObservation = {
  /** Nombre de la operación (compra, ajuste, conversión) para los mensajes. */
  op: string;
  /** Los dos POST llevaban la MISMA `clientRequestId`. */
  keyed: boolean;
  statuses: number[];
  /** Id de la operación que devolvió cada POST (null si no hubo). */
  ids: Array<string | null>;
  /** Movimientos nuevos del producto tras los dos POST. */
  movements: number;
  /** Movimientos que deja UNA sola operación. */
  expectedMovements: number;
};

/**
 * Doble POST idéntico de compra / ajuste / conversión (G5).
 * Con la misma clave el contrato es duro: una sola operación (mismo id, un
 * movimiento). Sin clave el servidor no puede deduplicar: la clave es opcional
 * por contrato en esos tres endpoints (decisión de la fase 5), así que el
 * duplicado se documenta como hallazgo, no como fallo.
 */
export function judgeDoubleSubmit(o: DoubleSubmitObservation): { failures: string[]; findings: string[] } {
  const failures: string[] = [];
  const findings: string[] = [];
  const statuses = o.statuses.join(",");
  if (o.keyed) {
    if (!o.statuses.every(is2xx)) failures.push(`${o.op}: los dos POST con la misma clientRequestId debían responder 2xx y respondieron ${statuses}`);
    const first = o.ids[0] ?? null;
    if (first === null || !o.ids.every((id) => id === first)) {
      failures.push(`${o.op}: los dos POST con la misma clientRequestId devolvieron ids distintos o nulos (${o.ids.map(String).join(", ")})`);
    }
    if (o.movements !== o.expectedMovements) {
      failures.push(`${o.op}: con la misma clientRequestId quedaron ${o.movements} movimiento(s) y se esperaba ${o.expectedMovements} (una sola operación)`);
    }
    return { failures, findings };
  }
  if (o.statuses.some((status) => status >= 500 || status === 0)) failures.push(`${o.op}: el doble POST sin clave respondió ${statuses}`);
  if (o.movements === o.expectedMovements * 2) {
    findings.push(
      `${o.op}: sin clientRequestId el doble POST se aplica dos veces (${o.movements} movimientos; el libro cuadra, el físico no). ` +
        "La clave es opcional por contrato en compras, ajustes y conversiones (decisión de la fase 5): solo protege al cliente que la envía",
    );
  } else if (o.movements !== o.expectedMovements && failures.length === 0) {
    failures.push(`${o.op}: el doble POST sin clave dejó ${o.movements} movimiento(s); ni una operación (${o.expectedMovements}) ni dos (${o.expectedMovements * 2})`);
  }
  return { failures, findings };
}

const DEADLOCK_RE = /deadlock|40P01|choc[oó] con otra|intenta de nuevo/i;

/**
 * N pares de ventas cruzadas [A,B] / [B,A] por HTTP (G7): cada respuesta debe
 * ser 2xx o un rechazo de negocio (4xx con mensaje). Un 40P01 no puede asomar
 * ni como 5xx ni como el 409 reintentable al que lo traduce el BFF.
 */
export function judgeCrossedSales(responses: ReadonlyArray<{ status: number; error: string }>): {
  failures: string[];
  accepted: number;
  rejected: number;
} {
  const failures: string[] = [];
  let accepted = 0;
  let rejected = 0;
  responses.forEach((res, index) => {
    if (is2xx(res.status)) {
      accepted += 1;
      return;
    }
    if (DEADLOCK_RE.test(res.error)) {
      failures.push(`venta #${index + 1}: deadlock (40P01) → ${res.status} ${res.error}`);
    } else if (!is4xx(res.status)) {
      failures.push(`venta #${index + 1}: respondió ${res.status} ${res.error || "(sin respuesta)"} en vez de 2xx o rechazo de negocio`);
    } else if (!res.error.trim()) {
      failures.push(`venta #${index + 1}: rechazo ${res.status} sin mensaje de negocio`);
    } else {
      rejected += 1;
    }
  });
  return { failures, accepted, rejected };
}

/** Filas afectadas según PostgREST (`return=representation`). */
export function restRowCount(res: RestResult): number {
  return Array.isArray(res.data) ? res.data.length : 0;
}

// ---------------------------------------------------------------------------
// Helpers de escenario
// ---------------------------------------------------------------------------

const CREATE_SALE_SQL = "select id from public.create_sale($1::uuid, $2::jsonb, null, $3::numeric)";

function saleItemsJson(lines: ReadonlyArray<{ productId: string; quantity: number }>): string {
  return JSON.stringify(lines.map((line) => ({ product_id: line.productId, quantity: line.quantity, unit_price_ref: 1 })));
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function brief(moves: readonly Movement[]): Array<[string, number, number]> {
  return moves.map((move) => [move.type, move.quantity_delta, move.stock_after]);
}

async function docStatus(lab: Lab, table: "sales" | "purchases", id: string): Promise<string | null> {
  const rows = await lab.rows<{ status: string }>(`select status::text as status from public.${table} where id = $1`, [id]);
  return rows[0]?.status ?? null;
}

async function movesOfDoc(lab: Lab, productId: string, column: "sale_id" | "purchase_id", id: string): Promise<Movement[]> {
  return (await lab.movements(productId)).filter((move) => move[column] === id);
}

/** Par empaque↔unidad propio, enlazado por el camino real (`PATCH /api/products/[id]`). */
async function makePair(t: CaseCtx, packStock: number, unitsPerPack: number): Promise<{ pack: LabProductRef; unit: LabProductRef }> {
  const pack = await t.product("pack", packStock);
  const unit = await t.product("unit", 0);
  // Con SOLO `packConversion` el PATCH responde 404 (update vacío sobre products): se manda también el nombre.
  const res = await t.http("almacen", "PATCH", `/api/products/${pack.id}`, {
    name: `S403 ${pack.sku}`,
    packConversion: { enabled: true, mode: "link_existing", unitsPerPack, unitProductId: unit.id },
  });
  if (!res.ok) throw new Error(`No se pudo enlazar el par empaque↔unidad: ${res.status} ${errorOf(res)}`);
  return { pack, unit };
}

type Snapshot = { stock: number; moves: number; updatedAt: string };

async function snapshot(lab: Lab, productId: string): Promise<Snapshot> {
  const rows = await lab.rows<{ current_stock: number; updated_at: string; moves: string }>(
    `select p.current_stock, p.updated_at::text as updated_at,
            (select count(*) from public.stock_movements m where m.product_id = p.id)::text as moves
     from public.products p where p.id = $1`,
    [productId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Producto ${productId} no existe.`);
  return { stock: row.current_stock, moves: Number(row.moves), updatedAt: row.updated_at };
}

// ---------------------------------------------------------------------------
// H1 · H2
// ---------------------------------------------------------------------------

async function h01PedidoThenReceive(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 10);
  const created = await t.purchase("almacen", "pedido", [{ productId: p.id, quantity: 5 }]);
  const purchaseId = mustId(created, "compra en pedido");
  const stockAfterOrder = await lab.stock(p.id);
  const movesAfterOrder = await movesOfDoc(lab, p.id, "purchase_id", purchaseId);
  c.eq("estado que devuelve el API al crear", dataOf(created).status, "pedido");
  c.eq("stock tras crear el pedido", stockAfterOrder, 10);
  c.eq("movimientos de la compra en pedido", movesAfterOrder.length, 0);
  const detail = await t.http("almacen", "GET", `/api/purchases/${purchaseId}`);
  c.eq("estado en GET /api/purchases/[id]", dataOf(detail).status, "pedido");
  const scopedOrder = await t.scoped();
  c.eq("purchases_without_movements con la compra en pedido", scopedOrder.purchases_without_movements, 0);

  const received = await t.http("almacen", "PATCH", `/api/purchases/${purchaseId}/receive`);
  c.ok("receive responde 2xx", received.ok, `${received.status} ${errorOf(received)}`);
  const stockAfterReceive = await lab.stock(p.id);
  const moves = await movesOfDoc(lab, p.id, "purchase_id", purchaseId);
  c.eq("stock tras receive", stockAfterReceive, 15);
  c.eq("movimientos tras receive", brief(moves), [["compra", 5, 15]]);
  c.eq("estado tras receive", await docStatus(lab, "purchases", purchaseId), "recibido");
  c.note("`pedido` no mueve stock por diseño y el API lo devuelve como `pedido`; si en producción parece registrada es un tema de pantalla (ola 8.3).");
  return outcome(c, {
    expected: { stock: { tras_pedido: 10, tras_receive: 15 }, movements: [{ type: "compra", quantity_delta: 5, stock_after: 15 }] },
    actual: { stock: { tras_pedido: stockAfterOrder, tras_receive: stockAfterReceive }, movements: brief(moves) },
    evidence: [`producto ${p.id}`, `compra ${purchaseId}`, ...moves.map(fmtMove)],
  });
}

async function h02PackNormalization(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 0);
  const first = await t.purchase("almacen", "recibido", [{ productId: p.id, packCount: 3, unitsPerPack: 12 }]);
  const purchaseId = mustId(first, "compra empaque 3x12");
  const moves = await movesOfDoc(lab, p.id, "purchase_id", purchaseId);
  const items = await lab.rows(
    "select entry_mode, pack_count, units_per_pack, quantity from public.purchase_items where purchase_id = $1",
    [purchaseId],
  );
  const stockFirst = await lab.stock(p.id);
  c.eq("stock tras 3 empaques x 12", stockFirst, 36);
  c.eq("movimiento compra", brief(moves), [["compra", 36, 36]]);
  c.eq("purchase_items", items, [{ entry_mode: "pack", pack_count: 3, units_per_pack: 12, quantity: 36 }]);

  // Mismo modo empaque con un `quantity` contradictorio: sano = 400 o gana pack_count × units_per_pack.
  const second = await t.purchase("almacen", "recibido", [{ productId: p.id, packCount: 2, unitsPerPack: 6, quantity: 99 }]);
  const stockSecond = await lab.stock(p.id);
  if (second.ok) {
    c.eq("stock tras 2x6 con quantity=99 contradictorio", stockSecond, 48);
  } else {
    c.rejected("empaque con quantity contradictorio", second.status, errorOf(second));
    c.eq("stock tras el rechazo", stockSecond, 36);
  }
  const scoped = await t.scoped();
  c.eq("purchases_without_movements", scoped.purchases_without_movements, 0);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  return outcome(c, {
    expected: { quantity_delta: "pack_count × units_per_pack", stock: [36, "48 o rechazo 4xx"] },
    actual: { stock: [stockFirst, stockSecond], movements: brief(await lab.movements(p.id)), second_status: second.status },
    evidence: [`producto ${p.id}`, `compra ${purchaseId}`, ...moves.map(fmtMove)],
  });
}

async function h02Dg8UnitsPerPackUnchecked(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const { pack, unit } = await makePair(t, 5, 12);
  // "2 cajas x 12" cargadas en modo empaque sobre el SKU que YA es la caja.
  const onPack = await t.purchase("almacen", "recibido", [{ productId: pack.id, packCount: 2, unitsPerPack: 12 }]);
  const packStock = await lab.stock(pack.id);
  const literalHolds = !onPack.ok || packStock === 5 + 24;
  if (onPack.ok) {
    c.eq("stock del SKU empaque tras comprar 2 cajas (sano: +2 cajas, o rechazo)", packStock, 7);
  } else {
    c.rejected("modo empaque sobre el SKU empaque", onPack.status, errorOf(onPack));
  }
  // Sobre la unidad con units_per_pack distinto al del par (24 vs 12): C13 lo rechaza con 400 (las unidades las fija el par).
  const onUnit = await t.purchase("almacen", "recibido", [{ productId: unit.id, packCount: 1, unitsPerPack: 24 }]);
  const unitStock = await lab.stock(unit.id);
  c.rejected("compra 1x24 sobre la unidad de un par x12", onUnit.status, errorOf(onUnit));
  c.eq("stock de la unidad tras el rechazo", unitStock, 0);
  const scoped = await t.scoped();
  c.note(`vistas tras G8: reconciliation=${scoped.stock_reconciliation} conversion_mismatches=${scoped.conversion_mismatches} (el libro cuadra; lo inflado es el físico)`);
  if (c.failures.length > 0) {
    c.note("G8 reproducido: el empaque se multiplica otra vez al convertir. H2 literal no: quantity_delta = pack_count × units_per_pack.");
  }
  return outcome(c, {
    hypothesis_verdict: literalHolds ? "descartada" : "confirmada",
    expected: { pack_stock: "7 (5 + 2 cajas) o rechazo 4xx", unit: "400 y stock 0 (units_per_pack distinto al del par)" },
    actual: { pack_stock: packStock, pack_status: onPack.status, unit_stock: unitStock, unit_status: onUnit.status },
    evidence: [`empaque ${pack.id}`, `unidad ${unit.id}`, ...(await lab.movements(pack.id)).map(fmtMove)],
  });
}

// ---------------------------------------------------------------------------
// H3
// ---------------------------------------------------------------------------

async function h03D1StoreIsolation(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const mine = await t.product("lab", 10);
  const foreign = await t.product("def", 10, { store: "default" });
  const admin = await lab.supa("admin");

  // D1 por PostgREST real (anon key + sesión lab-admin).
  const selfMove = await t.rest(
    "admin",
    "PATCH profiles (propio) store_id=default",
    admin.from("profiles").update({ store_id: lab.defaultStoreId }).eq("id", lab.uids.admin).select("id"),
  );
  const otherMove = await t.rest(
    "admin",
    "PATCH profiles (vendedor-1) store_id=default",
    admin.from("profiles").update({ store_id: lab.defaultStoreId }).eq("id", lab.uids.vendedor1).select("id"),
  );
  const productMove = await t.rest(
    "admin",
    "PATCH products store_id=default",
    admin.from("products").update({ store_id: lab.defaultStoreId }).eq("id", mine.id).select("id"),
  );
  const foreignRead = await t.rest("admin", "GET products de la tienda default", admin.from("products").select("id").eq("id", foreign.id));
  const foreignWrite = await t.rest(
    "admin",
    "PATCH products.current_stock de la tienda default",
    admin.from("products").update({ current_stock: 999 }).eq("id", foreign.id).select("id"),
  );
  const foreignRpc = await t.rpc("admin", "adjust_stock", { p_product_id: foreign.id, p_quantity_delta: 1, p_reason: "S403 cruce", p_type: null });
  c.eq("filas al mover el perfil propio de tienda", restRowCount(selfMove), 0);
  c.eq("filas al mover a otro usuario de tienda", restRowCount(otherMove), 0);
  c.eq("filas al mover un producto de tienda", restRowCount(productMove), 0);
  c.eq("filas leídas de un producto de otra tienda", restRowCount(foreignRead), 0);
  c.eq("filas escritas en un producto de otra tienda", restRowCount(foreignWrite), 0);
  c.ok("adjust_stock sobre producto de otra tienda falla", foreignRpc.error !== null, "devolvió un movimiento");

  // Mismo cruce por el BFF con usuarios lab (la tienda default existe y tiene el producto).
  const adjust = await t.adjust("almacen", foreign.id, 1);
  const sale = await t.sale("vendedor1", [{ productId: foreign.id, quantity: 1 }], { clientRequestId: randomUUID() });
  const purchase = await t.purchase("almacen", "recibido", [{ productId: foreign.id, quantity: 2 }]);
  c.rejected("ajuste de producto de otra tienda", adjust.status, errorOf(adjust));
  c.rejected("venta de producto de otra tienda", sale.status, errorOf(sale));
  c.rejected("compra de producto de otra tienda", purchase.status, errorOf(purchase));

  const profiles = await lab.rows<{ store_id: string }>("select store_id from public.profiles where id = any($1::uuid[])", [
    [lab.uids.admin, lab.uids.vendedor1],
  ]);
  const stores = await lab.rows<{ store_id: string }>("select store_id from public.products where id = $1", [mine.id]);
  c.eq("tienda de los perfiles tras los intentos", [...new Set(profiles.map((row) => row.store_id))], [lab.storeId]);
  c.eq("tienda del producto lab", stores[0]?.store_id, lab.storeId);
  const foreignAfter = await snapshot(lab, foreign.id);
  const mineAfter = await snapshot(lab, mine.id);
  c.eq("stock y movimientos del producto de la tienda default", [foreignAfter.stock, foreignAfter.moves], [10, 1]);
  c.eq("stock y movimientos del producto lab", [mineAfter.stock, mineAfter.moves], [10, 1]);
  const scoped = await t.scoped();
  c.eq("cross_store_movements", scoped.cross_store_movements, 0);
  return outcome(c, {
    expected: { rls: "0 filas en los 5 intentos", rpc: "Producto no encontrado", bff: "4xx", foreign_stock: 10 },
    actual: {
      rls_rows: [selfMove, otherMove, productMove, foreignRead, foreignWrite].map(restRowCount),
      rls_errors: [selfMove, otherMove, productMove, foreignWrite].map((res) => res.error?.message ?? null),
      rpc_error: foreignRpc.error?.message ?? null,
      bff: { adjust: adjust.status, sale: sale.status, purchase: purchase.status },
      foreign: foreignAfter,
    },
    evidence: [`producto lab ${mine.id}`, `producto tienda default ${foreign.id}`],
  });
}

async function h03MovedProductOps(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 10);
  await t.sql("CORRUPCIÓN deliberada: products.store_id → tienda default", "update public.products set store_id = $2 where id = $1", [
    p.id,
    lab.defaultStoreId,
  ]);
  const crossWhileMoved = await lab.viewRows("cross_store_movements", [p.id]);
  const sale = await t.sale("vendedor1", [{ productId: p.id, quantity: 1 }], { clientRequestId: randomUUID() });
  const adjust = await t.adjust("almacen", p.id, 1);
  const purchase = await t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 2 }]);
  const rpc = await t.rpc("admin", "adjust_stock", { p_product_id: p.id, p_quantity_delta: 1, p_reason: "S403 movido", p_type: null });
  c.rejected("venta desde lab de un producto movido a default", sale.status, errorOf(sale));
  c.rejected("ajuste desde lab", adjust.status, errorOf(adjust));
  c.rejected("compra desde lab", purchase.status, errorOf(purchase));
  c.ok("adjust_stock directo falla", rpc.error !== null, "devolvió un movimiento");
  const after = await snapshot(lab, p.id);
  c.eq("stock y movimientos del producto (ahora en default) tras operar desde lab", [after.stock, after.moves], [10, 1]);
  c.ok("cross_store_movements detecta el producto movido", crossWhileMoved.length > 0, "la vista no lo lista");
  await t.sql("limpieza: products.store_id → tienda lab", "update public.products set store_id = $2 where id = $1", [p.id, lab.storeId]);
  return outcome(c, {
    expected: { operaciones: "4xx limpio, sin mover stock de la otra tienda", stock: 10, movements: 1 },
    actual: {
      statuses: { sale: sale.status, adjust: adjust.status, purchase: purchase.status, rpc: rpc.error?.message ?? "ok" },
      errors: { sale: errorOf(sale), adjust: errorOf(adjust), purchase: errorOf(purchase) },
      after,
      cross_store_movements_mientras: crossWhileMoved.length,
    },
    evidence: [`producto ${p.id}`, ...crossWhileMoved.map((row) => `cross_store mov ${String(row.movement_id)}`)],
  });
}

async function h03Dg6ReversalOutOfStore(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 10);
  const saleToCancel = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { clientRequestId: randomUUID() }), "venta a cancelar");
  const saleToReturn = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 1 }], { clientRequestId: randomUUID() }), "venta a devolver");
  const buyToCancel = mustId(await t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 3 }]), "compra a cancelar");
  const buyToReturn = mustId(await t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 4 }]), "compra a devolver");
  const before = await snapshot(lab, p.id);
  c.eq("stock de partida", before.stock, 14);

  await t.sql("CORRUPCIÓN deliberada: products.store_id → tienda default", "update public.products set store_id = $2 where id = $1", [
    p.id,
    lab.defaultStoreId,
  ]);
  const cross = await lab.viewRows("cross_store_movements", [p.id]);
  const reversals: Array<[string, ApiResponse]> = [
    ["cancel_sale", await t.http("vendedor1", "PATCH", `/api/sales/${saleToCancel}/cancel`)],
    ["return_sale", await t.http("vendedor1", "POST", `/api/sales/${saleToReturn}/return`)],
    ["cancel_purchase", await t.http("almacen", "PATCH", `/api/purchases/${buyToCancel}/cancel`)],
    ["return_purchase", await t.http("almacen", "POST", `/api/purchases/${buyToReturn}/return`)],
  ];
  for (const [name, res] of reversals) {
    c.ok(`${name} con el producto fuera de la tienda responde 4xx (G6)`, is4xx(res.status), `${res.status} ${errorOf(res)}`);
    c.ok(`${name}: el rechazo trae un mensaje de negocio`, !/null value|violates/i.test(errorOf(res)), `error crudo de Postgres: "${errorOf(res)}"`);
  }
  const moved = await snapshot(lab, p.id);
  c.eq("stock y movimientos del producto en la otra tienda tras las 4 reversiones", [moved.stock, moved.moves], [before.stock, before.moves]);
  c.ok("cross_store_movements detecta el producto movido", cross.length > 0, "la vista no lo lista");
  const statuses = [
    await docStatus(lab, "sales", saleToCancel),
    await docStatus(lab, "sales", saleToReturn),
    await docStatus(lab, "purchases", buyToCancel),
    await docStatus(lab, "purchases", buyToReturn),
  ];
  c.eq("estado de los documentos tras el rechazo", statuses, ["pendiente_pago", "pendiente_pago", "recibido", "recibido"]);

  // Limpieza: devolver el producto a lab y revertir de verdad (deja mis productos en 0).
  await t.sql("limpieza: products.store_id → tienda lab", "update public.products set store_id = $2 where id = $1", [p.id, lab.storeId]);
  const retry = [
    await t.http("vendedor1", "PATCH", `/api/sales/${saleToCancel}/cancel`),
    await t.http("vendedor1", "POST", `/api/sales/${saleToReturn}/return`),
    await t.http("almacen", "PATCH", `/api/purchases/${buyToCancel}/cancel`),
    await t.http("almacen", "POST", `/api/purchases/${buyToReturn}/return`),
  ];
  const final = await lab.stock(p.id);
  c.eq("reversiones tras restaurar la tienda", retry.map((res) => res.status), [200, 200, 200, 200]);
  c.eq("stock final tras revertir de verdad", final, 10);
  return outcome(c, {
    hypothesis_verdict: moved.stock === before.stock && moved.moves === before.moves ? "descartada" : "confirmada",
    expected: { reversiones_fuera_de_tienda: "4xx con mensaje de negocio, sin tocar stock", stock: 14 },
    actual: {
      reversiones: reversals.map(([name, res]) => ({ name, status: res.status, error: errorOf(res) })),
      moved,
      cross_store_movements_mientras: cross.length,
      stock_final: final,
    },
    evidence: [`producto ${p.id}`, `ventas ${saleToCancel} ${saleToReturn}`, `compras ${buyToCancel} ${buyToReturn}`],
  });
}

// ---------------------------------------------------------------------------
// H4
// ---------------------------------------------------------------------------

async function h04SaleCancelReturn(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 10);

  const unpaid = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { clientRequestId: randomUUID() }), "venta sin cobrar");
  c.eq("stock tras vender 2", await lab.stock(p.id), 8);
  const cancel = await t.http("vendedor1", "PATCH", `/api/sales/${unpaid}/cancel`);
  c.ok("cancelar venta sin cobrar", cancel.ok, `${cancel.status} ${errorOf(cancel)}`);
  c.eq("stock tras cancelar", await lab.stock(p.id), 10);
  c.eq("movimientos de la venta cancelada", brief(await movesOfDoc(lab, p.id, "sale_id", unpaid)), [
    ["venta", -2, 8],
    ["ajuste_entrada", 2, 10],
  ]);
  const cancelAgain = await t.http("vendedor1", "PATCH", `/api/sales/${unpaid}/cancel`);
  const returnCancelled = await t.http("vendedor1", "POST", `/api/sales/${unpaid}/return`);
  c.rejected("cancelar dos veces", cancelAgain.status, errorOf(cancelAgain));
  c.rejected("devolver una venta cancelada", returnCancelled.status, errorOf(returnCancelled));
  c.eq("stock tras los intentos repetidos", await lab.stock(p.id), 10);

  const paid = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 3 }], { pay: true }), "venta cobrada");
  c.eq("stock tras vender 3 cobrados", await lab.stock(p.id), 7);
  const ret = await t.http("vendedor1", "POST", `/api/sales/${paid}/return`);
  c.ok("devolver venta cobrada", ret.ok, `${ret.status} ${errorOf(ret)}`);
  c.eq("stock tras devolver", await lab.stock(p.id), 10);
  c.eq("movimientos de la venta devuelta", brief(await movesOfDoc(lab, p.id, "sale_id", paid)), [
    ["venta", -3, 7],
    ["devolucion_cliente", 3, 10],
  ]);
  const returnAgain = await t.http("vendedor1", "POST", `/api/sales/${paid}/return`);
  const cancelReturned = await t.http("vendedor1", "PATCH", `/api/sales/${paid}/cancel`);
  c.rejected("devolver dos veces", returnAgain.status, errorOf(returnAgain));
  c.rejected("cancelar una venta devuelta", cancelReturned.status, errorOf(cancelReturned));
  const final = await snapshot(lab, p.id);
  c.eq("stock y nº de movimientos finales", [final.stock, final.moves], [10, 5]);
  const scoped = await t.scoped();
  c.eq("reversal_mismatches", scoped.reversal_mismatches, 0);
  c.eq("movements_without_document", scoped.movements_without_document, 0);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  return outcome(c, {
    expected: { stock_final: 10, movements: 5, reversiones_repetidas: "4xx sin movimiento" },
    actual: {
      final,
      repetidas: [cancelAgain, returnCancelled, returnAgain, cancelReturned].map((res) => res.status),
      movements: brief(await lab.movements(p.id)),
    },
    evidence: [`producto ${p.id}`, `venta cancelada ${unpaid}`, `venta devuelta ${paid}`],
  });
}

async function h04PurchaseCancelReturn(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 10);

  const toCancel = mustId(await t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 5 }]), "compra recibida");
  c.eq("stock tras recibir 5", await lab.stock(p.id), 15);
  const cancel = await t.http("almacen", "PATCH", `/api/purchases/${toCancel}/cancel`);
  c.ok("cancelar compra recibida", cancel.ok, `${cancel.status} ${errorOf(cancel)}`);
  c.eq("movimientos de la compra cancelada", brief(await movesOfDoc(lab, p.id, "purchase_id", toCancel)), [
    ["compra", 5, 15],
    ["ajuste_salida", -5, 10],
  ]);
  const cancelAgain = await t.http("almacen", "PATCH", `/api/purchases/${toCancel}/cancel`);
  c.rejected("cancelar compra dos veces", cancelAgain.status, errorOf(cancelAgain));

  const toReturn = mustId(await t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 4 }]), "compra a devolver");
  const ret = await t.http("almacen", "POST", `/api/purchases/${toReturn}/return`);
  c.ok("devolver compra recibida", ret.ok, `${ret.status} ${errorOf(ret)}`);
  c.eq("movimientos de la compra devuelta", brief(await movesOfDoc(lab, p.id, "purchase_id", toReturn)), [
    ["compra", 4, 14],
    ["devolucion_proveedor", -4, 10],
  ]);
  const returnAgain = await t.http("almacen", "POST", `/api/purchases/${toReturn}/return`);
  c.rejected("devolver compra dos veces", returnAgain.status, errorOf(returnAgain));

  const order = mustId(await t.purchase("almacen", "pedido", [{ productId: p.id, quantity: 6 }]), "compra en pedido");
  const cancelOrder = await t.http("almacen", "PATCH", `/api/purchases/${order}/cancel`);
  c.ok("cancelar pedido", cancelOrder.ok, `${cancelOrder.status} ${errorOf(cancelOrder)}`);
  c.eq("movimientos de un pedido cancelado", (await movesOfDoc(lab, p.id, "purchase_id", order)).length, 0);
  const receiveCancelled = await t.http("almacen", "PATCH", `/api/purchases/${order}/receive`);
  c.rejected("recibir un pedido cancelado", receiveCancelled.status, errorOf(receiveCancelled));
  const mid = await snapshot(lab, p.id);
  c.eq("stock y movimientos tras las reversiones", [mid.stock, mid.moves], [10, 5]);

  // Compra cuyo stock ya se vendió: la reversión debe rechazarse limpia y no dejar stock negativo.
  const q = await t.product("q", 0);
  const sold = mustId(await t.purchase("almacen", "recibido", [{ productId: q.id, quantity: 5 }]), "compra que luego se vende");
  mustId(await t.sale("vendedor1", [{ productId: q.id, quantity: 3 }], { clientRequestId: randomUUID() }), "venta del stock comprado");
  const cancelSold = await t.http("almacen", "PATCH", `/api/purchases/${sold}/cancel`);
  const returnSold = await t.http("almacen", "POST", `/api/purchases/${sold}/return`);
  c.rejected("cancelar compra con stock ya vendido", cancelSold.status, errorOf(cancelSold));
  c.rejected("devolver compra con stock ya vendido", returnSold.status, errorOf(returnSold));
  const soldAfter = await snapshot(lab, q.id);
  c.eq("stock y movimientos tras el rechazo", [soldAfter.stock, soldAfter.moves], [2, 2]);
  c.eq("estado de la compra tras el rechazo", await docStatus(lab, "purchases", sold), "recibido");
  const scoped = await t.scoped();
  c.eq("reversal_mismatches", scoped.reversal_mismatches, 0);
  c.eq("negative_stock", scoped.negative_stock, 0);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  return outcome(c, {
    expected: { p: { stock: 10, movements: 5 }, q: { stock: 2, movements: 2 }, rechazos: "4xx" },
    actual: {
      p: mid,
      q: soldAfter,
      rechazos: {
        cancel_again: cancelAgain.status,
        return_again: returnAgain.status,
        receive_cancelled: receiveCancelled.status,
        cancel_sold: `${cancelSold.status} ${errorOf(cancelSold)}`,
        return_sold: `${returnSold.status} ${errorOf(returnSold)}`,
      },
    },
    evidence: [`productos ${p.id} ${q.id}`, `compras ${toCancel} ${toReturn} ${order} ${sold}`],
  });
}

async function h04Dg3ReturnWithLivePayments(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 5);
  const saleId = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 1 }], { pay: true }), "venta cobrada");
  const ret = await t.http("vendedor1", "POST", `/api/sales/${saleId}/return`);
  const stockAfter = await lab.stock(p.id);
  const readMoney = async () => {
    const sale = await lab.rows<{ status: string; paid_ves: string; total_ves: string }>(
      "select status::text as status, paid_ves::text as paid_ves, total_ves::text as total_ves from public.sales where id = $1",
      [saleId],
    );
    const payments = await lab.rows<{ id: string; status: string; amount_ves: string }>(
      "select id, status::text as status, amount_ves::text as amount_ves from public.payments where sale_id = $1",
      [saleId],
    );
    return { sale: sale[0], payments };
  };
  const afterReturn = await readMoney();
  let cancelStatus: number | null = null;
  let cancelError = "";
  c.ok("return_sale acepta una venta pagada", ret.ok, `${ret.status} ${errorOf(ret)}`);
  if (ret.ok) {
    c.eq("stock tras devolver", stockAfter, 5);
    c.eq("pagos activos justo después de devolver (return_sale los anula, C7)", afterReturn.payments.filter((payment) => payment.status === "activo").length, 0);
    const live = afterReturn.payments.find((payment) => payment.status === "activo");
    if (live) {
      const cancel = await t.http("contador", "PATCH", `/api/payments/${live.id}/cancel`);
      cancelStatus = cancel.status;
      cancelError = errorOf(cancel);
    }
  } else {
    c.rejected("devolver venta con pagos activos", ret.status, errorOf(ret));
    c.eq("stock tras el rechazo", stockAfter, 4);
  }
  const final = await readMoney();
  const trapped = final.sale?.status === "devuelta" && final.payments.some((payment) => payment.status === "activo");
  c.ok(
    "G3: la venta devuelta no conserva ningún pago activo",
    !trapped,
    `venta devuelta con paid_ves=${final.sale?.paid_ves ?? "?"} y pago activo; anular pago → ${String(cancelStatus)} ${cancelError}`,
  );
  if (trapped) c.note("H4 literal no: el stock vuelve una sola vez y con su movimiento; lo atrapado es el dinero.");
  const scoped = await t.scoped();
  c.eq("reversal_mismatches", scoped.reversal_mismatches, 0);
  return outcome(c, {
    hypothesis_verdict: stockAfter === (ret.ok ? 5 : 4) && scoped.reversal_mismatches === 0 ? "descartada" : "confirmada",
    expected: { return_status: "2xx", stock: 5, dinero: "0 pagos activos tras la devolución (return_sale los anula)" },
    actual: { return_status: ret.status, stock: stockAfter, tras_devolver: afterReturn, cancel_payment: cancelStatus, final },
    evidence: [`producto ${p.id}`, `venta ${saleId}`, ...final.payments.map((payment) => `pago ${payment.id} ${payment.status}`)],
  });
}

// ---------------------------------------------------------------------------
// H5 · H6
// ---------------------------------------------------------------------------

async function h05ConvertBalanced(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const { pack, unit } = await makePair(t, 5, 12);
  const convert = (quantity: number) =>
    t.http("almacen", "POST", "/api/inventory/conversions", { packProductId: pack.id, packQuantity: quantity, reason: "S403" });

  const first = await convert(2);
  c.ok("conversión de 2 empaques", first.ok, `${first.status} ${errorOf(first)}`);
  const packMoves = (await lab.movements(pack.id)).filter((move) => move.conversion_id);
  const unitMoves = (await lab.movements(unit.id)).filter((move) => move.conversion_id);
  c.eq("movimiento del empaque", brief(packMoves), [["conversion_salida", -2, 3]]);
  c.eq("movimiento de la unidad", brief(unitMoves), [["conversion_entrada", 24, 24]]);
  c.ok("ambos comparten conversion_id", packMoves[0]?.conversion_id === unitMoves[0]?.conversion_id && Boolean(packMoves[0]?.conversion_id));

  const tooMany = await convert(10);
  c.rejected("convertir más empaques de los que hay", tooMany.status, errorOf(tooMany));
  c.eq("stocks tras el rechazo", [await lab.stock(pack.id), await lab.stock(unit.id)], [3, 24]);

  // Dos conversiones simultáneas de 2 con 3 empaques: solo cabe una.
  const parallel = await Promise.all([convert(2), convert(2)]);
  const summary = summarizeStatuses(parallel.map((res) => res.status));
  c.eq("conversiones simultáneas aceptadas", summary.ok, 1);
  c.finding("la conversión perdedora responde 4xx", summary.errors5xx === 0, `statuses ${summary.statuses.join(",")}`);
  const finalStocks = [await lab.stock(pack.id), await lab.stock(unit.id)];
  c.eq("stocks finales (empaque, unidad)", finalStocks, [1, 48]);
  const scoped = await t.scoped();
  c.eq("conversion_mismatches", scoped.conversion_mismatches, 0);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  c.eq("negative_stock", scoped.negative_stock, 0);
  return outcome(c, {
    expected: { pack: 1, unit: 48, por_conversion: "-N empaques / +N×12 unidades con el mismo conversion_id" },
    actual: { stocks: finalStocks, parallel: summary, pack: brief(await lab.movements(pack.id)), unit: brief(await lab.movements(unit.id)) },
    evidence: [`empaque ${pack.id}`, `unidad ${unit.id}`, ...packMoves.map(fmtMove), ...unitMoves.map(fmtMove)],
  });
}

async function h06ConcurrentSales(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  await t.ensureCash("vendedor2");
  const p = await t.product("p", 5);
  const sessions: Array<{ as: Seller; client: Awaited<ReturnType<Lab["api"]>> }> = [
    { as: "vendedor1", client: await lab.api("vendedor1") },
    { as: "vendedor2", client: await lab.api("vendedor2") },
    { as: "vendedor1", client: await lab.newApi("vendedor1") },
    { as: "vendedor2", client: await lab.newApi("vendedor2") },
  ];
  await lab.rate();
  // 8 ventas de 1 unidad a la vez con stock 5: mitad con cobro, mitad pendiente_pago (cada una con su clave).
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) => {
      const session = sessions[index % sessions.length] as (typeof sessions)[number];
      return t.sale(session.as, [{ productId: p.id, quantity: 1 }], { pay: index % 2 === 0, client: session.client, clientRequestId: randomUUID() });
    }),
  );
  const summary = summarizeStatuses(responses.map((res) => res.status));
  const moves = await lab.movements(p.id);
  const sales = moves.filter((move) => move.type === "venta");
  const stock = await lab.stock(p.id);
  const okIds = responses.map(idOf).filter((id): id is string => id !== null);
  const liveSales = await lab.rows<{ id: string }>(
    "select distinct s.id from public.sales s join public.sale_items i on i.sale_id = s.id where i.product_id = $1",
    [p.id],
  );
  c.eq("ventas aceptadas", summary.ok, 5);
  c.eq("stock final", stock, 0);
  c.eq("Σ movimientos venta", sumDelta(sales), -5);
  c.eq("nº de movimientos venta", sales.length, 5);
  c.ok("ningún stock_after negativo", moves.every((move) => move.stock_after >= 0));
  c.eq("ventas en la base con este producto", liveSales.map((row) => row.id).sort(), [...okIds].sort());
  c.finding("las rechazadas responden 4xx", summary.errors5xx === 0, responses.filter((res) => res.status >= 500).map(errorOf).join(" / "));
  const scoped = await t.scoped();
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  c.eq("negative_stock", scoped.negative_stock, 0);
  c.eq("sales_without_movements", scoped.sales_without_movements, 0);
  const chain = analyzeChain(moves, stock);
  c.ok("la cadena stock_after no tiene roturas reales", chain.classification !== "rotura_real", JSON.stringify(chain));
  if (scoped.stock_chain_breaks > 0) {
    c.note(`stock_chain_breaks=${scoped.stock_chain_breaks} clasificadas ${chain.classification} (G9: orden created_at ≠ orden de commit)`);
  }
  return outcome(c, {
    expected: { aceptadas: 5, rechazadas: 3, stock: 0, sum_venta: -5 },
    actual: { summary, stock, sum_venta: sumDelta(sales), chain, stock_chain_breaks: scoped.stock_chain_breaks },
    evidence: [`producto ${p.id}`, ...moves.map(fmtMove)],
  });
}

const CROSSED_PAIRS = 20;

/**
 * El producto ejecuta cada venta en UNA transacción (una RPC), así que la única
 * forma real de cruzar bloqueos es que dos ventas simultáneas traigan las líneas
 * en orden inverso. Se lanzan `CROSSED_PAIRS` pares [A,B] / [B,A] a la vez desde
 * 4 sesiones (2 vendedores). No se encadenan dos `create_sale` en una misma
 * transacción SQL: eso no lo hace ningún camino del producto y ningún orden de
 * bloqueo dentro de la RPC lo evitaría (STK-520).
 */
async function h06Dg7Deadlock(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const total = CROSSED_PAIRS * 2;
  const initial = total + 20;
  const a = await t.product("a", initial);
  const b = await t.product("b", initial);
  const clients = [
    { as: "vendedor1" as Seller, client: await lab.api("vendedor1") },
    { as: "vendedor2" as Seller, client: await lab.api("vendedor2") },
    { as: "vendedor1" as Seller, client: await lab.newApi("vendedor1") },
    { as: "vendedor2" as Seller, client: await lab.newApi("vendedor2") },
  ];
  await lab.rate();
  const responses = await Promise.all(
    Array.from({ length: total }, (_, index) => {
      const session = clients[index % clients.length] as (typeof clients)[number];
      const lines = index % 2 === 0 ? [a, b] : [b, a];
      return t.sale(session.as, lines.map((product) => ({ productId: product.id, quantity: 1 })), { client: session.client, clientRequestId: randomUUID() });
    }),
  );
  const summary = summarizeStatuses(responses.map((res) => res.status));
  const judged = judgeCrossedSales(responses.map((res) => ({ status: res.status, error: errorOf(res) })));
  c.eq(`${total} ventas cruzadas [A,B]/[B,A]: ninguna responde 40P01 / 5xx (2xx o rechazo de negocio)`, judged.failures, []);
  // Hay stock de sobra: un rechazo de negocio aquí no rompe el stock, pero tampoco es lo esperado.
  c.finding("con stock de sobra las ventas cruzadas pasan todas", judged.rejected === 0, `statuses ${summary.statuses.join(",")}: ${responses.filter((res) => !res.ok).map(errorOf).join(" / ")}`);
  const stocks = [await lab.stock(a.id), await lab.stock(b.id)];
  c.eq("stock de A y B = inicial − ventas aceptadas (rollback limpio de las rechazadas)", stocks, [initial - summary.ok, initial - summary.ok]);
  const movesA = await lab.movements(a.id);
  const movesB = await lab.movements(b.id);
  c.eq("un movimiento venta por venta aceptada en A y en B", [movesA, movesB].map((moves) => moves.filter((move) => move.type === "venta").length), [summary.ok, summary.ok]);
  const scoped = await t.scoped();
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  c.eq("sales_without_movements", scoped.sales_without_movements, 0);
  c.eq("stock_chain_breaks (orden por seq)", scoped.stock_chain_breaks, 0);
  const chains = [analyzeChain(movesA, stocks[0] ?? 0), analyzeChain(movesB, stocks[1] ?? 0)];
  c.ok("sin roturas reales de cadena", chains.every((chain) => chain.classification !== "rotura_real"), JSON.stringify(chains));
  return outcome(c, {
    expected: { http: `${total} ventas 2xx (o rechazo de negocio); 0 × 40P01 / 5xx`, stock: "inicial − aceptadas en ambos" },
    actual: { pares: CROSSED_PAIRS, http: summary, rechazos: responses.filter((res) => !res.ok).map(errorOf), deadlocks: judged.failures, stocks, chains },
    evidence: [`productos ${a.id} ${b.id}`],
  });
}

// ---------------------------------------------------------------------------
// H7
// ---------------------------------------------------------------------------

async function h07NoTrigger(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const triggers = await t.sql<{ tabla: string; tgname: string; funcion: string }>(
    "triggers de products y stock_movements",
    `select tgrelid::regclass::text as tabla, tgname, tgfoid::regproc::text as funcion
     from pg_trigger where not tgisinternal
       and tgrelid in ('public.products'::regclass, 'public.stock_movements'::regclass) order by 1, 2`,
  );
  const guarding = triggers.filter((row) => !/updated_at/i.test(row.tgname));
  c.ok(
    "existe un trigger que mantenga current_stock ↔ stock_movements",
    guarding.length > 0,
    `únicos triggers: ${triggers.map((row) => `${row.tabla}.${row.tgname}`).join(", ") || "ninguno"}`,
  );
  return outcome(c, {
    expected: { trigger: "alguno sobre products.current_stock o stock_movements que sincronice o impida escrituras sueltas" },
    actual: { triggers },
    evidence: triggers.map((row) => `${row.tabla}.${row.tgname} → ${row.funcion}`),
  });
}

async function h07DirectUpdatePostgres(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 10);
  const write = await t.trySql("ESCRITURA DIRECTA: products.current_stock = 17 (sin movimiento)", "update public.products set current_stock = 17 where id = $1", [p.id]);
  const stockAfterWrite = await lab.stock(p.id);
  const scopedAfterWrite = await t.scoped();
  // Fase 5 (20261006a/e): la conexión directa `postgres` es la vía de escape documentada (migraciones, one-shots,
  // setup de tests), así que lo sano ya no es solo bloquearla: vale el rechazo O que quede detectada al instante.
  // El bloqueo para los roles de tienda (PostgREST) lo prueba h07.dg1_direct_update_postgrest.
  const blocked = write.error !== null || stockAfterWrite === 10;
  const detected = stockAfterWrite === 17 && scopedAfterWrite.stock_reconciliation === 1;
  c.ok(
    "el update directo de current_stock como postgres se rechaza o stock_reconciliation lo detecta al instante",
    blocked || detected,
    `UPDATE ${write.rowCount}; current_stock=${stockAfterWrite} con Σ movimientos=10 y stock_reconciliation=${scopedAfterWrite.stock_reconciliation}`,
  );
  // El siguiente movimiento legítimo hereda el salto: el trigger parte de current_stock (17 → 18), no del libro.
  const adjust = await t.adjust("almacen", p.id, 1);
  const moves = await lab.movements(p.id);
  const scopedAfterMove = await t.scoped();
  const reconciliation = await lab.viewRows("stock_reconciliation", [p.id]);
  const breaks = await lab.viewRows("stock_chain_breaks", [p.id]);
  if (!blocked) {
    c.eq("el salto sigue a la vista tras el siguiente ajuste (stock_reconciliation, stock_chain_breaks)", [scopedAfterMove.stock_reconciliation, scopedAfterMove.stock_chain_breaks], [1, 1]);
  }
  c.note(
    `detección: stock_reconciliation ${scopedAfterWrite.stock_reconciliation} fila(s) al instante (diff=${String(reconciliation[0]?.diff)}); ` +
      `stock_chain_breaks ${scopedAfterWrite.stock_chain_breaks} → ${scopedAfterMove.stock_chain_breaks} tras el siguiente ajuste (${adjust.status})`,
  );
  return outcome(c, {
    expected: { update_directo: "rechazado; o aceptado solo por conexión directa postgres y detectado", stock_reconciliation: "0 si se rechaza; 1 si pasa" },
    actual: {
      update: { rowCount: write.rowCount, error: write.error },
      current_stock: [10, stockAfterWrite, await lab.stock(p.id)],
      vistas_tras_update: scopedAfterWrite,
      vistas_tras_ajuste: scopedAfterMove,
      reconciliation,
      breaks,
    },
    evidence: [`producto ${p.id}`, ...moves.map(fmtMove)],
  });
}

async function h07Dg1DirectUpdatePostgrest(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const roles: LabRoleKey[] = ["admin", "almacen", "vendedor1", "contador"];
  const actual: Record<string, unknown> = {};
  const evidence: string[] = [];
  for (const role of roles) {
    const p = await t.product(role, 10);
    const client = await lab.supa(role);
    const patch = await t.rest(
      role,
      "PATCH /rest/v1/products current_stock=999",
      client.from("products").update({ current_stock: 999 }).eq("id", p.id).select("id,current_stock"),
    );
    const insert = await t.rest(
      role,
      "POST /rest/v1/stock_movements",
      client
        .from("stock_movements")
        .insert({ product_id: p.id, type: "ajuste_entrada", quantity_delta: 5, stock_after: 999, store_id: lab.storeId })
        .select("id"),
    );
    const after = await snapshot(lab, p.id);
    c.eq(`${role}: current_stock tras el PATCH directo`, after.stock, 10);
    c.eq(`${role}: movimientos tras el insert directo`, after.moves, 1);
    actual[role] = {
      patch: { status: patch.status, rows: restRowCount(patch), error: patch.error?.message ?? null },
      insert: { status: insert.status, rows: restRowCount(insert), error: insert.error?.message ?? null },
      after,
      reconciliation: await lab.viewRows("stock_reconciliation", [p.id]),
    };
    evidence.push(`${role}: producto ${p.id} current_stock=${after.stock} movimientos=${after.moves}`);
  }
  if (c.failures.length > 0) c.note("G1: RLS `for all` de products deja a admin/almacén escribir current_stock con la anon key + su sesión, sin pasar por ninguna RPC.");
  return outcome(c, {
    expected: { todos: { current_stock: 10, movements: 1 }, patch: "0 filas o error", insert: "42501" },
    actual,
    evidence,
  });
}

async function h07MovementWithoutStock(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 10);
  const insert = await t.trySql(
    "ESCRITURA DIRECTA: stock_movements +5 sin tocar current_stock",
    `insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
     values ($1, 'ajuste_entrada', 5, 'S403 movimiento suelto', $2) returning id`,
    [p.id, lab.storeId],
  );
  const stock = await lab.stock(p.id);
  const moves = await lab.movements(p.id);
  const consistent = insert.error !== null || stock === 15;
  c.ok("insertar un movimiento sincroniza current_stock (o se rechaza)", consistent, `insert aceptado; current_stock=${stock}, Σ movimientos=${sumDelta(moves)}`);
  const scoped = await t.scoped();
  const reconciliation = await lab.viewRows("stock_reconciliation", [p.id]);
  c.note(`detección: stock_reconciliation=${scoped.stock_reconciliation} (diff=${String(reconciliation[0]?.diff)}), stock_chain_breaks=${scoped.stock_chain_breaks}`);
  return outcome(c, {
    expected: { current_stock: "15, o insert rechazado", stock_reconciliation: 0 },
    actual: { insert: { rowCount: insert.rowCount, error: insert.error }, current_stock: stock, ledger: sumDelta(moves), vistas: scoped, reconciliation },
    evidence: [`producto ${p.id}`, ...moves.map(fmtMove)],
  });
}

/**
 * Patrón de los one-shots: `stock_after := current_stock ± q` leído de products + update en pareja.
 * Desde 20261006e eso es exactamente lo que hace el trigger al insertar el movimiento (y repetir el update
 * a mano lo duplicaría), así que el one-shot equivalente hoy es SOLO el insert.
 */
const ONESHOT_PATTERN_SQL = `
  insert into public.stock_movements (product_id, type, quantity_delta, reason, store_id)
  select id, 'ajuste_salida'::public.stock_movement_type, -$2::int, 'S403 one-shot a mano', store_id
  from public.products where id = $1`;

async function h07OneshotPattern(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  // (A) producto sano con historia: el patrón, añadido al final, no rompe nada.
  const healthy = await t.product("sano", 10);
  await t.adjust("almacen", healthy.id, 2);
  await t.sql("one-shot a mano sobre producto sano (−3)", ONESHOT_PATTERN_SQL, [healthy.id, 3]);
  const healthyViews = await lab.scoped([healthy.id]);
  // (B) producto cuyo current_stock ya divergía (H9 / G1): el patrón hereda el salto en stock_after.
  const drifted = await t.product("deriva", 10);
  await t.sql("divergencia previa: current_stock = 17 sin movimiento", "update public.products set current_stock = 17 where id = $1", [drifted.id]);
  await t.sql("one-shot a mano sobre producto con deriva (−3)", ONESHOT_PATTERN_SQL, [drifted.id, 3]);
  const driftedViews = await lab.scoped([drifted.id]);
  const driftedMoves = await lab.movements(drifted.id);
  const breaks = await lab.viewRows("stock_chain_breaks", [drifted.id]);
  c.eq("producto sano: stock tras el one-shot (10 + 2 − 3)", await lab.stock(healthy.id), 9);
  c.eq("producto sano: vistas tras el one-shot", [healthyViews.stock_reconciliation, healthyViews.stock_chain_breaks], [0, 0]);
  // La deriva la metió a propósito la línea de arriba (update directo como postgres). Lo sano es que el one-shot
  // no la tape: el movimiento parte de current_stock (17 → 14) y las dos vistas la siguen señalando.
  c.eq("producto con deriva: stock tras el one-shot (17 − 3)", await lab.stock(drifted.id), 14);
  c.eq("producto con deriva: la deriva sigue detectada (reconciliation, chain_breaks)", [driftedViews.stock_reconciliation, driftedViews.stock_chain_breaks], [1, 1]);
  c.note("el one-shot no corrige la deriva previa: reconciliation sigue en 1 y el salto 10 → 14 con delta −3 queda como chain_break.");
  return outcome(c, {
    expected: { sano: { stock: 9, stock_reconciliation: 0, stock_chain_breaks: 0 }, deriva: { stock: 14, stock_reconciliation: 1, stock_chain_breaks: 1 } },
    actual: {
      sano: { stock: await lab.stock(healthy.id), vistas: healthyViews },
      deriva: { stock: await lab.stock(drifted.id), vistas: driftedViews, breaks, chain: analyzeChain(driftedMoves, await lab.stock(drifted.id)) },
    },
    evidence: [`sano ${healthy.id}`, `deriva ${drifted.id}`, ...driftedMoves.map(fmtMove)],
  });
}

function chainVerdict(
  c: Checks,
  breaks: number,
  reconciliation: number,
  classification: string,
): HypothesisVerdict {
  const falsePositive = breaks > 0 && reconciliation === 0 && classification === "artefacto_orden";
  c.ok(
    "stock_chain_breaks = 0 cuando no hay rotura real",
    breaks === 0,
    falsePositive
      ? `FALSO POSITIVO: ${breaks} fila(s) en stock_chain_breaks con stock_reconciliation=0; los mismos movimientos cierran la cadena en orden de commit y terminan en current_stock`
      : `${breaks} fila(s) y la cadena NO cierra en ningún orden (${classification}): rotura real`,
  );
  return breaks > 0 && !falsePositive ? "confirmada" : "descartada";
}

async function h07Dg9Interleaved(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 10);
  const rate = (await lab.rate()).rateVes;
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
    await s2.query(CREATE_SALE_SQL, [lab.customerId, saleItemsJson([{ productId: p.id, quantity: 1 }]), rate]);
    await s2.query("commit");
    await s1.query(CREATE_SALE_SQL, [lab.customerId, saleItemsJson([{ productId: p.id, quantity: 2 }]), rate]);
    await s1.query("commit");
    committed = true;
  } finally {
    if (!committed) {
      await s1.query("rollback").catch(() => undefined);
      await s2.query("rollback").catch(() => undefined);
    }
  }
  t.steps.push({ op: "SQL S1 begin+now() → S2 create_sale(1)+commit → S1 create_sale(2)+commit", as: "vendedor1+vendedor2", status: 0, response_id: null, ms: 0 });
  const moves = await lab.movements(p.id);
  const stock = await lab.stock(p.id);
  const breaks = await lab.viewRows("stock_chain_breaks", [p.id]);
  const scoped = await t.scoped();
  const chain = analyzeChain(moves, stock);
  c.eq("stock final (10 − 1 − 2)", stock, 7);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  const verdict = chainVerdict(c, breaks.length, scoped.stock_reconciliation, chain.classification);
  return outcome(c, {
    hypothesis_verdict: verdict,
    expected: { stock: 7, stock_chain_breaks: 0, stock_reconciliation: 0 },
    actual: { stock, stock_chain_breaks: breaks, chain, orden_de_la_vista: brief(moves) },
    evidence: [`producto ${p.id}`, "orden real de commit: inventario_inicial, venta −1 (S2), venta −2 (S1)", ...moves.map(fmtMove)],
  });
}

async function h07Dg9RepeatedLine(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 30);
  const rate = (await lab.rate()).rateVes;
  const lines = [
    { productId: p.id, quantity: 1 },
    { productId: p.id, quantity: 2 },
  ];
  // El mismo producto en dos líneas del mismo documento, 6 veces, EN SERIE (sin concurrencia).
  let via = "POST /api/sales";
  const probe = await t.sale("vendedor1", lines, { clientRequestId: randomUUID() });
  let done = probe.ok ? 1 : 0;
  if (!probe.ok) {
    via = `create_sale por SQL como vendedor-1 (el BFF rechaza líneas repetidas: ${probe.status} ${errorOf(probe)})`;
  }
  const session = probe.ok ? null : await lab.pg();
  for (let i = done; i < 6; i += 1) {
    if (session) {
      await session.query("begin");
      try {
        await actAs(session, lab.uids.vendedor1);
        await session.query(CREATE_SALE_SQL, [lab.customerId, saleItemsJson(lines), rate]);
        await session.query("commit");
      } catch (error) {
        await session.query("rollback").catch(() => undefined);
        throw error;
      }
    } else {
      mustId(await t.sale("vendedor1", lines, { clientRequestId: randomUUID() }), "venta con línea repetida");
    }
    done += 1;
  }
  const moves = await lab.movements(p.id);
  const stock = await lab.stock(p.id);
  const breaks = await lab.viewRows("stock_chain_breaks", [p.id]);
  const scoped = await t.scoped();
  const chain = analyzeChain(moves, stock);
  c.eq("stock final (30 − 6×3)", stock, 12);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  c.eq("sales_without_movements", scoped.sales_without_movements, 0);
  const verdict = chainVerdict(c, breaks.length, scoped.stock_reconciliation, chain.classification);
  return outcome(c, {
    hypothesis_verdict: verdict,
    expected: { stock: 12, stock_chain_breaks: 0 },
    actual: { via, ventas: done, stock, stock_chain_breaks: breaks.length, breaks, chain },
    evidence: [`producto ${p.id}`, "las dos líneas de cada venta comparten created_at; el desempate por id (uuid) es aleatorio", ...moves.map(fmtMove)],
  });
}

async function h07Dg9ClassifyGlobal(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  // Solo lectura sobre toda la tienda lab: clasifica cada producto con filas en stock_chain_breaks.
  const rows = await t.sql<{ product_id: string; sku: string; breaks: string; diff: number | null }>(
    "stock_chain_breaks de la tienda lab por producto",
    `select b.product_id, p.sku, count(*)::text as breaks,
            (select r.diff from public.stock_reconciliation r where r.product_id = b.product_id) as diff
     from public.stock_chain_breaks b join public.products p on p.id = b.product_id
     where b.store_id = $1 group by b.product_id, p.sku order by count(*) desc`,
    [lab.storeId],
  );
  const perClass: Record<string, number> = { artefacto_orden: 0, rotura_real: 0, sana: 0 };
  const breaksPerClass: Record<string, number> = { artefacto_orden: 0, rotura_real: 0, sana: 0 };
  const products: unknown[] = [];
  for (const row of rows) {
    const chain = analyzeChain(await lab.movements(row.product_id), await lab.stock(row.product_id));
    perClass[chain.classification] = (perClass[chain.classification] ?? 0) + 1;
    breaksPerClass[chain.classification] = (breaksPerClass[chain.classification] ?? 0) + Number(row.breaks);
    if (products.length < 40) products.push({ sku: row.sku, product_id: row.product_id, breaks: Number(row.breaks), reconciliation_diff: row.diff, ...chain });
  }
  c.finding(
    "stock_chain_breaks de la tienda no trae artefactos de orden",
    (perClass.artefacto_orden ?? 0) === 0,
    `${breaksPerClass.artefacto_orden ?? 0} fila(s) en ${perClass.artefacto_orden ?? 0} producto(s) son artefacto de orden`,
  );
  c.note(`roturas reales: ${breaksPerClass.rotura_real ?? 0} fila(s) en ${perClass.rotura_real ?? 0} producto(s) (incluye corrupciones deliberadas de otros tickets)`);
  return outcome(c, {
    hypothesis_verdict: "no_reproducible",
    expected: { artefacto_orden: 0 },
    actual: { productos_con_roturas: rows.length, productos_por_clase: perClass, filas_por_clase: breaksPerClass, products },
    evidence: ["clasificador: analyzeChain (camino euleriano sobre stock_after − delta → stock_after, fin = current_stock)"],
  });
}

// ---------------------------------------------------------------------------
// H8 (lado BFF)
// ---------------------------------------------------------------------------

async function h08SameClientRequestId(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 10);
  const lines = [{ productId: p.id, quantity: 2 }];

  const serialKey = randomUUID();
  const first = await t.sale("vendedor1", lines, { pay: true, clientRequestId: serialKey });
  const second = await t.sale("vendedor1", lines, { pay: true, clientRequestId: serialKey });
  const firstId = mustId(first, "venta con clientRequestId");
  c.ok("el reintento en serie responde 2xx", second.ok, `${second.status} ${errorOf(second)}`);
  c.eq("el reintento devuelve la misma venta", idOf(second), firstId);
  c.eq("stock tras venta + reintento", await lab.stock(p.id), 8);
  // La misma clave con OTRO carrito (C4): 409, sin vender ni devolver la venta vieja.
  const otherCart = await t.sale("vendedor1", [{ productId: p.id, quantity: 3 }], { pay: true, clientRequestId: serialKey });
  c.eq("misma clave con otro carrito", otherCart.status, 409);
  c.eq("stock tras reutilizar la clave con otro carrito", await lab.stock(p.id), 8);

  const parallelKey = randomUUID();
  await lab.rate();
  const parallel = await Promise.all([
    t.sale("vendedor1", lines, { pay: true, clientRequestId: parallelKey }),
    t.sale("vendedor1", lines, { pay: true, clientRequestId: parallelKey }),
  ]);
  const summary = summarizeStatuses(parallel.map((res) => res.status));
  const stock = await lab.stock(p.id);
  const moves = (await lab.movements(p.id)).filter((move) => move.type === "venta");
  const sales = await lab.rows<{ id: string; client_request_id: string }>(
    "select id, client_request_id from public.sales where client_request_id = any($1::uuid[])",
    [[serialKey, parallelKey]],
  );
  c.eq("stock tras el doble envío simultáneo", stock, 6);
  c.eq("ventas creadas para las dos claves", sales.length, 2);
  c.eq("movimientos venta", brief(moves), [
    ["venta", -2, 8],
    ["venta", -2, 6],
  ]);
  c.ok(
    "el envío simultáneo perdedor recibe la venta existente (G15)",
    summary.ok === 2,
    `statuses ${summary.statuses.join(",")}: ${parallel.filter((res) => !res.ok).map(errorOf).join(" / ")}`,
  );
  c.eq("el envío simultáneo devuelve una sola venta", [...new Set(parallel.map(idOf))].length, 1);
  return outcome(c, {
    expected: { stock: 6, ventas: 2, reintento: "misma venta, 2xx (en serie y simultáneo)", otro_carrito: 409 },
    actual: {
      stock,
      ventas: sales.length,
      serial: [first.status, second.status],
      otro_carrito: `${otherCart.status} ${errorOf(otherCart)}`,
      parallel: summary,
      parallel_errors: parallel.map(errorOf),
    },
    evidence: [`producto ${p.id}`, ...sales.map((sale) => `venta ${sale.id} client_request_id=${sale.client_request_id}`)],
  });
}

async function h08NoClientRequestId(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 10);
  const lines = [{ productId: p.id, quantity: 1 }];
  await lab.rate();
  // Mismo POST dos veces en < 50 ms, sin clave y sin pagos (p. ej. un cliente que no la manda).
  const parallel = await Promise.all([
    t.sale("vendedor1", lines, { clientRequestId: null }),
    t.sale("vendedor1", lines, { clientRequestId: null }),
  ]);
  // Mismo POST dos veces en serie con cobro pero sin clave (reintento tras timeout).
  const serial = [
    await t.sale("vendedor1", lines, { pay: true, clientRequestId: null }),
    await t.sale("vendedor1", lines, { pay: true, clientRequestId: null }),
  ];
  const stock = await lab.stock(p.id);
  const sales = await lab.rows<{ id: string; status: string }>(
    "select distinct s.id, s.status::text as status from public.sales s join public.sale_items i on i.sale_id = s.id where i.product_id = $1",
    [p.id],
  );
  const moves = (await lab.movements(p.id)).filter((move) => move.type === "venta");
  c.eq("los 4 POST sin clientRequestId responden 400", [...parallel, ...serial].map((res) => res.status), [400, 400, 400, 400]);
  c.eq("stock intacto", stock, 10);
  c.eq("ventas creadas", sales.length, 0);
  c.eq("movimientos venta", moves.length, 0);
  if (c.failures.length > 0) {
    c.note("POST /api/sales debe exigir clientRequestId (400 si falta): sin clave el BFF no puede deduplicar y cada reintento sería otra venta y otro descuento (ver h08.same_client_request_id para el camino con clave).");
  }
  return outcome(c, {
    expected: { statuses: [400, 400, 400, 400], stock: 10, ventas: 0, movimientos_venta: 0 },
    actual: { stock, ventas: sales, parallel: parallel.map((res) => res.status), serial: serial.map((res) => res.status) },
    evidence: [`producto ${p.id}`, ...sales.map((sale) => `venta ${sale.id} ${sale.status}`)],
  });
}

async function h08Dg4TwoStepFallback(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 5);
  const atomicRpc = await lab.rows("select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_sale_with_payments'");
  const rate = (await lab.rate()).rateVes;
  const lines = [{ productId: p.id, quantity: 2 }];
  const key = randomUUID();
  // Primer cobro válido por la mitad; el segundo excede el saldo → el cobro falla a mitad de camino.
  const broken = await t.sale("vendedor1", lines, {
    clientRequestId: key,
    payments: [
      { method: "efectivo_ves", currency: "VES", amount: rate },
      { method: "pago_movil", currency: "VES", amount: round2(rate * 2), bankName: "Banesco", phone: "04141234567", referenceCode: "1234" },
    ],
  });
  const afterBroken = await snapshot(lab, p.id);
  const orphan = await lab.rows<{ id: string; status: string; paid_ves: string }>(
    "select distinct s.id, s.status::text as status, s.paid_ves::text as paid_ves from public.sales s join public.sale_items i on i.sale_id = s.id where i.product_id = $1",
    [p.id],
  );
  c.rejected("venta con un cobro inválido", broken.status, errorOf(broken));
  c.eq("stock y movimientos tras el cobro fallido (sano: nada)", [afterBroken.stock, afterBroken.moves], [5, 1]);
  c.eq("ventas vivas tras el cobro fallido", orphan.length, 0);
  // El cajero corrige el cobro y reintenta con la misma clave.
  const retry = await t.sale("vendedor1", lines, { pay: true, clientRequestId: key });
  const final = await lab.stock(p.id);
  c.ok("reintento corregido", retry.ok, `${retry.status} ${errorOf(retry)}`);
  c.eq("stock tras el reintento", final, 3);
  c.note(`create_sale_with_payments ${atomicRpc.length > 0 ? "aplicado: camino atómico; el fallback en dos pasos (G4) no se alcanza en esta base" : "AUSENTE: se ejerció el fallback en dos pasos"}`);
  return outcome(c, {
    expected: { cobro_fallido: "4xx, sin venta ni movimiento", stock_final: 3 },
    actual: { atomic_rpc: atomicRpc.length > 0, broken: `${broken.status} ${errorOf(broken)}`, afterBroken, orphan, retry: retry.status, stock_final: final },
    evidence: [`producto ${p.id}`, ...orphan.map((sale) => `venta huérfana ${sale.id} ${sale.status} paid_ves=${sale.paid_ves}`)],
  });
}

/**
 * Doble POST idéntico en paralelo de compra, ajuste y conversión.
 * `keyed`: los dos POST de cada operación llevan la MISMA `clientRequestId`
 * (lo que hace el cliente del producto) → una sola operación. Sin clave se
 * duplica: queda como hallazgo (ver `judgeDoubleSubmit`).
 */
function h08Dg5DoubleSubmit(keyed: boolean) {
  return async (lab: Lab, t: CaseCtx): Promise<CaseOutcome> => {
    const c = new Checks();
    const p = await t.product("p", 10);
    const { pack, unit } = await makePair(t, 5, 12);
    await lab.rate();
    const key = (): string | undefined => (keyed ? randomUUID() : undefined);
    const countMoves = async (productId: string, type: string) => (await lab.movements(productId)).filter((move) => move.type === type).length;
    const apply = (observation: DoubleSubmitObservation) => {
      const judged = judgeDoubleSubmit(observation);
      c.failures.push(...judged.failures);
      c.findings.push(...judged.findings);
    };

    const purchaseKey = key();
    const purchases = await Promise.all([
      t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 4 }], { clientRequestId: purchaseKey }),
      t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 4 }], { clientRequestId: purchaseKey }),
    ]);
    const purchaseMoves = await countMoves(p.id, "compra");
    const afterPurchases = await lab.stock(p.id);
    apply({ op: "compra recibida +4", keyed, statuses: purchases.map((res) => res.status), ids: purchases.map(idOf), movements: purchaseMoves, expectedMovements: 1 });
    c.eq("stock tras las compras = 10 + 4 × movimientos compra", afterPurchases, 10 + 4 * purchaseMoves);

    const adjustKey = key();
    const adjustments = await Promise.all([
      t.adjust("almacen", p.id, 3, undefined, { clientRequestId: adjustKey }),
      t.adjust("almacen", p.id, 3, undefined, { clientRequestId: adjustKey }),
    ]);
    const adjustMoves = await countMoves(p.id, "ajuste_entrada");
    const afterAdjustments = await lab.stock(p.id);
    apply({ op: "ajuste +3", keyed, statuses: adjustments.map((res) => res.status), ids: adjustments.map(idOf), movements: adjustMoves, expectedMovements: 1 });
    c.eq("stock tras los ajustes = anterior + 3 × movimientos ajuste_entrada", afterAdjustments - afterPurchases, 3 * adjustMoves);

    const conversionKey = key();
    const conversion = { packProductId: pack.id, packQuantity: 1, reason: "S403 doble", ...(conversionKey ? { clientRequestId: conversionKey } : {}) };
    const conversions = await Promise.all([
      t.http("almacen", "POST", "/api/inventory/conversions", conversion),
      t.http("almacen", "POST", "/api/inventory/conversions", conversion),
    ]);
    const conversionIds = conversions.map((res) => {
      const id = dataOf(res).conversionId;
      return typeof id === "string" ? id : null;
    });
    const conversionMoves = await countMoves(pack.id, "conversion_salida");
    const stocks = [await lab.stock(pack.id), await lab.stock(unit.id)];
    apply({ op: "conversión de 1 empaque", keyed, statuses: conversions.map((res) => res.status), ids: conversionIds, movements: conversionMoves, expectedMovements: 1 });
    c.eq("empaque/unidad = 5 − conversiones / 12 × conversiones", stocks, [5 - conversionMoves, 12 * conversionMoves]);
    c.eq("movimientos conversion_entrada de la unidad = conversiones", await countMoves(unit.id, "conversion_entrada"), conversionMoves);

    const scoped = await t.scoped();
    c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
    c.eq("conversion_mismatches", scoped.conversion_mismatches, 0);
    if (keyed) c.note("C6: con la misma clientRequestId los dos envíos devuelven la misma operación.");
    return outcome(c, {
      expected: keyed
        ? { compra: "+4 (1 movimiento, mismo id)", ajuste: "+3 (1 movimiento, mismo id)", conversion: "-1 / +12 (mismo conversionId)" }
        : { nota: "sin clave no hay deduplicación (clave opcional por contrato): el duplicado se documenta como finding" },
      actual: {
        con_clave: keyed,
        compra: { statuses: purchases.map((res) => res.status), ids: purchases.map(idOf), movimientos: purchaseMoves, delta: afterPurchases - 10 },
        ajuste: { statuses: adjustments.map((res) => res.status), ids: adjustments.map(idOf), movimientos: adjustMoves, delta: afterAdjustments - afterPurchases },
        conversion: { statuses: conversions.map((res) => res.status), ids: conversionIds, movimientos: conversionMoves, stocks },
      },
      evidence: [`producto ${p.id}`, `empaque ${pack.id}`, `unidad ${unit.id}`],
    });
  };
}

// ---------------------------------------------------------------------------
// H9 · H10 · H11
// ---------------------------------------------------------------------------

async function createViaApi(t: CaseCtx, lab: Lab, name: string, body: Record<string, unknown>): Promise<string> {
  const sku = lab.nextSku(`${t.key}-${name}`);
  const res = await t.http("almacen", "POST", "/api/products", { sku, name: `S403 ${sku}`, ...body });
  const id = mustId(res, `POST /api/products (${name})`);
  t.track(id);
  return id;
}

async function h09CreateProductWithStock(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  // Formulario de producto: mismo payload que la pantalla, con stock inicial.
  const id = await createViaApi(t, lab, "form", { salePriceRef: 1, currentCostRef: 1, currentStock: 7, minStock: 0 });
  const moves = await lab.movements(id);
  const stock = await lab.stock(id);
  const reconciliation = await lab.viewRows("stock_reconciliation", [id]);
  c.eq("current_stock tras crear con currentStock=7", stock, 7);
  c.eq("movimiento inventario_inicial", brief(moves), [["inventario_inicial", 7, 7]]);
  c.eq("stock_reconciliation del producto", reconciliation.length, 0);
  // La diferencia no se cura sola: una venta posterior la arrastra.
  const sale = await t.sale("vendedor1", [{ productId: id, quantity: 2 }], { clientRequestId: randomUUID() });
  const after = await t.scoped();
  c.note(`tras vender 2 (${sale.status}): reconciliation=${after.stock_reconciliation} diff=${String((await lab.viewRows("stock_reconciliation", [id]))[0]?.diff)}, chain_breaks=${after.stock_chain_breaks} (el primer movimiento no se evalúa)`);
  return outcome(c, {
    expected: { current_stock: 7, movements: [{ type: "inventario_inicial", quantity_delta: 7 }], stock_reconciliation: 0 },
    actual: { current_stock: stock, movements: brief(moves), reconciliation, vistas_tras_venta: after },
    evidence: [`producto ${id}`, ...reconciliation.map((row) => `stock_reconciliation diff=${String(row.diff)} ledger=${String(row.ledger_stock)}`)],
  });
}

async function h09ImportPayload(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  // Mismo endpoint y forma que `runProductImportJob` → `toProductInput` (validateProductImportRows.ts).
  const withStock = await createViaApi(t, lab, "imp-a", { salePriceRef: 2.5, currentCostRef: 1.5, currentStock: 12, minStock: 5 });
  const withoutStock = await createViaApi(t, lab, "imp-b", { salePriceRef: 2.5, currentCostRef: 0, currentStock: 0, minStock: 5 });
  const moves = await lab.movements(withStock);
  const reconciliation = await lab.viewRows("stock_reconciliation", [withStock, withoutStock]);
  c.eq("fila con stock_inicial=12: movimiento inventario_inicial", brief(moves), [["inventario_inicial", 12, 12]]);
  c.eq("stock_reconciliation de las filas importadas", reconciliation.length, 0);
  c.eq("fila con stock_inicial=0: sin movimiento y sin diferencia (control)", (await lab.movements(withoutStock)).length, 0);
  return outcome(c, {
    expected: { fila_con_stock: [{ type: "inventario_inicial", quantity_delta: 12 }], stock_reconciliation: 0 },
    actual: { stocks: await lab.stocks([withStock, withoutStock]), movements: brief(moves), reconciliation },
    evidence: [`productos ${withStock} ${withoutStock}`, ...reconciliation.map((row) => `stock_reconciliation ${String(row.sku)} diff=${String(row.diff)}`)],
  });
}

async function h10PendingSales(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 10);
  const pay = (saleId: string, amount: number) =>
    t.http("vendedor1", "POST", "/api/payments", { saleId, method: "efectivo_ves", currency: "VES", amount });

  // A: pendiente → pagada.
  const a = await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { clientRequestId: randomUUID() });
  const aId = mustId(a, "venta A");
  c.eq("A nace pendiente_pago", await docStatus(lab, "sales", aId), "pendiente_pago");
  c.eq("A descuenta al crearse", await lab.stock(p.id), 8);
  const aPay = await pay(aId, Number(dataOf(a).totalVes));
  c.ok("cobro total de A", aPay.ok, `${aPay.status} ${errorOf(aPay)}`);
  c.eq("A pasa a pagada sin tocar stock", [await docStatus(lab, "sales", aId), await lab.stock(p.id)], ["pagada", 8]);

  // B: pendiente → cancelada.
  const bId = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 3 }], { clientRequestId: randomUUID() }), "venta B");
  const bCancel = await t.http("vendedor1", "PATCH", `/api/sales/${bId}/cancel`);
  c.ok("cancelar B", bCancel.ok, `${bCancel.status} ${errorOf(bCancel)}`);
  c.eq("B cancelada repone", [await docStatus(lab, "sales", bId), await lab.stock(p.id)], ["cancelada", 8]);

  // C: pendiente con abono parcial → no se puede cancelar hasta anular el abono.
  const cSale = await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { clientRequestId: randomUUID() });
  const cId = mustId(cSale, "venta C");
  const partial = await pay(cId, Math.round((Number(dataOf(cSale).totalVes) / 2) * 100) / 100);
  c.ok("abono parcial de C", partial.ok, `${partial.status} ${errorOf(partial)}`);
  const cancelWithPayment = await t.http("vendedor1", "PATCH", `/api/sales/${cId}/cancel`);
  c.rejected("cancelar C con abono activo", cancelWithPayment.status, errorOf(cancelWithPayment));
  c.eq("C sigue pendiente y con el stock descontado", [await docStatus(lab, "sales", cId), await lab.stock(p.id)], ["pendiente_pago", 6]);
  const partialId = idOf(partial);
  const voided = partialId ? await t.http("contador", "PATCH", `/api/payments/${partialId}/cancel`) : null;
  const cCancel = await t.http("vendedor1", "PATCH", `/api/sales/${cId}/cancel`);
  c.ok("anular el abono y cancelar C", Boolean(voided?.ok) && cCancel.ok, `anular ${String(voided?.status)} · cancelar ${cCancel.status} ${errorOf(cCancel)}`);
  c.eq("C cancelada repone", [await docStatus(lab, "sales", cId), await lab.stock(p.id)], ["cancelada", 8]);

  // D: pendiente abandonada.
  const dId = mustId(await t.sale("vendedor1", [{ productId: p.id, quantity: 1 }], { clientRequestId: randomUUID() }), "venta D");
  const final = await lab.stock(p.id);
  c.eq("stock final = 10 − A(2, pagada) − D(1, pendiente)", final, 7);
  const scoped = await t.scoped();
  c.eq("sales_without_movements", scoped.sales_without_movements, 0);
  c.eq("reversal_mismatches", scoped.reversal_mismatches, 0);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  const drafts = await lab.rows<{ n: string }>("select count(*)::text as n from public.sales where store_id = $1 and status = 'borrador'", [lab.storeId]);
  c.note(`borrador: existe en el enum pero ningún endpoint lo crea (ventas borrador en lab: ${drafts[0]?.n ?? "?"}); no hay camino que probar.`);
  c.finding(
    "una venta pendiente_pago abandonada libera su stock (vencimiento o aviso)",
    false,
    `D (${dId}) retiene 1 u indefinidamente hasta que alguien la cancele: es el origen del one-shot 20260830`,
  );
  return outcome(c, {
    expected: { stock_final: 7, estados: { A: "pagada", B: "cancelada", C: "cancelada", D: "pendiente_pago" } },
    actual: {
      stock_final: final,
      estados: {
        A: await docStatus(lab, "sales", aId),
        B: await docStatus(lab, "sales", bId),
        C: await docStatus(lab, "sales", cId),
        D: await docStatus(lab, "sales", dId),
      },
      movements: brief(await lab.movements(p.id)),
    },
    evidence: [`producto ${p.id}`, `ventas A=${aId} B=${bId} C=${cId} D=${dId}`],
  });
}

async function h11ReceiveTwice(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const p = await t.product("p", 0);
  const order = async () => mustId(await t.purchase("almacen", "pedido", [{ productId: p.id, quantity: 5 }]), "compra en pedido");
  const losers: string[] = [];
  const collect = (responses: ApiResponse[]) => {
    for (const res of responses) if (!res.ok) losers.push(`${res.status} ${errorOf(res)}`);
    return summarizeStatuses(responses.map((res) => res.status));
  };

  const serialId = await order();
  const serial = collect([
    await t.http("almacen", "PATCH", `/api/purchases/${serialId}/receive`),
    await t.http("almacen", "PATCH", `/api/purchases/${serialId}/receive`),
  ]);
  c.eq("serie ×2: recepciones aceptadas", serial.ok, 1);
  c.eq("serie ×2: stock", await lab.stock(p.id), 5);

  const pairId = await order();
  const pair = collect(
    await Promise.all([
      t.http("almacen", "PATCH", `/api/purchases/${pairId}/receive`),
      t.http("admin", "PATCH", `/api/purchases/${pairId}/receive`),
    ]),
  );
  c.eq("paralelo ×2: recepciones aceptadas", pair.ok, 1);
  c.eq("paralelo ×2: stock", await lab.stock(p.id), 10);

  const fiveId = await order();
  const extraAlmacen = await lab.newApi("almacen");
  const extraAdmin = await lab.newApi("admin");
  const five = collect(
    await Promise.all([
      t.http("almacen", "PATCH", `/api/purchases/${fiveId}/receive`),
      t.http("admin", "PATCH", `/api/purchases/${fiveId}/receive`),
      t.http("almacen", "PATCH", `/api/purchases/${fiveId}/receive`, undefined, extraAlmacen),
      t.http("admin", "PATCH", `/api/purchases/${fiveId}/receive`, undefined, extraAdmin),
      t.http("almacen", "PATCH", `/api/purchases/${fiveId}/receive`),
    ]),
  );
  const stock = await lab.stock(p.id);
  const moves = await lab.movements(p.id);
  c.eq("paralelo ×5: recepciones aceptadas", five.ok, 1);
  c.eq("paralelo ×5: stock", stock, 15);
  c.eq("movimientos compra (uno por compra)", brief(moves.filter((move) => move.type === "compra")).map((row) => row[1]), [5, 5, 5]);
  c.ok(
    "la recepción repetida no responde 5xx",
    serial.errors5xx + pair.errors5xx + five.errors5xx === 0,
    `perdedores: ${[...new Set(losers)].join(" / ")}`,
  );
  c.finding(
    "la recepción repetida responde 409",
    [...serial.statuses, ...pair.statuses, ...five.statuses].every((status) => is2xx(status) || status === 409),
    `perdedores: ${[...new Set(losers)].join(" / ")}`,
  );
  const scoped = await t.scoped();
  c.eq("purchases_without_movements", scoped.purchases_without_movements, 0);
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  const chain = analyzeChain(moves, stock);
  c.ok("sin roturas reales de cadena", chain.classification !== "rotura_real", JSON.stringify(chain));
  return outcome(c, {
    expected: { stock: 15, compras: 3, aceptadas_por_compra: 1, perdedor: "409 (PT409); nunca 5xx" },
    actual: { stock, serial, pair, five, perdedores: losers, chain },
    evidence: [`producto ${p.id}`, `compras ${serialId} ${pairId} ${fiveId}`, ...moves.map(fmtMove)],
  });
}

// ---------------------------------------------------------------------------
// H12
// ---------------------------------------------------------------------------

async function h12D0Catalog(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const names = [...STOCK_RPCS, "assert_store_context", "current_user_store_id", "current_user_role"];
  const functions = await t.sql<D0FunctionRow & { args: string }>(
    "D0.1 dueño / definer / search_path de las RPC",
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proowner::regrole::text as owner,
            p.prosecdef, p.proconfig, r.rolbypassrls, r.rolsuper
     from pg_proc p join pg_roles r on r.oid = p.proowner
     where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[]) order by 1, 2`,
    [names],
  );
  const tables = await t.sql<{ relname: string; owner: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "D0.2 dueño de tablas y force RLS",
    `select relname, relowner::regrole::text as owner, relrowsecurity, relforcerowsecurity
     from pg_class where relnamespace = 'public'::regnamespace and relname in ('products', 'stock_movements', 'profiles')`,
  );
  const policies = await t.sql<{ tablename: string; policyname: string; cmd: string }>(
    "D0.3 políticas instaladas",
    `select tablename, policyname, cmd from pg_policies
     where schemaname = 'public' and tablename in ('products', 'stock_movements') order by 1, 2`,
  );
  const grants = await t.sql<{ proname: string; anon_exec: boolean }>(
    "D0.4 execute para anon",
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[]) order by 1`,
    [[...STOCK_RPCS]],
  );
  const problems = d0Problems(functions, tables.map((row) => row.owner));
  c.eq("precondiciones de las 12 RPC (definer, search_path, dueño, una sobrecarga)", problems, []);
  c.eq("tablas con FORCE ROW LEVEL SECURITY", tables.filter((row) => row.relforcerowsecurity).map((row) => row.relname), []);
  c.eq(
    "políticas de escritura sobre stock_movements",
    policies.filter((row) => row.tablename === "stock_movements" && row.cmd !== "SELECT").map((row) => row.policyname),
    [],
  );
  // anon: hoy lo frena assert_store_context, no el grant.
  const p = await t.product("p", 10);
  const anon = await t.rest("anon", "rpc adjust_stock", lab.anon().rpc("adjust_stock", { p_product_id: p.id, p_quantity_delta: 1, p_reason: "S403 anon", p_type: null }));
  c.ok("anon no puede ajustar stock", anon.error !== null, "devolvió un movimiento");
  c.eq("stock tras el intento de anon", await lab.stock(p.id), 10);
  const anonExec = grants.filter((row) => row.anon_exec).map((row) => row.proname);
  c.finding("anon no tiene EXECUTE sobre las RPC de stock (G10)", anonExec.length === 0, `anon puede ejecutar: ${anonExec.join(", ")} (lo frena solo assert_store_context)`);
  return outcome(c, {
    expected: { problemas: [], force_rls: [], politicas_escritura_stock_movements: [], anon: "error" },
    actual: { problemas: problems, functions, tables, policies, anon: { status: anon.status, error: anon.error?.message ?? null }, anon_exec: anonExec },
    evidence: functions.map((row) => `${row.proname}(${row.args}) owner=${row.owner} definer=${String(row.prosecdef)} config=${JSON.stringify(row.proconfig)}`),
  });
}

async function h12RpcRowcounts(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  await t.ensureCash("vendedor1");
  const p = await t.product("p", 20);
  const { pack, unit } = await makePair(t, 5, 12);
  const rate = (await lab.rate()).rateVes;
  const log: Array<Record<string, unknown>> = [];

  /** Éxito ⇒ la fila cambió exactamente lo esperado (+1 movimiento); error ⇒ nada cambió. Nunca "éxito con 0 filas". */
  const probe = async (label: string, productId: string, delta: number, allowed: boolean, run: () => Promise<{ ok: boolean; info: string }>) => {
    const before = await snapshot(lab, productId);
    const res = await run();
    const after = await snapshot(lab, productId);
    const stockDelta = after.stock - before.stock;
    const moveDelta = after.moves - before.moves;
    log.push({ label, ok: res.ok, info: res.info, stock_delta: stockDelta, movement_delta: moveDelta, row_touched: after.updatedAt !== before.updatedAt });
    if (allowed) c.ok(`${label}: permitido`, res.ok, res.info);
    else c.ok(`${label}: rechazado por rol`, !res.ok, "la RPC aceptó la operación");
    if (res.ok) {
      c.eq(`${label}: filas afectadas (Δstock, Δmovimientos)`, [stockDelta, moveDelta], [delta, 1]);
    } else {
      c.eq(`${label}: sin efecto al fallar (Δstock, Δmovimientos)`, [stockDelta, moveDelta], [0, 0]);
    }
  };
  const viaHttp = (res: ApiResponse) => ({ ok: res.ok, info: `${res.status} ${errorOf(res)}`.trim() });
  const viaRpc = (res: RestResult) => ({ ok: res.error === null, info: res.error ? `${res.error.code ?? ""} ${res.error.message}`.trim() : "ok" });
  const rpcId = (res: RestResult): string => {
    const data = res.data as { id?: unknown } | Array<{ id?: unknown }> | null;
    const row = Array.isArray(data) ? data[0] : data;
    return typeof row?.id === "string" ? row.id : "";
  };

  // --- vendedor (sin política RLS de escritura sobre products) ---
  let saleId = "";
  await probe("vendedor · create_sale (BFF)", p.id, -2, true, async () => {
    const res = await t.sale("vendedor1", [{ productId: p.id, quantity: 2 }], { clientRequestId: randomUUID() });
    saleId = idOf(res) ?? "";
    return viaHttp(res);
  });
  await probe("vendedor · cancel_sale (BFF)", p.id, 2, true, async () => viaHttp(await t.http("vendedor1", "PATCH", `/api/sales/${saleId}/cancel`)));
  let paidId = "";
  await probe("vendedor · create_sale_with_payments (BFF)", p.id, -1, true, async () => {
    const res = await t.sale("vendedor1", [{ productId: p.id, quantity: 1 }], { pay: true });
    paidId = idOf(res) ?? "";
    return viaHttp(res);
  });
  await probe("vendedor · return_sale (BFF)", p.id, 1, true, async () => viaHttp(await t.http("vendedor1", "POST", `/api/sales/${paidId}/return`)));

  // Documentos de admin sobre los que el vendedor intentará operar por PostgREST.
  const order = mustId(await t.purchase("admin", "pedido", [{ productId: p.id, quantity: 2 }]), "pedido de admin");
  const received = mustId(await t.purchase("admin", "recibido", [{ productId: p.id, quantity: 3 }]), "compra recibida de admin");
  const purchaseArgs = {
    p_supplier_id: lab.supplierId,
    p_items: [{ product_id: p.id, quantity: 1, unit_cost_ref: 1, unit_cost_ves: rate, entry_mode: "unit" }],
    p_ref_rate_ves: rate,
    p_status: "recibido",
  };
  await probe("vendedor · adjust_stock (RPC directa)", p.id, 1, false, async () =>
    viaRpc(await t.rpc("vendedor1", "adjust_stock", { p_product_id: p.id, p_quantity_delta: 1, p_reason: "S403", p_type: null })),
  );
  await probe("vendedor · create_purchase (RPC directa)", p.id, 1, false, async () => viaRpc(await t.rpc("vendedor1", "create_purchase", purchaseArgs)));
  await probe("vendedor · receive_purchase (RPC directa)", p.id, 2, false, async () => viaRpc(await t.rpc("vendedor1", "receive_purchase", { p_purchase_id: order })));
  await probe("vendedor · cancel_purchase (RPC directa)", p.id, -3, false, async () => viaRpc(await t.rpc("vendedor1", "cancel_purchase", { p_purchase_id: received })));
  await probe("vendedor · return_purchase (RPC directa)", p.id, -3, false, async () => viaRpc(await t.rpc("vendedor1", "return_purchase", { p_purchase_id: received })));
  await probe("vendedor · convert_pack_to_units (RPC directa)", pack.id, -1, false, async () =>
    viaRpc(await t.rpc("vendedor1", "convert_pack_to_units", { p_pack_product_id: pack.id, p_pack_quantity: 1, p_reason: "S403" })),
  );
  await probe("contador · adjust_stock (RPC directa)", p.id, 1, false, async () =>
    viaRpc(await t.rpc("contador", "adjust_stock", { p_product_id: p.id, p_quantity_delta: 1, p_reason: "S403", p_type: null })),
  );

  // --- admin ---
  await probe("admin · receive_purchase (BFF)", p.id, 2, true, async () => viaHttp(await t.http("admin", "PATCH", `/api/purchases/${order}/receive`)));
  await probe("admin · return_purchase (BFF)", p.id, -2, true, async () => viaHttp(await t.http("admin", "POST", `/api/purchases/${order}/return`)));
  await probe("admin · cancel_purchase (BFF)", p.id, -3, true, async () => viaHttp(await t.http("admin", "PATCH", `/api/purchases/${received}/cancel`)));
  await probe("admin · create_purchase recibido (BFF)", p.id, 4, true, async () => viaHttp(await t.purchase("admin", "recibido", [{ productId: p.id, quantity: 4 }])));
  await probe("admin · adjust_stock (BFF)", p.id, -4, true, async () => viaHttp(await t.adjust("admin", p.id, -4)));
  await probe("admin · convert_pack_to_units (BFF, empaque)", pack.id, -1, true, async () =>
    viaHttp(await t.http("admin", "POST", "/api/inventory/conversions", { packProductId: pack.id, packQuantity: 1, reason: "S403" })),
  );
  let adminSale = "";
  await probe("admin · create_sale (RPC directa; el BFF no le deja vender)", p.id, -1, true, async () => {
    const res = await t.rpc("admin", "create_sale", {
      p_customer_id: lab.customerId,
      p_items: [{ product_id: p.id, quantity: 1, unit_price_ref: 1 }],
      p_exchange_rate_id: null,
      p_ref_rate_ves: rate,
    });
    adminSale = rpcId(res);
    return viaRpc(res);
  });
  await probe("admin · cancel_sale (RPC directa)", p.id, 1, true, async () => viaRpc(await t.rpc("admin", "cancel_sale", { p_sale_id: adminSale })));

  const unitStock = await lab.stock(unit.id);
  c.eq("unidad tras la única conversión aceptada", unitStock, 12);
  const scoped = await t.scoped();
  c.eq("stock_reconciliation", scoped.stock_reconciliation, 0);
  c.eq("stock final del producto", await lab.stock(p.id), 20);
  return outcome(c, {
    expected: { regla: "éxito ⇒ Δstock esperado y +1 movimiento; error ⇒ Δ 0/0; nunca éxito con 0 filas" },
    actual: { llamadas: log, unit_stock: unitStock },
    evidence: [`producto ${p.id}`, `empaque ${pack.id}`, `unidad ${unit.id}`, `compras ${order} ${received}`],
  });
}

async function h12Dg2InactiveUser(lab: Lab, t: CaseCtx): Promise<CaseOutcome> {
  const c = new Checks();
  const email = `s403-inactivo-${lab.tag}@lab.local`;
  const password = "S403-inactivo!";
  const created = await lab.service().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "S403 inactivo", role: "vendedor", store_id: lab.storeId },
  });
  const uid = created.data.user?.id;
  if (created.error || !uid) throw new Error(`auth.admin.createUser(${email}): ${created.error?.message ?? "sin usuario"}`);
  t.steps.push({ op: `Auth admin createUser ${email} (vendedor, tienda lab)`, as: "service_role", status: 200, response_id: uid, ms: 0 });
  await t.sql(
    "fixture: perfil del usuario propio en la tienda lab",
    `insert into public.profiles (id, full_name, role, store_id, is_active) values ($1, 'S403 inactivo', 'vendedor', $2, true)
     on conflict (id) do update set role = 'vendedor', store_id = excluded.store_id, is_active = true`,
    [uid, lab.storeId],
  );
  const session = await lab.newSupa(email, password);
  const p = await t.product("p", 10);
  const purchaseId = mustId(await t.purchase("almacen", "recibido", [{ productId: p.id, quantity: 3 }]), "compra recibida");
  const adjust = () => t.rest(email, "rpc adjust_stock +5", session.rpc("adjust_stock", { p_product_id: p.id, p_quantity_delta: 5, p_reason: "S403 rol nulo", p_type: null }));

  // Control: vendedor ACTIVO → la guarda de rol lo frena.
  const control = await adjust();
  c.ok("control: vendedor activo no puede ajustar stock", control.error !== null, "la RPC lo aceptó");
  const before = await snapshot(lab, p.id);

  await t.sql("desactivar SOLO al usuario propio: profiles.is_active = false", "update public.profiles set is_active = false where id = $1", [uid]);
  const role = await t.rest(email, "rpc current_user_role", session.rpc("current_user_role"));
  const store = await t.rest(email, "rpc current_user_store_id", session.rpc("current_user_store_id"));
  const inactiveAdjust = await adjust();
  const inactiveCancel = await t.rest(email, "rpc cancel_purchase", session.rpc("cancel_purchase", { p_purchase_id: purchaseId }));
  const after = await snapshot(lab, p.id);
  const login = await lab.service().auth.admin.getUserById(uid);
  c.ok("usuario desactivado: adjust_stock rechazado", inactiveAdjust.error !== null, "la RPC devolvió el movimiento (rol NULL salta la guarda `not in`)");
  c.ok("usuario desactivado: cancel_purchase rechazado", inactiveCancel.error !== null, "la RPC canceló la compra");
  c.eq("stock y movimientos tras las llamadas del usuario desactivado", [after.stock, after.moves], [before.stock, before.moves]);
  const moved = after.moves - before.moves;
  if (c.failures.length > 0) {
    c.note(
      `G2 reproducido: current_user_role()=${JSON.stringify(role.data)} y current_user_store_id()=${JSON.stringify(store.data)}; un usuario desactivado con JWT vivo ejecuta RPC de admin. ` +
        `H12 literal no: cada llamada aceptada sí escribió su fila y su movimiento (Δmovimientos=${moved}).`,
    );
  }
  const scoped = await t.scoped();
  return outcome(c, {
    hypothesis_verdict: scoped.stock_reconciliation === 0 ? "descartada" : "confirmada",
    expected: { adjust_stock: "No autorizado", cancel_purchase: "No autorizado", stock: before.stock },
    actual: {
      control: control.error?.message ?? "ACEPTADO",
      current_user_role: role.data,
      current_user_store_id: store.data,
      adjust_stock: inactiveAdjust.error?.message ?? "ACEPTADO",
      cancel_purchase: inactiveCancel.error?.message ?? "ACEPTADO",
      before,
      after,
      compra: await docStatus(lab, "purchases", purchaseId),
      usuario: { id: uid, email, auth_existe: Boolean(login.data.user) },
    },
    evidence: [`usuario ${uid} ${email} (queda con is_active=false)`, `producto ${p.id}`, `compra ${purchaseId}`, ...(await lab.movements(p.id)).map(fmtMove)],
  });
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export const HYPOTHESIS_CASES: readonly CaseDef[] = [
  { id: "h01.pedido_then_receive", title: "Compra `pedido` no mueve stock hasta `receive`", hypothesis: ["H1"], run: h01PedidoThenReceive },
  { id: "h02.pack_normalization", title: "Modo empaque: quantity_delta = pack_count × units_per_pack", hypothesis: ["H2"], run: h02PackNormalization },
  { id: "h02.dg8_units_per_pack_unchecked", title: "D-G8 · modo empaque sobre el SKU empaque / units_per_pack sin contrastar", hypothesis: ["H2"], run: h02Dg8UnitsPerPackUnchecked },
  { id: "h03.d1_store_isolation", title: "D1 · nadie cambia de tienda ni opera productos de la tienda default", hypothesis: ["H3"], run: h03D1StoreIsolation },
  { id: "h03.moved_product_ops", title: "Producto movido a mano a la tienda default: vender/ajustar/comprar desde lab", hypothesis: ["H3"], run: h03MovedProductOps },
  { id: "h03.dg6_reversal_out_of_store", title: "D-G6 · cancelar/devolver documentos con el producto fuera de la tienda", hypothesis: ["H3"], run: h03Dg6ReversalOutOfStore },
  { id: "h04.sale_cancel_return", title: "Cancelar y devolver venta: revierte una vez y con movimiento", hypothesis: ["H4"], run: h04SaleCancelReturn },
  { id: "h04.purchase_cancel_return", title: "Cancelar y devolver compra: revierte una vez y con movimiento", hypothesis: ["H4"], run: h04PurchaseCancelReturn },
  { id: "h04.dg3_return_with_live_payments", title: "D-G3 · devolver venta con pagos activos: ¿dinero atrapado?", hypothesis: ["H4"], run: h04Dg3ReturnWithLivePayments },
  { id: "h05.convert_balanced", title: "Conversión empaque→unidad balanceada (serie, exceso y paralelo)", hypothesis: ["H5"], run: h05ConvertBalanced },
  { id: "h06.concurrent_sales", title: "8 ventas simultáneas (2 vendedores, 4 sesiones) con stock 5", hypothesis: ["H6"], run: h06ConcurrentSales },
  { id: "h06.dg7_deadlock", title: `D-G7 · ${CROSSED_PAIRS} pares de ventas cruzadas [A,B] / [B,A] por HTTP en paralelo: sin deadlock`, hypothesis: ["H6"], run: h06Dg7Deadlock },
  { id: "h07.no_trigger", title: "No hay trigger que mantenga current_stock ↔ stock_movements", hypothesis: ["H7"], run: h07NoTrigger },
  { id: "h07.direct_update_postgres", title: "(i) update directo de current_stock como postgres", hypothesis: ["H7"], run: h07DirectUpdatePostgres },
  { id: "h07.dg1_direct_update_postgrest", title: "(ii) D-G1 · PATCH directo de current_stock por PostgREST como usuarios lab", hypothesis: ["H7"], run: h07Dg1DirectUpdatePostgrest },
  { id: "h07.movement_without_stock", title: "(iii) insertar stock_movement sin tocar current_stock", hypothesis: ["H7"], run: h07MovementWithoutStock },
  { id: "h07.oneshot_pattern", title: "(iv) patrón de los one-shots: stock_after fijado a mano desde current_stock", hypothesis: ["H7"], run: h07OneshotPattern },
  { id: "h07.dg9_interleaved_transactions", title: "D-G9 (i) · stock_chain_breaks con dos transacciones cuyo created_at va al revés que el commit", hypothesis: ["H7"], run: h07Dg9Interleaved },
  { id: "h07.dg9_repeated_line", title: "D-G9 (ii) · stock_chain_breaks con el mismo producto en dos líneas de un documento", hypothesis: ["H7"], run: h07Dg9RepeatedLine },
  { id: "h07.dg9_classify_global", title: "D-G9 · clasificar las filas actuales de stock_chain_breaks (artefacto de orden vs rotura real)", hypothesis: ["H7"], run: h07Dg9ClassifyGlobal },
  { id: "h08.same_client_request_id", title: "BFF · mismo clientRequestId dos veces (serie y simultáneo) y con otro carrito", hypothesis: ["H8"], run: h08SameClientRequestId },
  { id: "h08.no_client_request_id", title: "BFF · mismo POST de venta dos veces sin clientRequestId → 400, sin venta", hypothesis: ["H8"], run: h08NoClientRequestId },
  { id: "h08.dg4_two_step_fallback", title: "D-G4 · cobro que falla a mitad: ¿venta viva con stock descontado?", hypothesis: ["H8"], run: h08Dg4TwoStepFallback },
  { id: "h08.dg5_double_submit", title: "D-G5 · doble POST idéntico con la MISMA clientRequestId: compra, ajuste y conversión", hypothesis: ["H8"], run: h08Dg5DoubleSubmit(true) },
  { id: "h08.dg5_double_submit_no_key", title: "D-G5 · doble POST idéntico SIN clientRequestId (opcional por contrato): compra, ajuste y conversión", hypothesis: ["H8"], run: h08Dg5DoubleSubmit(false) },
  { id: "h09.create_product_with_stock", title: "POST /api/products con currentStock > 0 (formulario)", hypothesis: ["H9"], run: h09CreateProductWithStock },
  { id: "h09.import_payload", title: "Import Excel: mismo endpoint y payload con stock_inicial", hypothesis: ["H9"], run: h09ImportPayload },
  { id: "h10.pending_sales", title: "Ventas pendiente_pago: stock coherente con su estado final", hypothesis: ["H10"], run: h10PendingSales },
  { id: "h11.receive_twice", title: "receive_purchase ×2 en serie, ×2 y ×5 en paralelo", hypothesis: ["H11"], run: h11ReceiveTwice },
  { id: "h12.d0_catalog", title: "D0 · dueño, search_path, RLS, políticas y grants de las RPC", hypothesis: ["H12"], run: h12D0Catalog },
  { id: "h12.rpc_rowcounts", title: "Cada RPC de stock como vendedor y como admin: ningún update de 0 filas en silencio", hypothesis: ["H12"], run: h12RpcRowcounts },
  { id: "h12.dg2_inactive_user", title: "D-G2 · usuario con is_active=false: ¿pasa la guarda de rol?", hypothesis: ["H12"], run: h12Dg2InactiveUser },
];

if (require.main === module) {
  runSuite("hypotheses", [...HYPOTHESIS_CASES, ...ASSORTED_PACK_CASES, ...RECEIVE_DISASSEMBLE_CASES], process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
