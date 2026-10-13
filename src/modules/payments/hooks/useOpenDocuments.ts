"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

import type {
  OpenDocument,
  OpenDocumentContact,
  OpenDocumentsList,
  OpenDocumentsTotals,
  OpenDocumentType,
} from "../services/openDocuments.mock-server";

export type {
  OpenDocument,
  OpenDocumentContact,
  OpenDocumentsList,
  OpenDocumentsTotals,
  OpenDocumentType,
};

export type OpenDocumentsFilters = PaginationParams & {
  contactId?: string;
  /** Fecha Caracas `YYYY-MM-DD` del documento, inclusive. */
  from?: string;
  /** Documentos con N dias o mas de antiguedad (entero >= 1). */
  olderThanDays?: number;
  /** Numero de venta/compra, o nombre/RIF del contacto. */
  search?: string;
  /** Fecha Caracas `YYYY-MM-DD` del documento, inclusive. */
  to?: string;
  /** Sin tipo: ventas y, si el rol puede, tambien compras. */
  type?: OpenDocumentType;
};

/**
 * Cuelga de `["payments"]` (`paymentsQueryKeys.all`): cualquier invalidacion del
 * modulo de pagos refresca tambien los documentos con saldo.
 */
export const openDocumentsQueryKeys = {
  all: ["payments", "open-documents"] as const,
  list: (filters: OpenDocumentsFilters = {}) =>
    [...openDocumentsQueryKeys.all, filters] as const,
};

export function useOpenDocuments(
  filters: OpenDocumentsFilters = {},
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled,
    queryKey: openDocumentsQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<OpenDocumentsList>("/api/payments/open-documents", {
        query: filters,
      }),
  });
}
