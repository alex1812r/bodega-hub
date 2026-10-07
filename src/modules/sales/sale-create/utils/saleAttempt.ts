import type { SaleCreateInput } from "@/modules/sales/hooks/useSales";
import { ClientApiError } from "@/shared/api/apiFetch";

/**
 * Intento de cobro del POS, persistido en `sessionStorage` por tienda/usuario/caja;
 * mientras su resultado no se conoce se publica ademas en `localStorage`, para que
 * abrir el POS en otra pestaña (o cerrar y reabrir) no estrene clave (STK-605).
 *
 * La clave de idempotencia NO puede vivir en memoria del componente: si la
 * respuesta del cobro se pierde tras el commit y el cajero recarga o sale y
 * vuelve, el mismo carrito viajaria con una clave nueva y quedarian dos ventas
 * identicas (C3). Solo se descarta cuando el servidor confirma que hay una venta
 * con esa clave, o cuando el carrito cambia tras un rechazo definitivo (4xx).
 */
export type SaleAttempt = {
  clientRequestId: string;
  /** Huella del carrito que el servidor rechazo con un 4xx definitivo. */
  rejected?: string;
  /** Huellas de los carritos enviados con esta clave sin rechazo definitivo. */
  sent: string[];
  /** Hay un envio cuyo resultado no se conoce (ni exito, ni rechazo, ni 404 por clave). */
  unresolved: boolean;
};

type SaleAttemptScope = {
  registerId?: string | null;
  storeId?: string | null;
  userId?: string | null;
};

const STORAGE_PREFIX = "pos:sale-attempt";

// Respaldo si `sessionStorage` no esta disponible (modo privado estricto): la
// clave sigue sobreviviendo a remontajes dentro de la misma carga de pagina.
const memoryFallback = new Map<string, string>();

export function saleAttemptStorageKey({ registerId, storeId, userId }: SaleAttemptScope) {
  return [STORAGE_PREFIX, storeId ?? "-", userId ?? "-", registerId ?? "-"].join(":");
}

function isSaleAttempt(value: unknown): value is SaleAttempt {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SaleAttempt>;

  return (
    typeof candidate.clientRequestId === "string" &&
    candidate.clientRequestId.length > 0 &&
    Array.isArray(candidate.sent) &&
    candidate.sent.every((entry) => typeof entry === "string") &&
    typeof candidate.unresolved === "boolean"
  );
}

/** Intento de ESTA pestaña (sessionStorage, o el respaldo en memoria). */
function readTabAttempt(storageKey: string): SaleAttempt | null {
  let raw: string | null | undefined;

  try {
    raw = window.sessionStorage.getItem(storageKey);
  } catch {
    // Solo si sessionStorage falla manda el respaldo; si responde, manda el.
    raw = memoryFallback.get(storageKey);
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isSaleAttempt(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeTabAttempt(storageKey: string, attempt: SaleAttempt) {
  const raw = JSON.stringify(attempt);

  try {
    window.sessionStorage.setItem(storageKey, raw);
    memoryFallback.delete(storageKey);
  } catch {
    memoryFallback.set(storageKey, raw);
  }
}

/**
 * Cobros ENVIADOS y sin confirmar de esta tienda/usuario/caja, en `localStorage`:
 * lo unico que comparten las pestañas. El carrito en edicion y los intentos ya
 * resueltos siguen siendo de cada pestaña. Sin `localStorage`, o con contenido
 * ilegible, no hay nada compartido y cada pestaña se comporta como antes.
 */
function readSharedUnresolved(storageKey: string): SaleAttempt[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is SaleAttempt => isSaleAttempt(entry) && entry.unresolved)
      : [];
  } catch {
    return [];
  }
}

/** Publica (`unresolved`) o retira (cualquier otro estado) un intento para las demas pestañas. */
function shareUnresolved(storageKey: string, clientRequestId: string, attempt: SaleAttempt | null) {
  const others = readSharedUnresolved(storageKey).filter(
    (entry) => entry.clientRequestId !== clientRequestId,
  );
  const next = attempt?.unresolved ? [...others, attempt] : others;

  try {
    if (next.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    }
  } catch {
    // Sin localStorage el intento queda solo en esta pestaña (comportamiento previo).
  }
}

export function readSaleAttempt(storageKey: string): SaleAttempt | null {
  const own = readTabAttempt(storageKey);
  if (own?.unresolved) {
    return own;
  }

  // Un cobro sin confirmar enviado desde OTRA pestaña (o desde una que se cerro) se
  // resuelve antes que nada: esta pestaña lo adopta y sigue el flujo de una recarga.
  const foreign = readSharedUnresolved(storageKey).find(
    (entry) => entry.clientRequestId !== own?.clientRequestId,
  );
  if (!foreign) {
    return own;
  }

  writeTabAttempt(storageKey, foreign);
  return foreign;
}

export function writeSaleAttempt(storageKey: string, attempt: SaleAttempt) {
  writeTabAttempt(storageKey, attempt);
  shareUnresolved(storageKey, attempt.clientRequestId, attempt);
}

export function clearSaleAttempt(storageKey: string) {
  const own = readTabAttempt(storageKey);
  memoryFallback.delete(storageKey);

  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Sin sessionStorage solo existia el respaldo en memoria, ya borrado.
  }

  if (own) {
    shareUnresolved(storageKey, own.clientRequestId, null);
  }
}

/** Huella del contenido del cobro: mismo carrito, cliente y pagos → misma huella. */
export function saleFingerprint(
  input: Pick<SaleCreateInput, "customerId" | "items" | "payments">,
) {
  return JSON.stringify({
    customerId: input.customerId,
    items: input.items
      .map((item) => [item.productId, item.quantity] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    payments: (input.payments ?? []).map((payment) => [
      payment.method,
      payment.currency ?? "",
      payment.amount,
      payment.change?.method ?? "",
      payment.change?.amount ?? 0,
    ]),
  });
}

/**
 * El servidor respondio que NO registro la venta y repetir la misma peticion no
 * cambia nada (400, 401, 403, 404, 422…). Quedan fuera, por ser de resultado
 * incierto: error de red, 5xx, 408 y 409 (puede ser un conflicto reintentable o
 * una clave que ya tiene venta: hay que consultar por clave).
 */
export function isDefinitiveRejection(error: unknown) {
  return (
    error instanceof ClientApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 409
  );
}
