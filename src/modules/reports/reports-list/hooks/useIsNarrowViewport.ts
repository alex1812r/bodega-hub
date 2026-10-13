"use client";

import { useSyncExternalStore } from "react";

/** Por debajo del `sm` de Tailwind (640 px). */
const NARROW_VIEWPORT_QUERY = "(max-width: 639px)";

function getMediaQuery() {
  return typeof window.matchMedia === "function" ? window.matchMedia(NARROW_VIEWPORT_QUERY) : null;
}

function subscribe(onChange: () => void) {
  const media = getMediaQuery();

  media?.addEventListener("change", onChange);

  return () => media?.removeEventListener("change", onChange);
}

function getSnapshot() {
  return getMediaQuery()?.matches ?? false;
}

function getServerSnapshot() {
  return false;
}

/**
 * `true` en pantallas angostas (móvil). Se lee de forma síncrona, así el primer
 * render en el navegador ya trae el valor real y nada parpadea; en el servidor
 * se asume escritorio.
 */
export function useIsNarrowViewport() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
