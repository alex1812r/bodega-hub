import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { parsePagination } from "@/lib/api/pagination";
import { mapSupabaseError, throwIfSupabaseError } from "@/lib/supabase/errors";
import {
  mapProductPriceReviewItem,
  type ProductPriceHistoryRow,
  type ProductPriceReviewRow,
} from "@/lib/supabase/mappers";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { priceFromMarkup } from "@/shared/utils/pricing";

import {
  buildRepriceReason,
  PRICE_REVIEW_COLUMNS,
  REPRICE_NO_COST_MESSAGE,
  summarizeReprice,
  toProductPriceHistoryEntry,
  type ProductPriceReviewItem,
  type RepriceProductResult,
} from "./priceReview";
import type { KeepProductPriceInput, RepriceProductsInput } from "./productSchemas";

const PRICE_REVIEW_VIEW = "products_price_review";

/**
 * Cola "Por revisar" de la tienda (vista `products_price_review`): peor banda
 * primero y, dentro de ella, la mayor caída de %. `purchaseId` la acota a los
 * productos cuyo costo subió esa compra.
 */
export async function listPriceReview(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const purchaseId = searchParams.get("purchaseId")?.trim();

  let query = supabase
    .from(PRICE_REVIEW_VIEW)
    .select(PRICE_REVIEW_COLUMNS, { count: "exact" })
    .eq("store_id", storeId);

  if (purchaseId) {
    query = query.eq("purchase_id", purchaseId);
  }

  const { count, data, error } = await query
    .order("current_band_rank", { ascending: true })
    .order("margin_drop_pct", { ascending: false })
    .order("product_id", { ascending: true })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  const rows = (data ?? []) as unknown as ProductPriceReviewRow[];

  return {
    items: rows
      .map((row) => mapProductPriceReviewItem(row))
      .filter((item): item is ProductPriceReviewItem => item !== null),
    limit,
    skip,
    total: count ?? 0,
  };
}

/** Cuántos productos hay en la cola (tarjeta del dashboard): solo el conteo, sin filas. */
export async function getPriceReviewSummary(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { count, error } = await supabase
    .from(PRICE_REVIEW_VIEW)
    .select("product_id", { count: "exact", head: true })
    .eq("store_id", storeId);

  throwIfSupabaseError(error);

  return { total: count ?? 0 };
}

/**
 * "Mantener precio" (RPC `keep_product_price`): fila de historial sin cambio de
 * precio que vuelve a guardar el costo y la banda actuales. No toca el producto.
 */
export async function keepProductPrice(id: string, input: KeepProductPriceInput, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("keep_product_price", {
    p_product_id: id,
    p_reason: input.reason ?? null,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar el historial de precio.");
  }

  return toProductPriceHistoryEntry(data as ProductPriceHistoryRow);
}

type RepriceProductRow = { current_cost_ref: number | string | null; id: string };

/**
 * Reprecio masivo: precio = costo × (1 + % / 100) con `priceFromMarkup` de
 * `@bodega/core`, un `update_product_price` por producto. Un fallo no aborta el
 * lote: cada producto responde con su precio nuevo o con su error. Un producto
 * sin costo es un error de su fila (nunca se le pone precio 0).
 */
export async function repriceProducts(input: RepriceProductsInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const productIds = [...new Set(input.productIds)];
  const reason = input.reason ?? buildRepriceReason(input.markupPct);

  const { data, error } = await supabase
    .from("products")
    .select("id, current_cost_ref")
    .eq("store_id", storeId)
    .in("id", productIds);

  throwIfSupabaseError(error);

  const costById = new Map(
    ((data ?? []) as RepriceProductRow[]).map((row) => [row.id, Number(row.current_cost_ref ?? 0)]),
  );
  const results: RepriceProductResult[] = [];

  // Uno a uno y en orden: cada RPC bloquea su producto y registra su historial.
  for (const productId of productIds) {
    const costRef = costById.get(productId);

    if (costRef === undefined) {
      results.push({ code: "NOT_FOUND", message: "Producto no encontrado.", productId, status: "error" });
      continue;
    }

    if (!Number.isFinite(costRef) || costRef <= 0) {
      results.push({ code: "NO_COST", message: REPRICE_NO_COST_MESSAGE, productId, status: "error" });
      continue;
    }

    const salePriceRef = priceFromMarkup(costRef, input.markupPct);
    const { error: priceError } = await supabase.rpc("update_product_price", {
      p_new_sale_price_ref: salePriceRef,
      p_product_id: productId,
      p_reason: reason,
    });

    if (priceError) {
      const mapped = mapSupabaseError(priceError);
      results.push({ code: mapped.code, message: mapped.message, productId, status: "error" });
      continue;
    }

    results.push({ productId, salePriceRef, status: "ok" });
  }

  return summarizeReprice(results);
}
