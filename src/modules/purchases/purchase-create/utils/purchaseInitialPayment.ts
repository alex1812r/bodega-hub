import {
  type PaymentBalanceContext,
  type PaymentFormPayload,
  type PaymentFormValues,
  buildPaymentFormPayload,
  isPaymentFormValid,
} from "@/shared/payments/PaymentFormFields";
import { roundMoney } from "@/shared/utils/currency";

/**
 * Bs por encima del saldo que `register_payment` acepta en una compra: el céntimo de
 * la conversión. La compra en curso usa la tasa del día, la misma con la que el
 * servidor convierte un pago en USD.
 */
const PURCHASE_OVERPAY_TOLERANCE_VES = 0.01;

export const INITIAL_PAYMENT_INCOMPLETE_MESSAGE =
  "Completa los datos del pago o desactiva «Pagar ahora» para confirmar la compra sin pago.";

export const INITIAL_PAYMENT_NO_BALANCE_MESSAGE =
  "La compra no tiene saldo por pagar: desactiva «Pagar ahora» para confirmarla.";

/** Saldo contra el que se valida el pago inicial: el total de la compra en curso. */
export function purchasePaymentBalance(totalVes: number, rateVes: number): PaymentBalanceContext {
  return {
    overpayToleranceVes: PURCHASE_OVERPAY_TOLERANCE_VES,
    pendingBalance: totalVes,
    rateVes,
  };
}

/**
 * Pago inicial listo para enviar, o el motivo (para la sección "Pagar ahora") por el
 * que no se puede confirmar todavía. Mismas validaciones que el modal de pago.
 */
export function resolveInitialPayment(
  values: PaymentFormValues,
  totalVes: number,
  rateVes: number,
): { error: string } | { payment: PaymentFormPayload } {
  if (roundMoney(totalVes) <= 0) {
    return { error: INITIAL_PAYMENT_NO_BALANCE_MESSAGE };
  }

  if (!isPaymentFormValid(values, purchasePaymentBalance(totalVes, rateVes))) {
    return { error: INITIAL_PAYMENT_INCOMPLETE_MESSAGE };
  }

  return { payment: buildPaymentFormPayload(values) };
}

/**
 * Clave de idempotencia del pago inicial, ligada a la del intento de la compra
 * (`RequestAttempt`): nace con ella y se conserva mientras esa siga viva, así que
 * el reintento del mismo intento viaja con las mismas dos claves; cuando el intento
 * estrena clave (éxito, o contenido distinto tras un rechazo) el pago también.
 */
export class InitialPaymentKey {
  private pair: { paymentKey: string; purchaseKey: string } | null = null;

  for(purchaseKey: string): string {
    if (this.pair?.purchaseKey !== purchaseKey) {
      this.pair = { paymentKey: crypto.randomUUID(), purchaseKey };
    }

    return this.pair.paymentKey;
  }
}

/** Aviso cuando la compra quedó creada pero su pago inicial no entró. */
export function buildInitialPaymentFailedNotice(message: string) {
  const reason = message.trim().replace(/\.+$/, "");

  return {
    description: `${reason}. Puedes registrarlo desde aquí.`,
    title: "La compra se registró, pero el pago no",
  };
}
