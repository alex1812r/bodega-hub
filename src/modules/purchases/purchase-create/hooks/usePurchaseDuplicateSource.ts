"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { usePurchase, type PurchaseDetails } from "../../hooks/usePurchases";

const DUPLICATE_PARAM = "duplicate";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function readDuplicateParam() {
  return new URLSearchParams(window.location.search).get(DUPLICATE_PARAM) || null;
}

/** Quita `duplicate` de la URL sin navegar: recargar no vuelve a duplicar. */
function clearDuplicateParam() {
  const url = new URL(window.location.href);

  if (!url.searchParams.has(DUPLICATE_PARAM)) {
    return;
  }

  url.searchParams.delete(DUPLICATE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

  for (const listener of listeners) {
    listener();
  }
}

/**
 * `/purchases/create?duplicate=<id>` (COM-09): lee la compra de origen y se la
 * entrega UNA vez a `load`, que prepara la precarga y devuelve la función que la
 * pone en el formulario. Antes de llamarla se quita el parámetro de la URL: el
 * formulario (y su `ProcessGuard`, que duplica la entrada del historial) nace ya
 * sobre la URL limpia. Si la compra no se puede leer o `load` falla, el error
 * queda en `error` y el parámetro se conserva (recargar reintenta).
 *
 * `ready` retrasa la entrega hasta que el formulario puede recibirla (tasa cargada).
 */
export function usePurchaseDuplicateSource(input: {
  load: (purchase: PurchaseDetails) => Promise<() => void>;
  ready: boolean;
}) {
  const sourceId = useSyncExternalStore(subscribe, readDuplicateParam, () => null);
  const sourceQuery = usePurchase(sourceId ?? undefined);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const handledIdRef = useRef<string | null>(null);
  const loadRef = useRef(input.load);
  const source = sourceId ? sourceQuery.data : undefined;

  useEffect(() => {
    loadRef.current = input.load;
  });

  useEffect(() => {
    if (!source || !input.ready || handledIdRef.current === source.id) {
      return;
    }

    handledIdRef.current = source.id;
    void loadRef.current(source).then(
      (apply) => {
        clearDuplicateParam();
        apply();
      },
      (error: unknown) => {
        setLoadError(error instanceof Error ? error : new Error("No se pudo duplicar la compra."));
      },
    );
  }, [input.ready, source]);

  const error = sourceId ? (sourceQuery.error ?? loadError) : null;

  return {
    error,
    /** Hay una compra por duplicar que aún no ha llegado al formulario. */
    isLoading: sourceId !== null && error === null,
  };
}
