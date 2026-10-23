/**
 * Contrato compartido del escaneo de facturas (plan factura-escaneo-gtm §4).
 *
 * Lo fija el gerente antes de la Ola 1 para que Extracción (SCN-01..03),
 * Emparejamiento (SCN-04..06), UI (SCN-07..09) y Evaluación (SCN-10..12)
 * partan del mismo shape. Cambiarlo exige avisar al gerente.
 */
import { z } from "zod";

import { hasInvisibleChar } from "./invisibleChars";

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

/** REP4-02a (caos N9r / D29): ISO `AAAA-MM-DD` estricto, dígitos ASCII (`[0-9]`, no `\d` de otros sistemas). */
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
/** DD/MM/AAAA o DD-MM-AAAA (día y mes de 1 o 2 dígitos, mismo separador), como se imprime en Venezuela. */
const DAY_FIRST_DATE = /^([0-9]{1,2})([/-])([0-9]{1,2})\2([0-9]{4})$/;

/**
 * Rango razonable del año de una factura: fuera de 2000–2100 (9999-12-31,
 * 0000-01-01, 1899) es una mala lectura o un error de tecleo, no una compra real.
 */
export const INVOICE_DATE_MIN_YEAR = 2000;
export const INVOICE_DATE_MAX_YEAR = 2100;

function existsOnCalendar(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type InvoiceDateIssue = "format" | "range" | "calendar";

/**
 * REP4-02a (caos N9r / D29): qué le falta a una fecha de factura para valer.
 * Solo `AAAA-MM-DD` o `DD/MM/AAAA` / `DD-MM-AAAA` con año de 4 dígitos ASCII
 * (se ignoran los espacios de los extremos); año entre 2000 y 2100 y día real
 * de calendario (31/04 no, 29/02 solo en bisiesto). `undefined` si vale.
 */
export function getInvoiceDateIssue(value: string): InvoiceDateIssue | undefined {
  const trimmed = value.trim();
  const iso = ISO_DATE.exec(trimmed);
  const dayFirst = DAY_FIRST_DATE.exec(trimmed);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dayFirst ? [dayFirst[4], dayFirst[3], dayFirst[1]] : undefined;

  if (!parts) {
    return "format";
  }

  const [year, month, day] = parts.map(Number) as [number, number, number];

  if (year < INVOICE_DATE_MIN_YEAR || year > INVOICE_DATE_MAX_YEAR) {
    return "range";
  }

  return existsOnCalendar(year, month, day) ? undefined : "calendar";
}

/**
 * REP-05 (caos B8) / REP2-03b (caos N3) / REP3-03b (caos N9) / REP4-02a (caos
 * N9r): la fecha no vale (`getInvoiceDateIssue`): formato no admitido, año fuera
 * de rango o día que no existe en el calendario.
 */
export function isImpossibleInvoiceDate(value: string): boolean {
  return getInvoiceDateIssue(value) !== undefined;
}

/** REP-05 (auditoría B10): tope de líneas de una factura (lectura y corrección). */
export const INVOICE_MAX_LINES = 300;
export const INVOICE_TOO_MANY_LINES_MESSAGE = `La factura puede tener como máximo ${INVOICE_MAX_LINES} líneas.`;

/**
 * REP-05 (auditoría B10): tope del JSON (UTF-8) de la extracción corregida y
 * (REP2-02) de la lectura del modelo que se guarda. No garantiza que `confirmed`
 * quepa: eso lo comprueba `INVOICE_CONFIRMED_MAX_BYTES` antes de crear la compra.
 */
export const INVOICE_CORRECTED_MAX_BYTES = 128 * 1024;
export const INVOICE_CORRECTED_TOO_LARGE_MESSAGE =
  "La factura corregida es demasiado grande. Acorta los textos o divide la compra.";

/**
 * REP2-02 (auditoría B11): tope de `invoice_scans.confirmed` completo (extracción +
 * líneas con el rawText guardado, aliasNorm y packLabel). Es el MISMO valor que
 * `confirm_invoice_scan` (`pg_column_size(p_confirmed) > 262144`,
 * supabase/patches/20261019b-supplier-product-aliases.sql): si cambia allí, cambia
 * aquí. Se mide con `jsonbSizeUpperBound` antes de crear la compra.
 */
export const INVOICE_CONFIRMED_MAX_BYTES = 262144;
export const INVOICE_CONFIRMED_TOO_LARGE_MESSAGE =
  "La confirmación de la factura es demasiado grande. Vincula menos líneas, acorta las etiquetas de empaque o divide la compra.";
export const INVOICE_IMPOSSIBLE_DATE_MESSAGE =
  "La fecha de la factura no existe. Corrígela (AAAA-MM-DD) o déjala vacía.";
export const INVOICE_DATE_FORMAT_MESSAGE =
  "La fecha de la factura no tiene un formato válido. Escríbela como AAAA-MM-DD o DD/MM/AAAA, o déjala vacía.";
export const INVOICE_DATE_OUT_OF_RANGE_MESSAGE = `La fecha de la factura debe ser de un año entre ${INVOICE_DATE_MIN_YEAR} y ${INVOICE_DATE_MAX_YEAR}. Corrígela o déjala vacía.`;

const INVOICE_DATE_MESSAGES: Record<InvoiceDateIssue, string> = {
  format: INVOICE_DATE_FORMAT_MESSAGE,
  range: INVOICE_DATE_OUT_OF_RANGE_MESSAGE,
  calendar: INVOICE_IMPOSSIBLE_DATE_MESSAGE,
};

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

/**
 * Cota superior de `pg_column_size` del `jsonb` de un valor JSON (REP2-02). El JSON
 * UTF-8 se queda CORTO: jsonb guarda 4 bytes de JEntry por elemento (8 por par
 * clave/valor, frente a `"":,` en texto), 4 de cabecera por contenedor más hasta 3
 * de alineación, y cada número como `numeric` alineado (hasta 23 bytes por "1").
 * Los textos van en UTF-8 sin escapes. Se mide lo que viaja (`JSON.stringify`).
 */
export function jsonbSizeUpperBound(value: unknown): number {
  const serialized = JSON.stringify(value);

  return serialized === undefined ? 0 : 4 + jsonbDatumBytes(JSON.parse(serialized) as unknown);
}

function jsonbDatumBytes(value: unknown): number {
  if (typeof value === "string") {
    return utf8Length(value);
  }

  if (typeof value === "number") {
    // Alineación (3) + varlena (4) + cabecera larga (4) + 2 bytes por grupo de 4
    // dígitos significativos (+1 grupo si no cae alineado). Un double tiene ≤ 17.
    const significant = String(Math.abs(value)).split("e")[0].replace(".", "").replace(/^0+/, "").length;
    return 11 + 2 * (Math.ceil(significant / 4) + 1);
  }

  if (Array.isArray(value)) {
    return 7 + value.reduce((sum: number, item: unknown) => sum + 4 + jsonbDatumBytes(item), 0);
  }

  if (value !== null && typeof value === "object") {
    return 7 + Object.entries(value).reduce((sum, [key, item]) => sum + 8 + utf8Length(key) + jsonbDatumBytes(item), 0);
  }

  // true / false / null: solo su JEntry.
  return 0;
}

/** La extracción supera el tope de bytes (JSON UTF-8) de la lectura guardada o corregida. */
export function isInvoiceExtractionTooLarge(extraction: InvoiceExtraction): boolean {
  return utf8Length(JSON.stringify(extraction)) > INVOICE_CORRECTED_MAX_BYTES;
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
 * D10): además del contrato, sin bidi ni invisibles (caos B5/N2), sin fechas
 * imposibles (caos B8/N3) y con un tamaño que `confirm_invoice_scan` acepta
 * (auditoría B10). Todo se valida antes de crear la compra (400).
 */
export const correctedInvoiceExtractionSchema = invoiceExtractionSchema.superRefine((extraction, context) => {
  for (const [path, value] of invoiceTexts(extraction)) {
    if (value !== undefined && hasInvisibleChar(value)) {
      context.addIssue({ code: "custom", message: INVOICE_TEXT_INVALID_MESSAGE, path });
    }
  }

  const dateIssue = extraction.date === undefined ? undefined : getInvoiceDateIssue(extraction.date);

  if (dateIssue) {
    context.addIssue({ code: "custom", message: INVOICE_DATE_MESSAGES[dateIssue], path: ["date"] });
  }

  if (isInvoiceExtractionTooLarge(extraction)) {
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
  /**
   * D41-a: último costo por unidad de stock (REF) de ESTE candidato, misma semántica que
   * `InvoiceLineMatch.lastUnitCostRef` (D38). Ausente si no se conoce.
   */
  lastUnitCostRef?: number;
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
  /**
   * D38: último costo por unidad de stock (REF) del producto propuesto (`productId` o, sin él,
   * el primer candidato), haya o no aviso de precio. Ausente si no se conoce. La revisión compara
   * con él cada opción «Por unidad / Por empaque».
   */
  lastUnitCostRef?: number;
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
