import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { parsePagination } from "@/lib/api/pagination";
import {
  mapProduct,
  mapProductPriceHistory,
  type ProductPriceHistoryRow,
  type ProductRow,
} from "@/lib/supabase/mappers";
import { mapSupabaseError, throwIfSupabaseError } from "@/lib/supabase/errors";
import { getSupabaseUrl } from "@/lib/supabase/env";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  attachPackConversionToProduct,
  upsertPackConversionForPackProduct,
} from "./packConversion.server";
import type { PackConversionInput } from "./packConversionSchemas";
import { assertAllowedProductImageUrl } from "./productImagePaths";
import type {
  ProductInput,
  ProductPriceInput,
} from "./products.mock-server";
import { applyProductSort } from "./productSort";
import { buildProductSearchOrFilter, normalizeBarcode } from "./productSearch";
import {
  buildProductSaleHistoryResult,
  mapProductSaleHistoryRow,
} from "./productSales";
import { normalizeSku } from "@/shared/utils/skuGeneration";

function assertProductImageUrlInput(productId: string, imageUrl: string | null | undefined) {
  if (imageUrl == null) {
    return;
  }

  try {
    assertAllowedProductImageUrl(getSupabaseUrl(), productId, imageUrl);
  } catch (error) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      error instanceof Error ? error.message : "imageUrl no es valido para este producto.",
    );
  }
}

export type ProductInputWithPackConversion = ProductInput & {
  packConversion?: PackConversionInput;
};

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
  category:categories(id, name, description, tax_rate, is_active, created_at, updated_at)
`;

function toProductInsert(input: ProductInput, storeId: string) {
  return {
    barcode: normalizeBarcode(input.barcode),
    category_id: input.categoryId ?? null,
    current_cost_ref: input.currentCostRef ?? 0,
    // Siempre 0: el stock inicial entra por `adjust_stock` (movimiento
    // `inventario_inicial`), nunca como valor crudo de la fila (C1).
    current_stock: 0,
    image_url: input.imageUrl ?? null,
    min_stock: input.minStock ?? 5,
    name: input.name ?? "Producto",
    sale_price_ref: input.salePriceRef ?? 0,
    sku: normalizeSku(input.sku ?? ""),
    store_id: storeId,
  };
}

function toProductUpdate(input: ProductInput) {
  return {
    ...(input.barcode !== undefined ? { barcode: normalizeBarcode(input.barcode) } : {}),
    ...(input.categoryId !== undefined ? { category_id: input.categoryId ?? null } : {}),
    ...(input.currentCostRef !== undefined ? { current_cost_ref: input.currentCostRef } : {}),
    // `current_stock` nunca se escribe desde aqui: solo los RPC con movimiento
    // (create_sale, adjust_stock, receive_purchase...) pueden moverlo.
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

export async function listProducts(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  let query = supabase
    .from("products")
    .select(productSelect, { count: "exact" })
    .eq("store_id", storeId);

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

export async function getProductById(id: string, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
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

  return attachPackConversionToProduct(mapProduct(data), storeId);
}

const INITIAL_STOCK_REASON = "Inventario inicial al crear el producto";

/**
 * Registra el stock inicial de un producto recien creado como movimiento
 * `inventario_inicial` (RPC `adjust_stock`, con la sesion del usuario). Si el
 * ajuste falla, borra el producto para no dejar un alta a medias.
 */
async function registerInitialStock(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  productId: string,
  quantity: number,
  storeId: string,
) {
  const { error } = await supabase.rpc("adjust_stock", {
    p_product_id: productId,
    p_quantity_delta: quantity,
    p_reason: INITIAL_STOCK_REASON,
    p_type: "inventario_inicial",
  });

  if (!error) {
    return;
  }

  const adjustError = mapSupabaseError(error);
  const { data: deleted, error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("store_id", storeId)
    .select("id");

  if (deleteError || !deleted?.length) {
    throw new ApiError(
      adjustError.status,
      adjustError.code,
      `${adjustError.message} Ademas no se pudo deshacer el alta: el producto quedo creado con stock 0 (id ${productId}). Registra su stock con un ajuste de inventario.`,
    );
  }

  throw adjustError;
}

export async function createProduct(input: ProductInputWithPackConversion, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { packConversion, ...productInput } = input;
  const { data, error } = await supabase
    .from("products")
    .insert(toProductInsert(productInput, storeId))
    .select(productSelect)
    .single<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear el producto.");
  }

  const initialStock = productInput.currentStock ?? 0;

  if (initialStock > 0) {
    await registerInitialStock(supabase, data.id, initialStock, storeId);
  }

  if (packConversion) {
    await upsertPackConversionForPackProduct(data.id, storeId, packConversion, {
      categoryId: productInput.categoryId,
      currentCostRef: productInput.currentCostRef,
      name: productInput.name,
    });
  }

  return getProductById(data.id, storeId);
}

export async function updateProduct(
  id: string,
  input: ProductInputWithPackConversion,
  storeId: string,
) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  if (input.imageUrl !== undefined) {
    assertProductImageUrlInput(id, input.imageUrl);
  }
  const { packConversion, ...productInput } = input;
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .update(toProductUpdate(productInput))
    .eq("id", id)
    .select(productSelect)
    .maybeSingle<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  if (packConversion) {
    await upsertPackConversionForPackProduct(id, storeId, packConversion, {
      categoryId: productInput.categoryId ?? data.category_id ?? undefined,
      currentCostRef:
        productInput.currentCostRef ??
        (data.current_cost_ref != null ? Number(data.current_cost_ref) : undefined),
      name: productInput.name ?? data.name,
    });
  }

  return getProductById(id, storeId);
}

export async function addProductBarcode(id: string, barcode: string, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const normalized = normalizeBarcode(barcode);
  if (!normalized) {
    throw new ApiError(400, "BAD_REQUEST", "El codigo de barras es obligatorio.");
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("add_product_barcode", {
    p_barcode: normalized,
    p_product_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return getProductById(id, storeId);
}

export async function deleteProduct(id: string, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
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

export async function updateProductPrice(id: string, input: ProductPriceInput, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
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

  const product = await getProductById(id, storeId);

  return {
    history: mapProductPriceHistory(historyRow),
    product,
  };
}

export async function getProductPriceHistory(
  id: string,
  searchParams: URLSearchParams,
  storeId: string,
) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
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

type ProductSaleEmbed = {
  created_at: string;
  invoice_number: string;
  status: string;
  store_id: string;
};

type ProductSaleItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  sale_id: string;
  sales: ProductSaleEmbed | ProductSaleEmbed[] | null;
  subtotal_ref: number;
  subtotal_ves: number;
  unit_price_ref: number;
};

const productSaleItemsSelect = `
  id,
  quantity,
  unit_price_ref,
  subtotal_ref,
  subtotal_ves,
  sale_id,
  product_id,
  sales!inner (
    invoice_number,
    created_at,
    status,
    store_id
  )
`;

function unwrapProductSale(sales: ProductSaleItemRow["sales"]) {
  if (!sales) {
    return null;
  }

  return Array.isArray(sales) ? (sales[0] ?? null) : sales;
}

export async function getProductSales(
  id: string,
  searchParams: URLSearchParams,
  storeId: string,
) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("sale_items")
    .select(productSaleItemsSelect)
    .eq("product_id", id)
    .eq("sales.store_id", storeId);

  throwIfSupabaseError(error);

  const rows = ((data ?? []) as ProductSaleItemRow[]).flatMap((row) => {
    const sale = unwrapProductSale(row.sales);

    if (!sale) {
      return [];
    }

    return [
      mapProductSaleHistoryRow(
        {
          id: row.id,
          quantity: row.quantity,
          saleId: row.sale_id,
          subtotalRef: Number(row.subtotal_ref),
          subtotalVes: Number(row.subtotal_ves),
          unitPriceRef: Number(row.unit_price_ref),
        },
        {
          createdAt: sale.created_at,
          id: row.sale_id,
          invoiceNumber: sale.invoice_number,
          status: sale.status,
          storeId: sale.store_id,
        },
      ),
    ];
  });

  return buildProductSaleHistoryResult(rows, searchParams);
}
