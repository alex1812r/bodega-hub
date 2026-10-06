/**
 * Casos de caos DETERMINISTAS del plan stock-integrity, sección 9 (STK-411).
 *
 * Cada caso 9.1–9.12 corre aislado sobre productos propios (`C411-<run>-…`,
 * sembrados por SQL con su movimiento `inventario_inicial`) y se juzga con un
 * oráculo SQL antes/después. Las carreras se repiten N veces con datos frescos
 * y se reporta "k de N". Aquí viven:
 *
 *  - la lógica pura (jueces, agregación, argv, markdown, chequeo de cadena),
 *    cubierta por `cases.test.ts` sin red ni base;
 *  - el entorno lab (`openLab`) y los casos, que usa `run.ts` y reutiliza
 *    `load.ts`.
 *
 * No corrige nada de producto: un bug reproducido es un `fail` con evidencia.
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Client } from "pg";

import { type ApiClient, type ApiResponse, type JsonRecord, unwrapList } from "../../e2e-bodegon/client";
import {
  LAB_PASSWORD,
  LAB_USERS,
  type LabRoleKey,
  createLabClient,
  describeError,
  fetchRegisters,
  loginAs,
} from "../agents/base";
import { assertAllowedWriteHost, loadStockLabEnv } from "../env";
import { INTEGRITY_VIEW_NAMES, type IntegrityReport, type IntegrityViewName, reportFromJson } from "../integrity-views";

// ===========================================================================
// Tipos y tabla del plan
// ===========================================================================

export type Verdict = "pass" | "fail" | "finding" | "error" | "skip";
export type Severity = "Alta" | "Media" | "Baja";
export type Judgement = { verdict: Verdict; detail: string };

export const DEFAULT_STORE_ID = "00000000-0000-4000-8000-000000000001";
export const SKU_PREFIX = "C411";

/** Tabla literal de la sección 9 del plan. */
export const PLAN_CASES: Record<string, { title: string; expected: string; severity: Severity }> = {
  "9.1": {
    title: "`POST /api/sales` idéntico dos veces en 50 ms",
    expected: "Una venta, un movimiento (idempotencia)",
    severity: "Alta",
  },
  "9.2": {
    title: "`PATCH /api/purchases/[id]/receive` dos veces en paralelo",
    expected: "Un solo ingreso de stock; el segundo 409/400",
    severity: "Alta",
  },
  "9.3": {
    title: "Vender cantidad = stock desde 2 agentes a la vez",
    expected: "Una pasa, otra falla por stock; nunca negativo",
    severity: "Alta",
  },
  "9.4": {
    title: "Cancelar venta mientras otro agente la devuelve",
    expected: "Una sola reversión",
    severity: "Alta",
  },
  "9.5": { title: "Ajuste de salida mayor al stock", expected: "Rechazado sin movimiento", severity: "Media" },
  "9.6": {
    title: "Conversión con `units_per_pack` cambiado entre lectura y escritura",
    expected: "Usa el valor bloqueado en la transacción",
    severity: "Media",
  },
  "9.7": {
    title: "Cambiar `store_id` del producto a mano (simula dato corrupto) y vender",
    expected: "La RPC falla con mensaje claro; no mueve stock de otra tienda",
    severity: "Alta",
  },
  "9.8": {
    title: "Timeout del BFF (simular `statement_timeout` corto) con la transacción ya confirmada",
    expected: "La UI no reintenta a ciegas; con `client_request_id` el reintento devuelve la misma venta",
    severity: "Alta",
  },
  "9.9": { title: "Usuario `vendedor` llama `adjust_stock` por API", expected: "403, sin movimiento", severity: "Alta" },
  "9.10": {
    title: "Venta con 30 líneas de productos distintos mientras otro agente vende los mismos en orden inverso",
    expected: "Sin deadlock (orden de bloqueo determinista) o deadlock detectado y reintentado por la RPC",
    severity: "Media",
  },
  "9.11": {
    title: "Desactivar un producto con una venta `pendiente_pago` abierta",
    expected: "La venta se puede pagar o cancelar; el stock cuadra",
    severity: "Baja",
  },
  "9.12": {
    title: "Borrar categoría (soft) con productos y vender uno",
    expected: "Funciona o falla limpio; sin movimiento huérfano",
    severity: "Baja",
  },
  "9.13": {
    title: "1.000 operaciones en 2 min (carga)",
    expected: "`reconcile` en 0; p95 de `create_sale` documentado",
    severity: "Media",
  },
};

export type StepRecord = {
  op: string;
  as: string;
  status: number;
  response_id: string | null;
  ms: number;
  error?: string;
  /** true si la petición la cortó el propio script a propósito (9.8). */
  aborted?: boolean;
  request?: unknown;
  response?: unknown;
};

export type ScopedIntegrity = Record<IntegrityViewName, number> & {
  /** Productos propios cuya cadena de movimientos NO admite ningún orden coherente (chequeo exacto, ver `chainConsistent`). */
  chain_inconsistent: number;
};

export type AttemptResult = {
  attempt: number;
  verdict: Verdict;
  detail: string;
  steps: StepRecord[];
  actual: JsonRecord;
  evidence: string[];
  scoped: ScopedIntegrity | null;
};

export type ChaosLine = {
  ts: string;
  suite: "chaos";
  id: string;
  title: string;
  severity: Severity;
  hypothesis: string[];
  steps: StepRecord[];
  expected: JsonRecord;
  actual: JsonRecord;
  reconcile_scoped: ScopedIntegrity | null;
  reconcile_global: IntegrityReport | null;
  verdict: Verdict;
  detail: string;
  evidence: string[];
};

// ===========================================================================
// Lógica pura: clasificación HTTP y jueces
// ===========================================================================

export function is2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

export function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

export function isDeadlock(error: string | undefined | null): boolean {
  return typeof error === "string" && /deadlock/i.test(error);
}

/** Mensaje que es un error de Postgres sin traducir (p. ej. 23502 de G6), no un mensaje de negocio. */
export function isRawDbError(error: string | undefined | null): boolean {
  return typeof error === "string" && /violates|null value in column|of relation "|constraint|syntax error|invalid input/i.test(error);
}

function describeResponses(statuses: readonly number[], errors: readonly (string | undefined)[]): string {
  return statuses.map((status, i) => (is2xx(status) ? String(status) : `${status} ${errors[i] ?? ""}`.trim())).join(" | ");
}

const ok = (detail: string): Judgement => ({ verdict: "pass", detail });
const fail = (detail: string): Judgement => ({ verdict: "fail", detail });
const finding = (detail: string): Judgement => ({ verdict: "finding", detail });

export type DuplicateSaleObservation = {
  statuses: number[];
  ids: (string | null)[];
  errors: (string | undefined)[];
  sales: number;
  saleMovements: number;
  activePayments: number;
  stockDelta: number;
  quantity: number;
  /** true si el body lleva `payments` (se espera exactamente un pago activo). */
  paid: boolean;
};

/** 9.1: N envíos del mismo body deben dejar UNA venta, UN movimiento (y un pago). */
export function judgeDuplicateSale(o: DuplicateSaleObservation): Judgement {
  const n = o.statuses.length;
  const facts = `${o.sales} venta(s), ${o.saleMovements} movimiento(s) venta, ${o.activePayments} pago(s) activo(s), stock ${o.stockDelta}`;
  if (o.sales > 1 || o.saleMovements > 1 || o.stockDelta < -o.quantity || (o.paid && o.activePayments > 1)) {
    return fail(`Se esperaba 1 venta / 1 movimiento (stock −${o.quantity}) y quedaron ${facts} tras ${n} envíos idénticos.`);
  }
  if (o.sales === 1) {
    const coherent = o.saleMovements === 1 && o.stockDelta === -o.quantity && (!o.paid || o.activePayments === 1);
    if (!coherent) return fail(`Venta única pero incoherente: ${facts} (esperado stock −${o.quantity}).`);
    const okIds = new Set(o.ids.filter((id, i) => is2xx(o.statuses[i] ?? 0) && id !== null));
    if (okIds.size > 1) return fail(`Las respuestas 2xx devuelven ids distintos (${[...okIds].join(", ")}) con una sola venta en base.`);
    const okCount = o.statuses.filter(is2xx).length;
    if (okCount === n) return ok(`Una venta; las ${n} respuestas devuelven el mismo id.`);
    return finding(
      `Una sola venta y stock correcto, pero ${n - okCount} de ${n} respuestas no devolvieron la venta: ${describeResponses(o.statuses, o.errors)}.`,
    );
  }
  if (o.saleMovements !== 0 || o.stockDelta !== 0) return fail(`Ninguna venta en base pero ${facts}.`);
  return finding(`Ninguna venta: los ${n} envíos fueron rechazados (${describeResponses(o.statuses, o.errors)}); stock intacto.`);
}

export type DoubleReceiveObservation = {
  statuses: number[];
  errors: (string | undefined)[];
  purchaseMovements: number;
  stockDelta: number;
  quantity: number;
  purchaseStatus: string | null;
};

/** 9.2: N `receive` paralelos → un solo ingreso; los demás 409/400. */
export function judgeDoubleReceive(o: DoubleReceiveObservation): Judgement {
  const n = o.statuses.length;
  const facts = `${o.purchaseMovements} movimiento(s) compra, stock +${o.stockDelta}, compra ${o.purchaseStatus ?? "?"}`;
  if (o.purchaseMovements > 1 || o.stockDelta > o.quantity) {
    return fail(`Se esperaba un solo ingreso de +${o.quantity} y quedó ${facts} tras ${n} recepciones paralelas.`);
  }
  if (o.purchaseMovements === 1 && o.stockDelta === o.quantity && o.purchaseStatus === "recibido") {
    const okCount = o.statuses.filter(is2xx).length;
    const losers = o.statuses.filter((s) => !is2xx(s));
    if (okCount === 1 && losers.every((s) => s === 400 || s === 409)) return ok(`Un ingreso; ${losers.length} rechazo(s) 400/409.`);
    return finding(
      `Un solo ingreso de stock, pero los códigos no son "una 2xx y el resto 409/400": ${describeResponses(o.statuses, o.errors)}.`,
    );
  }
  if (o.purchaseMovements === 0 && o.stockDelta === 0 && o.purchaseStatus === "pedido") {
    return finding(`Ninguna recepción entró (${describeResponses(o.statuses, o.errors)}); la compra sigue en pedido.`);
  }
  return fail(`Estado incoherente tras ${n} recepciones: ${facts} (esperado +${o.quantity}, recibido).`);
}

export type StockRaceObservation = {
  statuses: number[];
  errors: (string | undefined)[];
  initialStock: number;
  stock: number;
  minStockAfter: number;
  sales: number;
  saleMovements: number;
  activePayments: number;
};

/** 9.3: N ventas simultáneas de cantidad = stock → una pasa, el resto 4xx, nunca negativo. */
export function judgeStockRace(o: StockRaceObservation): Judgement {
  const facts = `${o.sales} venta(s), ${o.saleMovements} movimiento(s), ${o.activePayments} pago(s), stock ${o.stock} (mín. stock_after ${o.minStockAfter}) tras ${o.statuses.length} ventas simultáneas`;
  if (o.stock < 0 || o.minStockAfter < 0) return fail(`Stock negativo: ${facts}.`);
  if (o.sales > 1 || o.saleMovements > 1) return fail(`Sobreventa: stock inicial ${o.initialStock} y quedaron ${facts}.`);
  if (o.sales === 1) {
    if (o.saleMovements !== 1 || o.stock !== 0 || o.activePayments !== 1) return fail(`Venta ganadora incoherente: ${facts}.`);
    const okCount = o.statuses.filter(is2xx).length;
    const losers = o.statuses.filter((s) => !is2xx(s));
    if (okCount === 1 && losers.every((s) => s === 400)) return ok(`Una venta pasa; ${losers.length} rechazo(s) 400 por stock; stock 0.`);
    return finding(`Una sola venta y stock 0, pero los códigos no son "una 2xx y el resto 400 por stock":${describeResponses(o.statuses, o.errors)}.`);
  }
  if (o.stock === o.initialStock && o.saleMovements === 0 && o.activePayments === 0) {
    return finding(`Ninguna venta pasó (${describeResponses(o.statuses, o.errors)}); stock intacto.`);
  }
  return fail(`Sin venta en base pero con efectos: ${facts}.`);
}

export type CancelVsReturnObservation = {
  cancelStatus: number;
  returnStatus: number;
  errors: (string | undefined)[];
  /** Movimientos de reversión ligados a la venta (ajuste_entrada + devolucion_cliente). */
  reversalMovements: number;
  lines: number;
  initialStock: number;
  quantity: number;
  stock: number;
  saleStatus: string | null;
  paid: boolean;
  activePayments: number;
  paidVes: number;
};

/** 9.4: cancel y return simultáneos → una sola reversión (y qué pasa con el dinero, G3). */
export function judgeCancelVsReturn(o: CancelVsReturnObservation): Judgement {
  const statuses = [o.cancelStatus, o.returnStatus];
  const responses = `cancel ${describeResponses([o.cancelStatus], [o.errors[0]])} · return ${describeResponses([o.returnStatus], [o.errors[1]])}`;
  const facts = `${o.reversalMovements} movimiento(s) de reversión, stock ${o.stock}, venta ${o.saleStatus ?? "?"}`;
  const sold = o.initialStock - o.quantity;
  if (o.reversalMovements > o.lines || o.stock > o.initialStock) {
    return fail(`Doble reversión: se esperaba volver a ${o.initialStock} con ${o.lines} movimiento(s) y quedó ${facts} (${responses}).`);
  }
  if (o.reversalMovements === o.lines) {
    if (o.stock !== o.initialStock || (o.saleStatus !== "cancelada" && o.saleStatus !== "devuelta")) {
      return fail(`Reversión incoherente: ${facts} (esperado stock ${o.initialStock}).`);
    }
    if (o.paid && o.activePayments > 0) {
      return finding(
        `Una sola reversión de stock, pero la venta quedó ${o.saleStatus} con ${o.activePayments} pago(s) activo(s) y paid_ves=${o.paidVes}: el dinero no se revierte (G3). ${responses}.`,
      );
    }
    if (statuses.every(is2xx)) return finding(`Una sola reversión en base pero ambas respuestas son 2xx (${responses}).`);
    if (statuses.some((s) => !is2xx(s) && !is4xx(s))) return finding(`Una sola reversión, pero la perdedora no es 4xx: ${responses}.`);
    return ok(`Una sola reversión (${o.saleStatus}); ${responses}.`);
  }
  if (o.reversalMovements === 0) {
    if (o.stock !== sold) return fail(`Sin movimientos de reversión pero el stock es ${o.stock} (esperado ${sold}).`);
    if (o.paid && statuses.every(is4xx)) return ok(`Ambas rechazadas limpiamente con pagos activos; stock y venta intactos (${responses}).`);
    return finding(`Ninguna reversión entró (${responses}); la venta sigue ${o.saleStatus ?? "?"}.`);
  }
  return fail(`Reversión parcial: ${facts} con ${o.lines} línea(s).`);
}

export type RejectionObservation = {
  status: number;
  error?: string;
  expectedStatuses: number[];
  newMovements: number;
  stockDelta: number;
  /** PostgREST responde 200 con `[]` cuando RLS filtra todas las filas: sin efecto = correcto. */
  allow2xxWithoutEffect?: boolean;
  what: string;
};

/** 9.5 / 9.7 / 9.9: la operación debe rechazarse sin tocar stock ni crear movimientos. */
export function judgeRejection(o: RejectionObservation): Judgement {
  const response = describeResponses([o.status], [o.error]);
  if (o.newMovements !== 0 || o.stockDelta !== 0) {
    return fail(`${o.what}: debía rechazarse sin efecto y dejó ${o.newMovements} movimiento(s) y stock ${o.stockDelta >= 0 ? "+" : ""}${o.stockDelta} (${response}).`);
  }
  if (o.expectedStatuses.includes(o.status)) {
    if (isRawDbError(o.error)) {
      return finding(`${o.what}: sin efecto en stock, pero el mensaje es un error crudo de Postgres en vez de uno de negocio: ${response}.`);
    }
    return ok(`${o.what}: rechazado con ${response}, sin movimiento.`);
  }
  if (is2xx(o.status)) {
    return o.allow2xxWithoutEffect
      ? ok(`${o.what}: ${o.status} sin filas afectadas, sin movimiento.`)
      : finding(`${o.what}: respondió ${o.status} (éxito) aunque no tuvo efecto; se esperaba ${o.expectedStatuses.join("/")}.`);
  }
  return finding(`${o.what}: sin efecto en stock, pero respondió ${response}; se esperaba ${o.expectedStatuses.join("/")}.`);
}

export type ConversionObservation = {
  status: number;
  error?: string;
  responseUnitsPerPack: number | null;
  packQuantity: number;
  /** Valores de `units_per_pack` que estuvieron vigentes durante la carrera. */
  candidates: number[];
  conversionMovements: number;
  packMovementDelta: number;
  unitMovementDelta: number;
  packStockDelta: number;
  unitStockDelta: number;
};

/** 9.6: el par de movimientos de la conversión debe ser coherente con UN solo valor. */
export function judgeConversion(o: ConversionObservation): Judgement {
  const facts = `${o.conversionMovements} movimiento(s), empaque ${o.packMovementDelta} (stock ${o.packStockDelta}), unidad +${o.unitMovementDelta} (stock +${o.unitStockDelta})`;
  if (!is2xx(o.status)) {
    const response = describeResponses([o.status], [o.error]);
    if (o.conversionMovements === 0 && o.packStockDelta === 0 && o.unitStockDelta === 0) {
      return finding(`La conversión fue rechazada (${response}) sin efecto; no se pudo observar qué valor usa.`);
    }
    return fail(`Conversión rechazada (${response}) pero con efectos: ${facts}.`);
  }
  const used = o.packQuantity === 0 ? Number.NaN : o.unitMovementDelta / o.packQuantity;
  const coherent =
    o.conversionMovements === 2 &&
    o.packMovementDelta === -o.packQuantity &&
    o.packStockDelta === o.packMovementDelta &&
    o.unitStockDelta === o.unitMovementDelta &&
    o.candidates.includes(used) &&
    (o.responseUnitsPerPack === null || o.responseUnitsPerPack === used);
  if (!coherent) {
    return fail(
      `Par de conversión incoherente: ${facts}; la respuesta dice units_per_pack=${o.responseUnitsPerPack ?? "?"} y los valores vigentes eran ${o.candidates.join("/")}.`,
    );
  }
  return ok(`Par coherente con units_per_pack=${used} (vigentes: ${o.candidates.join("/")}).`);
}

export type ReverseOrderObservation = {
  statuses: number[];
  errors: (string | undefined)[];
  lines: number;
  stockDeltas: number[];
  sales: number;
  saleMovements: number;
  activePayments: number;
};

/** 9.10: ventas cruzadas en orden inverso → sin deadlock y, si falla una, rollback completo. */
export function judgeReverseOrder(o: ReverseOrderObservation): Judgement {
  const n = o.statuses.length;
  const okCount = o.statuses.filter(is2xx).length;
  const clean =
    o.sales === okCount &&
    o.saleMovements === okCount * o.lines &&
    o.activePayments === okCount &&
    o.stockDeltas.every((delta) => delta === -okCount);
  if (!clean) {
    return fail(
      `Rollback parcial: ${okCount} respuesta(s) 2xx pero ${o.sales} venta(s), ${o.saleMovements} movimiento(s) (esperado ${okCount * o.lines}), ${o.activePayments} pago(s), deltas distintos de −${okCount}: ${o.stockDeltas.filter((d) => d !== -okCount).length}.`,
    );
  }
  const deadlocks = o.errors.filter((e, i) => !is2xx(o.statuses[i] ?? 0) && isDeadlock(e)).length;
  if (deadlocks > 0) {
    return fail(
      `Deadlock sin reintento: ${deadlocks} de ${n} ventas de ${o.lines} líneas respondieron ${describeResponses(o.statuses, o.errors)}; rollback limpio (ni venta ni movimientos parciales).`,
    );
  }
  if (okCount < n) return finding(`Sin deadlock, pero ${n - okCount} venta(s) rechazada(s): ${describeResponses(o.statuses, o.errors)}; rollback limpio.`);
  return ok(`Las ${n} ventas de ${o.lines} líneas pasaron sin deadlock.`);
}

export type AbortRetryObservation = {
  mode: "same_key" | "new_key";
  /** La venta original quedó confirmada en base aunque el cliente no recibió respuesta. */
  committedWithoutResponse: boolean;
  originalId: string | null;
  retryStatus: number;
  retryId: string | null;
  retryError?: string;
  sales: number;
  saleMovements: number;
  activePayments: number;
  stockDelta: number;
  quantity: number;
};

/** 9.8: transacción confirmada sin respuesta; reintento con la misma clave o con una nueva. */
export function judgeAbortRetry(o: AbortRetryObservation): Judgement {
  if (!o.committedWithoutResponse) {
    return { verdict: "error", detail: "Precondición no alcanzada: la venta no quedó confirmada tras cortar la respuesta." };
  }
  const facts = `${o.sales} venta(s), ${o.saleMovements} movimiento(s), ${o.activePayments} pago(s), stock ${o.stockDelta}`;
  const retry = describeResponses([o.retryStatus], [o.retryError]);
  if (o.mode === "same_key") {
    if (o.sales !== 1 || o.saleMovements !== 1 || o.activePayments !== 1 || o.stockDelta !== -o.quantity) {
      return fail(`El reintento con el MISMO clientRequestId debía dejar 1 venta y quedaron ${facts} (reintento ${retry}).`);
    }
    if (is2xx(o.retryStatus) && o.retryId !== null && o.retryId === o.originalId) return ok("El reintento con la misma clave devuelve la misma venta, sin segundo movimiento.");
    return finding(`Una sola venta, pero el reintento con la misma clave no devolvió la venta original (${retry}; id ${o.retryId ?? "null"} vs ${o.originalId ?? "null"}).`);
  }
  if (o.sales === 2 && o.saleMovements === 2 && o.stockDelta === -2 * o.quantity) {
    return finding(
      `Reintento a ciegas con clave NUEVA duplica: ${facts}. El servidor no puede distinguirlo; la protección depende de que la UI reutilice el clientRequestId.`,
    );
  }
  if (o.sales === 1 && o.saleMovements === 1 && o.stockDelta === -o.quantity && !is2xx(o.retryStatus)) {
    return ok(`El reintento con clave nueva fue rechazado (${retry}); una sola venta.`);
  }
  return fail(`Estado incoherente tras el reintento con clave nueva: ${facts} (reintento ${retry}).`);
}

export type DeactivatedSaleObservation = {
  action: "pay" | "cancel";
  status: number;
  error?: string;
  saleStatus: string | null;
  initialStock: number;
  quantity: number;
  stock: number;
  reversalMovements: number;
  activePayments: number;
};

/** 9.11: con el producto desactivado la venta pendiente se puede pagar o cancelar. */
export function judgeDeactivatedSale(o: DeactivatedSaleObservation): Judgement {
  const response = describeResponses([o.status], [o.error]);
  const sold = o.initialStock - o.quantity;
  if (o.action === "pay") {
    if (is2xx(o.status) && o.saleStatus === "pagada" && o.stock === sold && o.activePayments === 1 && o.reversalMovements === 0) {
      return ok("La venta pendiente se paga con el producto desactivado; stock cuadra.");
    }
    if (!is2xx(o.status) && o.stock === sold && o.activePayments === 0) {
      return fail(`No se puede pagar la venta pendiente de un producto desactivado: ${response}.`);
    }
    return fail(`Pago incoherente: ${response}, venta ${o.saleStatus ?? "?"}, stock ${o.stock} (esperado ${sold}), ${o.activePayments} pago(s).`);
  }
  if (is2xx(o.status) && o.saleStatus === "cancelada" && o.stock === o.initialStock && o.reversalMovements === 1) {
    return ok("La venta pendiente se cancela con el producto desactivado; el stock vuelve.");
  }
  if (!is2xx(o.status) && o.stock === sold && o.reversalMovements === 0) {
    return fail(`No se puede cancelar la venta pendiente de un producto desactivado: ${response}.`);
  }
  return fail(`Cancelación incoherente: ${response}, venta ${o.saleStatus ?? "?"}, stock ${o.stock}, ${o.reversalMovements} reversión(es).`);
}

export type SoftCategoryObservation = {
  deleteStatus: number;
  saleHttpStatus: number;
  error?: string;
  sales: number;
  saleMovements: number;
  stockDelta: number;
  quantity: number;
};

/** 9.12: vender un producto de una categoría borrada (soft) funciona o falla limpio. */
export function judgeSoftCategory(o: SoftCategoryObservation): Judgement {
  const response = describeResponses([o.saleHttpStatus], [o.error]);
  const noEffect = o.sales === 0 && o.saleMovements === 0 && o.stockDelta === 0;
  if (is2xx(o.saleHttpStatus)) {
    if (o.sales === 1 && o.saleMovements === 1 && o.stockDelta === -o.quantity) {
      return ok(`La venta funciona (DELETE categoría → ${o.deleteStatus}); un movimiento, stock −${o.quantity}.`);
    }
    return fail(`Venta 2xx incoherente: ${o.sales} venta(s), ${o.saleMovements} movimiento(s), stock ${o.stockDelta}.`);
  }
  if (!noEffect) return fail(`Venta rechazada (${response}) pero con efectos: ${o.sales} venta(s), ${o.saleMovements} movimiento(s), stock ${o.stockDelta}.`);
  if (is4xx(o.saleHttpStatus)) return ok(`La venta falla limpio (${response}); sin movimiento.`);
  return finding(`La venta falla sin efecto pero con ${response} en vez de un 4xx claro.`);
}

// ===========================================================================
// Lógica pura: cadena de movimientos, integridad, agregación
// ===========================================================================

export type ChainMovement = { quantity_delta: number; stock_after: number };

/**
 * ¿Existe ALGÚN orden de los movimientos que encadene 0 → … → `finalStock`
 * (cada uno parte del `stock_after` del anterior)? Es la versión exacta e
 * independiente del orden de `stock_chain_breaks`, que ordena por `created_at`
 * (= inicio de transacción) y da falsos positivos bajo concurrencia (G9).
 *
 * Cada movimiento es una arista `stock_after − delta → stock_after`; hay orden
 * válido si y solo si el multigrafo dirigido tiene un camino euleriano de 0 a
 * `finalStock`: grados balanceados salvo origen/destino y aristas conexas.
 */
export function chainConsistent(movements: readonly ChainMovement[], finalStock: number): boolean {
  if (movements.length === 0) return finalStock === 0;
  const balance = new Map<number, number>();
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(x, root);
    return root;
  };
  for (const m of movements) {
    const from = m.stock_after - m.quantity_delta;
    const to = m.stock_after;
    balance.set(from, (balance.get(from) ?? 0) + 1);
    balance.set(to, (balance.get(to) ?? 0) - 1);
    if (!parent.has(from)) parent.set(from, from);
    if (!parent.has(to)) parent.set(to, to);
    parent.set(find(from), find(to));
  }
  if (!balance.has(0) || !balance.has(finalStock)) return false;
  const roots = new Set([...parent.keys()].map(find));
  if (roots.size !== 1) return false;
  for (const [node, value] of balance) {
    let expected = 0;
    if (finalStock !== 0) {
      if (node === 0) expected = 1;
      else if (node === finalStock) expected = -1;
    }
    if (value !== expected) return false;
  }
  return true;
}

export function emptyScoped(): ScopedIntegrity {
  const out = { chain_inconsistent: 0 } as ScopedIntegrity;
  for (const name of INTEGRITY_VIEW_NAMES) out[name] = 0;
  return out;
}

export function addScoped(a: ScopedIntegrity, b: ScopedIntegrity | null): ScopedIntegrity {
  if (!b) return a;
  const out = { chain_inconsistent: a.chain_inconsistent + b.chain_inconsistent } as ScopedIntegrity;
  for (const name of INTEGRITY_VIEW_NAMES) out[name] = a[name] + b[name];
  return out;
}

/**
 * Vistas con filas sobre los productos propios. `stock_chain_breaks` no cuenta
 * por sí sola (falsos positivos G9): la sustituye `chain_inconsistent`, que es
 * exacto. La cuenta de la vista se conserva en `reconcile_scoped`.
 */
export function integrityProblems(scoped: ScopedIntegrity, ignore: readonly IntegrityViewName[] = []): string[] {
  const problems: string[] = [];
  for (const name of INTEGRITY_VIEW_NAMES) {
    if (name === "stock_chain_breaks" || ignore.includes(name)) continue;
    if (scoped[name] > 0) problems.push(`${name}=${scoped[name]}`);
  }
  if (scoped.chain_inconsistent > 0) problems.push(`chain_inconsistent=${scoped.chain_inconsistent}`);
  return problems;
}

/** Aplica el oráculo de vistas al juicio del caso: un pass/finding con vistas sucias es fail. */
export function applyIntegrity(
  judgement: Judgement,
  scoped: ScopedIntegrity,
  ignore: readonly IntegrityViewName[] = [],
): Judgement {
  const problems = integrityProblems(scoped, ignore);
  if (problems.length === 0 || judgement.verdict === "fail" || judgement.verdict === "error") return judgement;
  return { verdict: "fail", detail: `${judgement.detail} Vistas de integridad sobre los productos del caso: ${problems.join(", ")}.` };
}

const VERDICT_PRIORITY: Verdict[] = ["fail", "error", "finding", "pass", "skip"];

export type Aggregate = { verdict: Verdict; detail: string; counts: Record<Verdict, number>; total: number; sampleIndex: number };

/**
 * Veredicto de N repeticiones: el peor manda (fail > error > finding > pass >
 * skip). Una carrera que pasa 1 vez no está descartada, así que el detalle
 * lleva siempre el "k de N" por veredicto y el detalle de la primera peor.
 */
export function aggregateAttempts(attempts: readonly Judgement[]): Aggregate {
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, finding: 0, error: 0, skip: 0 };
  for (const attempt of attempts) counts[attempt.verdict] += 1;
  const total = attempts.length;
  if (total === 0) {
    return { verdict: "error", detail: "Sin repeticiones ejecutadas.", counts, total, sampleIndex: -1 };
  }
  const verdict = VERDICT_PRIORITY.find((v) => counts[v] > 0) ?? "error";
  const sampleIndex = attempts.findIndex((a) => a.verdict === verdict);
  const tally = VERDICT_PRIORITY.filter((v) => counts[v] > 0)
    .map((v) => `${v} ${counts[v]} de ${total}`)
    .join(" · ");
  const sample = attempts[sampleIndex]?.detail ?? "";
  return { verdict, detail: `${tally}. ${sample}`.trim(), counts, total, sampleIndex };
}

/** Quita request/response de los pasos (para repeticiones que pasaron). */
export function slimSteps(steps: readonly StepRecord[]): StepRecord[] {
  return steps.map((step) => {
    const slim: StepRecord = { op: step.op, as: step.as, status: step.status, response_id: step.response_id, ms: step.ms };
    if (step.error !== undefined) slim.error = step.error;
    if (step.aborted) slim.aborted = true;
    return slim;
  });
}

// ===========================================================================
// Lógica pura: argv, selección y markdown
// ===========================================================================

export type ChaosArgs = {
  cases: string[];
  all: boolean;
  runId: string | null;
  repeat: number | null;
  list: boolean;
  out: string | null;
};

/** `--case 9.1[,9.2…] | --only … | --all [--run <id>] [--repeat N] [--list] [--out <dir>]`. */
export function parseChaosArgs(argv: readonly string[]): ChaosArgs {
  const args: ChaosArgs = { cases: [], all: false, runId: null, repeat: null, list: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Falta el valor de ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--case" || arg === "--only") {
      args.cases.push(
        ...next()
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      );
    } else if (arg === "--all") args.all = true;
    else if (arg === "--list") args.list = true;
    else if (arg === "--run") args.runId = next();
    else if (arg === "--out") args.out = next();
    else if (arg === "--repeat") {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 1) throw new Error("--repeat debe ser un entero >= 1");
      args.repeat = value;
    } else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!args.list && !args.all && args.cases.length === 0) {
    throw new Error("Indica --case 9.N[,9.M…] o --all (o --list para ver los ids).");
  }
  if (args.runId !== null && !/^[A-Za-z0-9._-]+$/.test(args.runId)) {
    throw new Error("--run solo admite letras, números, punto, guion y guion bajo");
  }
  return args;
}

/** `9.1` selecciona todas sus variantes; `9.1.same_key_x2` una sola. Orden = el de `available`. */
export function selectVariantIds(available: readonly string[], args: Pick<ChaosArgs, "all" | "cases">): string[] {
  if (args.all && args.cases.length === 0) return [...available];
  const wanted = new Set<string>();
  for (const selector of args.cases) {
    const matches = available.filter((id) => id === selector || id.startsWith(`${selector}.`));
    if (matches.length === 0) throw new Error(`Caso desconocido: ${selector}. Usa --list.`);
    for (const id of matches) wanted.add(id);
  }
  return available.filter((id) => wanted.has(id));
}

/** `9.10.x` → `9.10` (clave de `PLAN_CASES`). */
export function planCaseOf(variantId: string): string {
  return variantId.split(".").slice(0, 2).join(".");
}

export function defaultRunId(now: Date, suite: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${suite}`;
}

function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Última línea por id (un mismo run puede ejecutarse por partes). */
export function latestById(lines: readonly ChaosLine[]): ChaosLine[] {
  const byId = new Map<string, ChaosLine>();
  for (const line of lines) byId.set(line.id, line);
  return [...byId.values()];
}

export function countVerdicts(lines: readonly Pick<ChaosLine, "verdict">[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, finding: 0, error: 0, skip: 0 };
  for (const line of lines) counts[line.verdict] += 1;
  return counts;
}

export function formatVerdictCounts(counts: Record<Verdict, number>): string {
  return (["pass", "fail", "finding", "error", "skip"] as const).map((v) => `${v}=${counts[v]}`).join(" ");
}

export function renderChaosMarkdown(runId: string, lines: readonly ChaosLine[]): string {
  const rows = latestById(lines);
  const out = [
    `# Caos determinista (sección 9) — run \`${runId}\``,
    "",
    `Resumen: ${formatVerdictCounts(countVerdicts(rows))}`,
    "",
    "| id | caso | severidad | esperado (plan) | veredicto | repeticiones | detalle |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const line of rows) {
    const attempts = typeof line.actual.attempts === "number" ? line.actual.attempts : 1;
    const plan = typeof line.expected.plan === "string" ? line.expected.plan : "";
    out.push(
      `| ${line.id} | ${mdCell(line.title)} | ${line.severity} | ${mdCell(plan)} | **${line.verdict}** | ${attempts} | ${mdCell(line.detail)} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

// ===========================================================================
// Entorno lab (I/O)
// ===========================================================================

export type Rate = { id: string; rateVes: number };

export type Lab = {
  runId: string;
  /** Sufijo único por proceso: un mismo `--run` puede relanzarse sin chocar SKUs. */
  nonce: string;
  storeId: string;
  supabaseUrl: string;
  anonKey: string;
  dbUrl: string;
  db: Client;
  userIds: Record<LabRoleKey, string>;
  customerId: string;
  supplierId: string;
  sessions: Map<string, ApiClient>;
  tokens: Map<LabRoleKey, string>;
  extraDbs: Client[];
};

export type SeededProduct = { id: string; sku: string; stock: number; price: number };

export type AttemptContext = {
  lab: Lab;
  tag: string;
  steps: StepRecord[];
  productIds: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ms)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function responseId(res: ApiResponse): string | null {
  const data = res.body?.data;
  if (!data || typeof data !== "object") return null;
  const id = (data as JsonRecord).id;
  return typeof id === "string" ? id : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Cliente pg contra la base LAB (host verificado contra STOCK_TEST_ALLOW_WRITES_HOST). */
export async function connectLabDb(dbUrl: string): Promise<Client> {
  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  return client;
}

/** Sesión HTTP `index` del rol (cada índice es un login y un cookie-jar distintos). */
export async function session(lab: Lab, role: LabRoleKey, index = 0): Promise<ApiClient> {
  const key = `${role}#${index}`;
  const cached = lab.sessions.get(key);
  if (cached) return cached;
  const client = createLabClient();
  await loginAs(client, role);
  lab.sessions.set(key, client);
  return client;
}

async function ensureCashSession(lab: Lab, role: "vendedor1" | "vendedor2"): Promise<void> {
  const client = await session(lab, role);
  const current = await client.request("/api/cash/session");
  if (!current.ok) throw new Error(`GET /api/cash/session (${role}) devolvió ${current.status}: ${describeError(current)}`);
  if (current.body?.data) return;
  const register = (await fetchRegisters(client)).find((r) => r.assignedUserId === lab.userIds[role]);
  if (!register) throw new Error(`${role} no tiene caja asignada.`);
  const opened = await client.request("/api/cash/session/open", {
    method: "POST",
    body: JSON.stringify({ registerId: register.id, openingVes: 0, openingRef: 0 }),
  });
  if (opened.ok) return;
  const again = await client.request("/api/cash/session");
  if (again.ok && again.body?.data) return;
  throw new Error(`Abrir caja de ${role} devolvió ${opened.status}: ${describeError(opened)}`);
}

async function contactId(client: ApiClient, type: "cliente" | "proveedor"): Promise<string | null> {
  const res = await client.request(`/api/contacts?type=${type}&limit=100`);
  if (!res.ok) throw new Error(`GET /api/contacts?type=${type} devolvió ${res.status}: ${describeError(res)}`);
  const items = unwrapList(res).filter((raw): raw is JsonRecord => Boolean(raw) && typeof raw === "object");
  const chosen = (type === "cliente" ? items.find((item) => item.isPosDefault === true) : undefined) ?? items[0];
  return typeof chosen?.id === "string" ? chosen.id : null;
}

/**
 * Abre el entorno: conexión pg (host permitido), sesiones de los 5 usuarios lab,
 * cajas de ambos vendedores abiertas (nunca se cierran), cliente y proveedor.
 */
export async function openLab(runId: string): Promise<Lab> {
  const file = loadStockLabEnv();
  const get = (key: string): string => {
    const value = process.env[key] ?? file[key];
    if (!value) throw new Error(`${key} no está definida (process.env o .env.stock-lab)`);
    return value;
  };
  const allowedHost = process.env.STOCK_TEST_ALLOW_WRITES_HOST ?? file.STOCK_TEST_ALLOW_WRITES_HOST;
  const dbUrl = get("STOCK_LAB_DB_URL");
  const supabaseUrl = get("NEXT_PUBLIC_SUPABASE_URL");
  assertAllowedWriteHost(dbUrl, allowedHost);
  assertAllowedWriteHost(supabaseUrl, allowedHost);

  const db = await connectLabDb(dbUrl);
  const users = await db.query<{ email: string; id: string; store_id: string }>(
    "select u.email, p.id, p.store_id from public.profiles p join auth.users u on u.id = p.id where u.email = any($1)",
    [Object.values(LAB_USERS).map((u) => u.email)],
  );
  const userIds = {} as Record<LabRoleKey, string>;
  let storeId = "";
  for (const key of Object.keys(LAB_USERS) as LabRoleKey[]) {
    const row = users.rows.find((r) => r.email === LAB_USERS[key].email);
    if (!row) throw new Error(`Falta el usuario lab ${LAB_USERS[key].email} (¿base sin sembrar?)`);
    userIds[key] = row.id;
    storeId = row.store_id;
  }
  if (!storeId || storeId === DEFAULT_STORE_ID) throw new Error("La tienda de los usuarios lab no es la tienda lab.");

  const lab: Lab = {
    runId,
    nonce: Date.now().toString(36).slice(-5),
    storeId,
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    anonKey: get("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    dbUrl,
    db,
    userIds,
    customerId: "",
    supplierId: "",
    sessions: new Map(),
    tokens: new Map(),
    extraDbs: [],
  };
  try {
    await ensureCashSession(lab, "vendedor1");
    await ensureCashSession(lab, "vendedor2");
    const admin = await session(lab, "admin");
    const customer = await contactId(await session(lab, "vendedor1"), "cliente");
    if (!customer) throw new Error("No hay cliente (consumidor final) en la tienda lab.");
    lab.customerId = customer;
    let supplier = await contactId(admin, "proveedor");
    if (!supplier) {
      const created = await admin.request("/api/contacts", {
        method: "POST",
        body: JSON.stringify({ name: `Proveedor ${SKU_PREFIX}`, type: "proveedor" }),
      });
      supplier = responseId(created);
    }
    if (!supplier) throw new Error("No se pudo obtener ni crear un proveedor.");
    lab.supplierId = supplier;
  } catch (error) {
    await db.end().catch(() => undefined);
    throw error;
  }
  return lab;
}

export async function closeLab(lab: Lab): Promise<void> {
  for (const extra of lab.extraDbs) await extra.end().catch(() => undefined);
  await lab.db.end().catch(() => undefined);
}

/** Segunda conexión pg (para sostener locks o escribir en paralelo). */
export async function extraDb(lab: Lab): Promise<Client> {
  const client = await connectLabDb(lab.dbUrl);
  lab.extraDbs.push(client);
  return client;
}

async function releaseDb(lab: Lab, client: Client): Promise<void> {
  lab.extraDbs = lab.extraDbs.filter((c) => c !== client);
  await client.end().catch(() => undefined);
}

/** Tasa vigente leída del API justo antes de operar (puede cambiar bajo los pies). */
export async function currentRate(lab: Lab): Promise<Rate> {
  const client = await session(lab, "vendedor1");
  const res = await client.request("/api/exchange-rates/current");
  const data = res.body?.data as JsonRecord | undefined;
  const rateVes = Number(data?.rateVes);
  if (!res.ok || typeof data?.id !== "string" || !Number.isFinite(rateVes) || rateVes <= 0) {
    throw new Error(`GET /api/exchange-rates/current devolvió ${res.status}: ${describeError(res)}`);
  }
  return { id: data.id, rateVes };
}

export type SeedOptions = { stock: number; price?: number; cost?: number; categoryId?: string | null };

/**
 * Siembra productos propios por SQL (producto + `inventario_inicial`, igual que
 * deja `adjust_stock`) en una transacción. El setup no pasa por el BFF para no
 * cargarlo: lo que se prueba son las operaciones posteriores.
 */
export async function seedProducts(lab: Lab, tag: string, count: number, options: SeedOptions): Promise<SeededProduct[]> {
  const price = options.price ?? 1;
  const cost = options.cost ?? 0.5;
  const skus = Array.from({ length: count }, (_, i) => `${SKU_PREFIX}-${lab.runId}-${lab.nonce}-${tag}-${String(i + 1).padStart(2, "0")}`);
  await lab.db.query("begin");
  try {
    const inserted = await lab.db.query<{ id: string; sku: string }>(
      `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active, category_id)
       select $1::uuid, s, 'Caos ' || s, $3::numeric, $4::numeric, $5::int, 0, true, $6::uuid from unnest($2::text[]) s
       returning id, sku`,
      [lab.storeId, skus, price, cost, options.stock, options.categoryId ?? null],
    );
    if (options.stock > 0) {
      await lab.db.query(
        `insert into public.stock_movements (product_id, type, quantity_delta, stock_after, reason, created_by, store_id)
         select p, 'inventario_inicial', $2::int, $2::int, $3, $4::uuid, $5::uuid from unnest($1::uuid[]) p`,
        [inserted.rows.map((r) => r.id), options.stock, `Inventario inicial ${SKU_PREFIX} ${tag}`, lab.userIds.admin, lab.storeId],
      );
    }
    await lab.db.query("commit");
    const bySku = new Map(inserted.rows.map((r) => [r.sku, r.id]));
    return skus.map((sku) => ({ id: bySku.get(sku) ?? "", sku, stock: options.stock, price }));
  } catch (error) {
    await lab.db.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function seed(ctx: AttemptContext, count: number, options: SeedOptions, suffix = ""): Promise<SeededProduct[]> {
  const products = await seedProducts(ctx.lab, `${ctx.tag}${suffix}`, count, options);
  ctx.productIds.push(...products.map((p) => p.id));
  return products;
}

// ---------------------------------------------------------------------------
// HTTP con registro de pasos
// ---------------------------------------------------------------------------

export type CallOptions = { timeoutMs?: number };

/** Petición al BFF que queda registrada como paso (request, respuesta, ms). `status: 0` = sin respuesta. */
export async function call(
  ctx: Pick<AttemptContext, "steps">,
  as: string,
  client: ApiClient,
  method: string,
  path: string,
  body?: unknown,
  options: CallOptions = {},
): Promise<ApiResponse> {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (options.timeoutMs !== undefined) init.signal = AbortSignal.timeout(options.timeoutMs);
  const started = performance.now();
  let res: ApiResponse;
  let thrown: string | undefined;
  try {
    res = await client.request(path, init);
  } catch (error) {
    thrown = errorText(error);
    res = { ok: false, status: 0, body: null };
  }
  const step: StepRecord = {
    op: `${method} ${path}`,
    as,
    status: res.status,
    response_id: responseId(res),
    ms: Math.round(performance.now() - started),
    request: body ?? null,
    response: res.body,
  };
  if (thrown !== undefined) {
    step.error = thrown;
    if (options.timeoutMs !== undefined) step.aborted = true;
  } else if (!res.ok) step.error = describeError(res);
  ctx.steps.push(step);
  return res;
}

async function accessToken(lab: Lab, role: LabRoleKey): Promise<string> {
  const cached = lab.tokens.get(role);
  if (cached) return cached;
  const response = await fetch(`${lab.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: lab.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: LAB_USERS[role].email, password: LAB_PASSWORD }),
  });
  const json = (await response.json().catch(() => null)) as JsonRecord | null;
  const token = json?.access_token;
  if (!response.ok || typeof token !== "string") throw new Error(`Login directo en Supabase Auth (${role}) devolvió ${response.status}`);
  lab.tokens.set(role, token);
  return token;
}

/** Petición directa a PostgREST con la anon key y el JWT del usuario (saltándose el BFF). */
async function postgrest(
  ctx: AttemptContext,
  role: LabRoleKey,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown; error?: string }> {
  const token = await accessToken(ctx.lab, role);
  const started = performance.now();
  const response = await fetch(`${ctx.lab.supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: ctx.lab.anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  const step: StepRecord = {
    op: `PostgREST ${method} /rest/v1${path}`,
    as: role,
    status: response.status,
    response_id: null,
    ms: Math.round(performance.now() - started),
    request: body,
    response: parsed,
  };
  let error: string | undefined;
  if (!response.ok) {
    const rec = parsed && typeof parsed === "object" ? (parsed as JsonRecord) : {};
    error = [rec.code, rec.message].filter((v) => typeof v === "string").join(" ") || text.slice(0, 200);
    step.error = error;
  }
  ctx.steps.push(step);
  return { status: response.status, body: parsed, error };
}

// ---------------------------------------------------------------------------
// Oráculo SQL
// ---------------------------------------------------------------------------

export type ProductRow = { id: string; sku: string; current_stock: number; is_active: boolean; store_id: string; category_id: string | null };
export type MovementRow = {
  id: string;
  product_id: string;
  type: string;
  quantity_delta: number;
  stock_after: number;
  sale_id: string | null;
  purchase_id: string | null;
  conversion_id: string | null;
  created_at: string;
};
export type SaleRow = { id: string; status: string; total_ves: number; paid_ves: number; client_request_id: string | null; invoice_number: string | null };
export type PurchaseRow = { id: string; status: string; total_ves: number; paid_ves: number };
export type PaymentRow = { id: string; sale_id: string | null; purchase_id: string | null; status: string; method: string; amount: number; amount_ves: number };

export type Observation = {
  products: ProductRow[];
  movements: MovementRow[];
  sales: SaleRow[];
  purchases: PurchaseRow[];
  payments: PaymentRow[];
};

/** Filas de base de los productos del caso: stock, movimientos y documentos/pagos que los tocan. */
export async function observe(db: Client, productIds: readonly string[]): Promise<Observation> {
  const ids = [...productIds];
  const products = await db.query<ProductRow>(
    "select id, sku, current_stock, is_active, store_id, category_id from public.products where id = any($1::uuid[]) order by sku",
    [ids],
  );
  const movements = await db.query<MovementRow>(
    `select id, product_id, type::text as type, quantity_delta, stock_after, sale_id, purchase_id, conversion_id, created_at::text as created_at
     from public.stock_movements where product_id = any($1::uuid[]) order by created_at, id`,
    [ids],
  );
  const sales = await db.query<SaleRow>(
    `select id, status::text as status, total_ves::float8 as total_ves, paid_ves::float8 as paid_ves, client_request_id, invoice_number
     from public.sales where id in (select sale_id from public.sale_items where product_id = any($1::uuid[])) order by created_at, id`,
    [ids],
  );
  const purchases = await db.query<PurchaseRow>(
    `select id, status::text as status, total_ves::float8 as total_ves, paid_ves::float8 as paid_ves
     from public.purchases where id in (select purchase_id from public.purchase_items where product_id = any($1::uuid[])) order by created_at, id`,
    [ids],
  );
  const payments = await db.query<PaymentRow>(
    `select id, sale_id, purchase_id, status::text as status, method::text as method, amount::float8 as amount, amount_ves::float8 as amount_ves
     from public.payments where sale_id = any($1::uuid[]) or purchase_id = any($2::uuid[]) order by created_at, id`,
    [sales.rows.map((s) => s.id), purchases.rows.map((p) => p.id)],
  );
  return { products: products.rows, movements: movements.rows, sales: sales.rows, purchases: purchases.rows, payments: payments.rows };
}

/** Cuenta de cada vista de integridad filtrada a los productos dados + chequeo exacto de cadena. */
export async function scopedIntegrity(db: Client, productIds: readonly string[]): Promise<ScopedIntegrity> {
  const out = emptyScoped();
  const ids = [...productIds];
  if (ids.length === 0) return out;
  for (const name of INTEGRITY_VIEW_NAMES) {
    const where =
      name === "conversion_mismatches"
        ? "pack_product_id = any($1::uuid[]) or unit_product_id = any($1::uuid[])"
        : "product_id = any($1::uuid[])";
    const result = await db.query<{ n: number }>(`select count(*)::int as n from public.${name} where ${where}`, [ids]);
    out[name] = result.rows[0]?.n ?? 0;
  }
  const stocks = await db.query<{ id: string; current_stock: number }>(
    "select id, current_stock from public.products where id = any($1::uuid[])",
    [ids],
  );
  const movements = await db.query<{ product_id: string; quantity_delta: number; stock_after: number }>(
    "select product_id, quantity_delta, stock_after from public.stock_movements where product_id = any($1::uuid[])",
    [ids],
  );
  const byProduct = new Map<string, ChainMovement[]>();
  for (const row of movements.rows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push({ quantity_delta: row.quantity_delta, stock_after: row.stock_after });
    byProduct.set(row.product_id, list);
  }
  for (const product of stocks.rows) {
    if (!chainConsistent(byProduct.get(product.id) ?? [], product.current_stock)) out.chain_inconsistent += 1;
  }
  return out;
}

export async function globalIntegrity(db: Client, storeId: string): Promise<IntegrityReport> {
  const result = await db.query<{ report: unknown }>("select public.stock_integrity_report($1::uuid) as report", [storeId]);
  return reportFromJson(result.rows[0]?.report);
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type SaleLineInput = { productId: string; quantity: number; price: number };

/**
 * Body de `POST /api/sales`. Con `key` o `paid` el BFF usa
 * `create_sale_with_payments`; sin ninguno, `create_sale` (venta `pendiente_pago`).
 */
export function saleBody(
  customerId: string,
  rate: Rate,
  lines: readonly SaleLineInput[],
  options: { key?: string | null; paid?: boolean; notes?: string } = {},
): JsonRecord {
  const body: JsonRecord = {
    customerId,
    exchangeRateId: rate.id,
    refRateVes: rate.rateVes,
    items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPriceRef: line.price })),
    taxRef: 0,
    discountRef: 0,
    notes: options.notes ?? `Lab ${SKU_PREFIX}`,
  };
  if (options.key) body.clientRequestId = options.key;
  if (options.paid) {
    const totalRef = round2(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
    body.payments = [{ method: "efectivo_usd", currency: "USD", amount: totalRef }];
  }
  return body;
}

export type PurchaseLineInput = { productId: string; quantity: number; cost: number };

export function purchaseBody(
  supplierId: string,
  rate: Rate,
  lines: readonly PurchaseLineInput[],
  status: "pedido" | "recibido",
  notes = `Lab ${SKU_PREFIX}`,
): JsonRecord {
  const items = lines.map((line) => {
    const subtotalRef = round2(line.cost * line.quantity);
    return {
      entryMode: "unit",
      productId: line.productId,
      quantity: line.quantity,
      unitCostRef: line.cost,
      unitCostVes: round2(line.cost * rate.rateVes),
      costCurrency: "ref",
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      subtotalRef,
      subtotalVes: round2(subtotalRef * rate.rateVes),
    };
  });
  const subtotalRef = round2(items.reduce((sum, item) => sum + item.subtotalRef, 0));
  return {
    supplierId,
    status,
    exchangeRateId: rate.id,
    refRateVes: rate.rateVes,
    notes,
    subtotalRef,
    subtotalVes: round2(subtotalRef * rate.rateVes),
    taxRef: 0,
    taxVes: 0,
    discountRef: 0,
    discountVes: 0,
    items,
  };
}

function line(product: SeededProduct, quantity: number): SaleLineInput {
  return { productId: product.id, quantity, price: product.price };
}

function errorsOf(ctx: AttemptContext, from: number): (string | undefined)[] {
  return ctx.steps.slice(from).map((step) => step.error);
}

function stockOf(obs: Observation, productId: string): number {
  return obs.products.find((p) => p.id === productId)?.current_stock ?? Number.NaN;
}

function countMovements(obs: Observation, productId: string, types: readonly string[]): number {
  return obs.movements.filter((m) => m.product_id === productId && types.includes(m.type)).length;
}

function activePayments(obs: Observation): number {
  return obs.payments.filter((p) => p.status === "activo").length;
}

const REVERSAL_TYPES = ["ajuste_entrada", "devolucion_cliente"] as const;

// ===========================================================================
// Casos
// ===========================================================================

export type VariantOutcome = { judgement: Judgement; actual: JsonRecord; evidence: string[] };

export type VariantDef = {
  id: string;
  title: string;
  hypothesis: string[];
  expected: JsonRecord;
  /** Repeticiones por defecto (carreras: 10). */
  defaultRepeat: number;
  /** false = determinista: `--repeat` no la multiplica. */
  repeatable: boolean;
  ignoreViews?: IntegrityViewName[];
  run(ctx: AttemptContext): Promise<VariantOutcome>;
};

// ------------------------------------------------------------------- 9.1

/**
 * Sin clientRequestId los únicos índices únicos de `sales` son la pk y
 * `sales_store_invoice_unique`; `create_sale` genera `invoice_number` como
 * 'V-' + clock_timestamp() al milisegundo, así que un 409 aquí es un choque de
 * número de factura entre dos ventas del mismo milisegundo, no idempotencia.
 */
export const INVOICE_COLLISION_NOTE =
  "Sin clientRequestId el 409 solo puede venir de sales_store_invoice_unique (invoice_number = 'V-' + clock_timestamp al ms): es un choque de número de factura entre ventas del mismo milisegundo, no idempotencia.";

function duplicateSale(copies: number, withKey: boolean, gapMs = 0) {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const [product] = await seed(ctx, 1, { stock: 20 });
    if (!product) throw new Error("seed vacío");
    const quantity = 2;
    const rate = await currentRate(lab);
    const before = await observe(lab.db, [product.id]);
    const vendedor = await session(lab, "vendedor1");
    const body = saleBody(lab.customerId, rate, [line(product, quantity)], withKey ? { key: randomUUID(), paid: true } : {});
    const from = ctx.steps.length;
    const responses = await Promise.all(
      Array.from({ length: copies }, (_, i) => sleep(i * gapMs).then(() => call(ctx, "vendedor1", vendedor, "POST", "/api/sales", body))),
    );
    const after = await observe(lab.db, [product.id]);
    let judgement = judgeDuplicateSale({
      statuses: ctx.steps.slice(from).map((s) => s.status),
      ids: ctx.steps.slice(from).map((s) => s.response_id),
      errors: errorsOf(ctx, from),
      sales: after.sales.length,
      saleMovements: countMovements(after, product.id, ["venta"]),
      activePayments: activePayments(after),
      stockDelta: stockOf(after, product.id) - product.stock,
      quantity,
      paid: withKey,
    });
    if (!withKey && judgement.verdict === "finding" && ctx.steps.slice(from).some((s) => s.status === 409)) {
      judgement = { verdict: "finding", detail: `${judgement.detail} ${INVOICE_COLLISION_NOTE}` };
    }
    return {
      judgement,
      actual: { rpc: withKey ? "create_sale_with_payments" : "create_sale", copies, gap_ms: gapMs, responses: responses.map((r) => r.status), before, after },
      evidence: [`product:${product.id}`, ...after.sales.map((s) => `sale:${s.id}`)],
    };
  };
}

// ------------------------------------------------------------------- 9.2

function parallelReceive(copies: number) {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const [product] = await seed(ctx, 1, { stock: 5 });
    if (!product) throw new Error("seed vacío");
    const quantity = 7;
    const rate = await currentRate(lab);
    const admin = await session(lab, "admin");
    const created = await call(
      ctx,
      "admin",
      admin,
      "POST",
      "/api/purchases",
      purchaseBody(lab.supplierId, rate, [{ productId: product.id, quantity, cost: 0.5 }], "pedido", `Lab ${SKU_PREFIX} 9.2`),
    );
    const purchaseId = responseId(created);
    if (!created.ok || !purchaseId) throw new Error(`No se pudo crear la compra pedido: ${created.status} ${describeError(created)}`);
    const before = await observe(lab.db, [product.id]);
    // Clientes/sesiones distintas: alterna admin y almacén, un login por petición.
    const actors = await Promise.all(
      Array.from({ length: copies }, async (_, i) => {
        const role: LabRoleKey = i % 2 === 0 ? "admin" : "almacen";
        return { role, client: await session(lab, role, 1 + Math.floor(i / 2)) };
      }),
    );
    const from = ctx.steps.length;
    await Promise.all(actors.map((actor) => call(ctx, actor.role, actor.client, "PATCH", `/api/purchases/${purchaseId}/receive`)));
    const after = await observe(lab.db, [product.id]);
    const judgement = judgeDoubleReceive({
      statuses: ctx.steps.slice(from).map((s) => s.status),
      errors: errorsOf(ctx, from),
      purchaseMovements: countMovements(after, product.id, ["compra"]),
      stockDelta: stockOf(after, product.id) - product.stock,
      quantity,
      purchaseStatus: after.purchases.find((p) => p.id === purchaseId)?.status ?? null,
    });
    return { judgement, actual: { copies, before, after }, evidence: [`product:${product.id}`, `purchase:${purchaseId}`] };
  };
}

// ------------------------------------------------------------------- 9.3

function stockRace(requests: number) {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const initialStock = 5;
    const [product] = await seed(ctx, 1, { stock: initialStock });
    if (!product) throw new Error("seed vacío");
    const rate = await currentRate(lab);
    const actors = await Promise.all(
      Array.from({ length: requests }, async (_, i) => {
        const role: LabRoleKey = i % 2 === 0 ? "vendedor1" : "vendedor2";
        return { role, client: await session(lab, role, Math.floor(i / 2)) };
      }),
    );
    const before = await observe(lab.db, [product.id]);
    const from = ctx.steps.length;
    await Promise.all(
      actors.map((actor) =>
        call(
          ctx,
          actor.role,
          actor.client,
          "POST",
          "/api/sales",
          saleBody(lab.customerId, rate, [line(product, initialStock)], { key: randomUUID(), paid: true }),
        ),
      ),
    );
    const after = await observe(lab.db, [product.id]);
    const judgement = judgeStockRace({
      statuses: ctx.steps.slice(from).map((s) => s.status),
      errors: errorsOf(ctx, from),
      initialStock,
      stock: stockOf(after, product.id),
      minStockAfter: Math.min(...after.movements.map((m) => m.stock_after)),
      sales: after.sales.length,
      saleMovements: countMovements(after, product.id, ["venta"]),
      activePayments: activePayments(after),
    });
    return { judgement, actual: { requests, before, after }, evidence: [`product:${product.id}`, ...after.sales.map((s) => `sale:${s.id}`)] };
  };
}

// ------------------------------------------------------------------- 9.4

function cancelVsReturn(paid: boolean) {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const initialStock = 10;
    const quantity = 2;
    const [product] = await seed(ctx, 1, { stock: initialStock });
    if (!product) throw new Error("seed vacío");
    const rate = await currentRate(lab);
    const vendedor1 = await session(lab, "vendedor1");
    const vendedor2 = await session(lab, "vendedor2");
    const created = await call(
      ctx,
      "vendedor1",
      vendedor1,
      "POST",
      "/api/sales",
      saleBody(lab.customerId, rate, [line(product, quantity)], paid ? { key: randomUUID(), paid: true } : {}),
    );
    const saleId = responseId(created);
    if (!created.ok || !saleId) throw new Error(`No se pudo crear la venta: ${created.status} ${describeError(created)}`);
    const before = await observe(lab.db, [product.id]);
    const [cancel, returned] = await Promise.all([
      call(ctx, "vendedor1", vendedor1, "PATCH", `/api/sales/${saleId}/cancel`),
      call(ctx, "vendedor2", vendedor2, "POST", `/api/sales/${saleId}/return`),
    ]);
    const after = await observe(lab.db, [product.id]);
    const sale = after.sales.find((s) => s.id === saleId);
    const judgement = judgeCancelVsReturn({
      cancelStatus: cancel.status,
      returnStatus: returned.status,
      errors: [cancel.ok ? undefined : describeError(cancel), returned.ok ? undefined : describeError(returned)],
      reversalMovements: after.movements.filter((m) => m.sale_id === saleId && (REVERSAL_TYPES as readonly string[]).includes(m.type)).length,
      lines: 1,
      initialStock,
      quantity,
      stock: stockOf(after, product.id),
      saleStatus: sale?.status ?? null,
      paid,
      activePayments: activePayments(after),
      paidVes: sale?.paid_ves ?? 0,
    });
    // Dinero (G3): si la venta quedó revertida con el pago vivo, ¿se puede anular el pago después?
    const money: JsonRecord = { sale_status: sale?.status ?? null, paid_ves: sale?.paid_ves ?? null, payments: after.payments };
    const livePayment = after.payments.find((p) => p.status === "activo");
    if (paid && livePayment && sale && sale.status !== "pagada") {
      const contador = await session(lab, "contador");
      const voided = await call(ctx, "contador", contador, "PATCH", `/api/payments/${livePayment.id}/cancel`);
      const final = await observe(lab.db, [product.id]);
      money.cancel_payment_after = { status: voided.status, error: voided.ok ? null : describeError(voided) };
      money.final_payments = final.payments;
      money.final_paid_ves = final.sales.find((s) => s.id === saleId)?.paid_ves ?? null;
    }
    return { judgement, actual: { paid, money, before, after }, evidence: [`product:${product.id}`, `sale:${saleId}`] };
  };
}

// ------------------------------------------------------------------- 9.5

async function overAdjust(ctx: AttemptContext): Promise<VariantOutcome> {
  const { lab } = ctx;
  const [product] = await seed(ctx, 1, { stock: 4 });
  if (!product) throw new Error("seed vacío");
  const before = await observe(lab.db, [product.id]);
  const admin = await session(lab, "admin");
  const res = await call(ctx, "admin", admin, "POST", "/api/inventory/adjustments", {
    productId: product.id,
    quantityDelta: -(product.stock + 3),
    type: "ajuste_salida",
    reason: `Lab ${SKU_PREFIX} 9.5: salida mayor al stock`,
  });
  const after = await observe(lab.db, [product.id]);
  const judgement = judgeRejection({
    status: res.status,
    error: res.ok ? undefined : describeError(res),
    expectedStatuses: [400, 409],
    newMovements: after.movements.length - before.movements.length,
    stockDelta: stockOf(after, product.id) - product.stock,
    what: `Ajuste de −${product.stock + 3} con stock ${product.stock}`,
  });
  return { judgement, actual: { before, after }, evidence: [`product:${product.id}`] };
}

// ------------------------------------------------------------------- 9.6

async function linkPack(lab: Lab, packId: string, unitId: string, unitsPerPack: number): Promise<void> {
  await lab.db.query(
    "insert into public.product_pack_conversions (store_id, pack_product_id, unit_product_id, units_per_pack, is_active) values ($1, $2, $3, $4, true)",
    [lab.storeId, packId, unitId, unitsPerPack],
  );
}

type ConversionSetup = { pack: SeededProduct; unit: SeededProduct };

async function conversionSetup(ctx: AttemptContext, unitsPerPack: number): Promise<ConversionSetup> {
  const [pack] = await seed(ctx, 1, { stock: 20, price: 12 }, "-pk");
  const [unit] = await seed(ctx, 1, { stock: 0, price: 1 }, "-un");
  if (!pack || !unit) throw new Error("seed vacío");
  await linkPack(ctx.lab, pack.id, unit.id, unitsPerPack);
  return { pack, unit };
}

function conversionObservation(
  res: ApiResponse,
  after: Observation,
  setup: ConversionSetup,
  packQuantity: number,
  candidates: number[],
): ConversionObservation {
  const data = res.body?.data as JsonRecord | undefined;
  const conv = after.movements.filter((m) => m.conversion_id !== null);
  const sum = (productId: string) => conv.filter((m) => m.product_id === productId).reduce((acc, m) => acc + m.quantity_delta, 0);
  return {
    status: res.status,
    error: res.ok ? undefined : describeError(res),
    responseUnitsPerPack: typeof data?.unitsPerPack === "number" ? data.unitsPerPack : null,
    packQuantity,
    candidates,
    conversionMovements: conv.length,
    packMovementDelta: sum(setup.pack.id),
    unitMovementDelta: sum(setup.unit.id),
    packStockDelta: stockOf(after, setup.pack.id) - setup.pack.stock,
    unitStockDelta: stockOf(after, setup.unit.id) - setup.unit.stock,
  };
}

/** Deja `units_per_pack` en el valor que usó la conversión para que `conversion_mismatches` compare contra él (evita el falso positivo G14). */
async function settleUnitsPerPack(lab: Lab, packId: string, obs: ConversionObservation): Promise<number | null> {
  const used = obs.packQuantity > 0 ? obs.unitMovementDelta / obs.packQuantity : Number.NaN;
  if (!Number.isInteger(used) || used <= 1) return null;
  await lab.db.query("update public.product_pack_conversions set units_per_pack = $2 where pack_product_id = $1", [packId, used]);
  return used;
}

const CONVERSION_OFFSETS_MS = [0, 3, 8, 15, 30];

function conversionRace(attemptOf: (ctx: AttemptContext) => number) {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const [oldValue, newValue, packQuantity] = [12, 24, 2];
    const setup = await conversionSetup(ctx, oldValue);
    const ids = [setup.pack.id, setup.unit.id];
    const before = await observe(lab.db, ids);
    const almacen = await session(lab, "almacen");
    const attempt = attemptOf(ctx);
    const offset = CONVERSION_OFFSETS_MS[Math.floor(attempt / 2) % CONVERSION_OFFSETS_MS.length] ?? 0;
    const sqlFirst = attempt % 2 === 0;
    const writer = await extraDb(lab);
    try {
      const update = sleep(sqlFirst ? 0 : offset).then(() =>
        writer.query("update public.product_pack_conversions set units_per_pack = $2 where pack_product_id = $1", [setup.pack.id, newValue]),
      );
      const http = sleep(sqlFirst ? offset : 0).then(() =>
        call(ctx, "almacen", almacen, "POST", "/api/inventory/conversions", {
          packProductId: setup.pack.id,
          packQuantity,
          reason: `Lab ${SKU_PREFIX} 9.6`,
        }),
      );
      const [res] = await Promise.all([http, update]);
      const after = await observe(lab.db, ids);
      const observation = conversionObservation(res, after, setup, packQuantity, [oldValue, newValue]);
      const settled = await settleUnitsPerPack(lab, setup.pack.id, observation);
      return {
        judgement: judgeConversion(observation),
        actual: { timing: { sql_first: sqlFirst, offset_ms: offset }, observation, units_per_pack_settled_to: settled, before, after },
        evidence: [`pack:${setup.pack.id}`, `unit:${setup.unit.id}`],
      };
    } finally {
      await releaseDb(lab, writer);
    }
  };
}

/**
 * Determinista: otra sesión bloquea el producto empaque; la RPC lee el enlace
 * (12) y queda esperando; mientras, se cambia `units_per_pack` a 24; al soltar
 * el lock la RPC termina. El par debe salir con UN valor.
 */
async function conversionBetweenReadAndWrite(ctx: AttemptContext): Promise<VariantOutcome> {
  const { lab } = ctx;
  const [oldValue, newValue, packQuantity] = [12, 24, 2];
  const setup = await conversionSetup(ctx, oldValue);
  const ids = [setup.pack.id, setup.unit.id];
  const before = await observe(lab.db, ids);
  const almacen = await session(lab, "almacen");
  const locker = await extraDb(lab);
  const writer = await extraDb(lab);
  try {
    await locker.query("begin");
    await locker.query("select id from public.products where id = $1 for update", [setup.pack.id]);
    let lockHeld = true;
    try {
      const http = call(ctx, "almacen", almacen, "POST", "/api/inventory/conversions", {
        packProductId: setup.pack.id,
        packQuantity,
        reason: `Lab ${SKU_PREFIX} 9.6 lock`,
      });
      await sleep(500);
      let updateDone = false;
      const update = writer
        .query("update public.product_pack_conversions set units_per_pack = $2 where pack_product_id = $1", [setup.pack.id, newValue])
        .then(() => {
          updateDone = true;
        });
      await sleep(500);
      const updateBlockedByRpc = !updateDone;
      await locker.query("commit");
      lockHeld = false;
      const res = await http;
      await update;
      const after = await observe(lab.db, ids);
      const observation = conversionObservation(res, after, setup, packQuantity, [oldValue, newValue]);
      const used = observation.packQuantity > 0 ? observation.unitMovementDelta / observation.packQuantity : null;
      const settled = await settleUnitsPerPack(lab, setup.pack.id, observation);
      let judgement = judgeConversion(observation);
      if (judgement.verdict === "pass") {
        judgement = {
          verdict: "pass",
          detail: `${judgement.detail} La RPC ${updateBlockedByRpc ? "bloqueó el enlace: el UPDATE concurrente esperó a que terminara" : "NO bloquea el enlace: el UPDATE concurrente entró mientras esperaba, y aun así usó el valor leído"}.`,
        };
      }
      return {
        judgement,
        actual: {
          method: "lock de fila sobre el producto empaque desde otra sesión pg; UPDATE de units_per_pack mientras la RPC espera",
          update_blocked_by_rpc: updateBlockedByRpc,
          used_units_per_pack: used,
          observation,
          units_per_pack_settled_to: settled,
          before,
          after,
        },
        evidence: [`pack:${setup.pack.id}`, `unit:${setup.unit.id}`],
      };
    } finally {
      if (lockHeld) await locker.query("rollback").catch(() => undefined);
    }
  } finally {
    await releaseDb(lab, locker);
    await releaseDb(lab, writer);
  }
}

// ------------------------------------------------------------------- 9.7

type CorruptAction = "sell" | "adjust" | "purchase" | "cancel_sale" | "return_sale" | "cancel_purchase" | "return_purchase";

async function moveProduct(lab: Lab, productId: string, storeId: string): Promise<void> {
  await lab.db.query("update public.products set store_id = $2 where id = $1", [productId, storeId]);
}

function corruptStore(action: CorruptAction) {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const [product] = await seed(ctx, 1, { stock: 10 });
    if (!product) throw new Error("seed vacío");
    const rate = await currentRate(lab);
    const vendedor = await session(lab, "vendedor1");
    const admin = await session(lab, "admin");
    let documentId: string | null = null;

    // Documento previo (con el producto todavía en la tienda lab).
    if (action === "cancel_sale" || action === "return_sale") {
      const sale = await call(ctx, "vendedor1", vendedor, "POST", "/api/sales", saleBody(lab.customerId, rate, [line(product, 2)]));
      documentId = responseId(sale);
      if (!sale.ok || !documentId) throw new Error(`No se pudo crear la venta previa: ${sale.status} ${describeError(sale)}`);
    } else if (action === "cancel_purchase" || action === "return_purchase") {
      const purchase = await call(
        ctx,
        "admin",
        admin,
        "POST",
        "/api/purchases",
        purchaseBody(lab.supplierId, rate, [{ productId: product.id, quantity: 3, cost: 0.5 }], "recibido", `Lab ${SKU_PREFIX} 9.7`),
      );
      documentId = responseId(purchase);
      if (!purchase.ok || !documentId) throw new Error(`No se pudo crear la compra previa: ${purchase.status} ${describeError(purchase)}`);
    }

    const before = await observe(lab.db, [product.id]);
    const stockBefore = stockOf(before, product.id);
    await moveProduct(lab, product.id, DEFAULT_STORE_ID);
    let res: ApiResponse;
    let during: Observation;
    try {
      if (action === "sell") {
        res = await call(ctx, "vendedor1", vendedor, "POST", "/api/sales", saleBody(lab.customerId, rate, [line(product, 1)], { key: randomUUID(), paid: true }));
      } else if (action === "adjust") {
        res = await call(ctx, "admin", admin, "POST", "/api/inventory/adjustments", {
          productId: product.id,
          quantityDelta: 3,
          type: "ajuste_entrada",
          reason: `Lab ${SKU_PREFIX} 9.7`,
        });
      } else if (action === "purchase") {
        res = await call(
          ctx,
          "admin",
          admin,
          "POST",
          "/api/purchases",
          purchaseBody(lab.supplierId, rate, [{ productId: product.id, quantity: 3, cost: 0.5 }], "recibido", `Lab ${SKU_PREFIX} 9.7`),
        );
      } else if (action === "cancel_sale") {
        res = await call(ctx, "vendedor1", vendedor, "PATCH", `/api/sales/${documentId}/cancel`);
      } else if (action === "return_sale") {
        res = await call(ctx, "vendedor1", vendedor, "POST", `/api/sales/${documentId}/return`);
      } else if (action === "cancel_purchase") {
        res = await call(ctx, "admin", admin, "PATCH", `/api/purchases/${documentId}/cancel`);
      } else {
        res = await call(ctx, "admin", admin, "POST", `/api/purchases/${documentId}/return`);
      }
      during = await observe(lab.db, [product.id]);
    } finally {
      await moveProduct(lab, product.id, lab.storeId);
    }
    const restored = await observe(lab.db, [product.id]);
    const judgement = judgeRejection({
      status: res.status,
      error: res.ok ? undefined : describeError(res),
      expectedStatuses: [400, 403, 404, 409],
      newMovements: during.movements.length - before.movements.length,
      stockDelta: stockOf(during, product.id) - stockBefore,
      what: `${action} con el producto movido por SQL a la tienda default`,
    });
    return {
      judgement,
      actual: {
        corruption: `update products set store_id = '${DEFAULT_STORE_ID}' (restaurado a la tienda lab al terminar)`,
        document_id: documentId,
        document_after: action.endsWith("sale") ? during.sales : action.includes("purchase") ? during.purchases : null,
        before,
        during,
        restored_store_id: restored.products[0]?.store_id ?? null,
      },
      evidence: [`product:${product.id}`, ...(documentId ? [`document:${documentId}`] : [])],
    };
  };
}

// ------------------------------------------------------------------- 9.8

const ABORT_AFTER_MS = 700;
const RELEASE_LOCK_AFTER_MS = 1500;
const COMMIT_WAIT_MS = 8000;

/**
 * La transacción se confirma y el cliente NO recibe respuesta: otra sesión pg
 * retiene la fila del producto (`select … for update`), el cliente aborta su
 * petición a los 700 ms (AbortSignal.timeout) y a los 1,5 s se suelta el lock:
 * la RPC, que seguía viva en el servidor, confirma la venta.
 */
function abortedThenRetry(mode: "same_key" | "new_key") {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const quantity = 1;
    const [product] = await seed(ctx, 1, { stock: 20 });
    if (!product) throw new Error("seed vacío");
    const rate = await currentRate(lab);
    const vendedor = await session(lab, "vendedor1");
    const key = randomUUID();
    const body = saleBody(lab.customerId, rate, [line(product, quantity)], { key, paid: true });
    const before = await observe(lab.db, [product.id]);
    const locker = await extraDb(lab);
    let committedId: string | null = null;
    let waitedMs = 0;
    try {
      await locker.query("begin");
      await locker.query("select id from public.products where id = $1 for update", [product.id]);
      const started = performance.now();
      const first = await call(ctx, "vendedor1", vendedor, "POST", "/api/sales", body, { timeoutMs: ABORT_AFTER_MS });
      if (first.status !== 0) {
        await locker.query("rollback");
        throw new Error(`La petición debía quedar sin respuesta y devolvió ${first.status}: el lock no la retuvo.`);
      }
      await sleep(RELEASE_LOCK_AFTER_MS - (performance.now() - started));
      await locker.query("commit");
      const releasedAt = performance.now();
      while (performance.now() - releasedAt < COMMIT_WAIT_MS) {
        const found = await lab.db.query<{ id: string }>("select id from public.sales where client_request_id = $1", [key]);
        if (found.rows[0]) {
          committedId = found.rows[0].id;
          break;
        }
        await sleep(100);
      }
      waitedMs = Math.round(performance.now() - releasedAt);
    } finally {
      await releaseDb(lab, locker);
    }
    const afterCommit = await observe(lab.db, [product.id]);
    let retryStatus = 0;
    let retryId: string | null = null;
    let retryError: string | undefined;
    if (committedId) {
      const retryBody = mode === "same_key" ? body : { ...body, clientRequestId: randomUUID() };
      const retry = await call(ctx, "vendedor1", vendedor, "POST", "/api/sales", retryBody);
      retryStatus = retry.status;
      retryId = responseId(retry);
      retryError = retry.ok ? undefined : describeError(retry);
    }
    const after = await observe(lab.db, [product.id]);
    const judgement = judgeAbortRetry({
      mode,
      committedWithoutResponse: committedId !== null,
      originalId: committedId,
      retryStatus,
      retryId,
      retryError,
      sales: after.sales.length,
      saleMovements: countMovements(after, product.id, ["venta"]),
      activePayments: activePayments(after),
      stockDelta: stockOf(after, product.id) - product.stock,
      quantity,
    });
    return {
      judgement,
      actual: {
        method: `lock de fila (select … for update) desde otra sesión pg + AbortSignal.timeout(${ABORT_AFTER_MS}) en el cliente; lock soltado a los ${RELEASE_LOCK_AFTER_MS} ms`,
        committed_sale_id: committedId,
        commit_seen_after_release_ms: waitedMs,
        retry: { mode, status: retryStatus, id: retryId, error: retryError ?? null },
        before,
        after_commit_without_response: afterCommit,
        after,
      },
      evidence: [`product:${product.id}`, `clientRequestId:${key}`, ...after.sales.map((s) => `sale:${s.id}`)],
    };
  };
}

// ------------------------------------------------------------------- 9.9

function forbiddenAdjust(path: "bff" | "rpc_direct" | "table_update_direct") {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const [product] = await seed(ctx, 1, { stock: 10 });
    if (!product) throw new Error("seed vacío");
    const before = await observe(lab.db, [product.id]);
    let status: number;
    let error: string | undefined;
    let responseBody: unknown = null;
    if (path === "bff") {
      const vendedor = await session(lab, "vendedor1");
      const res = await call(ctx, "vendedor1", vendedor, "POST", "/api/inventory/adjustments", {
        productId: product.id,
        quantityDelta: 5,
        type: "ajuste_entrada",
        reason: `Lab ${SKU_PREFIX} 9.9: ajuste desde vendedor`,
      });
      status = res.status;
      error = res.ok ? undefined : describeError(res);
    } else if (path === "rpc_direct") {
      const res = await postgrest(ctx, "vendedor1", "POST", "/rpc/adjust_stock", {
        p_product_id: product.id,
        p_quantity_delta: 5,
        p_reason: `Lab ${SKU_PREFIX} 9.9: RPC directa como vendedor`,
        p_type: "ajuste_entrada",
      });
      ({ status, error } = res);
      responseBody = res.body;
    } else {
      const res = await postgrest(ctx, "vendedor1", "PATCH", `/products?id=eq.${product.id}`, { current_stock: 999 });
      ({ status, error } = res);
      responseBody = res.body;
    }
    const after = await observe(lab.db, [product.id]);
    const labels = {
      bff: "POST /api/inventory/adjustments como vendedor",
      rpc_direct: "RPC adjust_stock directa por PostgREST como vendedor",
      table_update_direct: "UPDATE directo de products.current_stock por PostgREST como vendedor",
    } as const;
    const judgement = judgeRejection({
      status,
      error,
      expectedStatuses: path === "bff" ? [403] : [401, 403],
      newMovements: after.movements.length - before.movements.length,
      stockDelta: stockOf(after, product.id) - product.stock,
      allow2xxWithoutEffect: path === "table_update_direct",
      what: labels[path],
    });
    return { judgement, actual: { path, response: responseBody, before, after }, evidence: [`product:${product.id}`] };
  };
}

// ------------------------------------------------------------------ 9.10

export const REVERSE_ORDER_LINES = 30;

async function reverseOrderSales(ctx: AttemptContext): Promise<VariantOutcome> {
  const { lab } = ctx;
  const initialStock = 50;
  const products = await seed(ctx, REVERSE_ORDER_LINES, { stock: initialStock });
  const ids = products.map((p) => p.id);
  const rate = await currentRate(lab);
  const vendedor1 = await session(lab, "vendedor1");
  const vendedor2 = await session(lab, "vendedor2");
  const forward = saleBody(lab.customerId, rate, products.map((p) => line(p, 1)), { key: randomUUID(), paid: true });
  const backward = saleBody(lab.customerId, rate, [...products].reverse().map((p) => line(p, 1)), { key: randomUUID(), paid: true });
  const from = ctx.steps.length;
  await Promise.all([
    call(ctx, "vendedor1", vendedor1, "POST", "/api/sales", forward),
    call(ctx, "vendedor2", vendedor2, "POST", "/api/sales", backward),
  ]);
  const after = await observe(lab.db, ids);
  const statuses = ctx.steps.slice(from).map((s) => s.status);
  const errors = errorsOf(ctx, from);
  const judgement = judgeReverseOrder({
    statuses,
    errors,
    lines: REVERSE_ORDER_LINES,
    stockDeltas: ids.map((id) => stockOf(after, id) - initialStock),
    sales: after.sales.length,
    saleMovements: after.movements.filter((m) => m.type === "venta").length,
    activePayments: activePayments(after),
  });
  return {
    judgement,
    actual: {
      lines: REVERSE_ORDER_LINES,
      deadlocks: errors.filter((e, i) => !is2xx(statuses[i] ?? 0) && isDeadlock(e)).length,
      sales: after.sales,
      payments: after.payments,
      sale_movements: after.movements.filter((m) => m.type === "venta").length,
      stock_after: after.products.map((p) => ({ sku: p.sku, current_stock: p.current_stock })),
    },
    evidence: [`products:${products[0]?.sku ?? ""}…${products[products.length - 1]?.sku ?? ""}`, ...after.sales.map((s) => `sale:${s.id}`)],
  };
}

// ------------------------------------------------------------------ 9.11

function deactivatedProduct(action: "pay" | "cancel") {
  return async (ctx: AttemptContext): Promise<VariantOutcome> => {
    const { lab } = ctx;
    const initialStock = 10;
    const quantity = 2;
    const [product] = await seed(ctx, 1, { stock: initialStock });
    if (!product) throw new Error("seed vacío");
    const rate = await currentRate(lab);
    const vendedor = await session(lab, "vendedor1");
    const admin = await session(lab, "admin");
    const sale = await call(ctx, "vendedor1", vendedor, "POST", "/api/sales", saleBody(lab.customerId, rate, [line(product, quantity)]));
    const saleId = responseId(sale);
    if (!sale.ok || !saleId) throw new Error(`No se pudo crear la venta pendiente: ${sale.status} ${describeError(sale)}`);
    const deactivated = await call(ctx, "admin", admin, "PATCH", `/api/products/${product.id}`, { isActive: false });
    const before = await observe(lab.db, [product.id]);
    if (!deactivated.ok || before.products[0]?.is_active !== false) {
      throw new Error(`No se pudo desactivar el producto: ${deactivated.status} ${describeError(deactivated)}`);
    }
    const res =
      action === "pay"
        ? await call(ctx, "vendedor1", vendedor, "POST", "/api/payments", {
            saleId,
            method: "efectivo_usd",
            currency: "USD",
            amount: round2(product.price * quantity),
          })
        : await call(ctx, "vendedor1", vendedor, "PATCH", `/api/sales/${saleId}/cancel`);
    const after = await observe(lab.db, [product.id]);
    const judgement = judgeDeactivatedSale({
      action,
      status: res.status,
      error: res.ok ? undefined : describeError(res),
      saleStatus: after.sales.find((s) => s.id === saleId)?.status ?? null,
      initialStock,
      quantity,
      stock: stockOf(after, product.id),
      reversalMovements: after.movements.filter((m) => m.sale_id === saleId && (REVERSAL_TYPES as readonly string[]).includes(m.type)).length,
      activePayments: activePayments(after),
    });
    return { judgement, actual: { action, before, after }, evidence: [`product:${product.id}`, `sale:${saleId}`] };
  };
}

// ------------------------------------------------------------------ 9.12

async function softDeletedCategory(ctx: AttemptContext): Promise<VariantOutcome> {
  const { lab } = ctx;
  const quantity = 1;
  const admin = await session(lab, "admin");
  const category = await call(ctx, "admin", admin, "POST", "/api/categories", {
    name: `${SKU_PREFIX} ${lab.runId} ${lab.nonce} ${ctx.tag}`,
    description: "Categoría de caos 9.12",
    taxRate: 0,
  });
  const categoryId = responseId(category);
  if (!category.ok || !categoryId) throw new Error(`No se pudo crear la categoría: ${category.status} ${describeError(category)}`);
  const [product] = await seed(ctx, 1, { stock: 10, categoryId });
  if (!product) throw new Error("seed vacío");
  const removed = await call(ctx, "admin", admin, "DELETE", `/api/categories/${categoryId}`);
  const categoryRow = await lab.db.query<{ is_active: boolean }>("select is_active from public.categories where id = $1", [categoryId]);
  const before = await observe(lab.db, [product.id]);
  const rate = await currentRate(lab);
  const vendedor = await session(lab, "vendedor1");
  const sale = await call(ctx, "vendedor1", vendedor, "POST", "/api/sales", saleBody(lab.customerId, rate, [line(product, quantity)], { key: randomUUID(), paid: true }));
  const after = await observe(lab.db, [product.id]);
  const judgement = judgeSoftCategory({
    deleteStatus: removed.status,
    saleHttpStatus: sale.status,
    error: sale.ok ? undefined : describeError(sale),
    sales: after.sales.length,
    saleMovements: countMovements(after, product.id, ["venta"]),
    stockDelta: stockOf(after, product.id) - product.stock,
    quantity,
  });
  return {
    judgement,
    actual: {
      category_id: categoryId,
      delete_category: { status: removed.status, error: removed.ok ? null : describeError(removed) },
      category_is_active_after_delete: categoryRow.rows[0]?.is_active ?? null,
      product_category_id_after_delete: before.products[0]?.category_id ?? null,
      before,
      after,
    },
    evidence: [`product:${product.id}`, `category:${categoryId}`, ...after.sales.map((s) => `sale:${s.id}`)],
  };
}

// ---------------------------------------------------------------------------
// Catálogo de variantes
// ---------------------------------------------------------------------------

const attemptIndex = new WeakMap<AttemptContext, number>();
const RACE_REPEAT = 10;

function variant(
  id: string,
  title: string,
  hypothesis: string[],
  expected: JsonRecord,
  run: VariantDef["run"],
  options: { repeat?: number; repeatable?: boolean; ignoreViews?: IntegrityViewName[] } = {},
): VariantDef {
  return {
    id,
    title,
    hypothesis,
    expected,
    defaultRepeat: options.repeat ?? 1,
    repeatable: options.repeatable ?? (options.repeat ?? 1) > 1,
    ignoreViews: options.ignoreViews,
    run,
  };
}

const race = { repeat: RACE_REPEAT };

export const VARIANTS: VariantDef[] = [
  variant("9.1.same_key_x2", "Mismo body con el mismo clientRequestId ×2 en paralelo", ["G15"], { sales: 1, sale_movements: 1, payments: 1, responses: "ambas 2xx con el mismo id" }, duplicateSale(2, true), race),
  variant("9.1.no_key_x2", "Mismo body SIN clientRequestId ni payments ×2 en paralelo (create_sale)", ["G5"], { sales: 1, sale_movements: 1 }, duplicateSale(2, false), race),
  variant("9.1.no_key_gap50", "Mismo body SIN clientRequestId ni payments ×2 separados 50 ms (create_sale)", ["G5"], { sales: 1, sale_movements: 1 }, duplicateSale(2, false, 50), race),
  variant("9.1.same_key_x5", "Mismo body con el mismo clientRequestId ×5 en paralelo", ["G15"], { sales: 1, sale_movements: 1, payments: 1, responses: "las 5 2xx con el mismo id" }, duplicateSale(5, true), race),
  variant("9.2.x2", "receive ×2 en paralelo (admin y almacén, sesiones distintas)", [], { purchase_movements: 1, stock_delta: 7, responses: "una 2xx y una 409/400" }, parallelReceive(2), race),
  variant("9.2.x5", "receive ×5 en paralelo (5 sesiones distintas)", [], { purchase_movements: 1, stock_delta: 7, responses: "una 2xx y cuatro 409/400" }, parallelReceive(5), race),
  variant("9.3.two_sellers", "lab-vendedor-1 y -2 venden a la vez cantidad = stock", [], { sales: 1, stock: 0, never_negative: true, loser: "4xx sin venta, movimiento ni pago" }, stockRace(2), race),
  variant("9.3.five_requests", "5 peticiones repartidas entre los dos vendedores, cantidad = stock", [], { sales: 1, stock: 0, never_negative: true, losers: "4xx sin venta, movimiento ni pago" }, stockRace(5), race),
  variant("9.4.unpaid", "cancel (vendedor-1) vs return (vendedor-2) sobre una venta sin pagar", [], { reversal_movements: 1, stock: "vuelve al inicial", loser: "4xx" }, cancelVsReturn(false), race),
  variant("9.4.paid", "cancel (vendedor-1) vs return (vendedor-2) sobre una venta pagada", ["G3"], { reversal_movements: "0 o 1", money: "sin pago activo sobre una venta revertida" }, cancelVsReturn(true), race),
  variant("9.5", "Ajuste de salida mayor al stock", [], { status: "400/409", new_movements: 0, stock_delta: 0 }, overAdjust),
  variant("9.6.race", "UPDATE de units_per_pack 12→24 por SQL concurrente con POST /api/inventory/conversions", ["G14"], { conversion_movements: 2, unit_delta: "pack_quantity × un solo valor (12 o 24)" }, conversionRace((ctx) => attemptIndex.get(ctx) ?? 0), race),
  variant("9.6.between_read_write", "units_per_pack cambiado mientras la RPC espera el lock del empaque (entre lectura y escritura)", ["G14"], { conversion_movements: 2, unit_delta: "pack_quantity × el valor leído en la transacción" }, conversionBetweenReadAndWrite, { repeat: 1, repeatable: true }),
  variant("9.7.sell", "Producto movido a la tienda default: vender", ["H3"], { status: "4xx con mensaje claro", new_movements: 0, stock_delta: 0 }, corruptStore("sell")),
  variant("9.7.adjust", "Producto movido a la tienda default: ajustar", ["H3"], { status: "4xx con mensaje claro", new_movements: 0, stock_delta: 0 }, corruptStore("adjust")),
  variant("9.7.purchase", "Producto movido a la tienda default: comprar (recibido)", ["H3"], { status: "4xx con mensaje claro", new_movements: 0, stock_delta: 0 }, corruptStore("purchase")),
  variant("9.7.cancel_sale", "Venta previa; producto movido a la tienda default: cancelar la venta", ["H3", "G6"], { status: "4xx con mensaje claro", new_movements: 0, stock_delta: 0 }, corruptStore("cancel_sale")),
  variant("9.7.return_sale", "Venta previa; producto movido a la tienda default: devolver la venta", ["H3", "G6"], { status: "4xx con mensaje claro", new_movements: 0, stock_delta: 0 }, corruptStore("return_sale")),
  variant("9.7.cancel_purchase", "Compra recibida previa; producto movido a la tienda default: cancelar la compra", ["H3", "G6"], { status: "4xx con mensaje claro", new_movements: 0, stock_delta: 0 }, corruptStore("cancel_purchase")),
  variant("9.7.return_purchase", "Compra recibida previa; producto movido a la tienda default: devolver la compra", ["H3", "G6"], { status: "4xx con mensaje claro", new_movements: 0, stock_delta: 0 }, corruptStore("return_purchase")),
  variant("9.8.same_key_retry", "Venta confirmada sin respuesta al cliente; reintento con el MISMO clientRequestId", [], { sales: 1, sale_movements: 1, retry: "2xx con el id de la venta original" }, abortedThenRetry("same_key"), { repeat: 1, repeatable: true }),
  variant("9.8.new_key_retry", "Venta confirmada sin respuesta al cliente; reintento a ciegas con clientRequestId NUEVO", ["G5"], { sales: 1, note: "una UI que reintenta a ciegas genera otra clave; se documenta el duplicado" }, abortedThenRetry("new_key"), { repeat: 1, repeatable: true }),
  variant("9.9.bff", "vendedor → POST /api/inventory/adjustments", [], { status: 403, new_movements: 0, stock_delta: 0 }, forbiddenAdjust("bff")),
  variant("9.9.rpc_direct", "vendedor → RPC adjust_stock directa por PostgREST (anon key + su JWT)", ["G2"], { status: "401/403", new_movements: 0, stock_delta: 0 }, forbiddenAdjust("rpc_direct")),
  variant("9.9.table_update_direct", "vendedor → UPDATE directo de products.current_stock por PostgREST", ["G1"], { rows_updated: 0, new_movements: 0, stock_delta: 0 }, forbiddenAdjust("table_update_direct")),
  variant("9.10", `Dos vendedores venden los mismos ${REVERSE_ORDER_LINES} productos en orden directo e inverso a la vez`, ["G7"], { deadlocks: 0, rollback: "ni venta ni movimientos parciales" }, reverseOrderSales, race),
  variant("9.11.pay", "Producto desactivado con venta pendiente_pago: pagarla", ["G12"], { status: "2xx", sale_status: "pagada", stock_delta: -2 }, deactivatedProduct("pay")),
  variant("9.11.cancel", "Producto desactivado con venta pendiente_pago: cancelarla", ["G12"], { status: "2xx", sale_status: "cancelada", stock_delta: 0 }, deactivatedProduct("cancel")),
  variant("9.12", "Categoría borrada (soft) con un producto: venderlo", [], { outcome: "venta 2xx con un movimiento, o 4xx sin movimiento" }, softDeletedCategory),
];

export function variantIds(): string[] {
  return VARIANTS.map((v) => v.id);
}

/** Repeticiones efectivas: `--repeat` solo multiplica las variantes repetibles. */
export function repeatsFor(v: Pick<VariantDef, "defaultRepeat" | "repeatable">, repeat: number | null): number {
  if (repeat === null || !v.repeatable) return v.defaultRepeat;
  return repeat;
}

// ---------------------------------------------------------------------------
// Ejecución de una variante
// ---------------------------------------------------------------------------

async function runAttempt(lab: Lab, def: VariantDef, attempt: number): Promise<AttemptResult> {
  const ctx: AttemptContext = { lab, tag: `${def.id}-${attempt + 1}`, steps: [], productIds: [] };
  attemptIndex.set(ctx, attempt);
  let judgement: Judgement;
  let actual: JsonRecord = {};
  let evidence: string[] = [];
  try {
    const outcome = await def.run(ctx);
    ({ judgement, actual, evidence } = outcome);
    const unanswered = ctx.steps.filter((s) => s.status === 0 && !s.aborted);
    if (unanswered.length > 0) {
      judgement = { verdict: "error", detail: `Sin respuesta del BFF en ${unanswered.length} petición(es): ${unanswered[0]?.error ?? ""}` };
    }
  } catch (error) {
    judgement = { verdict: "error", detail: `El caso no pudo ejecutarse: ${errorText(error)}` };
  }
  let scoped: ScopedIntegrity | null = null;
  try {
    scoped = await scopedIntegrity(lab.db, ctx.productIds);
    judgement = applyIntegrity(judgement, scoped, def.ignoreViews);
  } catch (error) {
    if (judgement.verdict !== "fail") judgement = { verdict: "error", detail: `${judgement.detail} No se pudo leer el oráculo: ${errorText(error)}`.trim() };
  }
  return { attempt: attempt + 1, verdict: judgement.verdict, detail: judgement.detail, steps: ctx.steps, actual, evidence, scoped };
}

/** Ejecuta las N repeticiones de una variante y arma su línea de resultado. */
export async function runVariant(lab: Lab, def: VariantDef, repeats: number): Promise<ChaosLine> {
  const attempts: AttemptResult[] = [];
  for (let i = 0; i < repeats; i += 1) attempts.push(await runAttempt(lab, def, i));
  const aggregate = aggregateAttempts(attempts);
  const sample = attempts[aggregate.sampleIndex] ?? attempts[0];
  let scoped: ScopedIntegrity | null = null;
  for (const attempt of attempts) if (attempt.scoped) scoped = addScoped(scoped ?? emptyScoped(), attempt.scoped);
  let global: IntegrityReport | null = null;
  try {
    global = await globalIntegrity(lab.db, lab.storeId);
  } catch {
    global = null;
  }
  const plan = PLAN_CASES[planCaseOf(def.id)];
  const samplePassed = sample?.verdict === "pass";
  return {
    ts: new Date().toISOString(),
    suite: "chaos",
    id: def.id,
    title: `${plan?.title ?? def.id} · ${def.title}`,
    severity: plan?.severity ?? "Media",
    hypothesis: def.hypothesis,
    steps: sample ? (samplePassed ? slimSteps(sample.steps) : sample.steps) : [],
    expected: { plan: plan?.expected ?? "", ...def.expected },
    actual: {
      attempts: aggregate.total,
      counts: aggregate.counts,
      not_passed: aggregate.total - aggregate.counts.pass,
      per_attempt: attempts.map((a) => ({
        attempt: a.attempt,
        verdict: a.verdict,
        detail: a.detail,
        statuses: a.steps.map((s) => s.status),
        chain_breaks_view: a.scoped?.stock_chain_breaks ?? null,
      })),
      sample_attempt: sample?.attempt ?? null,
      sample: sample?.actual ?? {},
    },
    reconcile_scoped: scoped,
    reconcile_global: global,
    verdict: aggregate.verdict,
    detail: aggregate.detail,
    evidence: sample?.evidence ?? [],
  };
}
