import { paginateList, parsePagination } from "@/lib/api/pagination";
import {
  mapCategory,
  mapProductSummary,
  mapStockCardEntry,
  mapStockMovement,
  type CategoryRow,
  type DbProductSummaryRow,
  type DbStockMovementRow,
  type StockCardRow,
} from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { StockMovementType } from "@/shared/mocks/erp-data";

import {
  matchesInventoryListFilters,
  parseInventoryListFilters,
} from "../utils/inventoryListFilters";
import {
  matchesInventoryMovementFilters,
  parseInventoryMovementFilters,
} from "../utils/inventoryMovementFilters";
import { buildProductSearchOrFilter } from "@/modules/products/services/productSearch";

const productSummarySelect =
  "id, category_id, sku, barcode, name, sale_price_ref, current_cost_ref, current_stock, min_stock, image_url, is_active";

const productInventorySelect = `
  ${productSummarySelect},
  category:categories(id, name, description, is_active, created_at, updated_at)
`;

function mapInventoryItem(row: DbProductSummaryRow & { category?: CategoryRow | null }) {
  return {
    ...mapProductSummary(row),
    category: row.category ? mapCategory(row.category) : undefined,
  };
}

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
  const filters = parseInventoryListFilters(searchParams);
  const needsInMemoryPagination =
    Boolean(filters.stockStatus?.length) ||
    filters.minPriceRef !== undefined ||
    filters.maxPriceRef !== undefined;

  const table = filters.lowStock ? "low_stock_products" : "products";
  let query = supabase
    .from(table)
    .select(productInventorySelect, {
      count: needsInMemoryPagination ? undefined : "exact",
    })
    .order("name", { ascending: true });

  if (!filters.lowStock) {
    query = query.eq("is_active", true);
  }

  if (filters.search) {
    query = query.or(buildProductSearchOrFilter(filters.search));
  }

  if (filters.categoryId) {
    query = query.eq("category_id", filters.categoryId);
  }

  if (needsInMemoryPagination) {
    const { data, error } = await query;

    throwIfSupabaseError(error);

    const items = (data ?? [])
      .map((row) =>
        mapInventoryItem(
          row as unknown as DbProductSummaryRow & { category?: CategoryRow | null },
        ),
      )
      .filter((item) => matchesInventoryListFilters(item, filters));

    return paginateList(items, searchParams);
  }

  const { limit, skip } = parsePagination(searchParams);
  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) =>
      mapInventoryItem(
        row as unknown as DbProductSummaryRow & { category?: CategoryRow | null },
      ),
    ),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function listStockMovements(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const filters = parseInventoryMovementFilters(searchParams);

  let query = supabase
    .from("stock_movements")
    .select(stockMovementSelect, { count: "exact" })
    .order("created_at", { ascending: false });

  if (filters.productId) {
    query = query.eq("product_id", filters.productId);
  }

  if (filters.type) {
    query = query.eq("type", filters.type);
  }

  if (filters.from) {
    query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  }

  if (filters.to) {
    query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);
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
