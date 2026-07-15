import type { PaymentDirection } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

const directionConfig = {
  entrada: {
    className:
      "border-secondary/20 bg-secondary-container text-on-secondary-container",
    label: "Entrada",
  },
  salida: {
    className: "border-error/20 bg-error-container text-on-error-container",
    label: "Salida",
  },
} as const satisfies Record<PaymentDirection, { className: string; label: string }>;

type PaymentsDirectionBadgeProps = {
  direction: PaymentDirection;
};

export function PaymentsDirectionBadge({ direction }: PaymentsDirectionBadgeProps) {
  const config = directionConfig[direction];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
