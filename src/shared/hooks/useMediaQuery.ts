"use client";

import { useCallback, useSyncExternalStore } from "react";

function getServerSnapshot() {
  return false;
}

/**
 * `true` si el media query se cumple. En cliente devuelve el valor real desde
 * el primer render (sin pasar antes por `false`, que montaba un layout y luego
 * otro); en servidor y durante la hidratación devuelve `false`.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);

      media.addEventListener("change", onChange);

      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    getServerSnapshot,
  );
}

/** True when viewport width is below Tailwind `md` (768px). */
export function useIsBelowMd() {
  return useMediaQuery("(max-width: 767px)");
}
