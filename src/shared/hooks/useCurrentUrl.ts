"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * URL actual de la pantalla (ruta + query, con su `returnTo` si lo trae): es el
 * `returnTo` de los enlaces que salen de ella (`withChainedReturnTo`). Lee
 * `useSearchParams`, así que la pantalla necesita su límite de Suspense.
 */
export function useCurrentUrl() {
  const pathname = usePathname();
  const query = useSearchParams().toString();

  return query ? `${pathname}?${query}` : pathname;
}
