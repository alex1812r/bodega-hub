"use client";

import { useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useProducts } from "@/modules/products/hooks/useProducts";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";

import { useSupplierProducts } from "../../hooks/usePurchases";
import { mergePurchaseCatalog, PURCHASE_CATALOG_LIMIT } from "../utils/buildPurchaseCatalog";

export const PURCHASE_PRODUCT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Buscador de productos de la compra: busca en servidor, con debounce, entre
 * TODOS los productos activos de la tienda y los cruza con el catálogo del
 * proveedor para poner primero los vinculados.
 */
export function usePurchaseProductSearch(supplierId: string, search: string) {
  const typed = search.trim();
  const term = useDebouncedValue(typed, PURCHASE_PRODUCT_SEARCH_DEBOUNCE_MS);
  const enabled = Boolean(supplierId && term);
  const supplierProducts = useSupplierProducts(enabled ? supplierId : undefined, {
    limit: PURCHASE_CATALOG_LIMIT,
    search: term || undefined,
  });
  const products = useProducts(
    { isActive: true, limit: PURCHASE_CATALOG_LIMIT, search: term },
    { enabled },
  );

  const catalog = useMemo(
    () =>
      enabled
        ? mergePurchaseCatalog(
            supplierId,
            getPaginatedItems(supplierProducts.data),
            getPaginatedItems(products.data),
          )
        : [],
    [enabled, products.data, supplierId, supplierProducts.data],
  );

  return {
    catalog,
    error: enabled ? (products.error ?? supplierProducts.error ?? null) : null,
    isSearching:
      Boolean(supplierId && typed) &&
      (typed !== term || supplierProducts.isFetching || products.isFetching),
  };
}
