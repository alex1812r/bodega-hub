import { createModelFromEnv, type ResolvedModelInfo } from "@/modules/assistant/server/provider";

import { createMockInvoiceScanModel, INVOICE_SCAN_MOCK_MODEL_ID } from "./mockModel";

export type InvoiceScanModelInfo = ResolvedModelInfo;

/**
 * Defaults del escaneo (D22): el modelo lite medido en el banco de
 * `scripts/invoice-eval/` y el Haiku vigente con el que el banco mide Anthropic.
 */
export const DEFAULT_INVOICE_SCAN_GOOGLE_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_INVOICE_SCAN_ANTHROPIC_MODEL = "claude-haiku-5-5";

/**
 * Modelo del escaneo de facturas por entorno: `INVOICE_SCAN_PROVIDER`
 * (`google|anthropic|mock`, default google) e `INVOICE_SCAN_MODEL` opcional.
 * Misma factory y fallbacks que el asistente (otro proveedor, luego mock), con
 * defaults propios por proveedor.
 */
export function createInvoiceScanModel(): InvoiceScanModelInfo {
  return createModelFromEnv({
    createMock: () => createMockInvoiceScanModel(),
    defaultModels: {
      anthropic: DEFAULT_INVOICE_SCAN_ANTHROPIC_MODEL,
      google: DEFAULT_INVOICE_SCAN_GOOGLE_MODEL,
    },
    logPrefix: "invoice-scan",
    mockModelId: INVOICE_SCAN_MOCK_MODEL_ID,
    modelEnv: "INVOICE_SCAN_MODEL",
    noKeyMessage:
      "No hay GOOGLE_GENERATIVE_AI_API_KEY ni ANTHROPIC_API_KEY; el escaneo de facturas usa el proveedor mock.",
    providerEnv: "INVOICE_SCAN_PROVIDER",
  });
}
