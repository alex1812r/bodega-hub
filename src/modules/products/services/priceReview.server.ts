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

import { assertListFilterParams } from "./listFilterParams";
import { isRangeNotSatisfiable, listCountOptions } from "./listRange";
import {
  buildRepriceReason,
  COST_CHANGED_CODE,
  NO_COST_HINT,
  normalizeRepriceMarkupPct,
  PRICE_REVIEW_COLUMNS,
  REPRICE_NO_COST_MESSAGE,
  resolveRepriceTargets,
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
  assertListFilterParams(searchParams, ["purchaseId"]);

  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const purchaseId = searchParams.get("purchaseId")?.trim();

  /** La consulta con sus filtros; `head` = solo el conteo, sin filas. */
  const buildFilteredQuery = (head: boolean) => {
    const query = supabase
      .from(PRICE_REVIEW_VIEW)
      .select(PRICE_REVIEW_COLUMNS, listCountOptions(head))
      .eq("store_id", storeId);

    return purchaseId ? query.eq("purchase_id", purchaseId) : query;
  };

  const { count, data, error, status } = await buildFilteredQuery(false)
    .order("current_band_rank", { ascending: true })
    .order("margin_drop_pct", { ascending: false })
    .order("product_id", { ascending: true })
    .range(skip, skip + limit - 1);

  // Página más allá del total: no es un error, es una página vacía con el total real.
  if (isRangeNotSatisfiable(error, status)) {
    const total = await buildFilteredQuery(true);

    throwIfSupabaseError(total.error);

    return { items: [], limit, skip, total: total.count ?? 0 };
  }

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
    // Con el costo que vio el usuario, la base responde PT409 (409) si ya es otro.
    ...(input.expectedCostRef === undefined ? {} : { p_expected_cost_ref: input.expectedCostRef }),
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar el historial de precio.");
  }

  return toProductPriceHistoryEntry(data as ProductPriceHistoryRow);
}

/** Error de `reprice_product_to_markup` como fila del lote; el `hint` distingue los rechazos propios. */
function toRepriceFailure(productId: string, error: { hint?: string | null }): RepriceProductResult {
  const mapped = mapSupabaseError(error);

  if (error.hint === COST_CHANGED_CODE) {
    return { code: COST_CHANGED_CODE, message: mapped.message, productId, status: "error" };
  }

  if (error.hint === NO_COST_HINT) {
    return { code: "NO_COST", message: REPRICE_NO_COST_MESSAGE, productId, status: "error" };
  }

  return { code: mapped.code, message: mapped.message, productId, status: "error" };
}

/**
 * Reprecio masivo: una RPC `reprice_product_to_markup` por producto. El precio
 * (costo × (1 + % / 100), con el redondeo de `priceFromMarkup` de `@bodega/core`)
 * se calcula EN LA BASE con el producto bloqueado: aquí no se lee el costo, que
 * podía cambiar (una compra recibida) entre la lectura y el cambio de precio.
 * Con el costo que vio el usuario (`items`), la fila cuyo costo ya es otro
 * responde `COST_CHANGED` sin tocar el precio. Un fallo no aborta el lote: cada
 * producto responde con su precio nuevo o con su error. Un producto sin costo es
 * un error de su fila (nunca se le pone precio 0).
 */
export async function repriceProducts(input: RepriceProductsInput) {
  const supabase = await createRouteSupabaseClient();
  const reason = input.reason ?? buildRepriceReason(input.markupPct);
  const markupPct = normalizeRepriceMarkupPct(input.markupPct);
  const results: RepriceProductResult[] = [];

  // Uno a uno y en orden: cada RPC bloquea su producto y registra su historial.
  // La tienda la fija la sesión dentro de la RPC (otra tienda: PT404).
  for (const { expectedCostRef, productId } of resolveRepriceTargets(input)) {
    const { data, error } = await supabase.rpc("reprice_product_to_markup", {
      p_expected_cost_ref: expectedCostRef,
      p_markup_pct: markupPct,
      p_product_id: productId,
      p_reason: reason,
    });

    if (error) {
      results.push(toRepriceFailure(productId, error));
      continue;
    }

    results.push({
      productId,
      salePriceRef: Number((data as { sale_price_ref: number | string }).sale_price_ref),
      status: "ok",
    });
  }

  return summarizeReprice(results);
}
