import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import {
  documentBalance,
  type DocumentBalance,
  type DocumentPaymentStatus,
  isPayableDocumentStatus,
} from "@/shared/payments/documentBalance";

/**
 * Compras que todavía pueden deberse: las vigentes (pedidas o recibidas). Es la
 * regla de "cuentas por pagar" de `store_capital_summary`; una compra cancelada
 * o devuelta no deja saldo por pagar.
 */
export const PAYABLE_PURCHASE_STATUSES = [
  "pedido",
  "recibido",
] as const satisfies readonly PurchaseStatus[];

export type PurchasePaymentStatus = DocumentPaymentStatus;

/**
 * Importes de la cabecera. El saldo se decide en Bs (`documentBalance`, el criterio de
 * `register_payment`), no comparando `paidRef` con `totalRef`: es la misma respuesta
 * que dan el detalle, Saldos del proveedor y Cuentas por pagar (GQ-07).
 */
type PurchaseAmounts = {
  paidRef?: number;
  paidVes?: number;
  status: string;
  totalRef: number;
  totalVes?: number;
};

export function isPayablePurchaseStatus(status: string) {
  return isPayableDocumentStatus("purchase", status);
}

export function getPurchaseBalance(purchase: PurchaseAmounts): DocumentBalance {
  return documentBalance({ ...purchase, type: "purchase" });
}

/** Saldo en REF de la compra; 0 si ya está saldada. */
export function getPurchasePendingRef(purchase: PurchaseAmounts) {
  return getPurchaseBalance(purchase).pendingRef;
}

/** Saldo que cuenta como deuda: `null` si la compra no está vigente. */
export function getPurchaseBalanceRef(purchase: PurchaseAmounts) {
  return isPayablePurchaseStatus(purchase.status) ? getPurchasePendingRef(purchase) : null;
}

/** Filtro "Con saldo pendiente": compra vigente a la que el servidor aún le acepta un pago. */
export function hasPendingBalance(purchase: PurchaseAmounts) {
  return getPurchaseBalance(purchase).open;
}

/** Estado de pago: el mismo que la tarjeta "Estado de pago" del detalle. */
export function getPurchasePaymentStatus(purchase: PurchaseAmounts): PurchasePaymentStatus {
  return getPurchaseBalance(purchase).paymentStatus;
}
