export type ProductSearchFields = {
  barcode?: string | null;
  name: string;
  sku: string;
};

export function escapeIlike(value: string) {
  return value.replace(/[%_,]/g, "");
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

export function buildProductSearchOrFilter(search: string): string {
  const term = escapeIlike(search.trim());
  return `name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`;
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
