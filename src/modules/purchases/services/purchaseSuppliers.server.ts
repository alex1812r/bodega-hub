import { ApiError } from "@/lib/api/apiError";
import type { PaginatedList } from "@/lib/api/pagination";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE,
  PURCHASE_SUPPLIER_TYPES,
  type PurchaseSupplier,
  type PurchaseSuppliersQuery,
} from "./purchaseSuppliers.mock-server";

/** Únicas columnas de `contacts` que salen por este servicio. */
const PURCHASE_SUPPLIER_COLUMNS = "id, name, tax_id, is_active";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DbPurchaseSupplierRow = {
  id: string;
  is_active: boolean | null;
  name: string;
  tax_id: string | null;
};

function toPurchaseSupplier(row: DbPurchaseSupplierRow): PurchaseSupplier {
  return {
    id: row.id,
    isActive: row.is_active ?? true,
    name: row.name,
    taxId: row.tax_id ?? "",
  };
}

/** Quita lo que `or=(...)` de PostgREST lee como sintaxis o como comodín. */
function toIlikeTerm(value: string) {
  return value.replace(/[%_,()*"\\]/g, "").trim();
}

/**
 * Proveedores activos de la tienda, por nombre o RIF, ordenados por nombre. Lee
 * `contacts` con la sesión del usuario: la RLS de lectura solo exige la tienda.
 */
export async function listPurchaseSuppliers(
  { limit, search, skip }: PurchaseSuppliersQuery,
  storeId: string,
): Promise<PaginatedList<PurchaseSupplier>> {
  const supabase = await createRouteSupabaseClient();
  let query = supabase
    .from("contacts")
    .select(PURCHASE_SUPPLIER_COLUMNS, { count: "exact" })
    .eq("store_id", storeId)
    .in("type", PURCHASE_SUPPLIER_TYPES)
    .eq("is_active", true);
  const term = search ? toIlikeTerm(search) : "";

  if (term) {
    query = query.or(`name.ilike.%${term}%,tax_id.ilike.%${term}%`);
  }

  const { count, data, error } = await query.order("name").range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: ((data ?? []) as DbPurchaseSupplierRow[]).map(toPurchaseSupplier),
    limit,
    skip,
    total: count ?? 0,
  };
}

/** Un proveedor de la tienda por id, también si está inactivo (borrador o compra duplicada). */
export async function getPurchaseSupplierById(
  id: string,
  storeId: string,
): Promise<PurchaseSupplier> {
  // `contacts.id` es uuid: otro texto no puede existir (y Postgres lo rechazaría).
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError(404, "NOT_FOUND", PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE);
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("contacts")
    .select(PURCHASE_SUPPLIER_COLUMNS)
    .eq("id", id)
    .eq("store_id", storeId)
    .in("type", PURCHASE_SUPPLIER_TYPES)
    .maybeSingle();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", PURCHASE_SUPPLIER_NOT_FOUND_MESSAGE);
  }

  return toPurchaseSupplier(data as DbPurchaseSupplierRow);
}
