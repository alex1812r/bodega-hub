import { mapProductSummary } from "@/lib/supabase/mappers/products";
import { mapNullableString } from "@/lib/supabase/mappers/base";

export type StockCardRow = {
  created_at: string;
  created_by?: string | null;
  id: string;
  product_id: string;
  product_name: string;
  purchase_id?: string | null;
  quantity_delta: number;
  reason?: string | null;
  sale_id?: string | null;
  sku: string;
  stock_after: number;
  type: string;
};

export function mapStockCardEntry(row: StockCardRow) {
  return {
    createdAt: row.created_at,
    id: row.id,
    product: mapProductSummary({
      category_id: null,
      current_cost_ref: 0,
      current_stock: row.stock_after,
      id: row.product_id,
      is_active: true,
      min_stock: 0,
      name: row.product_name,
      sale_price_ref: 0,
      sku: row.sku,
    }),
    productId: row.product_id,
    purchaseId: mapNullableString(row.purchase_id),
    quantityDelta: row.quantity_delta,
    reason: mapNullableString(row.reason),
    saleId: mapNullableString(row.sale_id),
    stockAfter: row.stock_after,
    type: row.type,
  };
}
