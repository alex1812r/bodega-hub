import { formatVesBs, roundMoney, vesToRef } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

type SalesMoneyCellProps = {
  className?: string;
  muted?: boolean;
  refAmount: number;
  strike?: boolean;
  vesAmount: number;
};

/** Columna compacta: $ REF enfatizado + Bs. secundario. */
export function SalesMoneyCell({
  className,
  muted = false,
  refAmount,
  strike = false,
  vesAmount,
}: SalesMoneyCellProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-end gap-0.5 leading-tight tabular-nums",
        muted && "text-on-surface-variant",
        strike && "text-slate-400 line-through",
        className,
      )}
    >
      <span className="text-sm font-semibold text-foreground">
        ${roundMoney(refAmount).toFixed(2)}
      </span>
      <span className="text-xs text-on-surface-variant">{formatVesBs(vesAmount)}</span>
    </div>
  );
}

export function estimatePaidRef(paidVes: number, totalRef: number, totalVes: number, refRateVes: number) {
  if (paidVes <= 0) {
    return 0;
  }

  if (refRateVes > 0) {
    return roundMoney(vesToRef(paidVes, refRateVes));
  }

  if (totalVes > 0) {
    return roundMoney(totalRef * (paidVes / totalVes));
  }

  return 0;
}
