"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/shared/components/Toast";

import {
  describePosCartRestoration,
  findPosCartDraft,
  posCartDraftStorageKey,
  posCartRestorationHasChanges,
  prunePosCartDrafts,
  readPosCartTabId,
  removePosCartDraft,
  restorePosCartDraft,
  rotatePosCartTabId,
  serializePosCartDraft,
  writePosCartDraft,
  type PosCartDraftScope,
  type PosCartRestoration,
} from "../utils/posCartDraft";
import type { PosCartItem } from "./usePosCart";

/** Espera del guardado automático: una ráfaga de escaneos escribe una sola vez. */
export const POS_CART_DRAFT_SAVE_DELAY_MS = 500;

type CatalogProduct = Parameters<typeof restorePosCartDraft>[1]["products"][number];

export type UsePosCartDraftOptions = {
  /** Sesión de caja abierta. Sin ella, sin caja o sin usuario no se lee ni se escribe. */
  cashSessionId?: string | null;
  /**
   * Catálogo y clientes YA cargados, contra los que se revalida el carrito guardado.
   * `null` mientras cargan: la restauración espera.
   */
  catalog: {
    customers: ReadonlyArray<{ id: string }>;
    products: readonly CatalogProduct[];
  } | null;
  customerId: string;
  items: PosCartItem[];
  /** «Vaciar» del aviso «Carrito recuperado». */
  onDiscard: () => void;
  /** Pone en pantalla el carrito revalidado (y su cliente, si sigue existiendo). */
  onRestore: (restoration: PosCartRestoration) => void;
  registerId?: string | null;
  storeId?: string | null;
  userId?: string | null;
};

export type PosCartDraftController = {
  /** `localStorage` no dejó escribir: lo que hay en el carrito no está guardado. */
  saveFailed: boolean;
  /** Guarda YA el carrito (salir, recargar), sin esperar al guardado automático. */
  saveNow: () => void;
};

/**
 * Carrito recuperable del POS (CNF-16) sobre `utils/posCartDraft.ts`.
 *
 * - Guarda el carrito `POS_CART_DRAFT_SAVE_DELAY_MS` después del último cambio, desde
 *   un temporizador: escanear, tocar una cantidad o cobrar no escriben en
 *   `localStorage`. Lo pendiente se escribe al desmontar la pantalla y con `saveNow`.
 * - Un carrito vacío (venta cobrada u orden limpiada) borra lo guardado en el acto.
 * - Al montar toma el carrito de esta pestaña o, si no tiene, el más reciente de la
 *   misma caja y sesión. Lo restaura cuando hay catálogo, revalidado contra él, y
 *   avisa con «Carrito recuperado». Hasta entonces no guarda, para no pisarlo.
 * - Si otra pestaña se lleva el carrito de esta, lo vuelve a escribir; si otra
 *   pestaña comparte su identificador (pestaña duplicada), estrena uno.
 * - Sin `localStorage`, lleno, o con contenido ilegible, el POS funciona igual.
 */
export function usePosCartDraft(options: UsePosCartDraftOptions): PosCartDraftController {
  const { cashSessionId, catalog, customerId, items, registerId, storeId, userId } = options;
  const { dismiss, showToast } = useToast();
  const scope = useMemo<PosCartDraftScope | null>(
    () =>
      cashSessionId && registerId && userId
        ? { cashSessionId, registerId, storeId: storeId ?? null, userId }
        : null,
    [cashSessionId, registerId, storeId, userId],
  );
  const [tabId, setTabId] = useState(readPosCartTabId);
  const key = scope ? posCartDraftStorageKey(scope, tabId) : null;
  // Lo guardado al entrar: PosCashSessionGate ya esperó por la caja y el usuario.
  const [found] = useState(() => (scope ? findPosCartDraft(scope, tabId) : null));
  const [saveFailed, setSaveFailed] = useState(false);
  const saveFailedRef = useRef(false);
  const awaitingRestoreRef = useRef(found !== null);
  const latestRef = useRef({ key, options, scope });
  const timerRef = useRef<number | null>(null);
  /** Clave en la que esta pestaña tiene algo escrito. */
  const savedKeyRef = useRef<string | null>(null);
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    latestRef.current = { key, options, scope };
  });

  const cancelScheduled = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const saveNow = useCallback(() => {
    cancelScheduled();

    const current = latestRef.current;

    // Con un carrito guardado aún sin restaurar no se escribe: se pisaría.
    if (!current.key || !current.scope || awaitingRestoreRef.current) {
      return;
    }

    if (current.options.items.length === 0) {
      if (savedKeyRef.current === current.key) {
        removePosCartDraft(current.key);
        savedKeyRef.current = null;
      }

      return;
    }

    const saved = writePosCartDraft(
      current.key,
      serializePosCartDraft(
        { customerId: current.options.customerId, items: current.options.items },
        current.scope,
        new Date(),
      ),
    );

    if (saved) {
      savedKeyRef.current = current.key;
    }

    // Solo si cambia: un guardado normal no vuelve a pintar el POS.
    if (saveFailedRef.current === saved) {
      saveFailedRef.current = !saved;
      setSaveFailed(!saved);
    }
  }, [cancelScheduled]);

  useEffect(() => {
    if (scope) {
      prunePosCartDrafts(scope);
    }
  }, [scope]);

  // Va ANTES de la restauración: en el render en que llega el catálogo todavía no guarda.
  useEffect(() => {
    if (!key || awaitingRestoreRef.current) {
      return;
    }

    if (items.length === 0) {
      // Venta cobrada u orden limpiada: lo guardado se borra ya, y «Vaciar» deja de ofrecerse.
      saveNow();

      if (toastIdRef.current) {
        dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }

      return;
    }

    cancelScheduled();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      saveNow();
    }, POS_CART_DRAFT_SAVE_DELAY_MS);
  }, [cancelScheduled, customerId, dismiss, items, key, saveNow]);

  useEffect(() => {
    if (!found || !catalog || !awaitingRestoreRef.current) {
      return;
    }

    awaitingRestoreRef.current = false;

    const current = latestRef.current;
    const restoration = restorePosCartDraft(found.draft, {
      customerIds: new Set(catalog.customers.map((customer) => customer.id)),
      products: catalog.products,
    });

    // El carrito pasa a la clave de esta pestaña ANTES de borrar la de origen.
    if (current.key && current.scope && restoration.items.length > 0) {
      const saved = writePosCartDraft(
        current.key,
        serializePosCartDraft(
          {
            customerId: restoration.customerId ?? current.options.customerId,
            items: restoration.items,
          },
          current.scope,
          new Date(),
        ),
      );

      if (saved) {
        savedKeyRef.current = current.key;
      }

      if (saved && found.key !== current.key) {
        removePosCartDraft(found.key);
      }
    } else {
      removePosCartDraft(found.key);
    }

    current.options.onRestore(restoration);

    const hasItems = restoration.items.length > 0;

    const toastId = showToast({
      action: hasItems
        ? { label: "Vaciar", onClick: () => latestRef.current.options.onDiscard() }
        : undefined,
      description: describePosCartRestoration(restoration),
      // Un producto quitado o un precio distinto no se cierran solos.
      durationMs: posCartRestorationHasChanges(restoration) ? 0 : undefined,
      title: hasItems ? "Carrito recuperado" : "El carrito guardado ya no se puede recuperar",
      tone: "info",
    });

    // Solo el aviso con «Vaciar» se retira al vaciarse el carrito.
    toastIdRef.current = hasItems ? toastId : null;
  }, [catalog, found, showToast]);

  useEffect(() => {
    if (!key) {
      return;
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== key || awaitingRestoreRef.current) {
        return;
      }

      if (event.newValue === null) {
        // Otra pestaña se llevó (o borró) el carrito de esta: se vuelve a guardar.
        if (latestRef.current.options.items.length > 0) {
          saveNow();
        }

        return;
      }

      // Otra pestaña escribe en esta clave: comparte identificador (pestaña duplicada).
      savedKeyRef.current = null;
      setTabId(rotatePosCartTabId());
    }

    window.addEventListener("storage", handleStorage);

    return () => window.removeEventListener("storage", handleStorage);
  }, [key, saveNow]);

  // Salir de la pantalla dentro de la espera: lo pendiente se escribe.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        saveNow();
      }
    },
    [saveNow],
  );

  return useMemo(() => ({ saveFailed, saveNow }), [saveFailed, saveNow]);
}
