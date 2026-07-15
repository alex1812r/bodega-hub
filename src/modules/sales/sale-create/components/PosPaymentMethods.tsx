"use client";

import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

const paymentOptions: Array<{ label: string; value: PaymentMethod }> = [
  { label: "Efectivo VES", value: "efectivo_ves" },
  { label: "Efectivo USD", value: "efectivo_usd" },
  { label: "Pago movil", value: "pago_movil" },
  { label: "Punto de venta", value: "punto_venta" },
  { label: "Transferencia", value: "transferencia" },
];

type PosPaymentMethodsProps = {
  onChange: (method: PaymentMethod) => void;
  selectedMethod: PaymentMethod;
};

export function PosPaymentMethods({ onChange, selectedMethod }: PosPaymentMethodsProps) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium text-foreground">Metodo de pago</legend>
      <div className="min-w-0 overflow-hidden">
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {paymentOptions.map((option) => {
            const isActive = option.value === selectedMethod;

            return (
              <button
                aria-pressed={isActive}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low",
                )}
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
    </fieldset>
  );
}
