"use client";

import { useCallback, useContext } from "react";

import { QueryClientContext } from "@tanstack/react-query";

import { productsQueryKeys } from "./useProducts";

/**
 * Vuelve a pedir las listas de categorías (`useCategories` y `useAllCategories`) que
 * haya en pantalla: para que un selector abierto hace rato ofrezca las que creó otro
 * usuario sin recargar la página (GC-01).
 *
 * Lee el cliente del contexto y no con `useQueryClient`: el formulario de producto
 * recibe las categorías por props y también se monta sin proveedor de consultas;
 * ahí no hay lista que refrescar y no hace nada.
 */
export function useRefreshCategories() {
  const queryClient = useContext(QueryClientContext);

  return useCallback(() => {
    if (!queryClient) {
      return;
    }

    for (const scope of ["categories", "categories-all"]) {
      void queryClient.invalidateQueries({ queryKey: [...productsQueryKeys.all, scope] });
    }
  }, [queryClient]);
}
