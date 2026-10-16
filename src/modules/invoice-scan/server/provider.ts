import { ApiError } from "@/lib/api/apiError";
import { createModelFromEnv, type ResolvedModelInfo } from "@/modules/assistant/server/provider";

import { createMockInvoiceScanModel, INVOICE_SCAN_MOCK_MODEL_ID } from "./mockModel";

export type InvoiceScanModelInfo = ResolvedModelInfo;

/**
 * Defaults del escaneo (D22): el modelo lite medido en el banco de
 * `scripts/invoice-eval/` y el Haiku vigente con el que el banco mide Anthropic.
 */
export const DEFAULT_INVOICE_SCAN_GOOGLE_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_INVOICE_SCAN_ANTHROPIC_MODEL = "claude-haiku-5-5";

export const INVOICE_SCAN_NOT_CONFIGURED_MESSAGE =
  "El escaneo de facturas no está configurado: falta la key del proveedor de IA.";

export type InvoiceScanModelOptions = {
  /**
   * Con datos reales (Supabase) no se cae al mock por falta de key: devolvería
   * la factura de fixture como leída y quedaría en caché por hash (CIE-08 B4).
   * Sin ninguna key responde 503; el mock solo con `INVOICE_SCAN_PROVIDER=mock`.
   */
  requireRealProvider?: boolean;
};

/**
 * Modelo del escaneo de facturas por entorno: `INVOICE_SCAN_PROVIDER`
 * (`google|anthropic|mock`, default google) e `INVOICE_SCAN_MODEL` opcional.
 * Misma factory y fallbacks que el asistente (otro proveedor, luego mock), con
 * defaults propios por proveedor.
 */
export function createInvoiceScanModel(options: InvoiceScanModelOptions = {}): InvoiceScanModelInfo {
  const requireReal = options.requireRealProvider === true;
  const info = createModelFromEnv({
    createMock: () => createMockInvoiceScanModel(),
    defaultModels: {
      anthropic: DEFAULT_INVOICE_SCAN_ANTHROPIC_MODEL,
      google: DEFAULT_INVOICE_SCAN_GOOGLE_MODEL,
    },
    logPrefix: "invoice-scan",
    mockModelId: INVOICE_SCAN_MOCK_MODEL_ID,
    modelEnv: "INVOICE_SCAN_MODEL",
    noKeyMessage: requireReal
      ? "No hay GOOGLE_GENERATIVE_AI_API_KEY ni ANTHROPIC_API_KEY; el escaneo de facturas responde 503."
      : "No hay GOOGLE_GENERATIVE_AI_API_KEY ni ANTHROPIC_API_KEY; el escaneo de facturas usa el proveedor mock.",
    providerEnv: "INVOICE_SCAN_PROVIDER",
  });
  const explicitMock = process.env.INVOICE_SCAN_PROVIDER?.trim().toLowerCase() === "mock";

  if (requireReal && info.provider === "mock" && !explicitMock) {
    throw new ApiError(503, "INTERNAL_ERROR", INVOICE_SCAN_NOT_CONFIGURED_MESSAGE);
  }

  return info;
}
