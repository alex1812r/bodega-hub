import { roundMoney } from "@bodega/core/currency";

import type { InvoiceExtraction, InvoiceExtractionLine, InvoiceMatch } from "../../contracts";

import { formatDecimal, isPositive } from "./text";

/** Diferencia relativa tasa impresa vs tasa del sistema a partir de la cual se avisa (6.20). */
export const PRINTED_RATE_WARNING_DELTA = 0.03;
/** Desvío relativo del costo unitario vs el último conocido que hace dudar del empaque (6.18). */
export const PRICE_DEVIATION_LIMIT = 0.4;
/** Tolerancia de totales: 1 % del total leído, mínimo 1 Bs. */
export const TOTALS_RELATIVE_TOLERANCE = 0.01;
export const TOTALS_MIN_TOLERANCE_VES = 1;

export const USD_DOCUMENT_ISSUE =
  "La factura parece estar en dólares ($/USD): revisa los precios, no se precargaron como Bs.";
export const NO_PRICE_ISSUE = "La línea no trae precio: escríbelo.";
export const MISSING_RATE_WARNING = "Falta la tasa del día: los costos en REF no se precargaron.";

const USD_MARK = /\$|\bUSD\b|\bUS\s?\$/i;

export type RateResolution = {
  /** Bs por 1 REF usada para convertir; `undefined` si no hay ninguna. */
  used?: number;
  info?: InvoiceMatch["rate"];
};

/**
 * Tasa para pasar Bs -> REF (6.7, 6.20): la del sistema; sin ella, la impresa
 * con aviso; sin ninguna, no hay REF y se avisa. Impresa vs sistema > 3 % ->
 * aviso (no bloquea).
 */
export function resolveRate(systemRate: number | undefined, printedRate: number | undefined): RateResolution {
  const system = isPositive(systemRate) ? systemRate : undefined;
  const printed = isPositive(printedRate) ? printedRate : undefined;

  if (system !== undefined) {
    const warning =
      printed !== undefined && Math.abs(printed - system) / system > PRINTED_RATE_WARNING_DELTA
        ? `La factura trae tasa ${formatDecimal(printed)}; hoy es ${formatDecimal(system)}.`
        : undefined;
    return {
      used: system,
      info: {
        system,
        ...(printed !== undefined ? { printed } : {}),
        ...(warning ? { warning } : {}),
      },
    };
  }
  if (printed !== undefined) {
    return {
      used: printed,
      info: {
        printed,
        warning: `No hay tasa del día en el sistema: se usó la tasa impresa en la factura (${formatDecimal(printed)}).`,
      },
    };
  }
  return { info: { warning: MISSING_RATE_WARNING } };
}

/** Documento en dólares: `currency` USD o `$`/`USD` en el texto de alguna línea (6.21). */
export function isUsdDocument(extraction: InvoiceExtraction): boolean {
  return extraction.currency === "USD" || extraction.lines.some((line) => USD_MARK.test(line.rawText));
}

/** Importe de la línea en Bs: `lineTotal`; si no, `unitPrice × quantity`; 0 si no hay precio. */
export function lineAmount(line: InvoiceExtractionLine): number {
  if (isPositive(line.lineTotal)) {
    return line.lineTotal;
  }
  if (isPositive(line.unitPrice) && isPositive(line.quantity)) {
    return line.unitPrice * line.quantity;
  }
  return 0;
}

export function hasPrice(line: InvoiceExtractionLine): boolean {
  return isPositive(line.unitPrice) || isPositive(line.lineTotal);
}

/**
 * Costo por UNIDAD DE ENTRADA de la línea, sin IVA: por empaque en modo
 * `pack` (es el `packCostVes`/`packCostRef` de `purchaseItemInputSchema`; el
 * `unitCost*` de la compra es este ÷ `unitsPerPack`) y por unidad en modo
 * `unit` (es su `unitCostVes`/`unitCostRef`). Es el precio unitario impreso
 * (o `lineTotal ÷ quantity` si no lo trae), siempre en Bs.
 */
export function lineEntryCosts(
  line: InvoiceExtractionLine,
  rate: number | undefined,
): { unitCostVes?: number; unitCostRef?: number } {
  let perEntry: number | undefined;
  if (isPositive(line.unitPrice)) {
    perEntry = line.unitPrice;
  } else if (isPositive(line.lineTotal) && isPositive(line.quantity)) {
    perEntry = line.lineTotal / line.quantity;
  }
  if (perEntry === undefined) {
    return {};
  }
  return {
    unitCostVes: roundMoney(perEntry),
    ...(rate !== undefined ? { unitCostRef: roundMoney(perEntry / rate) } : {}),
  };
}

/**
 * Coherencia de precio (6.18): `lineTotal ÷ (quantity × unitsPerPack)` en REF
 * frente al último costo unitario. Devuelve el aviso si se desvía > 40 %.
 */
export function priceCoherenceIssue(input: {
  line: InvoiceExtractionLine;
  unitsPerPack: number | undefined;
  entryMode: "unit" | "pack";
  rate: number | undefined;
  lastUnitCostRef: number | null | undefined;
}): string | undefined {
  const { line, rate, lastUnitCostRef } = input;
  const units = input.entryMode === "pack" ? input.unitsPerPack : 1;
  const amount = lineAmount(line);
  if (!isPositive(lastUnitCostRef) || rate === undefined || !isPositive(units) || !isPositive(line.quantity) || amount <= 0) {
    return undefined;
  }

  const perUnitRef = amount / rate / (line.quantity * units);
  if (Math.abs(perUnitRef - lastUnitCostRef) / lastUnitCostRef <= PRICE_DEVIATION_LIMIT) {
    return undefined;
  }
  return `¿Precio por caja o por unidad? Sale a ${formatDecimal(perUnitRef)} REF por unidad y el último costo fue ${formatDecimal(lastUnitCostRef)} REF.`;
}

function withinTolerance(read: number, computed: number): boolean {
  const tolerance = Math.max(TOTALS_RELATIVE_TOLERANCE * Math.abs(read), TOTALS_MIN_TOLERANCE_VES);
  return Math.abs(read - computed) <= tolerance;
}

/**
 * Totales. `computed` = suma de importes de línea (sin IVA). Se compara:
 * - con `subtotal` si se leyó (y además `subtotal + tax` con `total` si están los tres);
 * - si no, `total − tax` si se leyeron ambos;
 * - si solo hay `total`, vale tanto sin IVA como con el IVA de las alícuotas
 *   resueltas (`computedWithTax`), porque la factura puede imprimirlo de las dos formas.
 * Tolerancia: max(1 % del leído, 1 Bs). Sin nada leído, no hay descuadre.
 */
export function computeTotals(
  extraction: InvoiceExtraction,
  computedNet: number,
  computedWithTax: number,
): InvoiceMatch["totals"] {
  const computed = roundMoney(computedNet);
  const read = Number.isFinite(extraction.total) ? extraction.total : undefined;
  const subtotal = Number.isFinite(extraction.subtotal) ? extraction.subtotal : undefined;
  const tax = Number.isFinite(extraction.tax) ? extraction.tax : undefined;

  let mismatch = false;
  if (subtotal !== undefined) {
    mismatch = !withinTolerance(subtotal, computed);
    if (!mismatch && tax !== undefined && read !== undefined) {
      mismatch = !withinTolerance(read, subtotal + tax);
    }
  } else if (read !== undefined && tax !== undefined) {
    mismatch = !withinTolerance(read - tax, computed);
  } else if (read !== undefined) {
    mismatch = !withinTolerance(read, computed) && !withinTolerance(read, roundMoney(computedWithTax));
  }

  return { ...(read !== undefined ? { read } : {}), computed, mismatch };
}
