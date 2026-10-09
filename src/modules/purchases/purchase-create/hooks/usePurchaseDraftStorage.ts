"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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

/** Espera del guardado automático (CNF-16): un cambio tras otro escribe una sola vez. */
export const PURCHASE_DRAFT_SAVE_DELAY_MS = 500;

/**
 * Por qué la compra del formulario no queda guardada: ya hay dos de otras visitas sin
 * decidir (`two-drafts`) o `localStorage` no dejó escribir (`storage`: lleno o bloqueado).
 */
export type PurchaseDraftSaveBlock = "storage" | "two-drafts";

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
  /** Escribe ya lo que `schedule` tuviera pendiente (no hace nada si no hay nada). */
  flush: () => void;
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
   * `null` si lo que hay en el formulario se puede guardar; si no, el motivo. El guardia
   * de salida lo usa para no prometer un borrador que no va a existir.
   */
  saveBlock: PurchaseDraftSaveBlock | null;
  /**
   * Guardado automático (CNF-16): como `sync`, pero espera `PURCHASE_DRAFT_SAVE_DELAY_MS`
   * desde el último cambio. Llamar en cada cambio del formulario. Lo pendiente se escribe
   * solo al desmontar la pantalla; `sync`, `adopt`, `keepNew` y `clear` lo cancelan.
   */
  schedule: (content: PurchaseDraftContent) => void;
  /**
   * Guarda YA el estado actual del formulario (salir, recargar), sin esperar al guardado
   * automático.
   * - Con un borrador `pending` sin decidir NO lo pisa: escribe en la segunda ranura
   *   (queda en `pendingNew`, con `ownsNew`), para que al recargar no se pierda ninguna
   *   de las dos. Si esa ranura ya guarda la compra nueva de otra visita, no escribe:
   *   hay dos sin decidir y no existe una tercera ranura.
   * - Sin "algo que perder" (`isPurchaseDraftWorthSaving`) no escribe, y borra lo
   *   que esta misma visita hubiera guardado antes.
   * - Si `localStorage` no está disponible o está lleno, no escribe (queda en `saveBlock`).
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
  const [writeFailed, setWriteFailed] = useState(false);
  // Guardado automático pendiente: lo último que pidió `schedule` y su temporizador.
  const scheduledRef = useRef<{ content: PurchaseDraftContent; timer: number } | null>(null);
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

  /** Olvida el guardado automático pendiente: lo que venga después manda sobre él. */
  const cancelScheduled = useCallback(() => {
    if (scheduledRef.current) {
      window.clearTimeout(scheduledRef.current.timer);
      scheduledRef.current = null;
    }
  }, []);

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
    cancelScheduled();

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
  }, [cancelScheduled, key, newKey, promoteNew, session, visit]);

  const keepNew = useCallback(() => {
    if (!readStoredDraft(newKey, session)) {
      return;
    }

    cancelScheduled();
    promoteNew();
    notify();
  }, [cancelScheduled, newKey, promoteNew, session]);

  const clear = useCallback(() => {
    // Aunque no haya dónde borrar: una compra confirmada no debe volver a guardarse.
    cancelScheduled();
    setWriteFailed(false);

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
  }, [cancelScheduled, key, newKey, visit]);

  const write = useCallback(
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
          setWriteFailed(false);
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
        setWriteFailed(isPurchaseDraftWorthSaving(content));
        return;
      }

      notify();
    },
    [key, newKey, session, visit],
  );

  const sync = useCallback(
    (content: PurchaseDraftContent) => {
      cancelScheduled();
      write(content);
    },
    [cancelScheduled, write],
  );

  const flush = useCallback(() => {
    const scheduled = scheduledRef.current;

    if (scheduled) {
      cancelScheduled();
      write(scheduled.content);
    }
  }, [cancelScheduled, write]);

  const schedule = useCallback(
    (content: PurchaseDraftContent) => {
      cancelScheduled();
      scheduledRef.current = {
        content,
        timer: window.setTimeout(() => {
          scheduledRef.current = null;
          write(content);
        }, PURCHASE_DRAFT_SAVE_DELAY_MS),
      };
    },
    [cancelScheduled, write],
  );

  // Al salir de la pantalla (o al cambiar de sesión) se escribe lo pendiente y lo guardado
  // deja de ser "de esta visita": la siguiente lo ofrece. En ese orden: `write` decide la
  // ranura según de quién es lo guardado.
  useEffect(
    () => () => {
      flush();

      for (const slot of [key, newKey]) {
        if (slot && owners.get(slot) === visit) {
          owners.delete(slot);
        }
      }
    },
    [flush, key, newKey, visit],
  );

  return useMemo(() => {
    // Sin principal, una segunda ranura que dejó otra visita es lo que se ofrece.
    const pending = owned ? null : (stored ?? (ownedNew ? null : storedNew));
    const pendingNew = pending !== null && stored !== null ? storedNew : null;
    const ownsNew = pendingNew !== null && ownedNew;

    return {
      adopt,
      clear,
      flush,
      keepNew,
      ownsNew,
      pending,
      pendingNew,
      saveBlock: pendingNew !== null && !ownsNew ? "two-drafts" : writeFailed ? "storage" : null,
      schedule,
      sync,
    };
  }, [
    adopt,
    clear,
    flush,
    keepNew,
    owned,
    ownedNew,
    schedule,
    stored,
    storedNew,
    sync,
    writeFailed,
  ]);
}
