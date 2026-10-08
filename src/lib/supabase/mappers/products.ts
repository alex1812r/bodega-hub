import { mapBaseEntity, mapBoolean, mapNullableString } from "@/lib/supabase/mappers/base";
import { mapCategory, type CategoryRow } from "@/lib/supabase/mappers/categories";
import type { MarginBand } from "@/shared/utils/pricing";
import { normalizeSku } from "@/shared/utils/skuGeneration";

/**
 * Fila de la vista `products_price_review` (parche 20261009c): un producto
 * activo cuyo costo subió y cuya banda de ganancia es peor que la de su última
 * instantánea de precio. Las bandas llegan como `red` / `yellow` / `green`.
 */
export type ProductPriceReviewRow = {
  current_band?: string | null;
  current_cost_ref?: number | string | null;
  current_margin_pct?: number | string | null;
  name?: string | null;
  previous_band?: string | null;
  previous_cost_ref?: number | string | null;
  previous_margin_pct?: number | string | null;
  product_id: string;
  purchase_id?: string | null;
  purchase_number?: string | null;
  purchase_received_at?: string | null;
  sale_price_ref?: number | string | null;
  sku?: string | null;
  snapshot_at?: string | null;
  supplier_name?: string | null;
};

/** Compra recibida que subió el costo (la más reciente posterior a la instantánea). */
export type ProductPriceReviewPurchase = {
  id: string;
  number: string;
  receivedAt: string;
  supplierName?: string;
};

/** Por qué un producto está en la cola "Por revisar": antes → ahora. */
export type ProductPriceReview = {
  currentBand: MarginBand;
  currentCostRef: number;
  currentMarginPct: number;
  previousBand: MarginBand;
  previousCostRef: number;
  previousMarginPct: number;
  /** Sin compra: el costo cambió por otra vía (edición, importación). */
  purchase?: ProductPriceReviewPurchase;
  snapshotAt: string;
};

/** Fila de `GET /api/products/price-review`. */
export type ProductPriceReviewItem = ProductPriceReview & {
  name: string;
  productId: string;
  salePriceRef: number;
  sku: string;
};

const REVIEW_BANDS: Record<string, MarginBand> = { green: "high", red: "low", yellow: "mid" };

export type DbProductSummaryRow = {
  barcode?: string | null;
  category?: CategoryRow | null;
  category_id?: string | null;
  current_cost_ref?: number | string | null;
  current_stock?: number | null;
  id: string;
  image_url?: string | null;
  is_active?: boolean | null;
  min_stock?: number | null;
  name: string;
  /** Relación calculada `price_review(products)`: la fila de la cola, si el producto está en ella. */
  price_review?: ProductPriceReviewRow | ProductPriceReviewRow[] | null;
  sale_price_ref?: number | string | null;
  sku: string;
};

export type ProductRow = DbProductSummaryRow & {
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

/**
 * La fila de la cola como `priceReview`. `null` si le falta una banda
 * comparable (no debería ocurrir: la vista ya excluye los productos sin costo).
 */
export function mapProductPriceReview(row: ProductPriceReviewRow): ProductPriceReview | null {
  const currentBand = REVIEW_BANDS[row.current_band ?? ""];
  const previousBand = REVIEW_BANDS[row.previous_band ?? ""];

  if (!currentBand || !previousBand) {
    return null;
  }

  return {
    currentBand,
    currentCostRef: toNumber(row.current_cost_ref),
    currentMarginPct: toNumber(row.current_margin_pct),
    previousBand,
    previousCostRef: toNumber(row.previous_cost_ref),
    previousMarginPct: toNumber(row.previous_margin_pct),
    ...(row.purchase_id
      ? {
          purchase: {
            id: row.purchase_id,
            number: row.purchase_number ?? "",
            receivedAt: row.purchase_received_at ?? "",
            ...(row.supplier_name ? { supplierName: row.supplier_name } : {}),
          },
        }
      : {}),
    snapshotAt: row.snapshot_at ?? "",
  };
}

export function mapProductPriceReviewItem(row: ProductPriceReviewRow): ProductPriceReviewItem | null {
  const review = mapProductPriceReview(row);

  if (!review) {
    return null;
  }

  return {
    ...review,
    name: row.name ?? "",
    productId: row.product_id,
    salePriceRef: toNumber(row.sale_price_ref),
    sku: normalizeSku(row.sku ?? ""),
  };
}

/** PostgREST devuelve la relación calculada como objeto, `null` o lista de 0 / 1 filas. */
function mapEmbeddedPriceReview(embed: DbProductSummaryRow["price_review"]) {
  const row = Array.isArray(embed) ? embed[0] : embed;

  return row ? mapProductPriceReview(row) : null;
}

export function mapProductSummary(row: DbProductSummaryRow) {
  const category = row.category ? mapCategory(row.category) : undefined;

  return {
    barcode: mapNullableString(row.barcode),
    categoryId: mapNullableString(row.category_id) ?? category?.id ?? "",
    currentCostRef: toNumber(row.current_cost_ref),
    currentStock: row.current_stock ?? 0,
    id: row.id,
    imageUrl: mapNullableString(row.image_url),
    isActive: mapBoolean(row.is_active, true),
    minStock: row.min_stock ?? 0,
    name: row.name,
    salePriceRef: toNumber(row.sale_price_ref),
    sku: normalizeSku(row.sku),
    taxRate: category?.taxRate ?? 0,
  };
}

export function mapProduct(row: ProductRow) {
  const summary = mapProductSummary(row);
  const priceReview = mapEmbeddedPriceReview(row.price_review);

  return {
    ...summary,
    ...mapBaseEntity(row),
    category: row.category ? mapCategory(row.category) : undefined,
    description: mapNullableString(row.description),
    // Solo cuando el producto está en la cola "Por revisar".
    ...(priceReview ? { priceReview } : {}),
  };
}

export function mapProductPriceHistory(row: ProductPriceHistoryRow) {
  return {
    createdAt: row.created_at ?? "",
    id: row.id,
    // Precio antes del cambio, tal como lo guardó la fila (`null` si no se registró).
    previousSalePriceRef:
      row.old_sale_price_ref === null || row.old_sale_price_ref === undefined
        ? null
        : toNumber(row.old_sale_price_ref),
    productId: row.product_id,
    salePriceRef: toNumber(row.new_sale_price_ref),
    userId: row.changed_by ?? "",
  };
}
