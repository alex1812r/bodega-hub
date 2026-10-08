import {
  DEFAULT_MARGIN_THRESHOLDS,
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
 * ÚNICO punto del servidor que decide los cortes de banda del listado (real y
 * mock). Hoy son los por defecto de `@bodega/core`; PRO-09 los leerá de la
 * configuración de la tienda cambiando solo esta función.
 */
export function getProductMarginThresholds(): MarginThresholds {
  return DEFAULT_MARGIN_THRESHOLDS;
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
