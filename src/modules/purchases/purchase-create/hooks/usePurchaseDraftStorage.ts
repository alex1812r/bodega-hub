"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { usePermission } from "@/shared/auth/usePermission";

import {
  isPurchaseDraftWorthSaving,
  parseStoredPurchaseDraft,
  purchaseDraftStorageKey,
  purchaseNewDraftStorageKey,
  serializePurchaseDraft,
  type PurchaseDraftContent,
  type PurchaseDraftSession,
  type StoredPurchaseDraft,
} from "../utils/purchaseDraftStorage";

const listeners = new Set<() => void>();
/**
 * Clave -> visita a la pantalla que escribió (o decidió sobre) lo guardado en ella; vale
 * para las dos ranuras. Un borrador que la visita actual no ha tocado es el que se ofrece.
 */
const owners = new Map<string, symbol>();
// Última lectura de cada clave: `useSyncExternalStore` necesita la misma referencia mientras no cambie el texto.
const lastReads = new Map<string, { draft: StoredPurchaseDraft | null; raw: string | null }>();

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

  const last = lastReads.get(key);

  if (last && last.raw === raw) {
    return last.draft;
  }

  const draft = parseStoredPurchaseDraft(raw, session);

  lastReads.set(key, { draft, raw });

  return draft;
}

export type PurchaseDraftStorage = {
  /**
   * La visita se queda con el borrador `pending` (el usuario pulsó Restaurar): deja de
   * ofrecerse, `sync` vuelve a guardar en él y la compra nueva de la segunda ranura,
   * si la hay, se borra.
   */
  adopt: () => void;
  /** Borra las dos ranuras (Descartar, o compra confirmada) y deja de ofrecerlas. */
  clear: () => void;
  /**
   * La visita se queda con la compra NUEVA (`pendingNew`): pasa a ser el borrador, el
   * `pending` anterior se borra y `sync` vuelve a guardar en la ranura principal. Es
   * «Seguir con esta» y también restaurar la nueva tras recargar. Sin `pendingNew` no
   * hace nada.
   */
  keepNew: () => void;
  /**
   * `true` si `pendingNew` lo escribió esta visita (es lo que hay en el formulario);
   * `false` si lo dejó otra (tras recargar: hay que elegir entre las dos).
   */
  ownsNew: boolean;
  /**
   * Borrador que guardó OTRA visita a la pantalla (o una pestaña anterior) y sobre
   * el que el usuario aún no ha decidido. `null` si no hay, si ya se restauró o
   * descartó, o si lo guardado lo escribió esta misma visita.
   */
  pending: StoredPurchaseDraft | null;
  /**
   * La compra nueva empezada con `pending` sin decidir, guardada en la segunda ranura
   * (`purchaseNewDraftStorageKey`). `null` si no hay `pending` o no se empezó ninguna.
   */
  pendingNew: StoredPurchaseDraft | null;
  /**
   * Guarda el estado actual del formulario. Llamar en cada cambio relevante.
   * - Con un borrador `pending` sin decidir NO lo pisa: escribe en la segunda ranura
   *   (queda en `pendingNew`, con `ownsNew`), para que al recargar no se pierda ninguna
   *   de las dos. Si esa ranura ya guarda la compra nueva de otra visita, no escribe:
   *   hay dos sin decidir y no existe una tercera ranura.
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
 * Dos ranuras (COM-F10): la principal y, mientras haya en ella un borrador de otra visita
 * sin decidir, una segunda para la compra nueva que el usuario empiece. Decidir deja
 * siempre una sola: `adopt` conserva la guardada, `keepNew` la nueva, `clear` ninguna.
 * Una segunda ranura sin principal (esta se borró desde otra pestaña) se ofrece como el
 * borrador pendiente.
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
  const newKey = session ? purchaseNewDraftStorageKey(session) : null;
  const [visit] = useState(() => Symbol("purchase-draft-visit"));
  const stored = useSyncExternalStore(
    subscribe,
    () => readStoredDraft(key, session),
    () => null,
  );
  const storedNew = useSyncExternalStore(
    subscribe,
    () => readStoredDraft(newKey, session),
    () => null,
  );
  const owned = useSyncExternalStore(
    subscribe,
    () => key !== null && owners.get(key) === visit,
    () => false,
  );
  const ownedNew = useSyncExternalStore(
    subscribe,
    () => newKey !== null && owners.get(newKey) === visit,
    () => false,
  );

  // Al salir de la pantalla lo guardado deja de ser "de esta visita": la siguiente lo ofrece.
  useEffect(
    () => () => {
      for (const slot of [key, newKey]) {
        if (slot && owners.get(slot) === visit) {
          owners.delete(slot);
        }
      }
    },
    [key, newKey, visit],
  );

  /** La segunda ranura pasa a la principal (si tiene algo) y la visita se queda con esta. */
  const promoteNew = useCallback(() => {
    if (!key || !newKey) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(newKey);

      if (raw !== null) {
        window.localStorage.setItem(key, raw);
        window.localStorage.removeItem(newKey);
      }
    } catch {
      // Sin `localStorage` no hay nada que mover.
    }

    owners.delete(newKey);
    owners.set(key, visit);
  }, [key, newKey, visit]);

  const adopt = useCallback(() => {
    if (!key || !newKey || !session) {
      return;
    }

    if (readStoredDraft(key, session)) {
      try {
        window.localStorage.removeItem(newKey);
      } catch {
        // Sin `localStorage` no hay nada que borrar.
      }

      owners.delete(newKey);
      owners.set(key, visit);
    } else {
      // Lo que se ofrecía era una segunda ranura sin principal.
      promoteNew();
    }

    notify();
  }, [key, newKey, promoteNew, session, visit]);

  const keepNew = useCallback(() => {
    if (!readStoredDraft(newKey, session)) {
      return;
    }

    promoteNew();
    notify();
  }, [newKey, promoteNew, session]);

  const clear = useCallback(() => {
    if (!key || !newKey) {
      return;
    }

    try {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(newKey);
    } catch {
      // Sin `localStorage` no hay nada que borrar.
    }

    owners.delete(newKey);
    owners.set(key, visit);
    notify();
  }, [key, newKey, visit]);

  const sync = useCallback(
    (content: PurchaseDraftContent) => {
      if (!key || !newKey || !session) {
        return;
      }

      const isOwner = owners.get(key) === visit;
      const ownsNewSlot = owners.get(newKey) === visit;

      // Dos compras de otras visitas sin decidir: no hay dónde guardar una tercera.
      if (!isOwner && !ownsNewSlot && readStoredDraft(newKey, session)) {
        return;
      }

      // Con un borrador de otra visita sin decidir, esta escribe en la segunda ranura.
      const undecided = !isOwner && readStoredDraft(key, session) !== null;
      const slot = undecided ? newKey : key;

      try {
        if (isPurchaseDraftWorthSaving(content)) {
          window.localStorage.setItem(slot, serializePurchaseDraft(content, session, new Date()));
          owners.set(slot, visit);
        } else if (undecided ? ownsNewSlot : isOwner) {
          window.localStorage.removeItem(slot);

          if (undecided) {
            owners.delete(slot);
          }
        } else {
          return;
        }
      } catch {
        // `localStorage` bloqueado o lleno: la compra sigue, solo que sin borrador.
        return;
      }

      notify();
    },
    [key, newKey, session, visit],
  );

  return useMemo(() => {
    // Sin principal, una segunda ranura que dejó otra visita es lo que se ofrece.
    const pending = owned ? null : (stored ?? (ownedNew ? null : storedNew));
    const pendingNew = pending !== null && stored !== null ? storedNew : null;

    return {
      adopt,
      clear,
      keepNew,
      ownsNew: pendingNew !== null && ownedNew,
      pending,
      pendingNew,
      sync,
    };
  }, [adopt, clear, keepNew, owned, ownedNew, stored, storedNew, sync]);
}
