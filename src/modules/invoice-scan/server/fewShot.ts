import {
  invoiceExtractionSchema,
  type InvoiceExtraction,
  type InvoiceExtractionLine,
} from "../contracts";

/**
 * Capa 2 (SCN-03q): de un `confirmed` previo solo se envía el FORMATO de sus
 * líneas, nunca valores de cabecera ni texto libre. `confirmed` lo escribe
 * confirm_invoice_scan con texto del usuario y del rawText de la factura del
 * proveedor, así que es entrada no confiable.
 */
export const FEW_SHOT_MAX_LINES = 5;
export const FEW_SHOT_TEXT_MAX_CHARS = 80;

const MAX_QUANTITY = 100_000;
const MAX_UNIT_PRICE = 1e9;
const LINE_TOTAL_TOLERANCE = 0.05;
/** Margen absoluto para redondeos a céntimos. */
const LINE_TOTAL_EPSILON = 0.01;

export type FewShotFormatLine = Pick<
  InvoiceExtractionLine,
  "description" | "lineTotal" | "quantity" | "rawText" | "taxHint" | "unit" | "unitPrice" | "unitsPerPack"
>;

/** Ejemplo saneado: sin proveedor, número, fecha, totales, avisos ni confianza. */
export type FewShotFormat = {
  currency: InvoiceExtraction["currency"];
  lines: FewShotFormatLine[];
};

export type FewShotFormatCode = "ABSURD_FEW_SHOT_EXAMPLE" | "INVALID_FEW_SHOT_EXAMPLE";

export type FewShotFormatResult =
  | { ok: true; format: FewShotFormat }
  | { ok: false; code: FewShotFormatCode };

/**
 * Controles C0/C1, invisibles de ancho cero (U+200B–U+200F, U+2060–U+2065,
 * BOM), bidi (U+202A–U+202E, U+2066–U+2069) y separadores U+2028/U+2029.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/gu;

/** `<`, `>`, `&` y sus parecidos que sobreviven a NFKC. */
const DELIMITER_LOOKALIKES = /[<>&«»˂˃‹›〈〉⟨⟩❮❯〈-》﹤﹥＜＞]/gu;

/** Texto de una línea de ejemplo: NFKC, sin controles ni delimitadores, espacios colapsados y 80 caracteres como mucho. */
export function sanitizeFewShotText(text: string): string {
  const clean = text
    .normalize("NFKC")
    .replace(CONTROL_CHARS, " ")
    .replace(DELIMITER_LOOKALIKES, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return Array.from(clean).slice(0, FEW_SHOT_TEXT_MAX_CHARS).join("").trim();
}

function isAbsurd(line: InvoiceExtractionLine): boolean {
  const expected = line.quantity * line.unitPrice;

  return (
    Math.abs(line.quantity) > MAX_QUANTITY ||
    Math.abs(line.unitPrice) > MAX_UNIT_PRICE ||
    Math.abs(line.lineTotal - expected) > Math.abs(expected) * LINE_TOTAL_TOLERANCE + LINE_TOTAL_EPSILON
  );
}

/** Solo campos de formato, en orden fijo; los textos, saneados. */
export function toFormatLine(line: FewShotFormatLine): FewShotFormatLine {
  return {
    description: sanitizeFewShotText(line.description),
    lineTotal: line.lineTotal,
    quantity: line.quantity,
    rawText: sanitizeFewShotText(line.rawText),
    taxHint: line.taxHint,
    unit: line.unit,
    unitPrice: line.unitPrice,
    unitsPerPack: line.unitsPerPack,
  };
}

/**
 * Valida `confirmed` contra el contrato y lo reduce al formato de sus primeras
 * líneas. Un ejemplo inválido, sin líneas o con valores absurdos en cualquier
 * línea se descarta entero.
 */
export function toFewShotFormat(confirmed: unknown): FewShotFormatResult {
  const parsed = invoiceExtractionSchema.safeParse(confirmed);

  if (!parsed.success || parsed.data.lines.length === 0) {
    return { code: "INVALID_FEW_SHOT_EXAMPLE", ok: false };
  }

  if (parsed.data.lines.some(isAbsurd)) {
    return { code: "ABSURD_FEW_SHOT_EXAMPLE", ok: false };
  }

  return {
    format: {
      currency: parsed.data.currency,
      lines: parsed.data.lines.slice(0, FEW_SHOT_MAX_LINES).map(toFormatLine),
    },
    ok: true,
  };
}
