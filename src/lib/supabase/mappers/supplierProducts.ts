import { mapBaseEntity, mapNullableString } from "@/lib/supabase/mappers/base";
import { mapContact, type DbContactRow } from "@/lib/supabase/mappers/contacts";
import { mapProductSummary, type DbProductSummaryRow } from "@/lib/supabase/mappers/products";

export type DbSupplierProductRow = {
  created_at?: string | null;
  id: string;
  last_cost_ref?: number | string | null;
  last_cost_ves?: number | string | null;
  last_purchased_at?: string | null;
  product?: DbProductSummaryRow | null;
  product_id: string;
  supplier?: DbContactRow | null;
  supplier_id: string;
  supplier_sku?: string | null;
  updated_at?: string | null;
};

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mapSupplierProduct(row: DbSupplierProductRow) {
  return {
    ...mapBaseEntity(row),
    lastCostRef: toNumber(row.last_cost_ref),
    product: row.product ? mapProductSummary(row.product) : undefined,
    productId: row.product_id,
    supplier: row.supplier ? mapContact(row.supplier) : undefined,
    supplierId: row.supplier_id,
    supplierSku: mapNullableString(row.supplier_sku),
  };
}
