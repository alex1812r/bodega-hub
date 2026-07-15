import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import { paymentMethodConfig } from "../utils/saleDetailLabels";

type SalePaymentMethodBadgeProps = {
  method: PaymentMethod;
};

export function SalePaymentMethodBadge({ method }: SalePaymentMethodBadgeProps) {
  const config = paymentMethodConfig[method];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded bg-surface-container px-2 py-1 text-xs font-semibold text-on-surface dark:bg-slate-800",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {config.label}
    </span>
  );
}
