import type { PricingSettingsMock } from "@/shared/mocks/erp-data";
import {
  DEFAULT_MARGIN_THRESHOLDS,
  DEFAULT_MARKUP_CHIPS,
  marginBand,
  markupPct,
  type MarginThresholds,
} from "@/shared/utils/pricing";

/**
 * Filtro "Ganancia" del listado de productos (`GET /api/products?margin=`).
 * `low` / `mid` / `high` son las bandas roja / amarilla / verde del semáforo;
 * `none` son los productos sin costo, que no tienen % y quedan FUERA de las
 * tres bandas (un producto sin costo no es "ganancia baja": no se sabe).
 */
export const PRODUCT_MARGIN_FILTERS = ["low", "mid", "high", "none"] as const;

export type ProductMarginFilter = (typeof PRODUCT_MARGIN_FILTERS)[number];

/** Columna generada `products.margin_pct` (parche 20261009a). */
export const MARGIN_PCT_COLUMN = "margin_pct";

/**
 * Ajustes de precios de la tienda (`pricing` de `/api/settings` y
 * `/api/settings/pricing`). Este módulo es puro (lo importan también los
 * formularios del navegador): quien llama los lee UNA vez por petición —el
 * servidor con `getPricingSettings(storeId)` de `settings.server` /
 * `settings.mock-server`, la pantalla con `usePricingSettings()`— y los pasa aquí.
 */
export type ProductPricingSettings = PricingSettingsMock;

/**
 * ÚNICO punto que decide los cortes de banda del semáforo y del filtro
 * "Ganancia" del listado (real y mock): los configurados en la tienda o, si no
 * se pasan (tienda sin configuración, ajustes aún cargando), los por defecto de
 * `@bodega/core`.
 */
export function getProductMarginThresholds(
  pricing?: ProductPricingSettings | null,
): MarginThresholds {
  if (!pricing) {
    return DEFAULT_MARGIN_THRESHOLDS;
  }

  return { high: pricing.greenFromPct, low: pricing.yellowFromPct };
}

/** Lo que el bloque de precio (`PricingFields`) necesita además del costo y el precio. */
export type ProductPricingOptions = {
  /** % recomendados, en el orden en que se ofrecen. */
  chips: readonly number[];
  thresholds: MarginThresholds;
};

/**
 * ÚNICO punto del que los formularios de precio (alta/edición de producto y
 * cambio de precio del detalle) obtienen los chips de % y los cortes del
 * semáforo: los de la tienda, o los por defecto de `@bodega/core` si no se pasan.
 * El % sugerido de la categoría del producto (`category.defaultMarkupPct`), si
 * tiene, va el PRIMERO y no se repite entre los de la tienda.
 */
export function getProductPricingOptions(
  pricing?: ProductPricingSettings | null,
  categoryMarkupPct?: number | null,
): ProductPricingOptions {
  const storeChips = pricing ? pricing.chipsPct : DEFAULT_MARKUP_CHIPS;
  const hasCategoryChip =
    typeof categoryMarkupPct === "number" && Number.isFinite(categoryMarkupPct) && categoryMarkupPct > 0;

  return {
    chips: hasCategoryChip
      ? [categoryMarkupPct, ...storeChips.filter((chip) => chip !== categoryMarkupPct)]
      : storeChips,
    thresholds: getProductMarginThresholds(pricing),
  };
}

/** Un valor desconocido no filtra (igual que el resto de filtros del listado). */
export function parseProductMarginFilter(searchParams: URLSearchParams): ProductMarginFilter | null {
  const value = searchParams.get("margin");

  return PRODUCT_MARGIN_FILTERS.find((filter) => filter === value) ?? null;
}

/**
 * Rango de `margin_pct` de cada banda: `gte` inclusivo, `lt` exclusivo, igual
 * que `marginBand` (rojo < low, amarillo [low, high), verde ≥ high). Los % negativos
 * (precio por debajo del costo) caen en `low`.
 */
export function marginBandRange(
  band: Exclude<ProductMarginFilter, "none">,
  thresholds: MarginThresholds,
): { gte?: number; lt?: number } {
  switch (band) {
    case "low":
      return { lt: thresholds.low };
    case "mid":
      return { gte: thresholds.low, lt: thresholds.high };
    case "high":
      return { gte: thresholds.high };
  }
}

type ProductMarginQuery<TQuery> = {
  gte: (column: string, value: number) => TQuery;
  is: (column: string, value: null) => TQuery;
  lt: (column: string, value: number) => TQuery;
};

/** Aplica el filtro de ganancia a la consulta de PostgREST. `margin_pct` NULL nunca entra en una banda. */
export function applyProductMarginFilter<TQuery extends ProductMarginQuery<TQuery>>(
  query: TQuery,
  filter: ProductMarginFilter | null,
  thresholds: MarginThresholds,
): TQuery {
  if (filter === null) {
    return query;
  }

  if (filter === "none") {
    return query.is(MARGIN_PCT_COLUMN, null);
  }

  const { gte, lt } = marginBandRange(filter, thresholds);
  let filteredQuery = query;

  if (gte !== undefined) {
    filteredQuery = filteredQuery.gte(MARGIN_PCT_COLUMN, gte);
  }

  if (lt !== undefined) {
    filteredQuery = filteredQuery.lt(MARGIN_PCT_COLUMN, lt);
  }

  return filteredQuery;
}

type ProductPricing = { currentCostRef: number; salePriceRef: number };

/** % de ganancia del producto; `null` sin costo. Mismo valor que `products.margin_pct`. */
export function productMarginPct(product: ProductPricing): number | null {
  return markupPct(product.currentCostRef, product.salePriceRef);
}

/** Paridad en memoria de `applyProductMarginFilter` (mock). */
export function matchesProductMarginFilter(
  product: ProductPricing,
  filter: ProductMarginFilter | null,
  thresholds: MarginThresholds,
): boolean {
  if (filter === null) {
    return true;
  }

  const pct = productMarginPct(product);

  if (pct === null) {
    return filter === "none";
  }

  return marginBand(pct, thresholds) === filter;
}
