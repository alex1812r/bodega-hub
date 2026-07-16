import { ApiError } from "@/lib/api/apiError";
import { assertStoreAccess } from "@/lib/api/storeAccess";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

type StoreScopedRow = {
  store_id: string;
};

/** Resuelve storeId de un mock (default si no viene). */
export function mockEntityStoreId(entity: { storeId?: string | null } | undefined | null) {
  return entity?.storeId ?? DEFAULT_STORE_ID;
}

/**
 * Verifica pertenencia a tienda vía service role (bypass RLS).
 * Si existe en otra tienda → 403; si no existe → 404.
 */
export async function assertSupabaseStoreResource(
  table:
    | "products"
    | "categories"
    | "contacts"
    | "sales"
    | "purchases"
    | "payments"
    | "supplier_products"
    | "stock_movements"
    | "exchange_rates",
  id: string,
  storeId: string,
  notFoundMessage: string,
) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from(table)
    .select("store_id")
    .eq("id", id)
    .maybeSingle<StoreScopedRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", notFoundMessage);
  }

  assertStoreAccess(storeId, data.store_id);
}

export function assertMockStoreResource<T extends { storeId?: string | null }>(
  entity: T | undefined | null,
  storeId: string,
  notFoundMessage: string,
): asserts entity is T {
  if (!entity) {
    throw new ApiError(404, "NOT_FOUND", notFoundMessage);
  }

  assertStoreAccess(storeId, mockEntityStoreId(entity));
}
