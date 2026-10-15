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

/**
 * Número de factura comparable: alfanumérico en mayúsculas y sin ceros a la
 * izquierda. "00-012345" y "12345" son el mismo número.
 */
export function normalizeInvoiceNumber(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^0+(?=.)/, "");
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
