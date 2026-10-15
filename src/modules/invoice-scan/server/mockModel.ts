import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { notAnInvoiceExtraction, singlePageExtraction } from "./__fixtures__/extractions";

/**
 * Modelo determinista del escaneo para tests, e2e y arranque sin API key.
 * `INVOICE_SCAN_MOCK_MODE` deja a QA/caos provocar cada salida del proveedor:
 * - `ok` (default): la extracción de fixture.
 * - `error`: fallo del proveedor (502).
 * - `timeout`: no responde hasta que se aborta la llamada.
 * - `empty`: "no es factura" (sin líneas y con aviso).
 * - `invalid`: JSON que no cumple el schema.
 */
export const invoiceScanMockModes = ["ok", "error", "timeout", "empty", "invalid"] as const;

export type InvoiceScanMockMode = (typeof invoiceScanMockModes)[number];

export const INVOICE_SCAN_MOCK_MODEL_ID = "invoice-scan-mock";

export function readInvoiceScanMockMode(): InvoiceScanMockMode {
  const configured = process.env.INVOICE_SCAN_MOCK_MODE?.trim().toLowerCase();

  return (invoiceScanMockModes as readonly string[]).includes(configured ?? "")
    ? (configured as InvoiceScanMockMode)
    : "ok";
}

function jsonResult(value: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ text: JSON.stringify(value), type: "text" }],
    finishReason: { raw: "stop", unified: "stop" },
    usage: {
      inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0 },
      outputTokens: { reasoning: 0, text: 0, total: 0 },
    },
    warnings: [],
  };
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/**
 * `mode` fijo para tests; sin él, el modo se lee del entorno en cada llamada
 * para que QA lo cambie sin reiniciar.
 */
export function createMockInvoiceScanModel(mode?: InvoiceScanMockMode): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: INVOICE_SCAN_MOCK_MODEL_ID,
    provider: "bodegahub-mock",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      switch (mode ?? readInvoiceScanMockMode()) {
        case "error":
          throw new APICallError({
            isRetryable: false,
            message: "Fallo simulado del proveedor de IA.",
            requestBodyValues: {},
            statusCode: 503,
            url: "mock://invoice-scan",
          });
        case "timeout":
          return waitForAbort(options.abortSignal);
        case "empty":
          return jsonResult(notAnInvoiceExtraction);
        case "invalid":
          return jsonResult({ supplier: { name: "Sin líneas válidas" }, lines: "ilegible" });
        case "ok":
          return jsonResult(singlePageExtraction);
      }
    },
  });
}
