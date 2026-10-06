/**
 * Delta de stock esperado por operación (STK-302). Función pura: los agentes
 * la llaman SOLO cuando la respuesta del API fue 2xx y guardan el resultado en
 * `expected_delta` del evento; `reconcile`/`summary` lo comparan después con
 * `stock_movements`.
 *
 * Reglas (según los RPC vigentes, ver .notes/stock-integrity-gtm/rpc-versions.md):
 * - sale_create: −q por línea. sale_cancel / sale_return: +q (devolución total).
 * - purchase_create `recibido`: +q (o +packCount×unitsPerPack si la línea va en
 *   modo empaque); `pedido`: {} (no mueve stock hasta recibir). Excepción C13
 *   (20261006c/f): si el producto ES el empaque de un par empaque→unidad, su
 *   stock se cuenta en empaques y entran `packCount` (línea `stockInPacks`).
 * - purchase_receive: +q (×upp) de las líneas de la compra.
 * - purchase_cancel / purchase_return sobre compra `recibido`: −q (×upp); sobre
 *   `pedido`: {}.
 * - adjustment: quantityDelta con signo.
 * - conversion: { pack: −packQuantity, unit: +packQuantity×unitsPerPack }.
 * - product_create: +initialStock (0 → {}).
 * - noop: {}.
 * Cuando un producto se repite en varias líneas, se suman los deltas.
 *
 * Idempotencia (STK-514): `POST /api/sales` exige `clientRequestId` y reenviar
 * la misma clave devuelve LA MISMA venta con 2xx. Ese segundo 2xx no descuenta
 * nada: `dedupeIdempotentReplays` deja su esperado en {} para que el run
 * cuente el descuento una sola vez.
 */
import type { LabEvent } from "./logger";

export type OpKind =
  | "sale_create"
  | "sale_cancel"
  | "sale_return"
  | "purchase_create"
  | "purchase_receive"
  | "purchase_cancel"
  | "purchase_return"
  | "adjustment"
  | "conversion"
  | "product_create"
  | "noop";

export type PurchaseStatus = "pedido" | "recibido";

/** Línea de venta: unidades vendidas/devueltas. */
export type SaleLine = { productId: string; quantity: number };

/**
 * Línea de compra. Modo unidad: `quantity`. Modo empaque: `packCount` ×
 * `unitsPerPack` (tiene prioridad si ambos vienen informados), salvo que el
 * producto sea el SKU EMPAQUE de un par (`stockInPacks`): ahí la RPC guarda la
 * línea como `packCount` unidades de stock (empaques), y eso es lo que mueven
 * crear, recibir, cancelar y devolver.
 */
export type PurchaseLine = {
  productId: string;
  quantity?: number;
  packCount?: number;
  unitsPerPack?: number;
  stockInPacks?: boolean;
};

export type ExpectedDeltaInputs = {
  sale_create: { items: SaleLine[] };
  sale_cancel: { items: SaleLine[] };
  sale_return: { items: SaleLine[] };
  purchase_create: { status: PurchaseStatus; items: PurchaseLine[] };
  purchase_receive: { items: PurchaseLine[] };
  purchase_cancel: { status: PurchaseStatus; items: PurchaseLine[] };
  purchase_return: { status: PurchaseStatus; items: PurchaseLine[] };
  adjustment: { productId: string; quantityDelta: number };
  conversion: {
    packProductId: string;
    unitProductId: string;
    packQuantity: number;
    unitsPerPack: number;
  };
  product_create: { productId: string; initialStock: number };
  noop: Record<string, never> | undefined;
};

/** Unión discriminada por `op` (útil para mixto/caos que guardan la op junto al input). */
export type ExpectedDeltaInput = {
  [K in OpKind]: { op: K; input: ExpectedDeltaInputs[K] };
}[OpKind];

function addDelta(acc: Record<string, number>, productId: string, delta: number): void {
  if (!productId || delta === 0 || !Number.isFinite(delta)) return;
  const next = (acc[productId] ?? 0) + delta;
  if (next === 0) {
    delete acc[productId];
  } else {
    acc[productId] = next;
  }
}

function purchaseLineUnits(line: PurchaseLine): number {
  if (line.packCount !== undefined && line.stockInPacks === true) {
    return line.packCount;
  }
  if (line.packCount !== undefined && line.unitsPerPack !== undefined) {
    return line.packCount * line.unitsPerPack;
  }
  return line.quantity ?? 0;
}

function sumSaleLines(items: SaleLine[], sign: 1 | -1): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const line of items) {
    addDelta(acc, line.productId, sign * line.quantity);
  }
  return acc;
}

function sumPurchaseLines(items: PurchaseLine[], sign: 1 | -1): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const line of items) {
    addDelta(acc, line.productId, sign * purchaseLineUnits(line));
  }
  return acc;
}

export function expectedDelta<K extends OpKind>(
  op: K,
  input: ExpectedDeltaInputs[K],
): Record<string, number> {
  switch (op) {
    case "sale_create":
      return sumSaleLines((input as ExpectedDeltaInputs["sale_create"]).items, -1);
    case "sale_cancel":
    case "sale_return":
      return sumSaleLines((input as ExpectedDeltaInputs["sale_cancel"]).items, 1);
    case "purchase_create": {
      const data = input as ExpectedDeltaInputs["purchase_create"];
      return data.status === "recibido" ? sumPurchaseLines(data.items, 1) : {};
    }
    case "purchase_receive":
      return sumPurchaseLines((input as ExpectedDeltaInputs["purchase_receive"]).items, 1);
    case "purchase_cancel":
    case "purchase_return": {
      const data = input as ExpectedDeltaInputs["purchase_cancel"];
      return data.status === "recibido" ? sumPurchaseLines(data.items, -1) : {};
    }
    case "adjustment": {
      const data = input as ExpectedDeltaInputs["adjustment"];
      const acc: Record<string, number> = {};
      addDelta(acc, data.productId, data.quantityDelta);
      return acc;
    }
    case "conversion": {
      const data = input as ExpectedDeltaInputs["conversion"];
      const acc: Record<string, number> = {};
      addDelta(acc, data.packProductId, -data.packQuantity);
      addDelta(acc, data.unitProductId, data.packQuantity * data.unitsPerPack);
      return acc;
    }
    case "product_create": {
      const data = input as ExpectedDeltaInputs["product_create"];
      const acc: Record<string, number> = {};
      addDelta(acc, data.productId, data.initialStock);
      return acc;
    }
    case "noop":
      return {};
    default: {
      const exhaustive: never = op;
      throw new Error(`expectedDelta: op desconocida ${String(exhaustive)}`);
    }
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status <= 299;
}

function requestKeyOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const key = (payload as { clientRequestId?: unknown }).clientRequestId;
  return typeof key === "string" && key.trim() ? key : null;
}

/**
 * Reintentos idempotentes: dos eventos 2xx con la misma `clientRequestId` y el
 * mismo `response_id` son UNA operación (el servidor devolvió el documento ya
 * creado). Devuelve los eventos en el mismo orden; las repeticiones salen con
 * `expected_delta: {}` (el primero conserva el suyo). No muta la entrada.
 *
 * Se exige la clave además del id a propósito: `sale_cancel`/`sale_return`
 * comparten `response_id` con su venta y sí mueven stock. Si la misma clave
 * devuelve ids distintos no se deduplica nada: ese doble descuento es el bug
 * que el run debe detectar.
 */
export function dedupeIdempotentReplays(events: readonly LabEvent[]): LabEvent[] {
  const seen = new Set<string>();
  return events.map((event) => {
    if (!isSuccess(event.status) || event.response_id === null) return event;
    const key = requestKeyOf(event.payload);
    if (key === null) return event;
    const id = `${key}|${event.response_id}`;
    if (!seen.has(id)) {
      seen.add(id);
      return event;
    }
    return { ...event, expected_delta: {} };
  });
}

/** Variante con la unión discriminada: `expectedDeltaFor({ op, input })`. */
export function expectedDeltaFor(entry: ExpectedDeltaInput): Record<string, number> {
  return expectedDelta(entry.op, entry.input as ExpectedDeltaInputs[typeof entry.op]);
}
