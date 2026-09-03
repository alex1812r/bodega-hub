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

import { USD_BILLS, VES_BILLS, type DenominationCounts } from "./denominations";

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
  /** Billetes contados en el pad; solo para efectivo. */
  denominations?: DenominationCounts | null;
  id: string;
  method: PaymentMethod;
  phone?: string;
  referenceCode?: string;
};

/** Lo que se devuelve porque el recibido supero el total: un solo metodo. */
export type PosChangeDeclaration = {
  /** Monto en la moneda de `method`. */
  amount: number;
  denominations?: DenominationCounts | null;
  method: PaymentMethod;
};

/** Resultado del modal «Cobrar»: recibido (1..4 lineas) + vuelto opcional. */
export type PosCheckout = {
  change: PosChangeDeclaration | null;
  /** Linea de `lines` que carga las columnas `change_*` del pago. */
  changeCarrierLineId: string | null;
  lines: PosMixedPaymentLine[];
};

/** Metodos por los que tiene sentido devolver vuelto. */
export const CHANGE_PAYMENT_METHODS: PaymentMethod[] = [
  "efectivo_ves",
  "pago_movil",
  "efectivo_usd",
  "transferencia",
];

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

/** Efectivo fisico: es lo unico que se cuenta con el pad de billetes. */
export function isCashPaymentMethod(method: PaymentMethod) {
  return method === "efectivo_usd" || method === "efectivo_ves";
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

/** Checkout inicial: una linea con el monto exacto del metodo elegido. */
export function createCheckoutForMethod(
  method: PaymentMethod,
  totalRef: number,
  rateVes: number,
): PosCheckout {
  const totalVes = getSaleTotalVes(totalRef, rateVes);

  return {
    change: null,
    changeCarrierLineId: null,
    lines: [
      {
        ...createEmptyMixedPaymentLine(method),
        amount: amountToCoverRemainingVes(method, totalVes, rateVes),
      },
    ],
  };
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

/** Excedente en Bs. del recibido sobre el total de la venta. */
export function getTenderOverageVes(
  totalRef: number,
  lines: Array<Pick<PosMixedPaymentLine, "amount" | "method">>,
  rateVes: number,
) {
  if (!rateVes || rateVes <= 0) {
    return 0;
  }

  return Math.max(
    0,
    roundMoney(getAllocatedVes(lines, rateVes) - getSaleTotalVes(totalRef, rateVes)),
  );
}

/** Vuelto declarado convertido a Bs., igual que `register_payment`. */
export function getChangeVes(
  change: PosChangeDeclaration | null | undefined,
  rateVes: number,
) {
  if (!change || !Number.isFinite(change.amount) || change.amount <= 0) {
    return 0;
  }

  return paymentAmountToVes(change.method, change.amount, rateVes);
}

export function getChangeMethodOptions(
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
) {
  return filterEnabledPaymentMethods(enabledMethods, CHANGE_PAYMENT_METHODS);
}

/**
 * `efectivo_ves` si la gaveta alcanza para ese vuelto; si no, `pago_movil`.
 * Proponer efectivo cuando no hay con que pagarlo solo obliga al cajero a
 * corregir el metodo despues de ver el error.
 */
export function getDefaultChangeMethod(
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
  drawerVes = 0,
  changeVes = 0,
): PaymentMethod | null {
  const options = getChangeMethodOptions(enabledMethods);

  if (options.length === 0) {
    return null;
  }

  if (drawerVes > 0 && drawerVes >= changeVes && options.includes("efectivo_ves")) {
    return "efectivo_ves";
  }

  if (options.includes("pago_movil")) {
    return "pago_movil";
  }

  return options[0];
}

/**
 * Monto de vuelto, en la moneda del metodo, que absorbe el excedente sin pasarse.
 * En USD trunca a centavos porque devolver de mas descuadra la gaveta.
 */
export function changeAmountForOverage(
  method: PaymentMethod,
  overageVes: number,
  rateVes: number,
) {
  if (!Number.isFinite(overageVes) || overageVes <= 0) {
    return 0;
  }

  if (isUsdPaymentMethod(method)) {
    if (!rateVes || rateVes <= 0) {
      return 0;
    }
    return Math.floor((overageVes / rateVes) * 100) / 100;
  }

  return roundMoney(overageVes);
}

/**
 * Sobrante en Bs. que puede quedar en la gaveta por no ser representable con
 * billetes. En metodos bancarios el vuelto sale exacto, asi que solo se admite
 * el centavo de redondeo.
 */
export function getMaxChangeRoundingVes(method: PaymentMethod, rateVes: number) {
  if (method === "efectivo_ves") {
    return roundMoney(Math.min(...VES_BILLS) - MIXED_PAYMENT_TOLERANCE_VES);
  }

  if (method === "efectivo_usd") {
    if (!rateVes || rateVes <= 0) {
      return MIXED_PAYMENT_TOLERANCE_VES;
    }
    return roundMoney(Math.min(...USD_BILLS) * rateVes - MIXED_PAYMENT_TOLERANCE_VES);
  }

  return MIXED_PAYMENT_TOLERANCE_VES;
}

/**
 * Linea de recibido que carga las columnas `change_*`: la de mayor monto en Bs.
 * que alcance el vuelto (el CHECK del patch exige `change_ves <= amount_ves`).
 */
export function pickChangeCarrierLineId(
  lines: Array<Pick<PosMixedPaymentLine, "amount" | "id" | "method">>,
  rateVes: number,
  changeVes: number,
) {
  if (!Number.isFinite(changeVes) || changeVes <= 0) {
    return null;
  }

  const carrier = lines
    .map((line) => ({
      amountVes: paymentAmountToVes(line.method, line.amount, rateVes),
      id: line.id,
    }))
    .filter((line) => line.amountVes + MIXED_PAYMENT_TOLERANCE_VES >= changeVes)
    .sort((left, right) => right.amountVes - left.amountVes)[0];

  return carrier?.id ?? null;
}

export type ValidateMixedPaymentsOptions = {
  /** Vuelto declarado que absorbe el excedente (spec cobro-pos-billetes §5.6). */
  change?: PosChangeDeclaration | null;
  /** Minimo de lineas: 1 en el modal «Cobrar», 2 en el pago mixto clasico. */
  minLines?: number;
};

export function validateMixedPayments(
  totalRef: number,
  lines: PosMixedPaymentLine[],
  rateVes: number,
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
  options: ValidateMixedPaymentsOptions = {},
): MixedPaymentsValidationResult {
  const errors: string[] = [];
  const enabled = filterEnabledPaymentMethods(enabledMethods);
  const maxLines = getMaxMixedPaymentLines(enabled.length);
  const minLines = Math.max(1, options.minLines ?? MIXED_PAYMENT_MIN_LINES);
  const change =
    options.change && options.change.amount > 0 ? options.change : null;

  if (lines.length < minLines) {
    errors.push(
      minLines === 1
        ? "Agrega al menos un metodo de pago."
        : `Agrega al menos ${minLines} metodos de pago.`,
    );
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

  if (options.change && options.change.amount < 0) {
    errors.push("El vuelto no puede ser negativo.");
  }

  if (change && !enabled.includes(change.method)) {
    errors.push(
      `El vuelto por ${paymentMethodLabels[change.method]} no esta habilitado en la tienda.`,
    );
  }

  if (rateVes > 0) {
    const totalVes = getSaleTotalVes(totalRef, rateVes);
    const allocatedVes = getAllocatedVes(lines, rateVes);
    const shortfall = roundMoney(totalVes - allocatedVes);
    const overage = roundMoney(allocatedVes - totalVes);
    const maxOverage = getMixedPaymentMaxOverageVes(rateVes);
    const changeVes = getChangeVes(change, rateVes);

    if (shortfall > MIXED_PAYMENT_TOLERANCE_VES) {
      errors.push(
        `Falta por cubrir ${formatVes(shortfall)} del total ${formatVes(totalVes)}.`,
      );
    } else if (!change) {
      if (overage > maxOverage) {
        errors.push(
          `La suma excede el total por ${formatVes(overage)} (total ${formatVes(totalVes)}). Declara el vuelto.`,
        );
      }
    } else if (overage <= MIXED_PAYMENT_TOLERANCE_VES) {
      errors.push("No hay excedente que devolver: quita el vuelto.");
    } else if (changeVes > roundMoney(overage + MIXED_PAYMENT_TOLERANCE_VES)) {
      errors.push(
        `El vuelto ${formatVes(changeVes)} supera el excedente ${formatVes(overage)}.`,
      );
    } else if (!pickChangeCarrierLineId(lines, rateVes, changeVes)) {
      errors.push(
        `Ninguna linea recibida alcanza para devolver ${formatVes(changeVes)}.`,
      );
    } else {
      const rounding = roundMoney(overage - changeVes);
      const maxRounding = getMaxChangeRoundingVes(change.method, rateVes);

      if (rounding > roundMoney(maxRounding + MIXED_PAYMENT_TOLERANCE_VES)) {
        errors.push(
          `El vuelto declarado deja ${formatVes(rounding)} sin devolver: ajusta el monto.`,
        );
      }
    }
  }

  return {
    errors,
    isValid: errors.length === 0,
  };
}

/** Validacion del modal «Cobrar»: admite una sola linea y vuelto declarado. */
export type PosDrawerCash = {
  /** Efectivo en USD disponible en la gaveta. */
  ref?: number;
  /** Efectivo en Bs. disponible en la gaveta. */
  ves?: number;
};

/**
 * El vuelto en efectivo sale de la gaveta: `register_payment` lo rechaza si no
 * alcanza. Se valida aqui tambien para no crear la venta y dejarla huerfana en
 * `pendiente_pago` cuando el pago falla despues.
 */
export function validateChangeAgainstDrawer(
  checkout: PosCheckout,
  rateVes: number,
  drawer: PosDrawerCash,
): string[] {
  const change = checkout.change;

  if (!change || !isCashPaymentMethod(change.method) || change.amount <= 0) {
    return [];
  }

  // El efectivo recibido en esta misma venta ya cuenta como disponible.
  const receivedVes = roundMoney(
    checkout.lines
      .filter((line) => line.method === "efectivo_ves")
      .reduce((total, line) => total + line.amount, 0),
  );
  const receivedRef = roundMoney(
    checkout.lines
      .filter((line) => line.method === "efectivo_usd")
      .reduce((total, line) => total + line.amount, 0),
  );

  if (change.method === "efectivo_ves") {
    // Sin dato de gaveta no se inventa un limite: lo valida el backend.
    if (drawer.ves == null) {
      return [];
    }
    const available = roundMoney(drawer.ves + receivedVes);
    if (roundMoney(change.amount) > available + MIXED_PAYMENT_TOLERANCE_VES) {
      return [
        `No hay suficiente efectivo en la caja para el vuelto: disponible ${formatVes(available)}, vuelto ${formatVes(change.amount)}.`,
      ];
    }
    return [];
  }

  if (drawer.ref == null) {
    return [];
  }

  const available = roundMoney(drawer.ref + receivedRef);
  if (roundMoney(change.amount) > available + 0.01) {
    return [
      `No hay suficiente efectivo en dolares en la caja para el vuelto: disponible ${formatRef(available)}, vuelto ${formatRef(change.amount)}.`,
    ];
  }
  return [];
}

export function validateCheckout(
  totalRef: number,
  checkout: PosCheckout,
  rateVes: number,
  enabledMethods: readonly PaymentMethod[] = DEFAULT_ENABLED_PAYMENT_METHODS,
  drawer: PosDrawerCash = {},
): MixedPaymentsValidationResult {
  const base = validateMixedPayments(totalRef, checkout.lines, rateVes, enabledMethods, {
    change: checkout.change,
    minLines: 1,
  });
  const drawerErrors = validateChangeAgainstDrawer(checkout, rateVes, drawer);
  const errors = [...base.errors, ...drawerErrors];

  return { errors, isValid: errors.length === 0 };
}
