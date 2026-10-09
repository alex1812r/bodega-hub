"use client";

import { useEffect } from "react";

import { getSkipForPage, getTotalPages } from "@/shared/components/Pagination";
import { useUrlListState } from "@/shared/hooks/useUrlListState";

import { useProductPriceHistory } from "../../hooks/useProducts";
import { productPriceHistorySchema } from "./productDetailParams";

/**
 * Historial de precios del producto, paginado en servidor. La página y el
 * tamaño viven en la URL (`pricesPage`, `pricesLimit`); una página más allá del
 * total cae a la última válida.
 */
export function useProductPriceHistoryPage(productId: string) {
  const { setState, state } = useUrlListState(productPriceHistorySchema, {
    pageField: "pricesPage",
  });
  const limit = state.pricesLimit;
  const skip = getSkipForPage(state.pricesPage, limit);
  const query = useProductPriceHistory(productId, { limit, skip });
  const lastPage = getTotalPages(query.data?.total ?? 0, limit);
  const isPagePastTheEnd = query.data !== undefined && state.pricesPage > lastPage;

  useEffect(() => {
    if (isPagePastTheEnd) {
      setState({ pricesPage: lastPage });
    }
  }, [isPagePastTheEnd, lastPage, setState]);

  return {
    ...query,
    limit,
    setLimit: (nextLimit: number) => setState({ pricesLimit: nextLimit }),
    setSkip: (nextSkip: number) =>
      setState({ pricesPage: Math.floor(Math.max(0, nextSkip) / limit) + 1 }),
    skip,
  };
}
