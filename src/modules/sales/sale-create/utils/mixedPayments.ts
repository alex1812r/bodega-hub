import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  PAYMENT_METHODS,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";
import { formatRef, formatVes, roundMoney } from "@/shared/utils/currency";
import { isKnownBankLabel } from "@/shared/venezuela/banks";
import { isValidVeMobilePhone } from "@/shared/venezuela/phone";

export const MIXED_PAYMENT_MAX_LINES = 4;
export const MIXED_PAYMENT_MIN_LINES = 2;
/** Tolerancia en REF (legacy / UI). La validacion de cierre usa VES. */
export const MIXED_PAYMENT_TOLERANCE_REF = 0.01;
/** Tolerancia en Bs. alineada a round(..., 2) del backend. */
export const MIXED_PAYMENT_TOLERANCE_VES = 0.01;

/** @deprecated Prefer PAYMENT_METHODS from shared/payments/paymentMethods */
export const MIXED_PAYMENT_METHODS: PaymentMethod[] = [...PAYMENT_METHODS];

export type PosMixedPaymentLine = {
  amount: number;
  bankName?: string;
  id: string;
  method: PaymentMethod;
  phone?: string;
  referenceCode?: string;
};

export function getMaxMixedPaymentLines(enabledCount: number) {
  return Math.min(MIXED_PAYMENT_MAX_LINES, Math.max(0, enabledCount));
}

export function canUseMixedPayments(enabledMethods: readonly PaymentMethod[]) {
  return filterEnabledPaymentMethods(enabledMethods).length >= MIXED_PAYMENT_MIN_LINES;
}

export function getUsedPaymentMethods(
  lines: Array<Pick<PosMixedPaymentLine, "id" | "method">>,
  excludeLineId?: string,
) {
  return new Set(
    lines
      .filter((line) => line.id !== excludeLineId)
      .map((line) => line.method),
  );
}

export function getAvailablePaymentMethods(
  lines: Array<Pick<PosMixedPaymentLine, "id" | "method">>,
  excludeLineId?: string,
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
) {
  const used = getUsedPaymentMethods(lines, excludeLineId);
  return filterEnabledPaymentMethods(enabledMethods).filter((method) => !used.has(method));
}

export function pickNextAvailablePaymentMethod(
  lines: Array<Pick<PosMixedPaymentLine, "id" | "method">>,
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
): PaymentMethod | null {
  return getAvailablePaymentMethods(lines, undefined, enabledMethods)[0] ?? null;
}

export function isUsdPaymentMethod(method: PaymentMethod) {
  return method === "efectivo_usd";
}

export function getPaymentCurrency(method: PaymentMethod): "USD" | "VES" {
  return isUsdPaymentMethod(method) ? "USD" : "VES";
}

export function needsBank(method: PaymentMethod) {
  return method === "pago_movil" || method === "transferencia";
}

export function needsPhone(method: PaymentMethod) {
  return method === "pago_movil";
}

export function needsReference(method: PaymentMethod) {
  return method === "pago_movil" || method === "punto_venta" || method === "transferencia";
}

export function methodRequiresPaymentDetails(method: PaymentMethod | null | undefined) {
  return method === "pago_movil" || method === "transferencia";
}

export type PosSinglePaymentDetails = {
  bankName: string;
  phone: string;
  referenceCode: string;
};

export function createEmptySinglePaymentDetails(): PosSinglePaymentDetails {
  return {
    bankName: "",
    phone: "",
    referenceCode: "",
  };
}

export function validateSinglePaymentDetails(
  method: PaymentMethod,
  details: PosSinglePaymentDetails | null | undefined,
): MixedPaymentsValidationResult {
  const errors: string[] = [];

  if (!methodRequiresPaymentDetails(method)) {
    return { errors, isValid: true };
  }

  if (!details) {
    errors.push("Completa los datos del metodo de pago.");
    return { errors, isValid: false };
  }

  if (needsBank(method) && !details.bankName.trim()) {
    errors.push("Indica el banco.");
  } else if (needsBank(method) && !isKnownBankLabel(details.bankName)) {
    errors.push("Selecciona un banco de la lista.");
  }

  if (needsPhone(method) && !details.phone.trim()) {
    errors.push("Indica el telefono.");
  } else if (needsPhone(method) && !isValidVeMobilePhone(details.phone)) {
    errors.push("Telefono invalido (ej. 0412 555-1234).");
  }

  if (method === "pago_movil") {
    if (!/^\d{4}$/.test(details.referenceCode.trim())) {
      errors.push("La referencia de pago movil debe tener 4 digitos.");
    }
  } else if (method === "transferencia" && !details.referenceCode.trim()) {
    errors.push("Indica el numero de transferencia.");
  }

  return {
    errors,
    isValid: errors.length === 0,
  };
}

/** Misma conversion REF que usa el POS para mostrar/estimar. */
export function paymentAmountToRef(
  method: PaymentMethod,
  amount: number,
  rateVes: number,
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (isUsdPaymentMethod(method)) {
    return amount;
  }

  if (!rateVes || rateVes <= 0) {
    return 0;
  }

  return amount / rateVes;
}

/**
 * Conversion a Bs. alineada a `register_payment`:
 * - USD: round(amount * rate, 2)
 * - VES: round(amount, 2)
 */
export function paymentAmountToVes(
  method: PaymentMethod,
  amount: number,
  rateVes: number,
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (isUsdPaymentMethod(method)) {
    if (!rateVes || rateVes <= 0) {
      return 0;
    }
    return roundMoney(amount * rateVes);
  }

  return roundMoney(amount);
}

/** Total VES de la venta: round(totalRef * rate), igual que `create_sale`. */
export function getSaleTotalVes(totalRef: number, rateVes: number) {
  if (!Number.isFinite(totalRef) || totalRef <= 0 || !rateVes || rateVes <= 0) {
    return 0;
  }
  return roundMoney(totalRef * rateVes);
}

export function getAllocatedRef(
  lines: Array<Pick<PosMixedPaymentLine, "amount" | "method">>,
  rateVes: number,
) {
  return lines.reduce(
    (total, line) => total + paymentAmountToRef(line.method, line.amount, rateVes),
    0,
  );
}

export function getAllocatedVes(
  lines: Array<Pick<PosMixedPaymentLine, "amount" | "method">>,
  rateVes: number,
) {
  return roundMoney(
    lines.reduce(
      (total, line) => total + paymentAmountToVes(line.method, line.amount, rateVes),
      0,
    ),
  );
}

export function getRemainingRef(
  totalRef: number,
  lines: Array<Pick<PosMixedPaymentLine, "amount" | "id" | "method">>,
  rateVes: number,
  excludeLineId?: string,
) {
  const source = excludeLineId
    ? lines.filter((line) => line.id !== excludeLineId)
    : lines;

  return Math.max(0, roundMoney(totalRef - getAllocatedRef(source, rateVes)));
}

export function getRemainingVes(
  totalRef: number,
  lines: Array<Pick<PosMixedPaymentLine, "amount" | "id" | "method">>,
  rateVes: number,
  excludeLineId?: string,
) {
  const source = excludeLineId
    ? lines.filter((line) => line.id !== excludeLineId)
    : lines;

  return Math.max(
    0,
    roundMoney(getSaleTotalVes(totalRef, rateVes) - getAllocatedVes(source, rateVes)),
  );
}

/**
 * Minimo USD (2 decimales) tal que round(usd * rate, 2) >= remainingVes.
 * Evita el hueco de centavos al redondear el restante REF→USD.
 */
export function usdAmountToCoverVes(remainingVes: number, rateVes: number) {
  if (!Number.isFinite(remainingVes) || remainingVes <= 0 || !rateVes || rateVes <= 0) {
    return 0;
  }

  let amount = roundMoney(remainingVes / rateVes);
  let guard = 0;

  while (paymentAmountToVes("efectivo_usd", amount, rateVes) + 1e-9 < remainingVes && guard < 20) {
    amount = roundMoney(amount + 0.01);
    guard += 1;
  }

  return amount;
}

/** Monto en la moneda del metodo para cubrir un restante en Bs. */
export function amountToCoverRemainingVes(
  method: PaymentMethod,
  remainingVes: number,
  rateVes: number,
) {
  if (!Number.isFinite(remainingVes) || remainingVes <= 0) {
    return 0;
  }

  if (isUsdPaymentMethod(method)) {
    return usdAmountToCoverVes(remainingVes, rateVes);
  }

  return roundMoney(remainingVes);
}

/**
 * @deprecated Prefer amountToCoverRemainingVes for fill-remaining (cierra en Bs.).
 * Conservado para callers que parten de restante REF.
 */
export function refToPaymentAmount(
  method: PaymentMethod,
  remainingRef: number,
  rateVes: number,
) {
  if (!Number.isFinite(remainingRef) || remainingRef <= 0) {
    return 0;
  }

  if (isUsdPaymentMethod(method)) {
    if (!rateVes || rateVes <= 0) {
      return roundMoney(remainingRef);
    }
    return usdAmountToCoverVes(roundMoney(remainingRef * rateVes), rateVes);
  }

  if (!rateVes || rateVes <= 0) {
    return 0;
  }

  return roundMoney(remainingRef * rateVes);
}

export function buildVesAmountHelperText(amountVes: number, rateVes: number) {
  if (!rateVes || rateVes <= 0 || !Number.isFinite(amountVes) || amountVes <= 0) {
    return undefined;
  }

  const amountRef = amountVes / rateVes;
  return `${formatRef(amountRef)} × ${formatVes(rateVes)} = ${formatVes(amountVes)}`;
}

export function buildRemainingFillHelperText(
  method: PaymentMethod,
  remainingVes: number,
  rateVes: number,
) {
  if (remainingVes <= MIXED_PAYMENT_TOLERANCE_VES) {
    return undefined;
  }

  const amount = amountToCoverRemainingVes(method, remainingVes, rateVes);

  if (isUsdPaymentMethod(method)) {
    const coversVes = paymentAmountToVes("efectivo_usd", amount, rateVes);
    return `Restante: ${formatVes(remainingVes)} → ${formatRef(amount)} (cubre ${formatVes(coversVes)})`;
  }

  if (!rateVes || rateVes <= 0) {
    return undefined;
  }

  return `${formatRef(remainingVes / rateVes)} × ${formatVes(rateVes)} = ${formatVes(amount)}`;
}

export function createEmptyMixedPaymentLine(
  method: PaymentMethod = "efectivo_usd",
): PosMixedPaymentLine {
  return {
    amount: 0,
    id: `mixed-${method}-${Math.random().toString(36).slice(2, 9)}`,
    method,
  };
}

export function createDefaultMixedPaymentLines(
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
): PosMixedPaymentLine[] {
  const methods = filterEnabledPaymentMethods(enabledMethods);
  const first = methods[0] ?? "efectivo_ves";
  const second = methods[1] ?? methods[0] ?? "efectivo_usd";

  return [createEmptyMixedPaymentLine(first), createEmptyMixedPaymentLine(second)];
}

export type MixedPaymentsValidationResult = {
  errors: string[];
  isValid: boolean;
};

/** Maximo sobrepago permitido en Bs. al cerrar con USD (1 centavo USD a la tasa). */
export function getMixedPaymentMaxOverageVes(rateVes: number) {
  if (!rateVes || rateVes <= 0) {
    return MIXED_PAYMENT_TOLERANCE_VES;
  }
  return roundMoney(0.01 * rateVes + MIXED_PAYMENT_TOLERANCE_VES);
}

export function validateMixedPayments(
  totalRef: number,
  lines: PosMixedPaymentLine[],
  rateVes: number,
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
): MixedPaymentsValidationResult {
  const errors: string[] = [];
  const enabled = filterEnabledPaymentMethods(enabledMethods);
  const maxLines = getMaxMixedPaymentLines(enabled.length);

  if (lines.length < MIXED_PAYMENT_MIN_LINES) {
    errors.push(`Agrega al menos ${MIXED_PAYMENT_MIN_LINES} metodos de pago.`);
  }

  if (lines.length > maxLines) {
    errors.push(`El maximo es ${maxLines} metodos de pago.`);
  }

  for (const line of lines) {
    if (!enabled.includes(line.method)) {
      errors.push(
        `El metodo ${paymentMethodLabels[line.method]} no esta habilitado en la tienda.`,
      );
    }
  }

  if (!rateVes || rateVes <= 0) {
    errors.push("No hay tasa de cambio disponible para calcular pagos mixtos.");
  }

  lines.forEach((line, index) => {
    const label = `Linea ${index + 1}`;

    if (!Number.isFinite(line.amount) || line.amount <= 0) {
      errors.push(`${label}: indica un monto mayor a cero.`);
    }

    if (needsBank(line.method) && !line.bankName?.trim()) {
      errors.push(`${label}: indica el banco.`);
    } else if (needsBank(line.method) && !isKnownBankLabel(line.bankName ?? "")) {
      errors.push(`${label}: selecciona un banco de la lista.`);
    }

    if (needsPhone(line.method) && !line.phone?.trim()) {
      errors.push(`${label}: indica el telefono.`);
    } else if (needsPhone(line.method) && !isValidVeMobilePhone(line.phone ?? "")) {
      errors.push(`${label}: telefono invalido (ej. 0412 555-1234).`);
    }

    if (needsReference(line.method)) {
      const reference = line.referenceCode?.trim() ?? "";
      if (line.method === "pago_movil") {
        if (!/^\d{4}$/.test(reference)) {
          errors.push(`${label}: la referencia de pago movil debe tener 4 digitos.`);
        }
      } else if (!reference) {
        errors.push(`${label}: indica la referencia.`);
      }
    }
  });

  const methods = lines.map((line) => line.method);
  if (new Set(methods).size !== methods.length) {
    errors.push("Cada metodo de pago solo puede usarse una vez.");
  }

  if (rateVes > 0) {
    const totalVes = getSaleTotalVes(totalRef, rateVes);
    const allocatedVes = getAllocatedVes(lines, rateVes);
    const shortfall = roundMoney(totalVes - allocatedVes);
    const overage = roundMoney(allocatedVes - totalVes);
    const maxOverage = getMixedPaymentMaxOverageVes(rateVes);

    if (shortfall > MIXED_PAYMENT_TOLERANCE_VES) {
      errors.push(
        `Falta por cubrir ${formatVes(shortfall)} del total ${formatVes(totalVes)}.`,
      );
    } else if (overage > maxOverage) {
      errors.push(
        `La suma excede el total por ${formatVes(overage)} (total ${formatVes(totalVes)}).`,
      );
    }
  }

  return {
    errors,
    isValid: errors.length === 0,
  };
}
