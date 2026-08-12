/** Caché React Query del catálogo POS (productos / clientes / categorías). */
export const POS_CATALOG_STALE_TIME_MS = 5 * 60_000;
export const POS_CATALOG_GC_TIME_MS = 30 * 60_000;

export const posCatalogQueryOptions = {
  gcTime: POS_CATALOG_GC_TIME_MS,
  staleTime: POS_CATALOG_STALE_TIME_MS,
} as const;
