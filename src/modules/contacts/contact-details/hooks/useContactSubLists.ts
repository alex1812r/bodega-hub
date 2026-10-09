"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import type { PaginatedList } from "@/lib/api/pagination";
import { getCurrentPage, getSkipForPage, getTotalPages } from "@/shared/components/Pagination";
import { useUrlListState } from "@/shared/hooks/useUrlListState";

import {
  useContactActivity,
  useContactPayments,
  useContactPurchases,
  useContactSales,
} from "../../hooks/useContacts";
import {
  contactActivityListSchema,
  contactPaymentsListSchema,
  contactPurchasesListSchema,
  contactSalesListSchema,
} from "./contactDetailParams";

/**
 * Une la consulta paginada con su página de la URL: una página más allá del
 * total cae a la última válida.
 */
function usePagedSubList<TRow>(
  query: UseQueryResult<PaginatedList<TRow>>,
  paging: {
    /** URL exacta del detalle con esta sublista: `returnTo` de sus enlaces. */
    href: string;
    limit: number;
    page: number;
    setLimit: (limit: number) => void;
    setPage: (page: number) => void;
  },
) {
  const { href, limit, page, setLimit, setPage } = paging;
  const lastPage = getTotalPages(query.data?.total ?? 0, limit);
  const isPagePastTheEnd = query.data !== undefined && page > lastPage;

  useEffect(() => {
    if (isPagePastTheEnd) {
      setPage(lastPage);
    }
  }, [isPagePastTheEnd, lastPage, setPage]);

  const setSkip = useCallback(
    (nextSkip: number) => setPage(getCurrentPage(Math.max(0, nextSkip), limit)),
    [limit, setPage],
  );

  return { ...query, href, limit, setLimit, setSkip, skip: getSkipForPage(page, limit) };
}

export type ContactSubList<TRow> = ReturnType<typeof usePagedSubList<TRow>>;

/** Actividad del contacto (ventas, compras y pagos mezclados): `activityPage`, `activityLimit`. */
export function useContactActivityList(contactId: string) {
  const { href, setState, state } = useUrlListState(contactActivityListSchema, {
    pageField: "activityPage",
  });
  const limit = state.activityLimit;
  const page = state.activityPage;
  const query = useContactActivity(contactId, { limit, skip: getSkipForPage(page, limit) });
  const setPage = useCallback((activityPage: number) => setState({ activityPage }), [setState]);
  const setLimit = useCallback((activityLimit: number) => setState({ activityLimit }), [setState]);

  return usePagedSubList(query, { href, limit, page, setLimit, setPage });
}

/** Ventas del contacto: `salesPage`, `salesLimit`. */
export function useContactSalesList(contactId: string) {
  const { href, setState, state } = useUrlListState(contactSalesListSchema, {
    pageField: "salesPage",
  });
  const limit = state.salesLimit;
  const page = state.salesPage;
  const query = useContactSales(contactId, { limit, skip: getSkipForPage(page, limit) });
  const setPage = useCallback((salesPage: number) => setState({ salesPage }), [setState]);
  const setLimit = useCallback((salesLimit: number) => setState({ salesLimit }), [setState]);

  return usePagedSubList(query, { href, limit, page, setLimit, setPage });
}

/** Compras del contacto: `purchasesPage`, `purchasesLimit`. */
export function useContactPurchasesList(contactId: string) {
  const { href, setState, state } = useUrlListState(contactPurchasesListSchema, {
    pageField: "purchasesPage",
  });
  const limit = state.purchasesLimit;
  const page = state.purchasesPage;
  const query = useContactPurchases(contactId, { limit, skip: getSkipForPage(page, limit) });
  const setPage = useCallback((purchasesPage: number) => setState({ purchasesPage }), [setState]);
  const setLimit = useCallback(
    (purchasesLimit: number) => setState({ purchasesLimit }),
    [setState],
  );

  return usePagedSubList(query, { href, limit, page, setLimit, setPage });
}

/** Pagos del contacto: `paymentsPage`, `paymentsLimit`. */
export function useContactPaymentsList(contactId: string) {
  const { href, setState, state } = useUrlListState(contactPaymentsListSchema, {
    pageField: "paymentsPage",
  });
  const limit = state.paymentsLimit;
  const page = state.paymentsPage;
  const query = useContactPayments(contactId, { limit, skip: getSkipForPage(page, limit) });
  const setPage = useCallback((paymentsPage: number) => setState({ paymentsPage }), [setState]);
  const setLimit = useCallback((paymentsLimit: number) => setState({ paymentsLimit }), [setState]);

  return usePagedSubList(query, { href, limit, page, setLimit, setPage });
}
