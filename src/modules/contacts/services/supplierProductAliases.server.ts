import { ApiError } from "@/lib/api/apiError";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { fetchAllRows, fetchAllRowsByIds } from "@/modules/reports/services/reportPagination";

import type {
  RemovedSupplierProductAlias,
  SupplierProductAlias,
  SupplierProductAliasList,
} from "../types/supplierProductAliases";

/**
 * SCN-09b · Alias aprendidos de facturas por proveedor (`supplier_product_aliases`,
 * 20261019b). Lectura con la sesión del usuario (RLS: tienda + purchases.view);
 * el borrado va por la RPC `remove_supplier_product_alias` (20261020a), que vuelve
 * a comprobar tienda y rol. Paridad: `supplierProductAliases.mock-server.ts`.
 */

export const SUPPLIER_PRODUCT_ALIAS_NOT_FOUND_MESSAGE = "Alias no encontrado";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DbProductName = { name: string | null };

type DbSupplierProductAliasRow = {
  alias_norm: string;
  hits: number;
  id: string;
  last_seen_at: string;
  pack_label: string | null;
  product_id: string;
  products: DbProductName | DbProductName[] | null;
  units_per_pack: number | null;
};

function productName(row: DbSupplierProductAliasRow) {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;

  return product?.name ?? null;
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function aliasNotFound() {
  return new ApiError(404, "NOT_FOUND", SUPPLIER_PRODUCT_ALIAS_NOT_FOUND_MESSAGE);
}

export async function listSupplierProductAliases(
  supplierId: string,
  storeId: string,
): Promise<SupplierProductAliasList> {
  if (!isUuid(supplierId)) {
    return { items: [] };
  }

  const supabase = await createRouteSupabaseClient();
  // REP6-05: todos los alias, por páginas (PostgREST corta en 1000) con orden estable.
  const rows = await fetchAllRows<DbSupplierProductAliasRow>(
    async (from, to) => {
      const { data, error } = await supabase
        .from("supplier_product_aliases")
        .select("id, alias_norm, pack_label, units_per_pack, hits, last_seen_at, product_id, products(name)")
        .eq("store_id", storeId)
        .eq("supplier_id", supplierId)
        .order("last_seen_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);

      return { data: data as unknown as DbSupplierProductAliasRow[] | null, error };
    },
    { getKey: (row) => row.id },
  );
  const productIds = [...new Set(rows.map((row) => row.product_id))];
  // Ids por lotes: con cientos de productos el filtro `in` no cabe en la URL.
  const links = await fetchAllRowsByIds<{ product_id: string }>(productIds, (chunk, from, to) =>
    supabase
      .from("supplier_products")
      .select("product_id")
      .eq("store_id", storeId)
      .eq("supplier_id", supplierId)
      .in("product_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const linked = new Set(links.map((link) => link.product_id));

  return {
    items: rows.map(
      (row): SupplierProductAlias => ({
        aliasNorm: row.alias_norm,
        hits: row.hits,
        id: row.id,
        inSupplierProducts: linked.has(row.product_id),
        lastSeenAt: row.last_seen_at,
        packLabel: row.pack_label,
        productId: row.product_id,
        productName: productName(row),
        unitsPerPack: row.units_per_pack,
      }),
    ),
  };
}

/**
 * Quita el alias si es de este proveedor y de la tienda. Ajeno, de otro proveedor
 * o inexistente → 404 (la RPC responde PT404, que `throwIfSupabaseError` mapea).
 */
export async function removeSupplierProductAlias(
  supplierId: string,
  aliasId: string,
  storeId: string,
): Promise<RemovedSupplierProductAlias> {
  if (!isUuid(aliasId) || !isUuid(supplierId)) {
    throw aliasNotFound();
  }

  const supabase = await createRouteSupabaseClient();
  // La RPC solo mira tienda y rol; la ruta además liga el alias al proveedor de la URL.
  const { data: owned, error: ownedError } = await supabase
    .from("supplier_product_aliases")
    .select("id")
    .eq("id", aliasId)
    .eq("store_id", storeId)
    .eq("supplier_id", supplierId)
    .maybeSingle();

  throwIfSupabaseError(ownedError);

  if (!owned) {
    throw aliasNotFound();
  }

  const { data, error } = await supabase.rpc("remove_supplier_product_alias", { p_alias_id: aliasId });

  throwIfSupabaseError(error);

  return { id: typeof data === "string" ? data : aliasId };
}
