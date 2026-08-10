import { Receipt } from "lucide-react";

import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { PurchaseDetailInfoCard } from "./PurchaseDetailInfoCard";

type PurchaseDetailPaymentStatusCardProps = {
  currentRateVes?: number;
  paidRef: number;
  paidVes: number;
  pendingRef: number;
};

export function PurchaseDetailPaymentStatusCard({
  currentRateVes = 0,
  paidRef,
  paidVes,
  pendingRef,
}: PurchaseDetailPaymentStatusCardProps) {
  const isPaid = pendingRef < 0.01;
  const isPartial = !isPaid && paidRef > 0.01;
  const pendingVesToday =
    currentRateVes > 0 ? Math.round(pendingRef * currentRateVes * 100) / 100 : null;

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
          <div className="flex flex-col items-start leading-tight">
            <span className="text-sm font-semibold tabular-nums text-foreground">
              Pagado {formatRefUsd(paidRef)}
            </span>
            <span className="text-xs tabular-nums text-on-surface-variant">
              {formatVesBs(paidVes)}
            </span>
          </div>
        </div>
        <div className="mt-3 space-y-1 border-t border-border/50 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-on-surface-variant">Pendiente (REF):</span>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                pendingRef > 0.01 ? "text-destructive" : "text-foreground",
              )}
            >
              {formatRefUsd(pendingRef)}
            </span>
          </div>
          {pendingVesToday != null ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-on-surface-variant">≈ hoy en Bs:</span>
              <span className="text-xs font-medium tabular-nums text-on-surface-variant">
                {formatVesBs(pendingVesToday)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </PurchaseDetailInfoCard>
  );
}
