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
export const INVALID_QUANTITY_ISSUE = "Cantidad inválida en la factura: revísala.";
export const INVALID_PRICE_ISSUE = "Precio inválido en la factura: revísalo.";
/** `unitPrice × quantity` no da `lineTotal` (ni por empaque ni por unidad dentro del empaque): caos A-r4-1. */
export const UNIT_PRICE_MISMATCH_ISSUE = "El precio unitario no cuadra con el total de la línea: revísalo.";
export const DECIMAL_QUANTITY_ISSUE = "Cantidad con decimales en la factura: la compra solo admite enteros, revísala.";
/**
 * Sin ninguna tasa no se puede comparar con el último costo (en REF). Decisión:
 * si había coherencia que comprobar (último costo e importe), la línea no se
 * confirma en silencio; si no la había, no se avisa (ya lo dice el documento).
 */
export const NO_RATE_PRICE_ISSUE = "Sin tasa no se verificó el precio contra el último costo: revísalo.";
/** Importe o precio en Bs por encima de esto es una lectura imposible (1e308, etc.). */
export const MAX_AMOUNT_VES = 1e12;
/** Cantidad máxima de una línea (entero de 32 bits de la compra). */
export const MAX_QUANTITY = 2_147_483_647;
/** Tolerancia de coma flotante al comparar el desvío con el límite (4,20 vs 3,00 es 40 % justo, no más). */
const DEVIATION_EPSILON = 1e-9;

/**
 * Marca de dólar sobre el texto plegado (NFKD sin diacríticos: "＄" -> "$",
 * "DÓLARES" -> "DOLARES"): cualquier "$" (US$, U$S, 5$), o USD/DOLAR(ES)/DLS/DLR(S)
 * como palabra, admitiendo cifras pegadas ("5USD", "USD5.00"), nunca dentro de
 * otra palabra ("HANDLS").
 */
const USD_MARK = /\$|(?<![A-Z])(?:USD|DOLAR(?:ES)?|DLS|DLRS?)(?![A-Z])/i;

function hasUsdMark(text: string): boolean {
  return USD_MARK.test(text.normalize("NFKD").replace(/[̀-ͯ]/g, ""));
}

/** Importe en Bs leído válido: finito, > 0 y no gigante. */
function isAmount(value: number | null | undefined): value is number {
  return isPositive(value) && value <= MAX_AMOUNT_VES;
}

function isQuantity(value: number | null | undefined): value is number {
  return isPositive(value) && value <= MAX_QUANTITY;
}

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

/** Documento en dólares: `currency` USD o una marca de dólar en el texto o la descripción de alguna línea (6.21). */
export function isUsdDocument(extraction: InvoiceExtraction): boolean {
  return (
    extraction.currency === "USD" ||
    extraction.lines.some((line) => hasUsdMark(line.rawText) || hasUsdMark(line.description))
  );
}

/** Importe de la línea en Bs: `lineTotal`; si no, `unitPrice × quantity`; 0 si no hay precio válido. */
export function lineAmount(line: InvoiceExtractionLine): number {
  if (isAmount(line.lineTotal)) {
    return line.lineTotal;
  }
  if (isAmount(line.unitPrice) && isQuantity(line.quantity) && isAmount(line.unitPrice * line.quantity)) {
    return line.unitPrice * line.quantity;
  }
  return 0;
}

/**
 * Avisos por valores imposibles leídos en la línea: cantidad no finita o <= 0;
 * precio unitario o total negativos o no finitos cuando el otro sí es válido
 * (sin ningún precio válido ya avisa `NO_PRICE_ISSUE`).
 */
export function lineValueIssues(line: InvoiceExtractionLine): string[] {
  const issues: string[] = [];
  if (!isQuantity(line.quantity)) {
    issues.push(INVALID_QUANTITY_ISSUE);
  } else if (!Number.isInteger(line.quantity)) {
    issues.push(DECIMAL_QUANTITY_ISSUE);
  }
  const invalid = (value: number) => !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT_VES;
  if (hasPrice(line) && (invalid(line.unitPrice) || invalid(line.lineTotal))) {
    issues.push(INVALID_PRICE_ISSUE);
  }
  return issues;
}

export function hasPrice(line: InvoiceExtractionLine): boolean {
  return isPositive(line.unitPrice) || isPositive(line.lineTotal);
}

/**
 * Tolerancia al conciliar `unitPrice × quantity (× unitsPerPack)` con
 * `lineTotal`: la de los totales (1 % del total, mínimo 1 Bs) más medio
 * céntimo por unidad facturada, porque el precio impreso viene redondeado al
 * céntimo (3 a 33,33 = 99,99 frente a 100).
 */
function lineWithinTolerance(lineTotal: number, computed: number, units: number): boolean {
  const tolerance = Math.max(TOTALS_RELATIVE_TOLERANCE * lineTotal, TOTALS_MIN_TOLERANCE_VES) + 0.005 * units;
  return Math.abs(lineTotal - computed) <= tolerance;
}

/**
 * Conciliación del precio unitario impreso con el total de la línea (caos
 * A-r4-1). Solo si hay `unitPrice`, `lineTotal` y `quantity` válidos. Cuadra si
 * `unitPrice × quantity ≈ lineTotal` (precio por unidad de entrada) o, en modo
 * empaque con tamaño conocido, `unitPrice × quantity × unitsPerPack ≈ lineTotal`
 * (precio impreso por unidad dentro del empaque). Si no cuadra ninguna,
 * devuelve `UNIT_PRICE_MISMATCH_ISSUE`; el costo sale igual de `lineTotal`.
 * En modo empaque sin `unitsPerPack` fijado no se concilia (la línea ya es
 * dudosa por el empaque y la segunda lectura no se puede comprobar).
 */
export function unitPriceIssue(input: {
  line: InvoiceExtractionLine;
  unitsPerPack: number | undefined;
  entryMode: "unit" | "pack";
}): string | undefined {
  const { line } = input;
  if (!isAmount(line.unitPrice) || !isAmount(line.lineTotal) || !isQuantity(line.quantity)) {
    return undefined;
  }
  if (lineWithinTolerance(line.lineTotal, line.unitPrice * line.quantity, line.quantity)) {
    return undefined;
  }
  if (input.entryMode === "unit") {
    return UNIT_PRICE_MISMATCH_ISSUE;
  }
  if (!isPositive(input.unitsPerPack)) {
    // Empaque sin tamaño fijado: ya es dudosa por el empaque y no se sabe si el P.UNIT es por unidad dentro.
    return undefined;
  }
  const units = line.quantity * input.unitsPerPack;
  return lineWithinTolerance(line.lineTotal, line.unitPrice * units, units) ? undefined : UNIT_PRICE_MISMATCH_ISSUE;
}

/**
 * Costo por UNIDAD DE ENTRADA de la línea, sin IVA: por empaque en modo
 * `pack` (es el `packCostVes`/`packCostRef` de `purchaseItemInputSchema`; el
 * `unitCost*` de la compra es este ÷ `unitsPerPack`) y por unidad en modo
 * `unit` (es su `unitCostVes`/`unitCostRef`). Siempre en Bs.
 *
 * Sale de `lineTotal ÷ quantity` cuando ambos son válidos, para que
 * `unitCostVes × quantity` sea el mismo importe que suma `lineAmount` en
 * `totals.computed` (caos A-r4-1: el P.UNIT impreso puede ser por unidad
 * dentro de la caja o venir cruzado; `unitPriceIssue` lo concilia). Sin
 * `lineTotal` válido, el precio unitario impreso (y `lineAmount` usa
 * `unitPrice × quantity`, la misma cifra).
 */
export function lineEntryCosts(
  line: InvoiceExtractionLine,
  rate: number | undefined,
): { unitCostVes?: number; unitCostRef?: number } {
  let perEntry: number | undefined;
  if (isAmount(line.lineTotal) && isQuantity(line.quantity)) {
    perEntry = line.lineTotal / line.quantity;
  } else if (isAmount(line.unitPrice)) {
    perEntry = line.unitPrice;
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
  if (!isPositive(lastUnitCostRef) || !isPositive(units) || !isQuantity(line.quantity) || amount <= 0) {
    return undefined;
  }
  if (rate === undefined) {
    return NO_RATE_PRICE_ISSUE;
  }

  const perUnitRef = amount / rate / (line.quantity * units);
  if (Math.abs(perUnitRef - lastUnitCostRef) / lastUnitCostRef <= PRICE_DEVIATION_LIMIT + DEVIATION_EPSILON) {
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
