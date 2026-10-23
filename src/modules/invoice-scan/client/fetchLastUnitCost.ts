import { apiFetch } from "@/shared/api/apiFetch";

import type { InvoiceLastUnitCost } from "../server/match.types";

/**
 * D41-a: último costo por unidad de stock (REF) de un producto elegido en la revisión fuera de
 * los candidatos (buscador «Cambiar producto» o alta), con la semántica de
 * `InvoiceLineMatch.lastUnitCostRef` (D38). `null` si no se conoce. Solo ids en la URL.
 */
export async function fetchLastUnitCostRef(productId: string, supplierId?: string): Promise<number | null> {
  const costs = await apiFetch<InvoiceLastUnitCost[]>("/api/purchases/invoice-scan/last-unit-costs", {
    query: { productIds: productId, supplierId },
  });

  return costs.find((cost) => cost.productId === productId)?.lastUnitCostRef ?? null;
}
