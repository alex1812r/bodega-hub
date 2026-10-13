"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/** Catálogo de reportes abierto o plegado. */
export const REPORTS_CATALOG_OPEN_KEY = "bodegahub:reports:catalog-open";
/** «Tabla de datos» abierta o plegada. */
export const REPORTS_TABLE_OPEN_KEY = "bodegahub:reports:table-open";

const STORED_OPEN = "open";
const STORED_CLOSED = "closed";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);

  return () => {
    listeners.delete(onChange);
  };
}

function readStoredOpen(storageKey: string): boolean | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey);

    if (stored === STORED_OPEN) {
      return true;
    }

    return stored === STORED_CLOSED ? false : null;
  } catch {
    // Almacenamiento bloqueado: manda el estado en memoria.
    return null;
  }
}

function getServerStoredOpen(): boolean | null {
  return null;
}

/**
 * Abierto/plegado de una sección de `/reports` recordado en `sessionStorage`,
 * igual que las posiciones de `useScrollRestoration`: de lo plegado sale el alto
 * de la página, así que al volver de un detalle tiene que estar como se dejó
 * para que la posición guardada caiga en el mismo sitio. Se lee de forma
 * síncrona: el primer render en el navegador ya trae el estado guardado, antes
 * de que el panel avise de «datos pintados». Una sesión nueva abre con
 * `defaultOpen`.
 */
export function useSessionSectionOpen(
  storageKey: string,
  defaultOpen: boolean,
): [isOpen: boolean, setOpen: (open: boolean) => void] {
  const getStoredOpen = useCallback(() => readStoredOpen(storageKey), [storageKey]);
  const storedOpen = useSyncExternalStore(subscribe, getStoredOpen, getServerStoredOpen);
  // Respaldo si el almacenamiento no guarda: el estado dura lo que el componente.
  const [memoryOpen, setMemoryOpen] = useState<boolean | null>(null);

  const setOpen = useCallback(
    (open: boolean) => {
      setMemoryOpen(open);

      try {
        window.sessionStorage.setItem(storageKey, open ? STORED_OPEN : STORED_CLOSED);
      } catch {
        // Almacenamiento bloqueado o lleno: queda el estado en memoria.
      }

      listeners.forEach((listener) => listener());
    },
    [storageKey],
  );

  return [storedOpen ?? memoryOpen ?? defaultOpen, setOpen];
}
