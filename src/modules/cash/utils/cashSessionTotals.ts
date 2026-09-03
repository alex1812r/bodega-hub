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
