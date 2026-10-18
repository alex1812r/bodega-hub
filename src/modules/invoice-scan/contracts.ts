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
 * REP-05 (caos B5): marcas bidi (U+202A–U+202E, U+2066–U+2069, U+200E/U+200F,
 * U+061C) y caracteres de ancho cero (U+200B–U+200D, U+2060, U+FEFF). Permiten
 * suplantar visualmente un nombre en el detalle o en los few-shot. Los emoji
 * siguen pasando, también las secuencias unidas con U+200D (p. ej. una familia).
 */
const INVISIBLE_INVOICE_CHARS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c\u200b\u200c\u2060\ufeff]/;
/** U+200D fuera de una secuencia de emoji (entre un emoji, o su U+FE0F, y otro emoji). */
const LOOSE_ZERO_WIDTH_JOINER = /(?<![\udc00-\udfff\ufe0f])\u200d|\u200d(?![\ud800-\udbff])/;

export function hasInvisibleInvoiceChar(value: string): boolean {
  return INVISIBLE_INVOICE_CHARS.test(value) || LOOSE_ZERO_WIDTH_JOINER.test(value);
}

/** REP-05 (caos B8): una fecha con forma ISO `YYYY-MM-DD` que no existe en el calendario (2026-02-31). */
export function isImpossibleIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return false;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day;
}

/** REP-05 (auditoría B10): tope de líneas de una factura (lectura y corrección). */
export const INVOICE_MAX_LINES = 300;
export const INVOICE_TOO_MANY_LINES_MESSAGE = `La factura puede tener como máximo ${INVOICE_MAX_LINES} líneas.`;

/**
 * REP-05 (auditoría B10): tope del JSON (UTF-8) de la extracción corregida.
 * `confirm_invoice_scan` rechaza un `confirmed` de más de 256 KB DESPUÉS de crear
 * la compra; con 128 KB para la extracción queda sitio para las líneas confirmadas.
 */
export const INVOICE_CORRECTED_MAX_BYTES = 128 * 1024;
export const INVOICE_CORRECTED_TOO_LARGE_MESSAGE =
  "La factura corregida es demasiado grande. Acorta los textos o divide la compra.";
export const INVOICE_IMPOSSIBLE_DATE_MESSAGE =
  "La fecha de la factura no existe. Corrígela (AAAA-MM-DD) o déjala vacía.";

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
  lines: z
    .array(invoiceExtractionLineSchema)
    .refine((lines) => lines.length <= INVOICE_MAX_LINES, INVOICE_TOO_MANY_LINES_MESSAGE),
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

/** Bytes UTF-8 de un texto sin `TextEncoder` (el schema también corre en el cliente y en jsdom). */
function utf8Length(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Un par de surrogates suma 4 en total (2 + 2); uno suelto no pasa el contrato.
    bytes += code < 0x80 ? 1 : code < 0x800 || (code >= 0xd800 && code <= 0xdfff) ? 2 : 3;
  }

  return bytes;
}

/** Cada texto de la extracción con su ruta, para los vetos de la extracción corregida. */
function invoiceTexts(extraction: InvoiceExtraction): Array<[(string | number)[], string | undefined]> {
  return [
    [["supplier", "name"], extraction.supplier.name],
    [["supplier", "taxId"], extraction.supplier.taxId],
    [["supplier", "phone"], extraction.supplier.phone],
    [["supplier", "address"], extraction.supplier.address],
    [["number"], extraction.number],
    [["date"], extraction.date],
    ...extraction.lines.flatMap((line, index): Array<[(string | number)[], string | undefined]> => [
      [["lines", index, "rawText"], line.rawText],
      [["lines", index, "description"], line.description],
      [["lines", index, "barcode"], line.barcode],
      [["lines", index, "supplierSku"], line.supplierSku],
    ]),
    ...extraction.warnings.map((warning, index): [(string | number)[], string] => [["warnings", index], warning]),
  ];
}

/**
 * Extracción corregida por el usuario (`invoiceScanExtraction` de `POST /api/purchases`,
 * D10): además del contrato, sin bidi ni ancho cero (caos B5), sin fechas ISO
 * imposibles (caos B8) y con un tamaño que `confirm_invoice_scan` acepta
 * (auditoría B10). Todo se valida antes de crear la compra (400).
 */
export const correctedInvoiceExtractionSchema = invoiceExtractionSchema.superRefine((extraction, context) => {
  for (const [path, value] of invoiceTexts(extraction)) {
    if (value !== undefined && hasInvisibleInvoiceChar(value)) {
      context.addIssue({ code: "custom", message: INVOICE_TEXT_INVALID_MESSAGE, path });
    }
  }

  if (extraction.date !== undefined && isImpossibleIsoDate(extraction.date)) {
    context.addIssue({ code: "custom", message: INVOICE_IMPOSSIBLE_DATE_MESSAGE, path: ["date"] });
  }

  if (utf8Length(JSON.stringify(extraction)) > INVOICE_CORRECTED_MAX_BYTES) {
    context.addIssue({ code: "custom", message: INVOICE_CORRECTED_TOO_LARGE_MESSAGE, path: [] });
  }
});

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
  /** `products.sku` del candidato, si tiene: distingue candidatos de igual nombre en la revisión (D24-d). */
  sku?: string;
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
  /**
   * Solo si la misma foto ya se confirmó en una compra (REP-01): la compra ligada.
   * La revisión avisa con el enlace y no deja cargarla otra vez. `purchaseNumber`
   * es null si la compra no se pudo leer.
   */
  confirmedPurchase?: InvoiceScanConfirmedPurchase;
};

/** Compra en la que ya se confirmó el escaneo (REP-01). */
export type InvoiceScanConfirmedPurchase = {
  id: string;
  purchaseNumber: string | null;
};
