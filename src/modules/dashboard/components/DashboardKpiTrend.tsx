import { Minus } from "lucide-react";

import { describeDeltaPct, formatDeltaPct } from "@/shared/components/RankingBarChart";
import { cn } from "@/shared/utils/cn";

type DashboardDeltaValueProps = {
  deltaPct: number | null | undefined;
  testId?: string;
};

/**
 * Variación % del dashboard, escrita igual que en Reportes: "↑ 12,5 %",
 * "↓ 3 %" o "—" sin periodo anterior comparable. Subir es bueno (verde) y
 * bajar, malo (error); el lector de pantalla recibe la frase completa.
 */
export function DashboardDeltaValue({ deltaPct, testId }: DashboardDeltaValueProps) {
  const isComparable = typeof deltaPct === "number" && Number.isFinite(deltaPct);

  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "font-semibold tabular-nums",
          isComparable && deltaPct < 0 && "text-error",
          isComparable && deltaPct >= 0 && "text-emerald-700 dark:text-emerald-300",
        )}
        data-testid={testId}
      >
        {formatDeltaPct(deltaPct)}
      </span>
      <span className="sr-only">{describeDeltaPct(deltaPct)}</span>
    </>
  );
}

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
  if (changePercent == null || !Number.isFinite(changePercent)) {
    return (
      <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
        <Minus aria-hidden className="h-4 w-4" />
        <span>{neutralLabel}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-1 text-sm">
      <DashboardDeltaValue deltaPct={changePercent} testId="kpi-trend-delta" />
      <span className="text-xs font-normal text-muted-foreground">{comparisonLabel}</span>
    </div>
  );
}
