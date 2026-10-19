import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
  TypeValidationError,
} from "ai";
import { ZodError } from "zod";

import { ApiError } from "@/lib/api/apiError";

import {
  invoiceExtractionSchema,
  isImpossibleInvoiceDate,
  type InvoiceExtraction,
} from "../contracts";
import { replaceInvisibleChars } from "../invisibleChars";
import type { FewShotFormat } from "./fewShot";
import { INVOICE_LOW_RES_SIDE, inspectInvoiceImage, stripImageMetadata, type InvoiceImageInfo } from "./imageInfo";
import { buildFewShotMessages, buildInvoiceSystemPrompt, buildTargetMessage } from "./prompt";
import { createInvoiceScanModel, type InvoiceScanModelInfo } from "./provider";

export type InvoicePage = {
  data: Uint8Array;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type InvoiceFewShotExample = {
  page?: InvoicePage;
  /** Formato saneado de un `confirmed` previo (`toFewShotFormat`), nunca el `confirmed` crudo. */
  format: FewShotFormat;
};

export type ExtractInvoiceResult = {
  extraction: InvoiceExtraction;
  provider: InvoiceScanModelInfo["provider"];
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  pages: number;
};

export type ExtractInvoiceInput = {
  pages: InvoicePage[];
  fewShot?: InvoiceFewShotExample[];
  signal?: AbortSignal;
  /** Para tests; por defecto, `createInvoiceScanModel()`. */
  model?: InvoiceScanModelInfo;
};

/** Plan §3: timeout de 45 s por llamada al modelo (una por página). */
const INVOICE_EXTRACTION_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 1;

export type InvoiceExtractionErrorCode =
  | "PROVIDER_ERROR"
  | "PROVIDER_CONFIG"
  | "TIMEOUT"
  | "INVALID_OUTPUT"
  | "QUOTA";

const ERROR_MESSAGES: Record<InvoiceExtractionErrorCode, string> = {
  INVALID_OUTPUT:
    "No pudimos leer la factura. Intenta con una foto más nítida y bien encuadrada.",
  PROVIDER_CONFIG:
    "El escaneo de facturas no está disponible por un problema de configuración. Avisa al administrador y, mientras tanto, registra la compra a mano.",
  PROVIDER_ERROR:
    "El servicio de IA no está disponible en este momento. Intenta de nuevo en unos minutos.",
  QUOTA:
    "Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.",
  TIMEOUT:
    "La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.",
};

/**
 * Respuestas con las que el proveedor rechaza la petición sin procesarla
 * (servicio no disponible, límite de peticiones): no llegó a facturar, así que
 * el intento no cuenta en la cuota (D24-a). La key inválida o sin permiso
 * tampoco factura: la detecta `isInvalidKey`.
 */
const NOT_BILLED_STATUS_CODES: ReadonlySet<number> = new Set([429, 503]);

/**
 * Google responde a una key inválida con HTTP 400, no 401/403: `reason`
 * API_KEY_INVALID en el cuerpo y "API key not valid" en el mensaje. Un 400 sin
 * esas marcas es una petición mala que pudo facturar: sigue como PROVIDER_ERROR.
 */
const INVALID_KEY_PATTERN = /API_KEY_INVALID|API key not valid/i;

/**
 * Caos N1 / D25-d: key inválida o sin permiso (401, 403, o 400 con
 * `INVALID_KEY_PATTERN` en el mensaje o el cuerpo). Reintentar no sirve.
 */
function isInvalidKey(cause: unknown): boolean {
  if (!APICallError.isInstance(cause)) {
    return false;
  }

  return (
    cause.statusCode === 401 ||
    cause.statusCode === 403 ||
    (cause.statusCode === 400 && INVALID_KEY_PATTERN.test(`${cause.message}\n${cause.responseBody ?? ""}`))
  );
}

export class InvoiceExtractionError extends Error {
  /**
   * `billable`: el proveedor pudo facturar el intento (timeout, salida
   * inválida, error desconocido). Si es false, quien llama devuelve la cuota.
   */
  constructor(
    public readonly code: InvoiceExtractionErrorCode,
    public readonly billable = true,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = "InvoiceExtractionError";
  }
}

function isAbort(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function classify(error: unknown, signal: AbortSignal): InvoiceExtractionErrorCode {
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  if (signal.aborted || isAbort(cause)) {
    return "TIMEOUT";
  }

  if (APICallError.isInstance(cause) && cause.statusCode === 429) {
    return "QUOTA";
  }

  if (isInvalidKey(cause)) {
    return "PROVIDER_CONFIG";
  }

  if (
    NoObjectGeneratedError.isInstance(cause) ||
    NoOutputGeneratedError.isInstance(cause) ||
    TypeValidationError.isInstance(cause) ||
    cause instanceof ZodError
  ) {
    return "INVALID_OUTPUT";
  }

  return "PROVIDER_ERROR";
}

/** ¿Pudo facturar el proveedor? Solo no si respondió con un rechazo sin procesar. */
function isBilled(error: unknown, signal: AbortSignal): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  return (
    signal.aborted ||
    !APICallError.isInstance(cause) ||
    cause.statusCode === undefined ||
    (!NOT_BILLED_STATUS_CODES.has(cause.statusCode) && !isInvalidKey(cause))
  );
}

/**
 * Solo metadatos: los errores del SDK llevan el cuerpo de la petición (la
 * imagen en base64) y el texto generado (el contenido de la factura).
 */
function logFailure(code: InvoiceExtractionErrorCode, error: unknown) {
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  console.error("[invoice-scan] fallo de extracción", {
    code,
    name: cause instanceof Error ? cause.name : typeof cause,
    statusCode: APICallError.isInstance(cause) ? cause.statusCode : undefined,
  });
}

/**
 * 502 en español para el BFF; la causa queda en `details.reason`. Una key
 * inválida (PROVIDER_CONFIG) responde 503: el cliente lo trata como "no
 * disponible" y no ofrece reintentar.
 */
export function toInvoiceScanApiError(error: unknown): ApiError {
  const code = error instanceof InvoiceExtractionError ? error.code : "PROVIDER_ERROR";
  const status = code === "PROVIDER_CONFIG" ? 503 : 502;

  return new ApiError(status, "INVOICE_SCAN_PROVIDER_ERROR", ERROR_MESSAGES[code], { reason: code });
}

type PageResult = {
  extraction: InvoiceExtraction;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
};

function firstDefined<T>(values: readonly (T | undefined)[]) {
  return values.find((value) => value !== undefined);
}

function lastDefined<T>(values: readonly (T | undefined)[]) {
  return firstDefined([...values].reverse());
}

function sumTokens(values: readonly (number | undefined)[]) {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}

/**
 * Une las páginas: líneas en orden; cabecera de la primera página que la
 * tenga; subtotal/IVA/total de la última; confianza mínima; avisos sin repetir.
 */
function mergePages(pages: readonly InvoiceExtraction[]): InvoiceExtraction {
  const supplier = pages.find((page) => page.supplier.name.trim() !== "")?.supplier ?? pages[0]!.supplier;
  const currency = pages.find((page) => page.currency !== "unknown")?.currency ?? "unknown";
  const optional = <K extends keyof InvoiceExtraction>(key: K, value: InvoiceExtraction[K] | undefined) =>
    value === undefined ? {} : { [key]: value };

  return invoiceExtractionSchema.parse({
    supplier,
    ...optional("number", firstDefined(pages.map((page) => page.number))),
    ...optional("date", firstDefined(pages.map((page) => page.date))),
    currency,
    ...optional("printedRate", firstDefined(pages.map((page) => page.printedRate))),
    lines: pages.flatMap((page) => page.lines),
    ...optional("subtotal", lastDefined(pages.map((page) => page.subtotal))),
    ...optional("tax", lastDefined(pages.map((page) => page.tax))),
    ...optional("total", lastDefined(pages.map((page) => page.total))),
    confidence: Math.min(...pages.map((page) => page.confidence)),
    warnings: [...new Set(pages.flatMap((page) => page.warnings))],
  });
}

async function extractPage(
  info: InvoiceScanModelInfo,
  input: ExtractInvoiceInput,
  pageIndex: number,
): Promise<PageResult> {
  const timeout = AbortSignal.timeout(INVOICE_EXTRACTION_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;

  try {
    const result = await generateText({
      abortSignal: signal,
      instructions: buildInvoiceSystemPrompt(),
      maxRetries: MAX_RETRIES,
      messages: [
        ...buildFewShotMessages(input.fewShot ?? []),
        buildTargetMessage(input.pages[pageIndex]!, pageIndex + 1, input.pages.length),
      ],
      model: info.model,
      output: Output.object({ name: "InvoiceExtraction", schema: invoiceExtractionSchema }),
      temperature: 0,
    });

    return {
      extraction: invoiceExtractionSchema.parse(result.output),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    };
  } catch (error) {
    const code = classify(error, signal);
    logFailure(code, error);
    throw new InvoiceExtractionError(code, isBilled(error, signal));
  }
}

/** Plan §6.1: tope de confianza cuando la lectura no es fiable. */
export const LOW_QUALITY_MAX_CONFIDENCE = 0.5;
/** Por debajo de esta confianza global, que todas las líneas digan 1 es incoherente. */
const INCOHERENT_GLOBAL_CONFIDENCE = 0.6;

export const LOW_RES_WARNING = "La imagen tiene poca resolución; revisa cada línea con la factura en mano.";
export const INCOHERENT_CONFIDENCE_WARNING =
  "La lectura no es fiable; revisa cada línea con la factura en mano.";

export const IMPOSSIBLE_DATE_WARNING = "La fecha leída no existe en el calendario; revísala en la factura.";

/** Caos B8/N3: una fecha imposible (2026-02-31, 31/02/2026) leída por el modelo se descarta con aviso; no falla la lectura. */
function guardDate(extraction: InvoiceExtraction): InvoiceExtraction {
  if (extraction.date === undefined || !isImpossibleInvoiceDate(extraction.date)) {
    return extraction;
  }

  const guarded: InvoiceExtraction = {
    ...extraction,
    warnings: [...new Set([...extraction.warnings, IMPOSSIBLE_DATE_WARNING])],
  };
  delete guarded.date;

  return guarded;
}

/**
 * Caos N2: quita de cada texto de la lectura los invisibles que la extracción
 * corregida vetaría (bidi, ancho cero, guion blando, tags…). Sin esto, una línea
 * legítima con un U+00AD leído quedaría imposible de confirmar.
 */
function stripInvisibles(extraction: InvoiceExtraction): InvoiceExtraction {
  const strip = (value: string) => replaceInvisibleChars(value);
  const stripOptional = (value: string | undefined) => (value === undefined ? undefined : strip(value));

  return {
    ...extraction,
    supplier: {
      ...extraction.supplier,
      name: strip(extraction.supplier.name),
      taxId: stripOptional(extraction.supplier.taxId),
      phone: stripOptional(extraction.supplier.phone),
      address: stripOptional(extraction.supplier.address),
    },
    number: stripOptional(extraction.number),
    date: stripOptional(extraction.date),
    lines: extraction.lines.map((line) => ({
      ...line,
      rawText: strip(line.rawText),
      description: strip(line.description),
      barcode: stripOptional(line.barcode),
      supplierSku: stripOptional(line.supplierSku),
    })),
    warnings: extraction.warnings.map((warning) => strip(warning)),
  };
}

/**
 * Plan §6.1: el modelo no siempre admite que no lee. Si alguna página tiene
 * poca resolución, o si dice confianza 1 en todas las líneas pero baja en lo
 * global, se avisa y se limita la confianza global y por línea a 0,5.
 */
function guardReadability(
  extraction: InvoiceExtraction,
  images: readonly InvoiceImageInfo[],
): InvoiceExtraction {
  const lowRes = images.some((image) => Math.max(image.width, image.height) < INVOICE_LOW_RES_SIDE);
  const incoherent =
    extraction.lines.length > 0 &&
    extraction.lines.every((line) => line.confidence === 1) &&
    extraction.confidence < INCOHERENT_GLOBAL_CONFIDENCE;

  if (!lowRes && !incoherent) {
    return extraction;
  }

  const cap = (confidence: number) => Math.min(confidence, LOW_QUALITY_MAX_CONFIDENCE);
  const added = [
    ...(lowRes ? [LOW_RES_WARNING] : []),
    ...(incoherent ? [INCOHERENT_CONFIDENCE_WARNING] : []),
  ];

  return {
    ...extraction,
    confidence: cap(extraction.confidence),
    lines: extraction.lines.map((line) => ({ ...line, confidence: cap(line.confidence) })),
    warnings: [...new Set([...extraction.warnings, ...added])],
  };
}

/**
 * REP3-03e: una imagen few-shot guardada que ya no se puede sanear (ApiError
 * 400 de `stripImageMetadata`) no tumba el escaneo del usuario: se omite ese
 * ejemplo entero. Las páginas del usuario siguen fallando con 400. El log no
 * lleva datos de la imagen.
 */
function sendableFewShot(
  example: InvoiceFewShotExample,
  toSend: (page: InvoicePage) => InvoicePage,
): InvoiceFewShotExample[] {
  if (!example.page) {
    return [example];
  }

  try {
    return [{ ...example, page: toSend(example.page) }];
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) {
      throw error;
    }

    console.warn("[invoice-scan] ejemplo few-shot omitido: imagen no saneable", { mediaType: example.page.mediaType });
    return [];
  }
}

/**
 * Lee la factura (una llamada por página) y devuelve la extracción validada.
 *
 * Antes de llamar al modelo valida TODAS las páginas con `inspectInvoiceImage`
 * (bytes mágicos, tipo declarado, dimensiones y lado mínimo): un archivo que no
 * es imagen o una foto diminuta lanza ApiError 400 sin consumir cuota. Las
 * dimensiones leídas deciden el aviso de poca resolución (`guardReadability`).
 * Se valida aquí, y no en quien llama, para que ningún camino llegue al modelo
 * sin esa comprobación; quien llama puede usar `inspectInvoiceImage` antes
 * (p. ej. antes de subir al bucket) sin que cambie el resultado.
 *
 * Los bytes tras el final de la imagen (`trailingBytes`) se toleran aquí, sin
 * tope: un JPEG MPF de cámara (f09/f12/f21/f22 de invoice-eval) trae su vista
 * previa tras el primer EOI. Solo la entrada del BFF (`assertImages`) los rechaza.
 */
export async function extractInvoice(input: ExtractInvoiceInput): Promise<ExtractInvoiceResult> {
  if (input.pages.length === 0) {
    throw new TypeError("extractInvoice necesita al menos una página.");
  }

  const images = input.pages.map((page) => inspectInvoiceImage(page.data, page.mediaType));
  // Auditoría B13: al modelo van copias sin metadatos; `input` (lo guardado) no cambia.
  const toSend = (page: InvoicePage): InvoicePage => ({ ...page, data: stripImageMetadata(page.data, page.mediaType) });
  const sent: ExtractInvoiceInput = {
    ...input,
    fewShot: input.fewShot?.flatMap((example) => sendableFewShot(example, toSend)),
    pages: input.pages.map(toSend),
  };
  const startedAt = Date.now();
  const info = input.model ?? createInvoiceScanModel();
  const results: PageResult[] = [];

  for (let index = 0; index < input.pages.length; index += 1) {
    try {
      results.push(await extractPage(info, sent, index));
    } catch (error) {
      // Las páginas ya leídas se facturaron aunque esta no.
      if (index > 0 && error instanceof InvoiceExtractionError && !error.billable) {
        throw new InvoiceExtractionError(error.code, true);
      }

      throw error;
    }
  }

  return {
    durationMs: Date.now() - startedAt,
    extraction: guardReadability(mergePages(results.map((result) => guardDate(stripInvisibles(result.extraction)))), images),
    inputTokens: sumTokens(results.map((result) => result.inputTokens)),
    modelId: info.modelId,
    outputTokens: sumTokens(results.map((result) => result.outputTokens)),
    pages: input.pages.length,
    provider: info.provider,
  };
}
