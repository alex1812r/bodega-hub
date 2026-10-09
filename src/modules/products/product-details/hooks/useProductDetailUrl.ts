"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * URL actual del detalle (ruta + query, con su pestaña y su `returnTo`): es el
 * `returnTo` de los enlaces que salen del detalle.
 */
export function useProductDetailUrl() {
  const pathname = usePathname();
  const query = useSearchParams().toString();

  return query ? `${pathname}?${query}` : pathname;
}
