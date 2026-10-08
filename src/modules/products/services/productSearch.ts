import { stripControlChars } from "./productText";

export type ProductSearchFields = {
  barcode?: string | null;
  name: string;
  sku: string;
};

/** Largo máximo del término de búsqueda de productos; lo que sobra se recorta. */
export const PRODUCT_SEARCH_MAX_LENGTH = 100;

/**
 * Término de búsqueda tal como se usa para filtrar: sin caracteres de control,
 * sin espacios sobrantes y recortado a `PRODUCT_SEARCH_MAX_LENGTH` (un término
 * de miles de caracteres desbordaba la URL de PostgREST y salía como 500).
 */
export function normalizeProductSearch(value: string | null | undefined): string {
  return Array.from(stripControlChars(value ?? "").trim())
    .slice(0, PRODUCT_SEARCH_MAX_LENGTH)
    .join("")
    .trim();
}

/**
 * Deja el término listo para un patrón `ilike` de PostgREST. Los caracteres que
 * ahí no son texto (`%` y `_`, comodines de LIKE; `\`, su escape; `*`, alias de
 * `%` en PostgREST; `"`, delimitador de valor) se cambian por `_`, que casa con
 * un carácter cualquiera: el término sigue encontrando el texto que los
 * contiene y ninguno llega a interpretarse.
 */
export function escapeIlike(value: string) {
  return value.replace(/[%_*\\"]/g, "_");
}

/**
 * `true` si llegó un término pero no deja nada que buscar: solo caracteres de
 * control o solo los que `escapeIlike` cambia por comodín (`%`, `_`, `*`, `\`,
 * `"`). Ese término casaría con todo: el listado responde vacío en vez de
 * devolver la tienda entera. Sin término (vacío o solo espacios) no aplica.
 */
export function isUnsearchableSearchTerm(value: string | null | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }

  return normalizeProductSearch(value).replace(/[%_*\\"\s]/g, "") === "";
}

export function normalizeBarcode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function matchesProductSearch(product: ProductSearchFields, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) {
    return true;
  }

  return [product.name, product.sku, product.barcode]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(term));
}

/** Caracteres reservados de PostgREST: con uno de ellos el valor va entre comillas dobles. */
const POSTGREST_RESERVED_CHARS = /[,.:()]/;

/**
 * Filtro `or` de PostgREST que busca el término en nombre, SKU y código de
 * barras. Un término con caracteres reservados viaja entre comillas dobles: así
 * es texto y no puede cerrar el `or=(…)` ni añadir filtros. `escapeIlike` ya
 * cambió las comillas y las barras invertidas, lo único que habría que escapar
 * dentro de un valor entrecomillado.
 */
export function buildProductSearchOrFilter(search: string): string {
  const pattern = `%${escapeIlike(normalizeProductSearch(search))}%`;
  const value = POSTGREST_RESERVED_CHARS.test(pattern) ? `"${pattern}"` : pattern;

  return `name.ilike.${value},sku.ilike.${value},barcode.ilike.${value}`;
}

export function matchesExactBarcode(
  product: Pick<ProductSearchFields, "barcode">,
  barcode: string,
): boolean {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) {
    return false;
  }

  return normalizeBarcode(product.barcode) === normalized;
}

export function findProductByExactBarcode<T extends Pick<ProductSearchFields, "barcode">>(
  products: T[],
  barcode: string,
): T | undefined {
  return products.find((product) => matchesExactBarcode(product, barcode));
}
