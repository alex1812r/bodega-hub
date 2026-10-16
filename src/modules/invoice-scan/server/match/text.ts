import { normalizeAlias } from "@bodega/core/invoice";

/** Número finito y > 0. */
export function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Número con 2 decimales y coma decimal, punto de miles ("0,72", "1.234,50"),
 * sin depender del ICU del entorno.
 */
export function formatDecimal(value: number): string {
  const [integer, decimals] = Math.abs(value).toFixed(2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}${grouped},${decimals}`;
}

/**
 * RIF/cédula comparable: mayúsculas, sin espacios, guiones ni puntos y sin la
 * letra de tipo inicial (J, V, E, G, P, C). "J-12345678-9" -> "123456789".
 */
export function normalizeTaxId(taxId: string | null | undefined): string {
  if (!taxId) {
    return "";
  }

  return taxId
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[JVEGPC]/, "");
}

/** Letra de tipo (J, V, E, G, P, C) con la que empieza el RIF/cédula, o "". */
function taxIdLetter(taxId: string | null | undefined): string {
  return /^[JVEGPC]/.exec((taxId ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""))?.[0] ?? "";
}

/**
 * Mismo RIF/cédula: mismos dígitos (`normalizeTaxId`) y, si ambos traen letra
 * de tipo, la misma letra. "V-508357612" no es "J-508357612" (caos 5.4); sin
 * letra en un lado se comparan solo los dígitos.
 */
export function sameTaxId(a: string | null | undefined, b: string | null | undefined): boolean {
  const digits = normalizeTaxId(a);
  if (!digits || digits !== normalizeTaxId(b)) {
    return false;
  }
  const letterA = taxIdLetter(a);
  const letterB = taxIdLetter(b);
  return !letterA || !letterB || letterA === letterB;
}

/**
 * Rótulo delante del número ("FACTURA", "FACT", "N°", "Nº", "No.", "NRO",
 * "NUM"), solo si no le sigue otra letra ("NOV-12" queda igual).
 */
const INVOICE_NUMBER_PREFIX = /^(?:FACTURA|FACT|NRO|NUM|N[°ºO])(?![A-Z])[^A-Z0-9]*/;

/**
 * Número de factura comparable: sin rótulos delante, alfanumérico en
 * mayúsculas y sin ceros a la izquierda. "00-012345", "N° 12345" y "12345" son
 * el mismo número. Sin ningún dígito distinto de cero ("S/N", "0", "000") es
 * "sin número": "".
 */
export function normalizeInvoiceNumber(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  let text = value.toUpperCase().trim();
  let stripped = text.replace(INVOICE_NUMBER_PREFIX, "");
  while (stripped !== text) {
    text = stripped;
    stripped = text.replace(INVOICE_NUMBER_PREFIX, "");
  }
  const number = text.replace(/[^A-Z0-9]/g, "").replace(/^0+(?=.)/, "");
  return /[1-9]/.test(number) ? number : "";
}

/** Distancia de edición <= 1 (una sustitución, omisión o carácter de más). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let index = 0;
  while (index < short.length && short[index] === long[index]) {
    index += 1;
  }
  const rest = short.length === long.length ? index + 1 : index;
  return short.slice(rest) === long.slice(index + 1);
}

/** Código (SKU del proveedor, barcode) comparable: `normalizeAlias` sin espacios. */
export function normalizeCode(value: string | null | undefined): string {
  return value ? normalizeAlias(value).replace(/ /g, "") : "";
}

function bigrams(text: string): string[] {
  const compact = ` ${text} `;
  const result: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.push(compact.slice(index, index + 2));
  }
  return result;
}

/**
 * Similitud de Dice sobre bigramas del texto normalizado (0..1). Solo se usa
 * para nombres de proveedor cuando la base no trae `score`.
 */
export function textSimilarity(left: string, right: string): number {
  const a = normalizeAlias(left);
  const b = normalizeAlias(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const pool = new Map<string, number>();
  const leftBigrams = bigrams(a);
  for (const gram of leftBigrams) {
    pool.set(gram, (pool.get(gram) ?? 0) + 1);
  }

  const rightBigrams = bigrams(b);
  let shared = 0;
  for (const gram of rightBigrams) {
    const count = pool.get(gram) ?? 0;
    if (count > 0) {
      shared += 1;
      pool.set(gram, count - 1);
    }
  }

  return (2 * shared) / (leftBigrams.length + rightBigrams.length);
}
