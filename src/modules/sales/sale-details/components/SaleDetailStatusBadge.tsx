import { cn } from "@/shared/utils/cn";
import type { SaleStatus } from "@/shared/mocks/erp-data";

import { saleDetailStatusConfig } from "../utils/saleDetailLabels";

type SaleDetailStatusBadgeProps = {
  status: SaleStatus;
};

export function SaleDetailStatusBadge({ status }: SaleDetailStatusBadgeProps) {
  const config = saleDetailStatusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded bg-surface-container-highest px-2 py-1 text-xs font-semibold text-on-surface-variant",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", config.dotClassName)}
      />
      {config.label}
    </span>
  );
}
