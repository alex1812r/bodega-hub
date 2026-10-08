"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { usePermission } from "@/shared/auth/usePermission";

import {
  isPurchaseDraftWorthSaving,
  parseStoredPurchaseDraft,
  purchaseDraftStorageKey,
  serializePurchaseDraft,
  type PurchaseDraftContent,
  type PurchaseDraftSession,
  type StoredPurchaseDraft,
} from "../utils/purchaseDraftStorage";

const listeners = new Set<() => void>();
/**
 * Clave -> visita a la pantalla que escribió (o decidió sobre) lo guardado. Un
 * borrador que la visita actual no ha tocado es el que se ofrece restaurar.
 */
const owners = new Map<string, symbol>();
// Última lectura: `useSyncExternalStore` necesita la misma referencia mientras no cambie el texto.
let lastRead: { draft: StoredPurchaseDraft | null; key: string; raw: string | null } | null = null;

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Otra pestaña guardó o borró el borrador.
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readStoredDraft(key: string | null, session: PurchaseDraftSession | null) {
  if (!key || !session) {
    return null;
  }

  let raw: string | null;

  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // `localStorage` bloqueado: no hay borrador que ofrecer.
    return null;
  }

  if (lastRead?.key !== key || lastRead.raw !== raw) {
    lastRead = { draft: parseStoredPurchaseDraft(raw, session), key, raw };
  }

  return lastRead.draft;
}

export type PurchaseDraftStorage = {
  /**
   * La visita se queda con el borrador pendiente (el usuario pulsó Restaurar):
   * deja de ofrecerse y `sync` vuelve a guardar.
   */
  adopt: () => void;
  /** Borra lo guardado (Descartar, o compra confirmada) y deja de ofrecerlo. */
  clear: () => void;
  /**
   * Borrador que guardó OTRA visita a la pantalla (o una pestaña anterior) y sobre
   * el que el usuario aún no ha decidido. `null` si no hay, si ya se restauró o
   * descartó, o si lo guardado lo escribió esta misma visita.
   */
  pending: StoredPurchaseDraft | null;
  /**
   * Guarda el estado actual del formulario. Llamar en cada cambio relevante.
   * - Con un borrador `pending` sin decidir NO escribe: no se pisa sin preguntar.
   * - Sin "algo que perder" (`isPurchaseDraftWorthSaving`) no escribe, y borra lo
   *   que esta misma visita hubiera guardado antes.
   * - Si `localStorage` no está disponible o está lleno, no hace nada.
   */
  sync: (content: PurchaseDraftContent) => void;
};

/**
 * Borrador local de la compra en curso (COM-09), en `localStorage` por tienda y
 * usuario (`purchaseDraftStorageKey`). Sin usuario cargado no lee ni escribe.
 *
 * Solo persiste: qué se guarda lo arma la página (`PurchaseDraftContent`) y cómo
 * vuelve al formulario lo resuelve `restorePurchaseDraft`.
 */
export function usePurchaseDraftStorage(): PurchaseDraftStorage {
  const { profile } = usePermission();
  const userId = profile?.user?.id ?? null;
  const storeId = profile?.storeId ?? null;
  const session = useMemo<PurchaseDraftSession | null>(
    () => (userId ? { storeId, userId } : null),
    [storeId, userId],
  );
  const key = session ? purchaseDraftStorageKey(session) : null;
  const [visit] = useState(() => Symbol("purchase-draft-visit"));
  const stored = useSyncExternalStore(
    subscribe,
    () => readStoredDraft(key, session),
    () => null,
  );
  const owned = useSyncExternalStore(
    subscribe,
    () => key !== null && owners.get(key) === visit,
    () => false,
  );

  // Al salir de la pantalla lo guardado deja de ser "de esta visita": la siguiente lo ofrece.
  useEffect(
    () => () => {
      if (key && owners.get(key) === visit) {
        owners.delete(key);
      }
    },
    [key, visit],
  );

  const adopt = useCallback(() => {
    if (!key) {
      return;
    }

    owners.set(key, visit);
    notify();
  }, [key, visit]);

  const clear = useCallback(() => {
    if (!key) {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch {
      // Sin `localStorage` no hay nada que borrar.
    }

    owners.set(key, visit);
    notify();
  }, [key, visit]);

  const sync = useCallback(
    (content: PurchaseDraftContent) => {
      if (!key || !session) {
        return;
      }

      const isOwner = owners.get(key) === visit;

      if (!isOwner && readStoredDraft(key, session)) {
        return;
      }

      try {
        if (isPurchaseDraftWorthSaving(content)) {
          window.localStorage.setItem(key, serializePurchaseDraft(content, session, new Date()));
          owners.set(key, visit);
        } else if (isOwner) {
          window.localStorage.removeItem(key);
        } else {
          return;
        }
      } catch {
        // `localStorage` bloqueado o lleno: la compra sigue, solo que sin borrador.
        return;
      }

      notify();
    },
    [key, session, visit],
  );

  return useMemo(
    () => ({ adopt, clear, pending: owned ? null : stored, sync }),
    [adopt, clear, owned, stored, sync],
  );
}
