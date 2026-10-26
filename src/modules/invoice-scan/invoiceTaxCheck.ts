import { roundMoney } from "@bodega/core/currency";

/**
 * REP3-01 (D27) · REP4-01 (D29): regla ÚNICA de IVA y cuadre de totales de una factura
 * escaneada. PURA y compartida: la usan la revisión (`reviewModel.ts`, cliente) y el
 * emparejamiento (`server/match/money.ts`) con los mismos importes por línea, así que el ✓
 * del pie y `totals.mismatch` no pueden discrepar.
 *
 * - Cifra leída de referencia y su homóloga calculada (D29): el total leído ↔ total
 *   registrado; sin él, subtotal + IVA leídos ↔ total registrado; sin IVA leído, el
 *   subtotal ↔ base imponible registrada; sin subtotal, el IVA ↔ IVA registrado. Sin
 *   ninguna cifra leída no hay con qué comparar. Cualquier discrepancia exige la casilla.
 * - Con total (o subtotal + IVA), "precios sin IVA" se contrasta con: el subtotal leído;
 *   sin él, total − IVA leído; sin desglose, referencia − IVA que añadirían las alícuotas
 *   de las líneas (por línea, así en una mixta solo cuentan las gravadas).
 * - Con solo subtotal o solo IVA, las dos hipótesis son la base (o el IVA) que saldría
 *   con precios sin IVA y con IVA incluido, línea a línea por su alícuota.
 * - El IVA en juego (`gap`) es la distancia entre ambas hipótesis. La sugerencia "los
 *   precios incluyen IVA" exige que la hipótesis incluida quede a ≤ ¼ del IVA en juego de
 *   la cifra leída y la otra a más de ¼: con una parte gravada pequeña (≤ 6 % de una
 *   mixta) el 1 % del total la escondía (N11).
 * - D59 (M-p14-1): además, frente a la referencia, la hipótesis incluida (Σ líneas) debe
 *   cuadrar mejor que la otra (Σ líneas con su alícuota) y quedar a no más de
 *   máx(mínimo, ½ del IVA leído o, sin él, del que añadirían las líneas): un subtotal o
 *   un IVA mal leídos (el EXENTO, la BI G) inflan el IVA en juego y no pueden empujar
 *   hacia la hipótesis que descuadra. Si ninguna cuadra, no se sugiere y la diferencia
 *   exige la casilla.
 * - REP13-04 (D59): la hipótesis sugerida cuadra la referencia con la MISMA tolerancia del
 *   ✓ del pie (`tolerance`, `getInvoiceTotalsGap`), así el aviso («la suma de las líneas da
 *   el total leído») nunca contradice el pie; ser solo la más cercana no basta (descuento
 *   global, total redondeado, IVA al 8 %). Única excepción, sin total leído: si el subtotal
 *   leído cuadra la base con IVA incluido (con la tolerancia del pie para un subtotal), se
 *   sugiere aunque el IVA leído descuadre (B20 de caos p5: IVA leído = 16, la alícuota).
 *   El tope literal de D59, mín(máx(1, 0,5 % del total), ½ IVA), no es compatible con B20
 *   (1,6 de diferencia sobre 106 > 1) y es más estricto que el pie (perdería sugerencias
 *   correctas que el pie da por cuadradas): se usa la tolerancia del pie, acotada además
 *   por ½ IVA. REP13-06: la excepción B20 exige también que "sin IVA" no cuadre mejor el
 *   subtotal ni el IVA leídos; con solo subtotal o solo IVA (`assessSingleFigure`) la incluida
 *   se sugiere solo si cuadra con la tolerancia del pie y la otra no.
 * - IVA leído 0,00 (o subtotal = total): nunca se sugiere (N12). Si además Σ líneas da la
 *   referencia con líneas gravadas, no se puede saber si es exenta o una nota de despacho
 *   con IVA incluido sin desglosar (f01/f02): `exemptOrIncluded`, se pregunta sin
 *   preselección (D28). Con solo IVA 0,00 leído y líneas gravadas ninguna hipótesis lo
 *   cuadra: no se pregunta, se pide la casilla (o marcar las líneas exentas).
 * - El cuadre con la cifra leída usa máx(mínimo, mín(1 % de la cifra, ¼ del IVA en
 *   juego)): el 1 % nunca tapa un IVA de más o de menos.
 */

/** Tolerancia relativa del cuadre: 1 % de la cifra leída (acotada por el IVA en juego). */
export const TOTALS_RELATIVE_TOLERANCE = 0.01;
/** Fracción del IVA en juego que separa "cuadra" de "no cuadra" en la sugerencia y en el cuadre. */
export const TAX_GAP_TOLERANCE_SHARE = 0.25;
/** D59: la hipótesis incluida nunca se sugiere a más de la mitad del IVA (leído o, sin él, el de las líneas). */
const SUGGESTION_TAX_SHARE = 0.5;
/** Por debajo de medio céntimo el IVA leído es 0,00. */
const ZERO_TAX_EPSILON = 0.005;

export type InvoiceTaxLine = {
  /** Importe de la línea tal como se leyó (cantidad × precio, redondeado), sin quitar ni añadir IVA. */
  amount: number;
  /** Alícuota de la línea en % (0 si exenta). */
  ratePct: number;
};

export type InvoiceTaxInput = {
  lines: InvoiceTaxLine[];
  subtotal?: number;
  tax?: number;
  total?: number;
  /** Tolerancia mínima: 1 Bs (0,01 en dólares). */
  minTolerance: number;
};

export type InvoiceTaxReference = {
  /** Cifra leída con la que se compara su homóloga registrada. */
  amount: number;
  source: "total" | "subtotalPlusTax" | "subtotal" | "tax";
};

export type InvoiceTaxAssessment = {
  /** Cifra leída de referencia; ausente si no se leyó ninguna. */
  reference?: InvoiceTaxReference;
  /** De dónde sale la hipótesis "precios sin IVA" frente a un total (para explicar la sugerencia). */
  plainSource?: "subtotal" | "totalMinusTax" | "linesTax";
  /** REP13-05: Σ líneas tal como se escribieron, frente a un total (para decir si lo da o solo se acerca). */
  linesTotal?: number;
  /** La hipótesis "IVA incluido" cuadra la cifra leída y la otra no: los precios parecen incluirlo. */
  includedSuggested: boolean;
  /**
   * La factura no trae IVA (0,00 o subtotal = total), Σ líneas ya da la referencia y las
   * alícuotas de las líneas añadirían IVA: o es exenta o los precios lo incluyen (notas de
   * despacho f01/f02). No se sugiere nada; se pregunta.
   */
  exemptOrIncluded: boolean;
  /** Tolerancia del cuadre de la cifra registrada con la referencia. */
  tolerance: number;
};

/** Lo que se registraría: base sin IVA, IVA de las alícuotas y total. */
export type InvoiceRegisteredAmounts = { base: number; tax: number; total: number };

type LineSums = { net: number; withTax: number; baseIfIncluded: number };

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function sumLines(lines: InvoiceTaxLine[]): LineSums {
  let net = 0;
  let withTax = 0;
  let baseIfIncluded = 0;
  for (const { amount, ratePct } of lines) {
    if (!Number.isFinite(amount)) {
      continue;
    }
    const factor = 1 + Math.max(0, ratePct) / 100;
    net += amount;
    withTax += roundMoney(amount * factor);
    baseIfIncluded += roundMoney(amount / factor);
  }
  return { net: roundMoney(net), withTax: roundMoney(withTax), baseIfIncluded: roundMoney(baseIfIncluded) };
}

/**
 * Base, IVA y total que se registrarían con los precios incluyendo IVA o no (por línea y
 * su alícuota). Es lo que compara el servidor; la revisión usa sus cifras, que reparten el
 * residuo de redondeo para que el total incluido sea Σ líneas.
 */
export function getInvoiceRegisteredAmounts(lines: InvoiceTaxLine[], included: boolean): InvoiceRegisteredAmounts {
  const { net, withTax, baseIfIncluded } = sumLines(lines);
  return included
    ? { base: baseIfIncluded, tax: roundMoney(net - baseIfIncluded), total: net }
    : { base: net, tax: roundMoney(withTax - net), total: withTax };
}

/** Tolerancia del cuadre con una cifra leída (la del ✓ del pie): máx(mínimo, mín(1 % de la cifra, ¼ del IVA en juego)). */
function fitTolerance(read: number, gap: number, minTolerance: number): number {
  return Math.max(minTolerance, Math.min(TOTALS_RELATIVE_TOLERANCE * Math.abs(read), TAX_GAP_TOLERANCE_SHARE * gap));
}

/** Desajuste de una hipótesis con una cifra leída, en tolerancias del pie para esa cifra (≤ 1: cuadra). */
function misfit(read: number, ifThis: number, ifPlain: number, ifIncluded: number, minTolerance: number): number {
  return Math.abs(ifThis - read) / fitTolerance(read, Math.abs(roundMoney(ifPlain - ifIncluded)), minTolerance);
}

/**
 * Solo subtotal o solo IVA leídos: la cifra frente a su homóloga sin IVA y con IVA incluido.
 * REP13-06 (D59): se sugiere la incluida solo si cuadra con la tolerancia del pie y la otra no.
 */
function assessSingleFigure(
  reference: InvoiceTaxReference,
  ifPlain: number,
  ifIncluded: number,
  addedTax: number,
  minTolerance: number,
): InvoiceTaxAssessment {
  const read = reference.amount;
  const gap = Math.abs(roundMoney(ifPlain - ifIncluded));
  const zeroTax = reference.source === "tax" && Math.abs(read) < ZERO_TAX_EPSILON;
  const tolerance = fitTolerance(read, gap, minTolerance);
  const includedSuggested =
    !zeroTax && addedTax > 0 && Math.abs(ifIncluded - read) <= tolerance && Math.abs(ifPlain - read) > tolerance;
  return { reference, includedSuggested, exemptOrIncluded: false, tolerance };
}

export function assessInvoiceTax(input: InvoiceTaxInput): InvoiceTaxAssessment {
  const { minTolerance } = input;
  const subtotal = finite(input.subtotal) ? input.subtotal : undefined;
  const tax = finite(input.tax) ? input.tax : undefined;
  const total = finite(input.total) ? input.total : undefined;
  const { net, withTax, baseIfIncluded } = sumLines(input.lines);
  const addedTax = roundMoney(withTax - net);

  let reference: InvoiceTaxReference | undefined;
  if (total !== undefined) {
    reference = { amount: total, source: "total" };
  } else if (subtotal !== undefined && tax !== undefined) {
    reference = { amount: roundMoney(subtotal + tax), source: "subtotalPlusTax" };
  } else if (subtotal !== undefined) {
    return assessSingleFigure({ amount: subtotal, source: "subtotal" }, net, baseIfIncluded, addedTax, minTolerance);
  } else if (tax !== undefined) {
    const includedTax = roundMoney(net - baseIfIncluded);
    return assessSingleFigure({ amount: tax, source: "tax" }, addedTax, includedTax, addedTax, minTolerance);
  }
  if (!reference) {
    return { includedSuggested: false, exemptOrIncluded: false, tolerance: minTolerance };
  }

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
  const includedGap = Math.abs(net - reference.amount);
  const suggestionTolerance = Math.max(minTolerance, SUGGESTION_TAX_SHARE * Math.abs(tax ?? addedTax));
  const tolerance = fitTolerance(reference.amount, gap, minTolerance);
  // REP13-06 (D59): la excepción B20 exige además que "sin IVA" no cuadre mejor ninguna cifra leída
  // (subtotal o IVA): si el IVA leído es justo el de las alícuotas, el mal leído es el subtotal.
  let subtotalFitsIncluded = false;
  if (total === undefined && subtotal !== undefined && tax !== undefined) {
    const includedMisfit = misfit(subtotal, baseIfIncluded, net, baseIfIncluded, minTolerance);
    const plainMisfit = Math.min(
      misfit(subtotal, net, net, baseIfIncluded, minTolerance),
      misfit(tax, addedTax, addedTax, roundMoney(net - baseIfIncluded), minTolerance),
    );
    subtotalFitsIncluded = includedMisfit <= 1 && includedMisfit < plainMisfit;
  }
  const includedSuggested =
    !zeroTax &&
    addedTax > 0 &&
    (includedGap <= tolerance || subtotalFitsIncluded) &&
    includedGap <= gapTolerance &&
    includedGap <= suggestionTolerance &&
    includedGap < Math.abs(withTax - reference.amount) &&
    Math.abs(net - plainTarget) > gapTolerance;
  const noTaxRead = zeroTax || (plainSource === "subtotal" && gap < ZERO_TAX_EPSILON);
  const exemptOrIncluded =
    noTaxRead &&
    addedTax > 0 &&
    Math.abs(net - reference.amount) <= Math.max(minTolerance, TAX_GAP_TOLERANCE_SHARE * addedTax);

  return { reference, plainSource, linesTotal: net, includedSuggested, exemptOrIncluded, tolerance };
}

/** La cifra registrada homóloga de la referencia: total, base imponible o IVA. */
function getComparedAmount(reference: InvoiceTaxReference, registered: InvoiceRegisteredAmounts): number {
  switch (reference.source) {
    case "subtotal":
      return registered.base;
    case "tax":
      return registered.tax;
    default:
      return registered.total;
  }
}

/**
 * Referencia − su homóloga registrada cuando no cuadran con la tolerancia de la
 * evaluación; si cuadra o no hay referencia, `undefined`.
 */
export function getInvoiceTotalsGap(
  assessment: InvoiceTaxAssessment,
  registered: InvoiceRegisteredAmounts,
): number | undefined {
  const { reference, tolerance } = assessment;
  if (!reference) {
    return undefined;
  }
  const compared = getComparedAmount(reference, registered);
  if (Math.abs(reference.amount - compared) <= tolerance) {
    return undefined;
  }
  return roundMoney(reference.amount - compared);
}
