"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  clearRestockDraft,
  readRestockDraft,
  RESTOCK_QUERY_PARAM,
  useRestockSession,
  type RestockDraft,
} from "@/modules/inventory/restock";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function readRestockParam() {
  return new URLSearchParams(window.location.search).get(RESTOCK_QUERY_PARAM) || null;
}

/** Quita `restock` de la URL sin navegar: el mismo enlace ya no vuelve a precargar. */
function clearRestockParam() {
  const url = new URL(window.location.href);

  if (!url.searchParams.has(RESTOCK_QUERY_PARAM)) {
    return;
  }

  url.searchParams.delete(RESTOCK_QUERY_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

  for (const listener of listeners) {
    listener();
  }
}

/**
 * `/purchases/create?restock=<id>` (INV-05): lee la precarga que dejó «Crear
 * compra con estos productos» (`readRestockDraft`, contrato en
 * `.notes/ux-mejoras/inventario/INV-05-contrato.md`) y se la entrega UNA vez a
 * `onDraft`. Espera a que cargue la sesión (la precarga va firmada con tienda y
 * usuario) y a `ready` (la pantalla puede recibirla: tasa cargada).
 *
 * - Precarga inservible (no existe, ya se usó, caducó, de otra sesión o id mal
 *   formado): `onUnavailable` y se quita `restock` de la URL.
 * - Precarga válida: `onDraft(draft)`. El hook NO la borra: quien la recibe llama
 *   a `consumeRestockDraft(id)` cuando las líneas ya están en la compra (o el usuario decidió
 *   no usarla). Hasta entonces una recarga la vuelve a encontrar.
 */
export function usePurchaseRestockSource(input: {
  onDraft: (draft: RestockDraft) => void;
  onUnavailable: () => void;
  ready: boolean;
}) {
  const restockId = useSyncExternalStore(subscribe, readRestockParam, () => null);
  const session = useRestockSession();
  const handledIdRef = useRef<string | null>(null);
  const handlersRef = useRef(input);

  useEffect(() => {
    handlersRef.current = input;
  });

  useEffect(() => {
    if (!restockId || !session || !input.ready || handledIdRef.current === restockId) {
      return;
    }

    handledIdRef.current = restockId;

    const result = readRestockDraft(restockId, session);

    if (result.status === "ok") {
      handlersRef.current.onDraft(result.draft);
      return;
    }

    clearRestockParam();
    handlersRef.current.onUnavailable();
  }, [input.ready, restockId, session]);
}

/** La precarga ya se usó o se descartó: se borra y el enlace deja de servir. */
export function consumeRestockDraft(id: string) {
  clearRestockDraft(id);
  clearRestockParam();
}
