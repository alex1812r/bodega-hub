import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

/** Filtra entidades mock por una o varias tiendas. */
export function matchesStoreIds(
  entityStoreId: string | null | undefined,
  storeIds: string[],
) {
  if (storeIds.length === 0) {
    return false;
  }

  return storeIds.includes(entityStoreId ?? DEFAULT_STORE_ID);
}

export function normalizeStoreIds(storeIdOrIds: string | string[]): string[] {
  const ids = Array.isArray(storeIdOrIds) ? storeIdOrIds : [storeIdOrIds];
  return [...new Set(ids.filter(Boolean))];
}
