"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useProducts } from "@/modules/products/hooks/useProducts";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";

import { purchasesQueryKeys, useSupplierProducts } from "../../hooks/usePurchases";
import { fetchPurchaseLastCosts } from "../services/purchaseLastCosts";
import {
  applyLastPurchaseCost,
  mergePurchaseCatalog,
  PURCHASE_CATALOG_LIMIT,
} from "../utils/buildPurchaseCatalog";

export const PURCHASE_PRODUCT_SEARCH_DEBOUNCE_MS = 300;

/**
 * Buscador de productos de la compra: busca en servidor, con debounce, entre
 * TODOS los productos activos de la tienda y los cruza con el catálogo del
 * proveedor para poner primero los vinculados.
 *
 * El costo sugerido de cada resultado es el de su última compra recibida: se pide
 * una vez por página de resultados y NO retrasa la lista. Mientras no ha llegado
 * (o si se está volviendo a pedir, o falló) el producto va marcado
 * `lastCostPending` y quien lo agregue lo consulta antes de crear la línea.
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

  const found = useMemo(
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
  const productIds = useMemo(() => found.map((product) => product.productId), [found]);
  const lastCosts = useQuery({
    // Con la página de resultados ya completa: una sola petición por página.
    enabled: productIds.length > 0 && !supplierProducts.isFetching && !products.isFetching,
    queryFn: () => fetchPurchaseLastCosts(supplierId, productIds),
    queryKey: purchasesQueryKeys.lastCosts(supplierId, productIds),
  });
  // Solo una respuesta al día vale: una en caché que se está refrescando puede ser de
  // antes de la última compra.
  const knownCosts = lastCosts.isSuccess && !lastCosts.isFetching ? lastCosts.data : null;

  const catalog = useMemo(
    () =>
      found.map((product) =>
        knownCosts
          ? applyLastPurchaseCost(product, knownCosts.get(product.productId)?.unitCostRef)
          : { ...product, lastCostPending: true },
      ),
    [found, knownCosts],
  );

  return {
    catalog,
    error: enabled ? (products.error ?? supplierProducts.error ?? null) : null,
    isSearching:
      Boolean(supplierId && typed) &&
      (typed !== term || supplierProducts.isFetching || products.isFetching),
  };
}
