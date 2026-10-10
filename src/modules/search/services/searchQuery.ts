import {
  escapeIlike,
  isUnsearchableSearchTerm,
  normalizeBarcode,
} from "@/modules/products/services/productSearch";
import { stripControlChars } from "@/modules/products/services/productText";

import {
  GLOBAL_SEARCH_LIMIT,
  GLOBAL_SEARCH_MIN_LENGTH,
  type GlobalSearchProduct,
} from "../types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `q` tal como se busca: sin caracteres de control (NUL incluido), con espacios simples y recortado. */
export function normalizeGlobalSearchQuery(value: string | null | undefined): string {
  return stripControlChars(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Largo en caracteres (no en unidades UTF-16): un emoji cuenta uno. */
export function globalSearchQueryLength(query: string): number {
  return Array.from(query).length;
}

/**
 * `true` si el término no llega a consulta: es más corto que el mínimo o solo
 * tiene comodines (`%`, `_`, `*`, `\`, `"`), que casarían con la tienda entera.
 */
export function isGlobalSearchQueryTooShort(query: string): boolean {
  return (
    globalSearchQueryLength(query) < GLOBAL_SEARCH_MIN_LENGTH || isUnsearchableSearchTerm(query)
  );
}

/**
 * El término como UUID en minúsculas, o `null`. Solo con un UUID bien formado se
 * compara contra una columna `id`: cualquier otro texto ahí es un error de cast.
 */
export function toSearchUuid(query: string): string | null {
  return UUID_PATTERN.test(query) ? query.toLowerCase() : null;
}

/**
 * Patrón `ilike` entre comillas dobles, listo para un `or=(…)` de PostgREST: las
 * comillas hacen texto de `,`, `(`, `)`, `.` y `:`, y `escapeIlike` ya cambió por
 * `_` lo único que habría que escapar dentro de ellas (`"` y `\`) y los comodines.
 */
export function quotedIlikePattern(query: string, mode: "contains" | "exact" | "prefix"): string {
  const term = escapeIlike(query);

  if (mode === "exact") {
    return `"${term}"`;
  }

  return mode === "prefix" ? `"${term}%"` : `"%${term}%"`;
}

/** Filtro `or` de PostgREST: `ilike` sobre cada columna y, si el término es un UUID, también por `id`. */
export function buildSearchOrFilter(columns: readonly string[], query: string): string {
  const pattern = quotedIlikePattern(query, "contains");
  const uuid = toSearchUuid(query);

  return [...columns.map((column) => `${column}.ilike.${pattern}`), ...(uuid ? [`id.eq.${uuid}`] : [])].join(
    ",",
  );
}

export function containsIgnoreCase(value: string | null | undefined, query: string): boolean {
  return Boolean(value) && (value as string).toLowerCase().includes(query.toLowerCase());
}

/** Orden de un producto: id o código de barras exacto, SKU exacto, SKU por prefijo, resto. */
function productRank(product: GlobalSearchProduct, query: string): number {
  const term = query.toLowerCase();
  const sku = product.sku.toLowerCase();

  if (product.id.toLowerCase() === term || normalizeBarcode(product.barcode) === query) {
    return 0;
  }

  if (sku === term) {
    return 1;
  }

  return sku.startsWith(term) ? 2 : 3;
}

/** Quita repetidos, ordena por tipo de coincidencia (y nombre) y corta al límite por tipo. */
export function rankProducts(products: GlobalSearchProduct[], query: string): GlobalSearchProduct[] {
  const unique = [...new Map(products.map((product) => [product.id, product])).values()];

  return unique
    .map((product) => ({ product, rank: productRank(product, query) }))
    .sort((a, b) => a.rank - b.rank || a.product.name.localeCompare(b.product.name, "es"))
    .slice(0, GLOBAL_SEARCH_LIMIT)
    .map(({ product }) => product);
}
