"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * URL actual del detalle (ruta + query, con su pestaña, sus páginas y su
 * `returnTo`): es el `returnTo` de los enlaces que salen del detalle.
 */
export function useContactDetailUrl() {
  const pathname = usePathname();
  const query = useSearchParams().toString();

  return query ? `${pathname}?${query}` : pathname;
}
