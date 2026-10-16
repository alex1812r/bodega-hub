"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

/** Línea aprendida de la factura (`GET /api/purchases/[id]/invoice-scan`, SCN-09a). */
export type PurchaseInvoiceScanLine = {
  lineIndex: number;
  rawText: string;
  productId: string;
  productName: string | null;
  packLabel?: string;
  unitsPerPack?: number;
};

export type PurchaseInvoiceScan = {
  scanId: string;
  createdAt: string;
  confirmedAt: string | null;
  pages: number;
  imageUrls: string[];
  imageExpired: boolean;
  lines: PurchaseInvoiceScanLine[];
  learned: number;
};

/**
 * Las URLs firmadas caducan a los 5 minutos (`INVOICE_READ_URL_TTL_SECONDS`):
 * se piden de nuevo a los 4 mientras la sección sigue abierta.
 */
export const PURCHASE_INVOICE_IMAGES_REFRESH_MS = 4 * 60 * 1000;

export const purchaseInvoiceScanQueryKeys = {
  all: (purchaseId: string) => ["purchases", "invoice-scan", purchaseId] as const,
  images: (purchaseId: string) => [...purchaseInvoiceScanQueryKeys.all(purchaseId), "images"] as const,
  summary: (purchaseId: string) => [...purchaseInvoiceScanQueryKeys.all(purchaseId), "summary"] as const,
};

function endpoint(purchaseId: string) {
  return `/api/purchases/${encodeURIComponent(purchaseId)}/invoice-scan`;
}

/** Respuesta con otra forma (o `null`): la compra no tiene escaneo que mostrar. */
function toScan(value: unknown): PurchaseInvoiceScan | null {
  const scan = value as Partial<PurchaseInvoiceScan> | null;

  if (!scan || typeof scan.scanId !== "string" || !Array.isArray(scan.lines) || !Array.isArray(scan.imageUrls)) {
    return null;
  }

  return scan as PurchaseInvoiceScan;
}

/** Escaneo de la compra sin firmar imágenes (`?images=0`): decide si se pinta la sección. */
export function usePurchaseInvoiceScan(purchaseId: string) {
  return useQuery({
    queryFn: ({ signal }) =>
      apiFetch<unknown>(`${endpoint(purchaseId)}?images=0`, { signal }).then(toScan),
    queryKey: purchaseInvoiceScanQueryKeys.summary(purchaseId),
    retry: false,
  });
}

/** Páginas firmadas de la factura; solo se piden con `enabled` (sección abierta). */
export function usePurchaseInvoiceScanImages(purchaseId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: ({ signal }) => apiFetch<unknown>(endpoint(purchaseId), { signal }).then(toScan),
    queryKey: purchaseInvoiceScanQueryKeys.images(purchaseId),
    refetchInterval: enabled ? PURCHASE_INVOICE_IMAGES_REFRESH_MS : false,
    staleTime: PURCHASE_INVOICE_IMAGES_REFRESH_MS,
  });
}
