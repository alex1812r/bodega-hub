import type { SaleCreateInput } from "@/modules/sales/hooks/useSales";
import { ClientApiError } from "@/shared/api/apiFetch";

/**
 * Intento de cobro del POS, persistido en `sessionStorage` por tienda/usuario/caja.
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

export function readSaleAttempt(storageKey: string): SaleAttempt | null {
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

export function writeSaleAttempt(storageKey: string, attempt: SaleAttempt) {
  const raw = JSON.stringify(attempt);

  try {
    window.sessionStorage.setItem(storageKey, raw);
    memoryFallback.delete(storageKey);
  } catch {
    memoryFallback.set(storageKey, raw);
  }
}

export function clearSaleAttempt(storageKey: string) {
  memoryFallback.delete(storageKey);

  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Sin sessionStorage solo existia el respaldo en memoria, ya borrado.
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
