import type { InvoiceExtractionLine } from "../../contracts";
import type { MatchProduct, MatchTaxRate, MatchTaxRateKind } from "../match.types";

/** Código usado si la tienda no tiene ninguna alícuota activa (semilla global de 20261007a). */
export const FALLBACK_TAX_RATE_CODE = "general";

/** Marcas de exento en el texto literal de la línea: "(E)", "EXE", "EXENTO". */
const EXEMPT_MARK = /\(\s*E\s*\)|\bEXE\b|\bEXENT[OA]S?\b/i;

function findByKind(rates: MatchTaxRate[], kind: MatchTaxRateKind): MatchTaxRate | undefined {
  return rates.find((rate) => rate.kind === kind && rate.isDefault) ?? rates.find((rate) => rate.kind === kind);
}

function hintKind(line: InvoiceExtractionLine): MatchTaxRateKind | undefined {
  if (line.taxHint === "exento" || EXEMPT_MARK.test(line.rawText)) {
    return "exento";
  }
  if (line.taxHint === "reducida" || line.taxHint === "general") {
    return line.taxHint;
  }
  return undefined;
}

/**
 * Alícuota de la línea (plan §3 "Moneda y alícuota"):
 * 1. La leída (`taxHint` o marca de exento en `rawText`) si existe activa.
 * 2. Si no, la de la categoría del producto si está activa.
 * 3. Si no (sin producto o su alícuota no está activa), la por defecto de la
 *    tienda (`isDefault`), luego la general, luego la primera activa, y sin
 *    ninguna activa `FALLBACK_TAX_RATE_CODE`.
 */
export function resolveTaxRateCode(
  line: InvoiceExtractionLine,
  product: MatchProduct | undefined,
  rates: MatchTaxRate[],
): string {
  const kind = hintKind(line);
  const hinted = kind ? findByKind(rates, kind) : undefined;
  if (hinted) {
    return hinted.code;
  }

  const productRate = product?.taxRateCode ? rates.find((rate) => rate.code === product.taxRateCode) : undefined;
  if (productRate) {
    return productRate.code;
  }

  const fallback = rates.find((rate) => rate.isDefault) ?? findByKind(rates, "general") ?? rates[0];
  return fallback?.code ?? FALLBACK_TAX_RATE_CODE;
}

/** Porcentaje de una alícuota por código (0 si no está). */
export function taxPctOf(code: string, rates: MatchTaxRate[]): number {
  return rates.find((rate) => rate.code === code)?.pct ?? 0;
}
