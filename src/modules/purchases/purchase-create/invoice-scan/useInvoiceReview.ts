"use client";

import { useMemo, useReducer } from "react";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import {
  createInvoiceReviewState,
  reviewReducer,
  summarizeInvoiceReview,
  type InvoiceReviewContext,
} from "./reviewModel";

/**
 * Hook delgado sobre `reviewReducer` (SCN-08a): estado de la revisión + lo derivado.
 * El estado se arma una sola vez con la respuesta y el contexto del primer render;
 * para otro escaneo, montar de nuevo (cambiar la `key` del componente).
 */
export function useInvoiceReview(response: InvoiceScanResponse, context: InvoiceReviewContext) {
  const [state, dispatch] = useReducer(reviewReducer, undefined, () =>
    createInvoiceReviewState(response, context),
  );
  const summary = useMemo(() => summarizeInvoiceReview(state), [state]);

  return { dispatch, state, summary };
}
