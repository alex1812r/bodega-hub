import type { PaymentMethod } from "@/shared/mocks/erp-data";

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "efectivo_ves",
  "efectivo_usd",
  "pago_movil",
  "punto_venta",
  "transferencia",
] as const;

export const DEFAULT_ENABLED_PAYMENT_METHODS: PaymentMethod[] = [...PAYMENT_METHODS];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo_usd: "Efectivo USD",
  efectivo_ves: "Efectivo VES",
  pago_movil: "Pago movil",
  punto_venta: "Punto de venta",
  transferencia: "Transferencia",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function normalizeEnabledPaymentMethods(
  value: unknown,
): PaymentMethod[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_PAYMENT_METHODS];
  }

  const unique: PaymentMethod[] = [];
  for (const item of value) {
    if (isPaymentMethod(item) && !unique.includes(item)) {
      unique.push(item);
    }
  }

  return unique.length > 0 ? unique : [...DEFAULT_ENABLED_PAYMENT_METHODS];
}

export function filterEnabledPaymentMethods(
  enabled: readonly PaymentMethod[] | null | undefined,
  candidates: readonly PaymentMethod[] = PAYMENT_METHODS,
): PaymentMethod[] {
  const allowed = new Set(
    normalizeEnabledPaymentMethods(enabled ?? DEFAULT_ENABLED_PAYMENT_METHODS),
  );
  return candidates.filter((method) => allowed.has(method));
}

export function isPaymentMethodEnabled(
  method: PaymentMethod,
  enabled: readonly PaymentMethod[] | null | undefined,
) {
  return filterEnabledPaymentMethods(enabled).includes(method);
}
