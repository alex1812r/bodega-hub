import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";

function hasPosStock(product: Pick<ProductWithCategory, "currentStock">) {
  return product.currentStock > 0;
}

/**
 * POS catalog order: in-stock first, then alphabetical by name.
 * Does not rank by stock quantity — only stock vs no stock.
 */
export function sortPosCatalogProducts<T extends Pick<ProductWithCategory, "currentStock" | "name">>(
  products: readonly T[],
): T[] {
  return [...products].sort((left, right) => {
    const leftRank = hasPosStock(left) ? 0 : 1;
    const rightRank = hasPosStock(right) ? 0 : 1;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.name.localeCompare(right.name, "es", { sensitivity: "base" });
  });
}
