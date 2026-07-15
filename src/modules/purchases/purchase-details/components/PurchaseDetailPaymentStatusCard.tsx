import { Receipt } from "lucide-react";

import { formatVesBs } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { PurchaseDetailInfoCard } from "./PurchaseDetailInfoCard";

type PurchaseDetailPaymentStatusCardProps = {
  paidVes: number;
  pendingVes: number;
};

export function PurchaseDetailPaymentStatusCard({
  paidVes,
  pendingVes,
}: PurchaseDetailPaymentStatusCardProps) {
  const isPaid = pendingVes < 0.01;
  const isPartial = !isPaid && paidVes > 0.01;

  const statusLabel = isPaid ? "Pagado" : isPartial ? "Pago parcial" : "Pendiente";

  return (
    <PurchaseDetailInfoCard icon={Receipt} title="Estado de pago">
      <div className="flex flex-1 flex-col justify-between">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
              isPaid
                ? "bg-secondary-container/30 text-stitch-secondary dark:bg-emerald-950/40 dark:text-emerald-400"
                : isPartial
                  ? "bg-tertiary-container/20 text-tertiary-container dark:bg-amber-950/40 dark:text-amber-400"
                  : "bg-surface-variant text-primary dark:bg-indigo-950/30",
            )}
          >
            {statusLabel}
          </span>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatVesBs(paidVes)}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-3 dark:border-slate-800">
          <span className="text-sm text-on-surface-variant">Pendiente:</span>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              pendingVes > 0.01 ? "text-destructive" : "text-foreground",
            )}
          >
            {formatVesBs(pendingVes)}
          </span>
        </div>
      </div>
    </PurchaseDetailInfoCard>
  );
}
