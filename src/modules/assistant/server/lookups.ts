import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { matchesStoreIds } from "@/modules/reports/services/storeScope";
import { mockProducts } from "@/shared/mocks/erp-data";

import type { AssistantToolContext } from "../types";

/**
 * `top_productos` solo devuelve sku; para el usuario el nombre es lo util.
 * Resuelve id -> nombre respetando el alcance de tiendas del contexto.
 */
export async function resolveProductNames(
  ctx: AssistantToolContext,
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) {
    return new Map();
  }

  if (ctx.dataSource === "mock") {
    return new Map(
      mockProducts
        .filter(
          (product) =>
            productIds.includes(product.id) && matchesStoreIds(product.storeId, ctx.storeIds),
        )
        .map((product) => [product.id, product.name]),
    );
  }

  const supabase =
    ctx.scope === "platform" ? createAdminSupabaseClient() : await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name")
    .in("id", productIds)
    .in("store_id", ctx.storeIds);

  throwIfSupabaseError(error);

  return new Map((data ?? []).map((row) => [row.id as string, row.name as string]));
}
