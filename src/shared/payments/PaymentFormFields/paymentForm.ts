import { formatVesBs, roundMoney } from "@/shared/utils/currency";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  fromMoneyCents,
  maxUsdCentsWithin,
  payablePart,
  toMoneyCents,
  toRateUnits,
  usdCentsToVesCents,
  vesCentsToUsdCents,
} from "@/shared/payments/moneyConversion";

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

/** Saldo del documento contra el que se compara el monto. */
export type PaymentBalanceContext = {
  /**
   * Menor saldo en Bs que el servidor aún deja pagar (`MIN_PAYABLE_VES_BY_DOCUMENT`).
   * Los atajos de saldo no dejan un resto por debajo. Por defecto Bs 0,01.
   */
  minPayableVes?: number;
  /**
   * Bs por encima del saldo que el servidor todavía acepta. Con él, un monto que lo
   * rebasa invalida el formulario; sin él, superar el saldo solo se avisa.
   */
  overpayToleranceVes?: number;
  /** Saldo pendiente del documento en Bs. */
  pendingBalance?: number;
  /** Tasa Bs por REF del documento. */
  rateVes?: number;
};

export type PaymentOverpayment = {
  /** `true` si el servidor lo rechazaría: el formulario no debe enviarse. */
  blocking: boolean;
  message: string;
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

/**
 * Aviso cuando el monto supera el saldo pendiente. `null` si no lo supera o no se
 * puede saber (sin saldo, o método en USD sin tasa).
 *
 * Misma aritmética exacta que el reparto de un abono (`moneyConversion`): en USD
 * un monto "cabe" mientras su valor en Bs sin redondear no pase del saldo en más
 * de medio céntimo, así que lo que propone "Completar saldo" nunca se avisa. El
 * bloqueo compara los Bs que descontará el servidor con el saldo más la holgura.
 */
export function paymentOverpayment(
  values: PaymentFormValues,
  { overpayToleranceVes, pendingBalance, rateVes }: PaymentBalanceContext = {},
): PaymentOverpayment | null {
  const parsed = Number(values.amount);

  if (pendingBalance === undefined || !Number.isFinite(pendingBalance) || !(parsed > 0)) {
    return null;
  }

  const amountCents = toMoneyCents(parsed);
  const balanceCents = toMoneyCents(pendingBalance);
  let amountVesCents = amountCents;
  let fits = amountCents <= balanceCents;

  if (getPaymentCurrency(values.method) === "USD") {
    const rateUnits = toRateUnits(rateVes);

    if (rateUnits <= 0) {
      return null;
    }

    amountVesCents = usdCentsToVesCents(amountCents, rateUnits);
    fits = amountCents <= maxUsdCentsWithin(balanceCents, rateUnits);
  }

  if (fits) {
    return null;
  }

  return {
    blocking:
      overpayToleranceVes !== undefined &&
      amountVesCents > balanceCents + Math.round(overpayToleranceVes * 100),
    message: `El monto supera el saldo pendiente (${formatVesBs(fromMoneyCents(balanceCents))}).`,
  };
}

/**
 * Mismas reglas y textos que tenía `RegisterPaymentModal`. Con `balance` añade el
 * sobrepago que el servidor rechazaría (ver `PaymentBalanceContext`).
 */
export function validatePaymentForm(
  values: PaymentFormValues,
  balance?: PaymentBalanceContext,
): PaymentFormErrors {
  const { amount, bankName, method, phone, referenceCode } = values;
  const errors: PaymentFormErrors = {};
  const overpayment = paymentOverpayment(values, balance);

  if (!(Number(amount) > 0)) {
    errors.amount = "Indica un monto mayor a cero.";
  } else if (overpayment?.blocking) {
    errors.amount = overpayment.message;
  }

  if (paymentNeedsBank(method) && !isKnownBankLabel(bankName)) {
    errors.bankName = bankName.trim() ? "Selecciona un banco de la lista." : "Indica el banco.";
  }

  if (paymentNeedsPhone(method) && !isValidVeMobilePhone(phone)) {
    errors.phone = phone.trim() ? "Teléfono inválido (ej. 0412 555-1234)." : "Indica el teléfono.";
  }

  if (method === "pago_movil") {
    if (!/^\d{4}$/.test(referenceCode.trim())) {
      errors.referenceCode = "Usa una referencia de 4 dígitos.";
    }
  } else if (paymentNeedsReference(method) && !referenceCode.trim()) {
    errors.referenceCode = "Indica la referencia.";
  }

  return errors;
}

export function isPaymentFormValid(values: PaymentFormValues, balance?: PaymentBalanceContext) {
  return Object.keys(validatePaymentForm(values, balance)).length === 0;
}

/**
 * Monto al pasar de `from` a `to`. Entre métodos de la misma moneda no cambia; a otra
 * moneda se convierte con la tasa (mismo redondeo que la equivalencia en vivo) o se
 * vacía si no hay tasa: la misma cifra nunca se reinterpreta en otra moneda.
 */
export function amountForMethodChange(
  from: PaymentMethod,
  to: PaymentMethod,
  amount: string,
  rateVes?: number,
): string {
  if (getPaymentCurrency(from) === getPaymentCurrency(to)) {
    return amount;
  }

  const converted = paymentAmountEquivalent(from, amount, rateVes);

  return converted ? String(converted.value) : "";
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
 * `null` si no se puede calcular (sin saldo, o método en REF sin tasa).
 *
 * Es el mismo cálculo exacto que el reparto de un abono (`payablePart`): en Bs se
 * topa con el saldo; en REF es el mayor monto que cabe en esa parte del saldo con
 * la regla del medio céntimo, y nunca deja un resto que el servidor ya no deje
 * pagar (`minPayableVes`). Al 100 % coincide siempre con lo que el reparto aplica a
 * ese documento.
 */
export function amountForPendingShare(
  method: PaymentMethod,
  pendingBalanceVes: number | undefined,
  percent: number,
  rateVes?: number,
  minPayableVes = 0.01,
): number | null {
  if (pendingBalanceVes === undefined || !Number.isFinite(pendingBalanceVes)) {
    return null;
  }

  const balanceCents = toMoneyCents(pendingBalanceVes);

  if (balanceCents <= 0 || percent <= 0) {
    return null;
  }

  const currency = getPaymentCurrency(method);
  const rateUnits = currency === "USD" ? toRateUnits(rateVes) : 0;

  if (currency === "USD" && rateUnits <= 0) {
    return null;
  }

  // El porcentaje del saldo (en Bs) se redondea como siempre, con `roundMoney`: no es
  // una conversión de moneda. Lo que se unifica con el reparto es lo que viene después.
  const shareCents = Math.min(
    toMoneyCents(roundMoney((fromMoneyCents(balanceCents) * percent) / 100)),
    balanceCents,
  );
  const part = payablePart(
    currency === "USD" ? maxUsdCentsWithin(shareCents, rateUnits) : shareCents,
    balanceCents,
    rateUnits,
    currency,
    Math.max(toMoneyCents(minPayableVes), 1),
  );

  return part.cents > 0 ? fromMoneyCents(part.cents) : null;
}

/** Equivalencia del monto en la otra moneda. `null` sin monto o sin tasa. */
export function paymentAmountEquivalent(
  method: PaymentMethod,
  amount: string,
  rateVes?: number,
): { currency: PaymentFormCurrency; value: number } | null {
  const parsed = Number(amount);
  const rateUnits = toRateUnits(rateVes);

  if (rateUnits <= 0 || !(parsed > 0)) {
    return null;
  }

  const cents = toMoneyCents(parsed);

  // Mismo redondeo que el servidor y que el reparto de un abono (`moneyConversion`).
  return getPaymentCurrency(method) === "USD"
    ? { currency: "VES", value: fromMoneyCents(usdCentsToVesCents(cents, rateUnits)) }
    : { currency: "USD", value: fromMoneyCents(vesCentsToUsdCents(cents, rateUnits)) };
}
