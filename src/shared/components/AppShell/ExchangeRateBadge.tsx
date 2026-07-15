import { ArrowLeftRight } from "lucide-react";

import { cn } from "@/shared/utils/cn";

type ExchangeRateBadgeProps = {
  className?: string;
  hasError?: boolean;
  rateVes?: number;
};

function formatRefVesRate(rateVes: number) {
  return rateVes.toLocaleString("es-VE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function ExchangeRateBadge({
  className,
  hasError = false,
  rateVes,
}: ExchangeRateBadgeProps) {
  const label =
    rateVes != null ? `REF/VES: ${formatRefVesRate(rateVes)}` : "REF/VES: —";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-full border border-secondary/20 bg-secondary-container/20 px-3 py-1",
        hasError && "border-amber-400/40",
        className,
      )}
      title={rateVes != null ? `Tasa vigente: 1 REF = ${formatRefVesRate(rateVes)} VES` : undefined}
    >
      <ArrowLeftRight
        aria-hidden
        className="size-[1.125rem] shrink-0 text-secondary"
      />
      <span className="truncate text-sm font-bold text-secondary">{label}</span>
    </div>
  );
}
