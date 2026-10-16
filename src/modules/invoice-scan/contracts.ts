/**
 * Contrato compartido del escaneo de facturas (plan factura-escaneo-gtm §4).
 *
 * Lo fija el gerente antes de la Ola 1 para que Extracción (SCN-01..03),
 * Emparejamiento (SCN-04..06), UI (SCN-07..09) y Evaluación (SCN-10..12)
 * partan del mismo shape. Cambiarlo exige avisar al gerente.
 */
import { z } from "zod";

export const invoiceLineUnits = [
  "unidad",
  "caja",
  "bulto",
  "paquete",
  "display",
  "otro",
] as const;

export const invoiceTaxHints = [
  "exento",
  "reducida",
  "general",
  "unknown",
] as const;

export const invoiceCurrencies = ["VES", "USD", "unknown"] as const;

const confidence = z.number().min(0).max(1);

/** CIE-06 · Largo máximo (unidades UTF-16) de cada texto de la factura. */
export const INVOICE_TEXT_MAX_LENGTH = 1000;
/** CIE-06 · Máximo de avisos por factura. */
export const INVOICE_WARNINGS_MAX = 50;
export const INVOICE_TEXT_INVALID_MESSAGE = "Un texto de la factura tiene caracteres no permitidos.";
export const INVOICE_TEXT_TOO_LONG_MESSAGE = `Cada texto de la factura puede tener como máximo ${INVOICE_TEXT_MAX_LENGTH} caracteres.`;

/**
 * CIE-06 (auditoría M1): U+0000, caracteres de control C0/C1 (salvo tabulador,
 * salto de línea y retorno de carro) o un surrogate UTF-16 suelto. Postgres
 * rechaza el U+0000 y los surrogates sueltos en `jsonb` (22P05), y el fallo
 * llegaba al confirmar el escaneo, DESPUÉS de crear la compra.
 */
export function hasForbiddenInvoiceChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }

      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

/**
 * Texto de la factura que acaba en `jsonb`. Solo refinamientos (sin `max`/`regex`):
 * el JSON Schema que recibe el modelo (`Output.object`) no cambia, y una salida
 * del modelo que no cumpla falla la extracción (INVALID_OUTPUT) antes de guardarse.
 */
function invoiceText() {
  return z
    .string()
    .refine((value) => !hasForbiddenInvoiceChar(value), INVOICE_TEXT_INVALID_MESSAGE)
    .refine((value) => value.length <= INVOICE_TEXT_MAX_LENGTH, INVOICE_TEXT_TOO_LONG_MESSAGE);
}

export const invoiceExtractionLineSchema = z.object({
  /** Texto literal de la línea tal como aparece en la factura (obligatorio). */
  rawText: invoiceText(),
  description: invoiceText(),
  quantity: z.number(),
  unit: z.enum(invoiceLineUnits).optional(),
  unitsPerPack: z.number().int().positive().optional(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  taxHint: z.enum(invoiceTaxHints).optional(),
  barcode: invoiceText().optional(),
  /** Código del proveedor leído en la línea, si lo hay (cascada paso 1). */
  supplierSku: invoiceText().optional(),
  confidence,
});

export const invoiceExtractionSchema = z.object({
  supplier: z.object({
    name: invoiceText(),
    taxId: invoiceText().optional(),
    phone: invoiceText().optional(),
    address: invoiceText().optional(),
  }),
  number: invoiceText().optional(),
  /** ISO `YYYY-MM-DD`. */
  date: invoiceText().optional(),
  currency: z.enum(invoiceCurrencies),
  /** Tasa Bs/USD impresa al pie, si la hay (caos 6.20). */
  printedRate: z.number().positive().optional(),
  lines: z.array(invoiceExtractionLineSchema),
  subtotal: z.number().optional(),
  tax: z.number().optional(),
  total: z.number().optional(),
  confidence,
  /** Avisos en español para el usuario. */
  warnings: z
    .array(invoiceText())
    .refine(
      (warnings) => warnings.length <= INVOICE_WARNINGS_MAX,
      `La factura puede tener como máximo ${INVOICE_WARNINGS_MAX} avisos.`,
    ),
});

export type InvoiceExtractionLine = z.infer<typeof invoiceExtractionLineSchema>;
export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;

export const invoiceMatchStatuses = [
  "confirmed",
  "doubtful",
  "unmatched",
] as const;
export type InvoiceMatchStatus = (typeof invoiceMatchStatuses)[number];

export type InvoiceMatchCandidate = {
  productId: string;
  name: string;
  /** 0..1 */
  score: number;
  /** Motivo legible en español: "SKU del proveedor", "alias visto 4 veces", "nombre parecido 0,72". */
  reason: string;
};

export type InvoiceLineMatch = {
  /** Índice de la línea en `extraction.lines`. */
  index: number;
  status: InvoiceMatchStatus;
  productId?: string;
  candidates?: InvoiceMatchCandidate[];
  entryMode: "unit" | "pack";
  packUnitId?: string;
  /** Unidades por empaque resueltas (leídas o registradas). */
  unitsPerPack?: number;
  /** Producto con receta: desarmar al recibir. */
  disassembleOnReceive?: boolean;
  taxRateCode: string;
  unitCostVes?: number;
  unitCostRef?: number;
  /** Avisos en español: tamaño de empaque, coherencia de precio, moneda, etc. */
  issues: string[];
};

export type InvoiceMatch = {
  supplier: {
    contactId?: string;
    candidates?: { contactId: string; name: string; score: number; reason: string }[];
  };
  lines: InvoiceLineMatch[];
  totals: { read?: number; computed: number; mismatch: boolean };
  /** Tasa usada para convertir Bs → REF y la impresa si difiere > 2 % (D8). */
  rate?: { system?: number; printed?: number; warning?: string };
  /** Mismo proveedor + número ya escaneado en la tienda (duplicado). */
  duplicateOfScanId?: string;
};

export type InvoiceScanLimits = {
  used: number;
  limit: number;
  remaining: number;
};

export type InvoiceScanResponse = {
  scanId: string;
  extraction: InvoiceExtraction;
  matched: InvoiceMatch;
  limits: InvoiceScanLimits;
  /** true si vino del caché por hash (0 llamadas al modelo). */
  cached: boolean;
};
