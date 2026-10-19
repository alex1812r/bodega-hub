import { roundMoney } from "@bodega/core/currency";

/**
 * REP3-01 (D27): regla ÚNICA de IVA y cuadre de totales de una factura escaneada. PURA y
 * compartida: la usan la revisión (`reviewModel.ts`, cliente) y el emparejamiento
 * (`server/match/money.ts`), así que el ✓ del pie y `totals.mismatch` no pueden discrepar.
 *
 * - Total de referencia: el total leído; sin él, subtotal + IVA leídos; sin ninguno, no
 *   hay con qué comparar (no se pide confirmar diferencia, solo se informa).
 * - "Precios sin IVA" se contrasta con: el subtotal leído; sin él, total − IVA leído; sin
 *   desglose, referencia − IVA que añadirían las alícuotas de las líneas (por línea, así
 *   en una mixta solo cuentan las gravadas).
 * - El IVA en juego (`gap`) es la distancia entre ambas hipótesis. La sugerencia "los
 *   precios incluyen IVA" exige Σ líneas a ≤ ¼ del IVA en juego de la referencia y a más
 *   de ¼ de la otra: con una parte gravada pequeña (≤ 6 % de una mixta) el 1 % del total
 *   la escondía (N11).
 * - IVA leído 0,00 (o subtotal = total): nunca se sugiere (N12). Si además Σ líneas da la
 *   referencia con líneas gravadas, no se puede saber si es exenta o una nota de despacho
 *   con IVA incluido sin desglosar (f01/f02): `exemptOrIncluded`, se pregunta sin preselección.
 * - El cuadre del total registrado con la referencia usa máx(mínimo, mín(1 %, ¼ del IVA
 *   en juego)): el 1 % nunca tapa un IVA de más o de menos.
 */

/** Tolerancia relativa del cuadre de totales: 1 % de la referencia (acotada por el IVA en juego). */
export const TOTALS_RELATIVE_TOLERANCE = 0.01;
/** Fracción del IVA en juego que separa "cuadra" de "no cuadra" en la sugerencia y en el cuadre. */
export const TAX_GAP_TOLERANCE_SHARE = 0.25;
/** Por debajo de medio céntimo el IVA leído es 0,00. */
const ZERO_TAX_EPSILON = 0.005;

export type InvoiceTaxInput = {
  /** Σ importes de las líneas tal como se leyeron (sin quitar ni añadir IVA). */
  linesAmount: number;
  /** Σ de cada importe más el IVA de su alícuota: lo que se registraría si los precios no lo incluyen. */
  linesAmountWithTax: number;
  subtotal?: number;
  tax?: number;
  total?: number;
  /** Tolerancia mínima: 1 Bs (0,01 en dólares). */
  minTolerance: number;
};

export type InvoiceTaxReference = {
  amount: number;
  source: "total" | "subtotalPlusTax";
};

export type InvoiceTaxAssessment = {
  /** Total con el que se compara lo registrado; ausente si no se leyó ningún total. */
  reference?: InvoiceTaxReference;
  /** De dónde sale la hipótesis "precios sin IVA" (para explicar la sugerencia). */
  plainSource?: "subtotal" | "totalMinusTax" | "linesTax";
  /** Σ líneas ≈ referencia y no ≈ "precios sin IVA": los precios parecen incluir IVA. */
  includedSuggested: boolean;
  /**
   * La factura no trae IVA (0,00 o subtotal = total), Σ líneas ya da la referencia y las
   * alícuotas de las líneas añadirían IVA: o es exenta o los precios lo incluyen (notas de
   * despacho f01/f02). No se sugiere nada; se pregunta.
   */
  exemptOrIncluded: boolean;
  /** Tolerancia del cuadre del total registrado con la referencia. */
  tolerance: number;
};

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

export function assessInvoiceTax(input: InvoiceTaxInput): InvoiceTaxAssessment {
  const { minTolerance } = input;
  const subtotal = finite(input.subtotal) ? input.subtotal : undefined;
  const tax = finite(input.tax) ? input.tax : undefined;
  const total = finite(input.total) ? input.total : undefined;

  let reference: InvoiceTaxReference | undefined;
  if (total !== undefined) {
    reference = { amount: total, source: "total" };
  } else if (subtotal !== undefined && tax !== undefined) {
    reference = { amount: roundMoney(subtotal + tax), source: "subtotalPlusTax" };
  }
  if (!reference) {
    return { includedSuggested: false, exemptOrIncluded: false, tolerance: minTolerance };
  }

  const net = roundMoney(input.linesAmount);
  const addedTax = roundMoney(input.linesAmountWithTax - input.linesAmount);
  let plainSource: NonNullable<InvoiceTaxAssessment["plainSource"]>;
  let plainTarget: number;
  if (subtotal !== undefined) {
    plainSource = "subtotal";
    plainTarget = subtotal;
  } else if (tax !== undefined) {
    plainSource = "totalMinusTax";
    plainTarget = roundMoney(reference.amount - tax);
  } else {
    plainSource = "linesTax";
    plainTarget = roundMoney(reference.amount - addedTax);
  }

  const gap = Math.abs(roundMoney(reference.amount - plainTarget));
  const gapTolerance = Math.max(minTolerance, TAX_GAP_TOLERANCE_SHARE * gap);
  const zeroTax = tax !== undefined && Math.abs(tax) < ZERO_TAX_EPSILON;
  const includedSuggested =
    !zeroTax &&
    addedTax > 0 &&
    Math.abs(net - reference.amount) <= gapTolerance &&
    Math.abs(net - plainTarget) > gapTolerance;
  const noTaxRead = zeroTax || (plainSource === "subtotal" && gap < ZERO_TAX_EPSILON);
  const exemptOrIncluded =
    noTaxRead &&
    addedTax > 0 &&
    Math.abs(net - reference.amount) <= Math.max(minTolerance, TAX_GAP_TOLERANCE_SHARE * addedTax);
  const tolerance = Math.max(
    minTolerance,
    Math.min(TOTALS_RELATIVE_TOLERANCE * Math.abs(reference.amount), TAX_GAP_TOLERANCE_SHARE * gap),
  );

  return { reference, plainSource, includedSuggested, exemptOrIncluded, tolerance };
}

/** Referencia − registrado cuando no cuadran con la tolerancia de la evaluación; si cuadra o no hay referencia, `undefined`. */
export function getInvoiceTotalsGap(assessment: InvoiceTaxAssessment, registered: number): number | undefined {
  const { reference, tolerance } = assessment;
  if (!reference || Math.abs(reference.amount - registered) <= tolerance) {
    return undefined;
  }
  return roundMoney(reference.amount - registered);
}
