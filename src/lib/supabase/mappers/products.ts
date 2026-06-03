import { mapBaseEntity, mapBoolean, mapNullableString } from "@/lib/supabase/mappers/base";
import { mapCategory, type CategoryRow } from "@/lib/supabase/mappers/categories";

export type DbProductSummaryRow = {
  category_id?: string | null;
  current_cost_ref?: number | string | null;
  current_stock?: number | null;
  id: string;
  image_url?: string | null;
  is_active?: boolean | null;
  min_stock?: number | null;
  name: string;
  sale_price_ref?: number | string | null;
  sku: string;
};

export type ProductRow = DbProductSummaryRow & {
  category?: CategoryRow | null;
  created_at?: string | null;
  description?: string | null;
  updated_at?: string | null;
};

export type ProductPriceHistoryRow = {
  changed_by?: string | null;
  created_at?: string | null;
  id: string;
  new_sale_price_ref?: number | string | null;
  old_sale_price_ref?: number | string | null;
  product_id: string;
  reason?: string | null;
};

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mapProductSummary(row: DbProductSummaryRow) {
  return {
    categoryId: mapNullableString(row.category_id) ?? "",
    currentCostRef: toNumber(row.current_cost_ref),
    currentStock: row.current_stock ?? 0,
    id: row.id,
    imageUrl: mapNullableString(row.image_url),
    isActive: mapBoolean(row.is_active, true),
    minStock: row.min_stock ?? 0,
    name: row.name,
    salePriceRef: toNumber(row.sale_price_ref),
    sku: row.sku,
  };
}

export function mapProduct(row: ProductRow) {
  return {
    ...mapProductSummary(row),
    ...mapBaseEntity(row),
    category: row.category ? mapCategory(row.category) : undefined,
    description: mapNullableString(row.description),
  };
}

export function mapProductPriceHistory(row: ProductPriceHistoryRow) {
  return {
    createdAt: row.created_at ?? "",
    id: row.id,
    productId: row.product_id,
    salePriceRef: toNumber(row.new_sale_price_ref),
    userId: row.changed_by ?? "",
  };
}
