/**
 * Opciones de react-query comunes a los hooks de impact (`useSaleImpact`, …).
 *
 * El efecto se recalcula cada vez que se abre el modal: sin caché entre
 * aperturas (`gcTime: 0`), siempre rancio (`staleTime: 0`), sin reintentos (un
 * 403/404/409 no cambia por repetir) y sin refrescos en segundo plano que
 * cambien las cifras mientras el usuario las lee.
 */
export const impactQueryOptions = {
  gcTime: 0,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: 0,
} as const;

/** Clave de consulta de un impact: `["impact", <doc>, <id>, <action>, …]`. */
export function impactQueryKey(
  document: "payments" | "purchases" | "sales",
  id: string,
  action: string,
) {
  return ["impact", document, id, action] as const;
}
