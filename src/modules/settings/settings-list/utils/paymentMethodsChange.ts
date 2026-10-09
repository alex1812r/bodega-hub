import type { ConfirmActionEffect } from "@/shared/components/ConfirmActionModal";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { PAYMENT_METHODS, paymentMethodLabels } from "@/shared/payments/paymentMethods";

export type PaymentMethodsChange = {
  /** Estaban habilitados y dejan de estarlo, en el orden del catálogo. */
  disabled: PaymentMethod[];
  /** No estaban habilitados y pasan a estarlo, en el orden del catálogo. */
  enabled: PaymentMethod[];
  hasChanges: boolean;
};

/** Qué métodos de pago se habilitan y cuáles se deshabilitan al guardar. */
export function computePaymentMethodsChange(
  before: readonly PaymentMethod[],
  after: readonly PaymentMethod[],
): PaymentMethodsChange {
  const disabled = PAYMENT_METHODS.filter(
    (method) => before.includes(method) && !after.includes(method),
  );
  const enabled = PAYMENT_METHODS.filter(
    (method) => !before.includes(method) && after.includes(method),
  );

  return { disabled, enabled, hasChanges: disabled.length > 0 || enabled.length > 0 };
}

/** Una fila «antes → después» por método que cambia; primero los que se deshabilitan. */
export function buildPaymentMethodEffects(change: PaymentMethodsChange): ConfirmActionEffect[] {
  return [
    ...change.disabled.map<ConfirmActionEffect>((method) => ({
      after: "Deshabilitado",
      before: "Habilitado",
      label: paymentMethodLabels[method],
      tone: "warning",
    })),
    ...change.enabled.map<ConfirmActionEffect>((method) => ({
      after: "Habilitado",
      before: "Deshabilitado",
      label: paymentMethodLabels[method],
      tone: "positive",
    })),
  ];
}
