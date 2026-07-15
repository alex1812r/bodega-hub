import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { getTaxPercentLabel } from "../utils/saleDetailLabels";

type SaleDetailFinancialSummaryProps = {
  discountRef: number;
  paidVes: number;
  pendingVes: number;
  refRateVes: number;
  subtotalRef: number;
  taxRef: number;
  totalRef: number;
  totalVes: number;
};

export function SaleDetailFinancialSummary({
  discountRef,
  paidVes,
  pendingVes,
  refRateVes,
  subtotalRef,
  taxRef,
  totalRef,
  totalVes,
}: SaleDetailFinancialSummaryProps) {
  const taxPercent = getTaxPercentLabel(subtotalRef, taxRef);
  const showPending = pendingVes > 0.01;

  return (
    <section className="flex flex-col divide-y divide-border rounded border border-border bg-surface-container-low md:flex-row md:divide-x md:divide-y-0 dark:divide-slate-800 dark:border-slate-800">
      <div className="flex flex-1 flex-col justify-center p-4 md:pr-4">
        <div className="mb-2 flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-on-surface-variant">Subtotal</span>
          <span className="text-sm tabular-nums">{formatRefUsd(subtotalRef)}</span>
        </div>
        <div className="mb-2 flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-on-surface-variant">Descuento</span>
          <span
            className={cn(
              "text-sm tabular-nums",
              discountRef > 0 ? "text-destructive" : "text-foreground",
            )}
          >
            -{formatRefUsd(discountRef)}
          </span>
        </div>
        <div className="mb-2 flex items-center justify-between gap-4 border-b border-border pb-2 dark:border-slate-800">
          <span className="text-sm font-medium text-on-surface-variant">
            IVA ({taxPercent}%)
          </span>
          <span className="text-sm tabular-nums">{formatRefUsd(taxRef)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-4">
          <span className="text-lg font-semibold text-foreground">Total (REF)</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatRefUsd(totalRef)}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center bg-surface-bright/50 p-4 md:pl-4 dark:bg-slate-900/30">
        <div className="mb-2 flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-on-surface-variant">Tasa de Cambio</span>
          <span className="font-mono text-sm tabular-nums">
            {refRateVes.toFixed(2)} VES/REF
          </span>
        </div>
        <div className="mt-auto flex items-center justify-between gap-4 border-t border-border pt-2 dark:border-slate-800">
          <span className="text-lg font-semibold text-foreground">Total (VES)</span>
          <span className="text-lg font-semibold tabular-nums">{formatVesBs(totalVes)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Pagado VES
          </span>
          <span className="text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatVesBs(paidVes)}
          </span>
        </div>
        {showPending ? (
          <div className="mt-1 flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-destructive">Saldo Pendiente VES</span>
            <span className="text-sm font-bold tabular-nums text-destructive">
              {formatVesBs(pendingVes)}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
