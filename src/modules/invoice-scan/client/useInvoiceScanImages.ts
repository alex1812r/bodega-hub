"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

/** Mismo prefijo que `INVOICE_SCAN_ENDPOINT` (sin arrastrar la subida y su pdf.js). */
const INVOICE_SCAN_DETAIL_ENDPOINT = "/api/purchases/invoice-scan";

/**
 * Las URLs firmadas de lectura caducan a los 5 minutos (`INVOICE_READ_URL_TTL_SECONDS`
 * del servidor): se piden de nuevo a los 4 para que la miniatura siga cargando
 * mientras el usuario revisa.
 */
export const INVOICE_SCAN_IMAGES_REFRESH_MS = 4 * 60 * 1000;

/** Lo que usa el cliente de `GET /api/purchases/invoice-scan/[id]`. */
type InvoiceScanImagesPayload = { imageUrls?: string[] };

export const invoiceScanQueryKeys = {
  all: ["invoice-scan"] as const,
  images: (scanId: string) => [...invoiceScanQueryKeys.all, "images", scanId] as const,
};

export function fetchInvoiceScanImages(scanId: string, signal?: AbortSignal): Promise<string[]> {
  return apiFetch<InvoiceScanImagesPayload>(`${INVOICE_SCAN_DETAIL_ENDPOINT}/${encodeURIComponent(scanId)}`, {
    signal,
  }).then((detail) => detail?.imageUrls ?? []);
}

/**
 * Páginas de la factura escaneada (URLs firmadas) para cotejar en la revisión.
 * Sin `scanId` no pide nada.
 */
export function useInvoiceScanImages(scanId: string | null | undefined) {
  const query = useQuery({
    enabled: Boolean(scanId),
    queryFn: ({ signal }) => fetchInvoiceScanImages(scanId ?? "", signal),
    queryKey: invoiceScanQueryKeys.images(scanId ?? ""),
    refetchInterval: INVOICE_SCAN_IMAGES_REFRESH_MS,
    staleTime: INVOICE_SCAN_IMAGES_REFRESH_MS,
  });

  return {
    error: query.error,
    isLoading: query.isPending && Boolean(scanId),
    refetch: query.refetch,
    urls: query.data ?? [],
  };
}
