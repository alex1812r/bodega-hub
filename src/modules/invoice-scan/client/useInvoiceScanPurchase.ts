"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";

/** Lo que usa el cliente de `GET /api/purchases/invoice-scan/[id]`. */
type InvoiceScanPurchasePayload = { purchaseId?: string | null };

export function fetchInvoiceScanPurchaseId(scanId: string, signal?: AbortSignal): Promise<string | null> {
  return apiFetch<InvoiceScanPurchasePayload>(`/api/purchases/invoice-scan/${encodeURIComponent(scanId)}`, {
    signal,
  }).then((detail) => detail?.purchaseId ?? null);
}

/**
 * Compra registrada con un escaneo anterior (aviso de factura duplicada). `null`
 * mientras carga, si falla o si ese escaneo aún no está en ninguna compra: el aviso
 * dice entonces solo que la factura ya se escaneó. Sin `scanId` no pide nada.
 */
export function useInvoiceScanPurchase(scanId: string | null | undefined) {
  const query = useQuery({
    enabled: Boolean(scanId),
    queryFn: ({ signal }) => fetchInvoiceScanPurchaseId(scanId ?? "", signal),
    queryKey: ["invoice-scan", "purchase", scanId ?? ""],
    retry: false,
  });

  return { purchaseId: query.data ?? null };
}
