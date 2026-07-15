import { ApiError } from "@/lib/api/apiError";
import { parsePagination } from "@/lib/api/pagination";
import {
  mapProduct,
  mapProductPriceHistory,
  type ProductPriceHistoryRow,
  type ProductRow,
} from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type {
  ProductInput,
  ProductPriceInput,
} from "./products.mock-server";
import { applyProductSort } from "./productSort";
import { buildProductSearchOrFilter, normalizeBarcode } from "./productSearch";
import { normalizeOptionalSku, normalizeSku } from "@/shared/utils/skuGeneration";

const productSelect = `
  id,
  category_id,
  sku,
  barcode,
  name,
  description,
  sale_price_ref,
  current_cost_ref,
  current_stock,
  min_stock,
  image_url,
  is_active,
  created_at,
  updated_at,
  category:categories(id, name, description, is_active, created_at, updated_at)
`;

function toProductInsert(input: ProductInput) {
  return {
    barcode: normalizeBarcode(input.barcode),
    category_id: input.categoryId ?? null,
    current_cost_ref: input.currentCostRef ?? 0,
    current_stock: input.currentStock ?? 0,
    image_url: input.imageUrl ?? null,
    min_stock: input.minStock ?? 5,
    name: input.name ?? "Producto",
    sale_price_ref: input.salePriceRef ?? 0,
    sku: normalizeSku(input.sku ?? ""),
  };
}

function toProductUpdate(input: ProductInput) {
  return {
    ...(input.barcode !== undefined ? { barcode: normalizeBarcode(input.barcode) } : {}),
    ...(input.categoryId !== undefined ? { category_id: input.categoryId ?? null } : {}),
    ...(input.currentCostRef !== undefined ? { current_cost_ref: input.currentCostRef } : {}),
    ...(input.currentStock !== undefined ? { current_stock: input.currentStock } : {}),
    ...(input.imageUrl !== undefined ? { image_url: input.imageUrl } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.minStock !== undefined ? { min_stock: input.minStock } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.salePriceRef !== undefined ? { sale_price_ref: input.salePriceRef } : {}),
    ...(input.sku !== undefined ? { sku: normalizeSku(input.sku) } : {}),
  };
}

function applyProductFilters<TQuery extends {
  eq: (column: string, value: boolean | string) => TQuery;
  or: (filters: string) => TQuery;
}>(query: TQuery, searchParams: URLSearchParams): TQuery {
  const barcode = normalizeBarcode(searchParams.get("barcode"));
  const categoryId = searchParams.get("categoryId");
  const isActive = searchParams.get("isActive");
  const search = searchParams.get("search")?.trim();

  let filteredQuery = query;

  if (categoryId) {
    filteredQuery = filteredQuery.eq("category_id", categoryId);
  }

  if (isActive !== null) {
    filteredQuery = filteredQuery.eq("is_active", isActive.toLowerCase() === "true");
  }

  if (barcode) {
    return filteredQuery.eq("barcode", barcode);
  }

  if (search) {
    filteredQuery = filteredQuery.or(buildProductSearchOrFilter(search));
  }

  return filteredQuery;
}

export async function listProducts(searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  let query = supabase
    .from("products")
    .select(productSelect, { count: "exact" });

  query = applyProductFilters(query, searchParams);
  query = applyProductSort(query, searchParams);

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapProduct(row as unknown as ProductRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getProductById(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .select(productSelect)
    .eq("id", id)
    .maybeSingle<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return mapProduct(data);
}

export async function createProduct(input: ProductInput) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .insert(toProductInsert(input))
    .select(productSelect)
    .single<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear el producto.");
  }

  return mapProduct(data);
}

export async function updateProduct(id: string, input: ProductInput) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .update(toProductUpdate(input))
    .eq("id", id)
    .select(productSelect)
    .maybeSingle<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return mapProduct(data);
}

export async function deleteProduct(id: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: false })
    .eq("id", id)
    .eq("is_active", true)
    .select(productSelect)
    .maybeSingle<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return {
    ...mapProduct(data),
    deleted: true,
  };
}

export async function updateProductPrice(id: string, input: ProductPriceInput) {
  const supabase = await createRouteSupabaseClient();

  const { data: productRow, error: productError } = await supabase.rpc("update_product_price", {
    p_new_sale_price_ref: input.salePriceRef,
    p_product_id: id,
    p_reason: null,
  });

  throwIfSupabaseError(productError);

  if (!productRow) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  const { data: historyRow, error: historyError } = await supabase
    .from("product_price_history")
    .select("id, product_id, old_sale_price_ref, new_sale_price_ref, reason, changed_by, created_at")
    .eq("product_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ProductPriceHistoryRow>();

  throwIfSupabaseError(historyError);

  if (!historyRow) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar el historial de precio.");
  }

  const product = await getProductById(id);

  return {
    history: mapProductPriceHistory(historyRow),
    product,
  };
}

export async function getProductPriceHistory(id: string, searchParams: URLSearchParams) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  const { count: productCount, error: productError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("id", id);

  throwIfSupabaseError(productError);

  if (!productCount) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  const { count, data, error } = await supabase
    .from("product_price_history")
    .select("id, product_id, old_sale_price_ref, new_sale_price_ref, reason, changed_by, created_at", {
      count: "exact",
    })
    .eq("product_id", id)
    .order("created_at", { ascending: false })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapProductPriceHistory(row as ProductPriceHistoryRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}
