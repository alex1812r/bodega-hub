import type { CashMovement } from "../types";

const CASH_OUT_TYPES: CashMovement["type"][] = [
  "change_out",
  "refund_out",
  "transfer_out",
];

export type CashSessionOpening = { openingRef: number; openingVes: number };

export type CashSessionTotalsInput = Pick<CashMovement, "amountRef" | "amountVes" | "type">;

/**
 * Saldos vivos de una sesión de caja, con las mismas reglas que `close_cash_session`:
 * el efectivo arranca en el fondo de apertura y suma `sale_in`/`adjustment` menos
 * `transfer_out`/`refund_out`/`change_out`; el movimiento `opening` no se vuelve a sumar
 * (ya está en el fondo) y los cobros en cuenta se acumulan aparte.
 */
export function computeCashSessionTotals(
  movements: CashSessionTotalsInput[],
  opening: CashSessionOpening,
) {
  return movements.reduce(
    (totals, movement) => {
      if (movement.type === "account_in") {
        totals.accountVes += movement.amountVes;
        return totals;
      }

      if (movement.type === "account_out") {
        totals.accountVes -= movement.amountVes;
        return totals;
      }

      if (movement.type === "opening") {
        return totals;
      }

      const sign = CASH_OUT_TYPES.includes(movement.type) ? -1 : 1;
      totals.cashRef += sign * movement.amountRef;
      totals.cashVes += sign * movement.amountVes;
      return totals;
    },
    { accountVes: 0, cashRef: opening.openingRef, cashVes: opening.openingVes },
  );
}

export type CashCloseDifferenceKind = "shortage" | "surplus" | "even";

export type CashCloseDifference = {
  /** Contado − teórico, con signo: negativo si falta, positivo si sobra. */
  amount: number;
  counted: number;
  kind: CashCloseDifferenceKind;
  theoretical: number;
};

export type CashCloseReview = {
  /**
   * Hay que pedir confirmación explícita antes de cerrar: falta Bs por ENCIMA
   * del umbral de la tienda, o falta REF (el umbral está en Bs: en REF no hay
   * tolerancia configurable y cualquier faltante confirma).
   */
  needsConfirmation: boolean;
  ref: CashCloseDifference;
  /** Faltante en REF que obliga a confirmar. */
  refShortageOverThreshold: boolean;
  ves: CashCloseDifference;
  /** Faltante en Bs que supera el umbral. */
  vesShortageOverThreshold: boolean;
};

// Céntimos enteros: 0.1 + 0.2 no deja un faltante fantasma de 0.00000000000000004.
function toMoneyCents(value: number) {
  return Math.round(value * 100);
}

function closeDifference(counted: number, theoretical: number): CashCloseDifference {
  const countedCents = toMoneyCents(counted);
  const theoreticalCents = toMoneyCents(theoretical);
  const cents = countedCents - theoreticalCents;

  return {
    amount: cents / 100,
    counted: countedCents / 100,
    kind: cents < 0 ? "shortage" : cents > 0 ? "surplus" : "even",
    theoretical: theoreticalCents / 100,
  };
}

/**
 * Diferencia de un cierre de caja (contado − teórico) en Bs y en REF, con el
 * mismo criterio que `record_cash_close_difference`: lo contado contra el
 * teórico del cajón (fondo + efectivo de ventas). Decide además si el cierre
 * debe confirmarse: solo un FALTANTE lo exige (en Bs, cuando `|faltante|`
 * SUPERA `alertVes`; con 0 cualquier faltante). Un sobrante nunca confirma por
 * sí solo. Un umbral inválido (negativo, NaN) se trata como 0.
 */
export function computeCashCloseReview(input: {
  alertVes: number;
  countedRef: number;
  countedVes: number;
  theoreticalRef: number;
  theoreticalVes: number;
}): CashCloseReview {
  const ves = closeDifference(input.countedVes, input.theoreticalVes);
  const ref = closeDifference(input.countedRef, input.theoreticalRef);
  const alertCents =
    Number.isFinite(input.alertVes) && input.alertVes > 0 ? toMoneyCents(input.alertVes) : 0;
  const vesShortageOverThreshold =
    ves.kind === "shortage" && Math.abs(toMoneyCents(ves.amount)) > alertCents;
  const refShortageOverThreshold = ref.kind === "shortage";

  return {
    needsConfirmation: vesShortageOverThreshold || refShortageOverThreshold,
    ref,
    refShortageOverThreshold,
    ves,
    vesShortageOverThreshold,
  };
}
