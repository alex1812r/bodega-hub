import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { roundMoney } from "@/shared/utils/currency";

/**
 * Compras que todavía pueden deberse: las vigentes (pedidas o recibidas). Es la
 * regla de "cuentas por pagar" de `store_capital_summary`; una compra cancelada
 * o devuelta no deja saldo por pagar.
 */
export const PAYABLE_PURCHASE_STATUSES = [
  "pedido",
  "recibido",
] as const satisfies readonly PurchaseStatus[];

/** Por debajo de un céntimo de REF no hay saldo (misma tolerancia que el detalle de compra). */
export const PURCHASE_BALANCE_TOLERANCE_REF = 0.01;

export type PurchasePaymentStatus = "pagada" | "parcial" | "pendiente";

type PurchaseAmounts = { paidRef?: number; totalRef: number };

export function isPayablePurchaseStatus(status: string) {
  return (PAYABLE_PURCHASE_STATUSES as readonly string[]).includes(status);
}

/** Total − pagado en REF, nunca negativo (como el detalle de compra). */
export function getPurchasePendingRef({ paidRef = 0, totalRef }: PurchaseAmounts) {
  return Math.max(0, roundMoney(totalRef - paidRef));
}

/** Saldo que cuenta como deuda: `null` si la compra no está vigente. */
export function getPurchaseBalanceRef(purchase: PurchaseAmounts & { status: string }) {
  return isPayablePurchaseStatus(purchase.status) ? getPurchasePendingRef(purchase) : null;
}

/** Filtro "Con saldo pendiente": compra vigente a la que le falta al menos un céntimo de REF. */
export function hasPendingBalance(purchase: PurchaseAmounts & { status: string }) {
  const balanceRef = getPurchaseBalanceRef(purchase);

  return balanceRef !== null && balanceRef >= PURCHASE_BALANCE_TOLERANCE_REF;
}

/** Estado de pago con los mismos umbrales que la tarjeta "Estado de pago" del detalle. */
export function getPurchasePaymentStatus(purchase: PurchaseAmounts): PurchasePaymentStatus {
  if (getPurchasePendingRef(purchase) < PURCHASE_BALANCE_TOLERANCE_REF) {
    return "pagada";
  }

  return (purchase.paidRef ?? 0) > PURCHASE_BALANCE_TOLERANCE_REF ? "parcial" : "pendiente";
}
