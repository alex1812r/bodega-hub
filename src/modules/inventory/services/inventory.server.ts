import { parsePagination } from "@/lib/api/pagination";
import {
  mapProductSummary,
  mapStockCardEntry,
  mapStockMovement,
  type DbProductSummaryRow,
  type DbStockMovementRow,
  type StockCardRow,
} from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { StockMovementType } from "@/shared/mocks/erp-data";

const productSummarySelect =
  "id, category_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, image_url, is_active";

const stockMovementSelect = `
  id,
  product_id,
  type,
  quantity_delta,
  stock_after,
  sale_id,
  purchase_id,
  reason,
  created_at,
  product:products(${productSummarySelect})
`;

const stockCardSelect =
  "id, product_id, sku, product_name, type, quantity_delta, stock_after, sale_id, purchase_id, reason, created_by, created_at";

export async function listInventory(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const onlyLowStock = searchParams.get("lowStock") === "true";
  const search = searchParams.get("search")?.trim();

  const table = onlyLowStock ? "low_stock_products" : "products";
  let query = supabase
    .from(table)
    .select(productSummarySelect, { count: "exact" })
    .order("name", { ascending: true });

  if (!onlyLowStock) {
    query = query.eq("is_active", true);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapProductSummary(row as DbProductSummaryRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function listStockMovements(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const productId = searchParams.get("productId");

  let query = supabase
    .from("stock_movements")
    .select(stockMovementSelect, { count: "exact" })
    .order("created_at", { ascending: false });

  if (productId) {
    query = query.eq("product_id", productId);
  }

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapStockMovement(row as DbStockMovementRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getStockCard(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const productId = searchParams.get("productId");

  let query = supabase
    .from("stock_card")
    .select(stockCardSelect, { count: "exact" })
    .order("created_at", { ascending: false });

  if (productId) {
    query = query.eq("product_id", productId);
  }

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapStockCardEntry(row as StockCardRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function createStockAdjustment(input: {
  productId: string;
  quantityDelta: number;
  reason?: string;
  type?: StockMovementType;
}) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_product_id: input.productId,
    p_quantity_delta: input.quantityDelta,
    p_reason: input.reason ?? null,
    p_type: input.type ?? null,
  });

  throwIfSupabaseError(error);

  return mapStockMovement(data as DbStockMovementRow);
}
