/**
 * SCN-UI-C1 · Retomar una revisión de factura que quedó a medias (recarga antes de
 * «Cargar»). El borrador local guarda solo el `scanId`; `GET /api/purchases/invoice-scan/[id]`
 * devuelve lo leído y lo emparejado, y solo un escaneo aún `extracted` se puede retomar.
 */
import type { InvoiceExtraction, InvoiceMatch, InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";

/** Lo que usa el cliente del detalle del escaneo. */
type InvoiceScanDetailPayload = {
  extraction: InvoiceExtraction | null;
  matched: InvoiceMatch | null;
  scanId: string;
  status: string;
};

/** El detalle como respuesta de escaneo para la revisión; `null` si ya no se puede revisar. */
export function toResumableInvoiceScan(detail: InvoiceScanDetailPayload): InvoiceScanResponse | null {
  if (detail.status !== "extracted" || !detail.extraction || !detail.matched) {
    return null;
  }

  return {
    // Viene de un escaneo guardado: no consume cupo. La revisión no usa `limits`.
    cached: true,
    extraction: detail.extraction,
    limits: { limit: 0, remaining: 0, used: 0 },
    matched: detail.matched,
    scanId: detail.scanId,
  };
}

/** `null` si el escaneo ya no está por revisar o ya no existe (404). */
export async function fetchResumableInvoiceScan(
  scanId: string,
  signal?: AbortSignal,
): Promise<InvoiceScanResponse | null> {
  try {
    const detail = await apiFetch<InvoiceScanDetailPayload>(
      `/api/purchases/invoice-scan/${encodeURIComponent(scanId)}`,
      { signal },
    );

    return toResumableInvoiceScan(detail);
  } catch (error) {
    if (error instanceof ClientApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
