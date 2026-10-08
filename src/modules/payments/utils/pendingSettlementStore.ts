import { useMemo, useSyncExternalStore } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import type {
  PaymentFormCurrency,
  PaymentFormPayload,
  PaymentFormValues,
} from "@/shared/payments/PaymentFormFields";

/** Quién guardó el abono: la tienda (`null` para superadmin) y el usuario de la sesión. */
export type PendingSettlementSession = {
  storeId: string | null;
  userId: string;
};

/**
 * Un abono pendiente por sesión, contacto y tipo de documento. Sin sesión conocida
 * (`null`/`undefined`: el usuario aún no cargó) no se guarda ni se lee nada.
 */
export type PendingSettlementScope = {
  contactId: string;
  session: PendingSettlementSession | null | undefined;
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
  /** Ya se reintentó y siguió sin saberse si entró: se puede ofrecer descartarlo. */
  retriedUncertain?: boolean;
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

const KEY_PREFIX = "bodegahub:abono-pendiente:v2";
const ROW_STATUSES: readonly string[] = ["failed", "pending", "registered"];
const listeners = new Set<() => void>();

/**
 * Clave por tienda y usuario además de contacto y tipo: otro usuario (u otra tienda)
 * en la misma pestaña no ve ni reenvía el abono de otro. `null` sin sesión conocida.
 */
function storageKey({ contactId, session, type }: PendingSettlementScope) {
  if (!session) {
    return null;
  }

  return [
    KEY_PREFIX,
    encodeURIComponent(session.storeId ?? ""),
    encodeURIComponent(session.userId),
    type,
    contactId,
  ].join(":");
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

function isSameSession(value: unknown, session: PendingSettlementSession) {
  return isRecord(value) && value.storeId === session.storeId && value.userId === session.userId;
}

/**
 * Abono que quedó sin terminar para esta sesión, contacto y tipo, o `null`. Un valor
 * que no se puede leer, o que no guardó esta misma sesión, se descarta: nunca se
 * reenvía un pago a partir de datos corruptos ni de otro usuario.
 */
export function loadPendingSettlement(scope: PendingSettlementScope): PendingSettlement | null {
  const storage = getStorage();
  const key = storageKey(scope);
  const raw = key === null ? null : (storage?.getItem(key) ?? null);

  if (storage === null || key === null || raw === null || !scope.session) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      isRecord(parsed) &&
      isSameSession(parsed.session, scope.session) &&
      isPendingSettlement(parsed.settlement)
    ) {
      return parsed.settlement;
    }
  } catch {
    // JSON ilegible: se trata igual que un valor con forma inesperada.
  }

  storage.removeItem(key);
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
  const key = storageKey(scope);

  if (storage === null || key === null) {
    return false;
  }

  try {
    storage.setItem(key, JSON.stringify({ session: scope.session, settlement }));
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
  const key = storageKey(scope);

  if (storage === null || key === null || storage.getItem(key) === null) {
    return;
  }

  storage.removeItem(key);
  notify();
}

export function hasPendingSettlement(scope: PendingSettlementScope) {
  const key = storageKey(scope);

  return key !== null && (getStorage()?.getItem(key) ?? null) !== null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Sesión actual (tienda y usuario de `usePermission`) para el `session` del ámbito;
 * `null` mientras el usuario no ha cargado.
 */
export function usePendingSettlementSession(): PendingSettlementSession | null {
  const { profile } = usePermission();
  const storeId = profile?.storeId ?? null;
  const userId = profile?.user?.id;

  return useMemo(() => (userId ? { storeId, userId } : null), [storeId, userId]);
}

/**
 * `true` mientras haya un abono sin terminar guardado por esta sesión para el contacto
 * y el tipo. Quien monta `ContactSettlementModal` de forma condicional debe mantenerlo
 * montado mientras sea `true`: el modal es la única vía para confirmar ese abono.
 *
 * @example
 * const session = usePendingSettlementSession();
 * const hasPending = useHasPendingSettlement({ contactId, session, type: "sale" });
 */
export function useHasPendingSettlement({ contactId, session, type }: PendingSettlementScope) {
  return useSyncExternalStore(
    subscribe,
    () => hasPendingSettlement({ contactId, session, type }),
    () => false,
  );
}
