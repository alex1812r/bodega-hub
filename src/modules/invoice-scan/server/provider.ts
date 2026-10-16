import { createModelFromEnv, type ResolvedModelInfo } from "@/modules/assistant/server/provider";

import { createMockInvoiceScanModel, INVOICE_SCAN_MOCK_MODEL_ID } from "./mockModel";

export type InvoiceScanModelInfo = ResolvedModelInfo;

/**
 * Modelo del escaneo de facturas por entorno: `INVOICE_SCAN_PROVIDER`
 * (`google|anthropic|mock`, default google) e `INVOICE_SCAN_MODEL` opcional.
 * Misma factory y fallbacks que el asistente (otro proveedor, luego mock).
 */
export function createInvoiceScanModel(): InvoiceScanModelInfo {
  return createModelFromEnv({
    createMock: () => createMockInvoiceScanModel(),
    logPrefix: "invoice-scan",
    mockModelId: INVOICE_SCAN_MOCK_MODEL_ID,
    modelEnv: "INVOICE_SCAN_MODEL",
    noKeyMessage:
      "No hay GOOGLE_GENERATIVE_AI_API_KEY ni ANTHROPIC_API_KEY; el escaneo de facturas usa el proveedor mock.",
    providerEnv: "INVOICE_SCAN_PROVIDER",
  });
}
