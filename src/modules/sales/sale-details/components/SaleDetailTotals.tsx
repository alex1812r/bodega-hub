import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { getTaxPercentLabel } from "../utils/saleDetailLabels";

type SaleDetailTotalsProps = {
  discountRef: number;
  refRateVes: number;
  subtotalRef: number;
  taxRef: number;
  totalRef: number;
  totalVes: number;
};

const rowClassName = "flex items-center justify-between gap-4";
const labelClassName = "text-sm font-medium text-on-surface-variant";

/** Desglose del total de la venta. Lo pagado y el saldo van en la cabecera. */
export function SaleDetailTotals({
  discountRef,
  refRateVes,
  subtotalRef,
  taxRef,
  totalRef,
  totalVes,
}: SaleDetailTotalsProps) {
  const taxPercent = getTaxPercentLabel(subtotalRef, taxRef);

  return (
    <dl className="ml-auto w-full max-w-sm space-y-2 rounded border border-border bg-surface-container-low p-4 dark:border-slate-800">
      <div className={rowClassName}>
        <dt className={labelClassName}>Subtotal</dt>
        <dd className="text-sm tabular-nums">{formatRefUsd(subtotalRef)}</dd>
      </div>
      <div className={rowClassName}>
        <dt className={labelClassName}>Descuento</dt>
        <dd
          className={cn(
            "text-sm tabular-nums",
            discountRef > 0 ? "text-destructive" : "text-foreground",
          )}
        >
          -{formatRefUsd(discountRef)}
        </dd>
      </div>
      <div className={rowClassName}>
        <dt className={labelClassName}>IVA ({taxPercent}%)</dt>
        <dd className="text-sm tabular-nums">{formatRefUsd(taxRef)}</dd>
      </div>
      <div className={cn(rowClassName, "border-t border-border pt-2 dark:border-slate-800")}>
        <dt className="text-base font-semibold text-foreground">Total (REF)</dt>
        <dd className="text-base font-semibold tabular-nums text-foreground">
          {formatRefUsd(totalRef)}
        </dd>
      </div>
      <div className={rowClassName}>
        <dt className={labelClassName}>Tasa de cambio</dt>
        <dd className="font-mono text-sm tabular-nums">{refRateVes.toFixed(2)} VES/REF</dd>
      </div>
      <div className={rowClassName}>
        <dt className="text-base font-semibold text-foreground">Total (VES)</dt>
        <dd className="text-base font-semibold tabular-nums text-foreground">
          {formatVesBs(totalVes)}
        </dd>
      </div>
    </dl>
  );
}
