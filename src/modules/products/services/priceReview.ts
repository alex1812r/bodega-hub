import {
  mapProductPriceHistory,
  type ProductPriceHistoryRow,
  type ProductPriceReview,
  type ProductPriceReviewItem,
  type ProductPriceReviewPurchase,
} from "@/lib/supabase/mappers";
import {
  bandDrop,
  marginBand,
  markupPct,
  type MarginBand,
  type MarginThresholds,
} from "@/shared/utils/pricing";

/**
 * Cola "Por revisar" (regla 10b): al fijar un precio se guarda el costo y la
 * banda de ganancia del momento; si después el costo sube y la banda actual es
 * peor que la guardada, el producto entra en la cola hasta que se cambie el
 * precio o se elija "Mantener precio". Nunca se cambia un precio solo.
 *
 * Módulo puro: lo comparten el servicio real, el mock, las rutas y los hooks.
 */

export type { ProductPriceReview, ProductPriceReviewItem, ProductPriceReviewPurchase };

/** Motivo de la fila que crea el alta de un producto (y el backfill del parche 20261009c). */
export const PRICE_BASELINE_REASON = "Línea base de ganancia";

/** Motivo por defecto de "Mantener precio" (RPC `keep_product_price`). */
export const PRICE_KEEP_REASON = "Precio mantenido";

/**
 * Qué registra una fila del historial de precios:
 * `change` un cambio de precio; `keep` el precio se mantuvo ("Mantener precio");
 * `baseline` la línea base de ganancia del producto.
 */
export type PriceHistoryKind = "baseline" | "change" | "keep";

/** Entrada de `GET /api/products/[id]/price-history`. */
export type ProductPriceHistoryEntry = {
  createdAt: string;
  id: string;
  kind: PriceHistoryKind;
  /** Precio antes del cambio; `null` si la fila no lo registró. */
  previousSalePriceRef: number | null;
  productId: string;
  reason: string | null;
  salePriceRef: number;
  userId: string;
  /** Nombre de quien la registró; `null` si no hay usuario o su perfil no es visible para quien consulta. */
  userName: string | null;
};

/** Sin precio anterior registrado no hay forma de saber que no cambió: es un cambio. */
export function getPriceHistoryKind(
  previousSalePriceRef: number | null | undefined,
  salePriceRef: number,
  reason: string | null | undefined,
): PriceHistoryKind {
  if (previousSalePriceRef === null || previousSalePriceRef === undefined) {
    return "change";
  }

  if (previousSalePriceRef !== salePriceRef) {
    return "change";
  }

  return reason === PRICE_BASELINE_REASON ? "baseline" : "keep";
}

/** Banda guardada en una instantánea; `none` = el producto no tenía costo. */
export type PriceSnapshotBand = MarginBand | "none";

/** Banda de un precio sobre un costo con los cortes de la tienda (`none` sin costo), como `product_margin_band`. */
export function getPriceSnapshotBand(
  costRef: number,
  salePriceRef: number,
  thresholds: MarginThresholds,
): PriceSnapshotBand {
  const pct = markupPct(costRef, salePriceRef);

  return pct === null ? "none" : marginBand(pct, thresholds);
}

export type PriceReviewSnapshot = {
  at: string;
  band: PriceSnapshotBand;
  costRef: number;
};

/**
 * Misma regla que la vista `products_price_review`: el costo actual es mayor que
 * el de la instantánea y la banda actual es peor que la guardada. Un lado sin
 * costo (`none`) no entra. Devuelve `null` si el producto no está en la cola.
 */
export function buildPriceReview(input: {
  currentCostRef: number;
  purchase?: ProductPriceReviewPurchase;
  salePriceRef: number;
  snapshot: PriceReviewSnapshot;
  thresholds: MarginThresholds;
}): ProductPriceReview | null {
  const { currentCostRef, purchase, salePriceRef, snapshot, thresholds } = input;
  const currentMarginPct = markupPct(currentCostRef, salePriceRef);
  const previousMarginPct = markupPct(snapshot.costRef, salePriceRef);

  if (snapshot.band === "none" || currentMarginPct === null || previousMarginPct === null) {
    return null;
  }

  const currentBand = marginBand(currentMarginPct, thresholds);

  if (!(currentCostRef > snapshot.costRef) || !bandDrop(snapshot.band, currentBand)) {
    return null;
  }

  return {
    currentBand,
    currentCostRef,
    currentMarginPct,
    previousBand: snapshot.band,
    previousCostRef: snapshot.costRef,
    previousMarginPct,
    ...(purchase ? { purchase } : {}),
    snapshotAt: snapshot.at,
  };
}

const BAND_ORDER: Record<MarginBand, number> = { high: 2, low: 0, mid: 1 };

/** Orden por defecto de la cola: peor banda primero y, dentro de ella, la mayor caída de %. */
export function comparePriceReviewItems(left: ProductPriceReviewItem, right: ProductPriceReviewItem) {
  return (
    BAND_ORDER[left.currentBand] - BAND_ORDER[right.currentBand] ||
    right.previousMarginPct - right.currentMarginPct - (left.previousMarginPct - left.currentMarginPct) ||
    left.productId.localeCompare(right.productId)
  );
}

/** "Reprecio al 25 %" / "Reprecio al 12,5 %". */
export function buildRepriceReason(markupPct: number) {
  return `Reprecio al ${String(markupPct).replace(".", ",")} %`;
}

/** Resultado de `POST /api/products/price-review/reprice` para un producto. */
export type RepriceProductResult =
  | { productId: string; salePriceRef: number; status: "ok" }
  | { code: string; message: string; productId: string; status: "error" };

export type RepriceResult = {
  failed: number;
  results: RepriceProductResult[];
  updated: number;
};

export const REPRICE_NO_COST_MESSAGE =
  "El producto no tiene costo: no se puede calcular el precio a partir de un % de ganancia.";

/** Misma `clientRequestId` con otro %: el texto del `PT409` de `reprice_product_to_markup`. */
export const REPRICE_REQUEST_REUSED_MESSAGE =
  "Esta solicitud de reprecio ya se usó con otro % de ganancia";

/**
 * Código de la fila de un reprecio cuyo producto ya no cuesta lo que el usuario
 * vio, y `hint` con el que las RPC de precio marcan ese rechazo (`PT409`).
 */
export const COST_CHANGED_CODE = "COST_CHANGED";

/** `hint` con el que `reprice_product_to_markup` marca un producto sin costo (`PT400`). */
export const NO_COST_HINT = "NO_COST";

/** Costos iguales a dos decimales, como compara `assert_expected_cost_ref` en la base. */
export function isSameCostRef(left: number, right: number) {
  return Math.round(left * 100) === Math.round(right * 100);
}

/** El mismo mensaje que la base (`PT409` de `assert_expected_cost_ref`). */
export function buildCostChangedMessage(expectedCostRef: number, currentCostRef: number) {
  return `El costo cambió de ${expectedCostRef.toFixed(2)} a ${currentCostRef.toFixed(2)}; revisa el precio`;
}

/**
 * % de un reprecio a dos decimales con la regla de `priceFromMarkup` de
 * `@bodega/core` (`Math.round(pct × 100)`): así `price_from_markup` de la base,
 * que redondea en decimal exacto, recibe un % que ya no tiene nada que redondear.
 */
export function normalizeRepriceMarkupPct(markupPct: number) {
  return Math.round(markupPct * 100) / 100;
}

export type RepriceTarget = {
  /** Costo que el usuario vio; `null` = sin comprobación de costo. */
  expectedCostRef: number | null;
  productId: string;
};

/**
 * Productos de un reprecio, sin repetidos y en el orden recibido: primero los de
 * `items` (con su costo esperado) y después los de `productIds` que no estén ya.
 */
export function resolveRepriceTargets(input: {
  items?: { expectedCostRef: number; productId: string }[];
  productIds?: string[];
}): RepriceTarget[] {
  const targets = new Map<string, RepriceTarget>();

  for (const item of input.items ?? []) {
    if (!targets.has(item.productId)) {
      targets.set(item.productId, { expectedCostRef: item.expectedCostRef, productId: item.productId });
    }
  }

  for (const productId of input.productIds ?? []) {
    if (!targets.has(productId)) {
      targets.set(productId, { expectedCostRef: null, productId });
    }
  }

  return [...targets.values()];
}

export function summarizeReprice(results: RepriceProductResult[]): RepriceResult {
  const updated = results.filter((result) => result.status === "ok").length;

  return { failed: results.length - updated, results, updated };
}

/** `review=1` / `review=true` en `GET /api/products`: solo productos en la cola. */
export function isPriceReviewFilterOn(searchParams: URLSearchParams) {
  const value = searchParams.get("review")?.toLowerCase();

  return value === "1" || value === "true";
}

/** Columnas de `products_price_review` que lee el BFF (lista de la cola y relación `price_review` del producto). */
export const PRICE_REVIEW_COLUMNS =
  "product_id, name, sku, sale_price_ref, previous_cost_ref, current_cost_ref, previous_margin_pct, current_margin_pct, previous_band, current_band, snapshot_at, purchase_id, purchase_number, purchase_received_at, supplier_name";

/**
 * Columnas de `product_price_history` que lee el BFF. El nombre del usuario
 * llega en la misma lectura por el embed de `profiles` (como en pagos): lo
 * filtra la RLS de `profiles`, así que cada rol ve los nombres que ya podía ver.
 */
export const PRICE_HISTORY_COLUMNS =
  "id, product_id, old_sale_price_ref, new_sale_price_ref, reason, changed_by, created_at, changed_by_profile:profiles!product_price_history_changed_by_fkey(id, full_name)";

/** La fila del historial con su motivo (`null` si se registró sin él) y qué registra (`kind`). */
export function toProductPriceHistoryEntry(row: ProductPriceHistoryRow): ProductPriceHistoryEntry {
  const entry = mapProductPriceHistory(row);
  const reason = row.reason?.trim() || null;

  return {
    ...entry,
    kind: getPriceHistoryKind(entry.previousSalePriceRef, entry.salePriceRef, reason),
    reason,
  };
}
