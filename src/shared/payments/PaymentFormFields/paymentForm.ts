import { roundMoney } from "@/shared/utils/currency";
import type { PaymentMethod } from "@/shared/mocks/erp-data";

import { isKnownBankLabel } from "@/shared/venezuela/banks";
import { isValidVeMobilePhone } from "@/shared/venezuela/phone";

export type PaymentFormCurrency = "USD" | "VES";

/** Estado del formulario. `amount` es texto con punto decimal, en la moneda del método. */
export type PaymentFormValues = {
  amount: string;
  bankName: string;
  method: PaymentMethod;
  notes: string;
  phone: string;
  referenceCode: string;
};

export type PaymentFormErrors = {
  amount?: string;
  bankName?: string;
  phone?: string;
  referenceCode?: string;
};

/** Campos del pago listos para `POST /api/payments` (falta solo `saleId`/`purchaseId`). */
export type PaymentFormPayload = {
  amount: number;
  bankName: string | undefined;
  currency: PaymentFormCurrency;
  method: PaymentMethod;
  notes: string | undefined;
  phone: string | undefined;
  referenceCode: string | undefined;
};

export const PENDING_BALANCE_SHARES = [25, 50, 100] as const;

export function createEmptyPaymentFormValues(
  method: PaymentMethod = "efectivo_ves",
): PaymentFormValues {
  return {
    amount: "",
    bankName: "",
    method,
    notes: "",
    phone: "",
    referenceCode: "",
  };
}

export function getPaymentCurrency(method: PaymentMethod): PaymentFormCurrency {
  return method === "efectivo_usd" ? "USD" : "VES";
}

export function paymentNeedsBank(method: PaymentMethod) {
  return method === "pago_movil" || method === "transferencia";
}

export function paymentNeedsPhone(method: PaymentMethod) {
  return method === "pago_movil";
}

export function paymentNeedsReference(method: PaymentMethod) {
  return method === "pago_movil" || method === "punto_venta" || method === "transferencia";
}

/** Mismas reglas y textos que tenía `RegisterPaymentModal`. */
export function validatePaymentForm(values: PaymentFormValues): PaymentFormErrors {
  const { amount, bankName, method, phone, referenceCode } = values;
  const errors: PaymentFormErrors = {};

  if (!(Number(amount) > 0)) {
    errors.amount = "Indica un monto mayor a cero.";
  }

  if (paymentNeedsBank(method) && !isKnownBankLabel(bankName)) {
    errors.bankName = bankName.trim() ? "Selecciona un banco de la lista." : "Indica el banco.";
  }

  if (paymentNeedsPhone(method) && !isValidVeMobilePhone(phone)) {
    errors.phone = phone.trim() ? "Telefono invalido (ej. 0412 555-1234)." : "Indica el telefono.";
  }

  if (method === "pago_movil") {
    if (!/^\d{4}$/.test(referenceCode.trim())) {
      errors.referenceCode = "Usa una referencia de 4 digitos.";
    }
  } else if (paymentNeedsReference(method) && !referenceCode.trim()) {
    errors.referenceCode = "Indica la referencia.";
  }

  return errors;
}

export function isPaymentFormValid(values: PaymentFormValues) {
  return Object.keys(validatePaymentForm(values)).length === 0;
}

export function buildPaymentFormPayload(values: PaymentFormValues): PaymentFormPayload {
  return {
    amount: Number(values.amount),
    bankName: values.bankName.trim() || undefined,
    currency: getPaymentCurrency(values.method),
    method: values.method,
    notes: values.notes.trim() || undefined,
    phone: values.phone.trim() || undefined,
    referenceCode: values.referenceCode.trim() || undefined,
  };
}

/**
 * Monto, en la moneda del método, que cubre `percent` % del saldo pendiente (en Bs).
 * Nunca supera el saldo: en Bs se topa con el saldo y en REF se baja un céntimo
 * mientras su equivalente en Bs lo exceda. `null` si no se puede calcular
 * (sin saldo, o método en REF sin tasa).
 */
export function amountForPendingShare(
  method: PaymentMethod,
  pendingBalanceVes: number | undefined,
  percent: number,
  rateVes?: number,
): number | null {
  if (pendingBalanceVes === undefined || !Number.isFinite(pendingBalanceVes)) {
    return null;
  }

  const balanceVes = roundMoney(pendingBalanceVes);

  if (balanceVes <= 0 || percent <= 0) {
    return null;
  }

  const shareVes = Math.min(roundMoney((balanceVes * percent) / 100), balanceVes);

  if (getPaymentCurrency(method) === "VES") {
    return shareVes > 0 ? shareVes : null;
  }

  if (!rateVes || rateVes <= 0) {
    return null;
  }

  let amountRef = roundMoney(shareVes / rateVes);

  while (amountRef > 0 && roundMoney(amountRef * rateVes) > shareVes) {
    amountRef = roundMoney(amountRef - 0.01);
  }

  return amountRef > 0 ? amountRef : null;
}

/** Equivalencia del monto en la otra moneda. `null` sin monto o sin tasa. */
export function paymentAmountEquivalent(
  method: PaymentMethod,
  amount: string,
  rateVes?: number,
): { currency: PaymentFormCurrency; value: number } | null {
  const parsed = Number(amount);

  if (!rateVes || rateVes <= 0 || !(parsed > 0)) {
    return null;
  }

  return getPaymentCurrency(method) === "USD"
    ? { currency: "VES", value: roundMoney(parsed * rateVes) }
    : { currency: "USD", value: roundMoney(parsed / rateVes) };
}
