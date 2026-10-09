"use client";

import { useEffect } from "react";

import { getSkipForPage, getTotalPages } from "@/shared/components/Pagination";
import { useUrlListState } from "@/shared/hooks/useUrlListState";

import { useProductSales } from "../../hooks/useProducts";
import { productSalesHistorySchema } from "./productDetailParams";

/**
 * Historial de ventas del producto, paginado en servidor (`skip`/`limit`). La
 * página y el tamaño viven en la URL (`salesPage`, `salesLimit`); una página
 * más allá del total cae a la última válida.
 */
export function useProductSalesHistory(productId: string) {
  const { setState, state } = useUrlListState(productSalesHistorySchema, {
    pageField: "salesPage",
  });
  const limit = state.salesLimit;
  const skip = getSkipForPage(state.salesPage, limit);
  const query = useProductSales(productId, { limit, skip });
  const lastPage = getTotalPages(query.data?.total ?? 0, limit);
  const isPagePastTheEnd = query.data !== undefined && state.salesPage > lastPage;

  useEffect(() => {
    if (isPagePastTheEnd) {
      setState({ salesPage: lastPage });
    }
  }, [isPagePastTheEnd, lastPage, setState]);

  return {
    ...query,
    limit,
    setLimit: (nextLimit: number) => setState({ salesLimit: nextLimit }),
    setSkip: (nextSkip: number) =>
      setState({ salesPage: Math.floor(Math.max(0, nextSkip) / limit) + 1 }),
    skip,
  };
}
