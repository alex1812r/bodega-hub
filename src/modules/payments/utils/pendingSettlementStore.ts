import { useSyncExternalStore } from "react";

import type {
  PaymentFormCurrency,
  PaymentFormPayload,
  PaymentFormValues,
} from "@/shared/payments/PaymentFormFields";

/** Un abono pendiente por contacto y tipo de documento. */
export type PendingSettlementScope = {
  contactId: string;
  type: "purchase" | "sale";
};

/** Lo que el modal necesita de un documento para volver a pintar y reenviar su pago. */
export type PendingSettlementDocument = {
  createdAt: string;
  id: string;
  number: string;
  pendingVes: number;
};

export type PendingSettlementRow = {
  allocation: {
    amount: number;
    appliedVes: number;
    document: PendingSettlementDocument;
    equivalent: number | null;
    remainingVes: number;
  };
  /** Clave de idempotencia con la que se envió (o se enviará) el pago de este documento. */
  clientRequestId: string;
  errorMessage?: string;
  status: "failed" | "pending" | "registered";
  /** El fallo no dice si el pago se registró: solo se puede reenviar con la misma clave. */
  uncertain?: boolean;
};

export type PendingSettlement = {
  currency: PaymentFormCurrency;
  /** Campos comunes a todos los pagos del abono, tal como se enviaron. */
  payload: PaymentFormPayload;
  rows: PendingSettlementRow[];
  /** Lo tecleado en el formulario, para poder volver a editar lo no registrado. */
  values: PaymentFormValues;
};

const KEY_PREFIX = "bodegahub:abono-pendiente:v1";
const ROW_STATUSES: readonly string[] = ["failed", "pending", "registered"];
const listeners = new Set<() => void>();

function storageKey({ contactId, type }: PendingSettlementScope) {
  return `${KEY_PREFIX}:${type}:${contactId}`;
}

/** `null` en el servidor y donde el navegador no deja usar `sessionStorage`. */
function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRow(value: unknown): value is PendingSettlementRow {
  if (!isRecord(value) || !isRecord(value.allocation) || !isRecord(value.allocation.document)) {
    return false;
  }

  const { allocation } = value;
  const document = allocation.document as Record<string, unknown>;

  return (
    typeof value.clientRequestId === "string" &&
    value.clientRequestId.length > 0 &&
    typeof value.status === "string" &&
    ROW_STATUSES.includes(value.status) &&
    typeof allocation.amount === "number" &&
    allocation.amount > 0 &&
    typeof allocation.appliedVes === "number" &&
    typeof allocation.remainingVes === "number" &&
    typeof document.id === "string" &&
    typeof document.number === "string" &&
    typeof document.createdAt === "string" &&
    typeof document.pendingVes === "number"
  );
}

function isPendingSettlement(value: unknown): value is PendingSettlement {
  return (
    isRecord(value) &&
    (value.currency === "USD" || value.currency === "VES") &&
    isRecord(value.payload) &&
    typeof value.payload.method === "string" &&
    isRecord(value.values) &&
    typeof value.values.method === "string" &&
    Array.isArray(value.rows) &&
    value.rows.length > 0 &&
    value.rows.every(isRow)
  );
}

/**
 * Abono que quedó sin terminar para este contacto y tipo, o `null`. Un valor que no
 * se puede leer se descarta: nunca se reenvía un pago a partir de datos corruptos.
 */
export function loadPendingSettlement(scope: PendingSettlementScope): PendingSettlement | null {
  const storage = getStorage();
  const raw = storage?.getItem(storageKey(scope)) ?? null;

  if (storage === null || raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (isPendingSettlement(parsed)) {
      return parsed;
    }
  } catch {
    // JSON ilegible: se trata igual que un valor con forma inesperada.
  }

  storage.removeItem(storageKey(scope));
  notify();

  return null;
}

/**
 * Guarda el abono sin terminar en `sessionStorage` (vive lo que la pestaña del
 * navegador: sobrevive a recargar y a navegar). Devuelve `false` si no se pudo guardar.
 */
export function savePendingSettlement(
  scope: PendingSettlementScope,
  settlement: PendingSettlement,
): boolean {
  const storage = getStorage();

  if (storage === null) {
    return false;
  }

  try {
    storage.setItem(storageKey(scope), JSON.stringify(settlement));
  } catch {
    // Cuota agotada o almacenamiento bloqueado: el abono sigue vivo solo en el modal.
    return false;
  }

  notify();

  return true;
}

/** Borra el abono guardado: ya se resolvió o el usuario lo descartó. */
export function clearPendingSettlement(scope: PendingSettlementScope) {
  const storage = getStorage();

  if (storage === null || storage.getItem(storageKey(scope)) === null) {
    return;
  }

  storage.removeItem(storageKey(scope));
  notify();
}

export function hasPendingSettlement(scope: PendingSettlementScope) {
  return (getStorage()?.getItem(storageKey(scope)) ?? null) !== null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * `true` mientras haya un abono sin terminar guardado para el contacto y el tipo.
 * Quien monta `ContactSettlementModal` de forma condicional debe mantenerlo montado
 * mientras sea `true`: el modal es la única vía para confirmar ese abono.
 */
export function useHasPendingSettlement({ contactId, type }: PendingSettlementScope) {
  return useSyncExternalStore(
    subscribe,
    () => hasPendingSettlement({ contactId, type }),
    () => false,
  );
}
