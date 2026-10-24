import { apiFetch, ClientApiError } from "@/shared/api/apiFetch";

import type { InvoiceLastUnitCost } from "../server/match.types";

/** REP10-02 (B2): tope de cada intento; sin respuesta se aborta y cuenta como fallo. */
export const LAST_UNIT_COST_TIMEOUT_MS = 8_000;
/** El primero y un reintento: después rechaza y la línea pide reconocer el costo (D42). */
const LAST_UNIT_COST_ATTEMPTS = 2;

/** Un 4xx es la respuesta a esta petición: repetirla daría lo mismo. */
function isRetryable(error: unknown): boolean {
  return !(error instanceof ClientApiError && error.status < 500);
}

async function requestLastUnitCosts(productId: string, supplierId: string | undefined): Promise<InvoiceLastUnitCost[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAST_UNIT_COST_TIMEOUT_MS);
  try {
    return await apiFetch<InvoiceLastUnitCost[]>("/api/purchases/invoice-scan/last-unit-costs", {
      query: { productIds: productId, supplierId },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * D41-a: último costo por unidad de stock (REF) de un producto elegido en la revisión fuera de
 * los candidatos (buscador «Cambiar producto» o alta), con la semántica de
 * `InvoiceLineMatch.lastUnitCostRef` (D38). `null` si no se conoce. Solo ids en la URL.
 * REP10-02 (B2): cada intento tiene tope y un fallo de red o del servidor se reintenta una vez.
 */
export async function fetchLastUnitCostRef(productId: string, supplierId?: string): Promise<number | null> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const costs = await requestLastUnitCosts(productId, supplierId);
      return costs.find((cost) => cost.productId === productId)?.lastUnitCostRef ?? null;
    } catch (error) {
      if (attempt >= LAST_UNIT_COST_ATTEMPTS || !isRetryable(error)) {
        throw error;
      }
    }
  }
}
