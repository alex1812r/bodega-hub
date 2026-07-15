import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/shared/utils/cn";

type DashboardKpiTrendProps = {
  changePercent?: number | null;
  comparisonLabel?: string;
  neutralLabel?: string;
};

export function DashboardKpiTrend({
  changePercent,
  comparisonLabel = "vs ayer",
  neutralLabel = "Sin datos de ayer",
}: DashboardKpiTrendProps) {
  if (changePercent == null || Number.isNaN(changePercent)) {
    return (
      <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
        <Minus aria-hidden className="h-4 w-4" />
        <span>{neutralLabel}</span>
      </div>
    );
  }

  const isPositive = changePercent >= 0;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <div className="mt-2 flex items-center gap-1 text-sm">
      <TrendIcon
        aria-hidden
        className={cn("h-4 w-4", isPositive ? "text-emerald-600" : "text-red-600")}
      />
      <span className={cn("font-medium", isPositive ? "text-emerald-600" : "text-red-600")}>
        {isPositive ? "+" : ""}
        {changePercent.toFixed(1)}%
      </span>
      <span className="text-xs font-normal text-muted-foreground">{comparisonLabel}</span>
    </div>
  );
}
