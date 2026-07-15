import { cn } from "@/shared/utils/cn";

type SupplierProductVariationBadgeProps = {
  className?: string;
  variationPercent?: number | null;
};

export function SupplierProductVariationBadge({
  className,
  variationPercent,
}: SupplierProductVariationBadgeProps) {
  if (variationPercent == null) {
    return <span className={cn("text-sm text-on-surface-variant", className)}>—</span>;
  }

  const isIncrease = variationPercent > 0;
  const isDecrease = variationPercent < 0;

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        isIncrease && "bg-error-container text-error",
        isDecrease && "bg-secondary-container text-secondary",
        !isIncrease && !isDecrease && "bg-surface-container-high text-on-surface-variant",
        className,
      )}
    >
      {isIncrease ? "↑" : isDecrease ? "↓" : "→"} {variationPercent > 0 ? "+" : ""}
      {variationPercent.toFixed(1)}%
    </span>
  );
}
