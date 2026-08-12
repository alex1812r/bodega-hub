import { formatRefUsd, formatVesBs, refToVes, roundMoney } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

type ProductMoneyCellProps = {
  /** When false, dims the amounts (e.g. inactive product). */
  isActive?: boolean;
  rateVes: number;
  refAmount: number;
};

/**
 * Same-column REF + Bs display used in product tables.
 * Emphasizes REF (primary line); Bs stays secondary underneath (often longer).
 */
export function ProductMoneyCell({
  isActive = true,
  rateVes,
  refAmount,
}: ProductMoneyCellProps) {
  const vesAmount = rateVes > 0 ? roundMoney(refToVes(refAmount, rateVes)) : null;

  return (
    <div
      className={cn(
        "flex flex-col items-end gap-0.5 leading-tight",
        !isActive && "opacity-60",
      )}
    >
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
        {formatRefUsd(refAmount)}
      </span>
      <span className="font-mono text-xs tabular-nums text-on-surface-variant">
        {vesAmount == null ? "—" : formatVesBs(vesAmount)}
      </span>
    </div>
  );
}
