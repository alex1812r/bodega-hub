"use client";

import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";
import { cn } from "@/shared/utils/cn";

type PosPaymentMethodsProps = {
  disabled?: boolean;
  enabledMethods?: readonly PaymentMethod[];
  onChange: (method: PaymentMethod) => void;
  onOpenMixedPayments?: () => void;
  selectedMethod: PaymentMethod | null;
  showMixedPaymentsLink?: boolean;
};

export function PosPaymentMethods({
  disabled = false,
  enabledMethods = DEFAULT_ENABLED_PAYMENT_METHODS,
  onChange,
  onOpenMixedPayments,
  selectedMethod,
  showMixedPaymentsLink = true,
}: PosPaymentMethodsProps) {
  const paymentOptions = filterEnabledPaymentMethods(enabledMethods).map((value) => ({
    label: paymentMethodLabels[value],
    value,
  }));

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium text-foreground">Metodo de pago</legend>
      <div className="min-w-0 overflow-hidden">
        <div
          className={cn(
            "flex max-w-full gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            disabled && "opacity-50",
          )}
        >
          {paymentOptions.map((option) => {
            const isActive = option.value === selectedMethod && !disabled;

            return (
              <button
                aria-pressed={isActive}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low",
                  disabled && "cursor-not-allowed hover:bg-surface-container-lowest",
                )}
                disabled={disabled}
                key={option.value}
                onClick={() => onChange(option.value)}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {onOpenMixedPayments && showMixedPaymentsLink ? (
        <button
          className="cursor-pointer text-sm font-medium text-primary hover:underline"
          onClick={onOpenMixedPayments}
          type="button"
        >
          {disabled ? "Editar pago mixto" : "Pago mixto"}
        </button>
      ) : null}
    </fieldset>
  );
}

export { paymentMethodLabels as posPaymentMethodLabels };
