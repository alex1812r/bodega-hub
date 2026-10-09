import type { ReactNode } from "react";

import { describeDeltaPct, formatDeltaPct } from "@/shared/components/RankingBarChart";
import { cn } from "@/shared/utils/cn";

/**
 * `sentiment`: subir es bueno (verde) y bajar es malo (rojo), como en ventas o
 * ganancia. `neutral`: sin color, para medidas donde subir no es ni bueno ni
 * malo (compras).
 */
export type ReportDeltaTone = "neutral" | "sentiment";

type ReportDeltaProps = {
  /** Variación % del total; `null` = sin periodo anterior comparable («—»). */
  deltaPct: number | null;
  tone?: ReportDeltaTone;
};

/** Variación frente al periodo anterior: flecha + cifra + texto, nunca solo color. */
export function ReportDelta({ deltaPct, tone = "sentiment" }: ReportDeltaProps) {
  const isComparable = typeof deltaPct === "number" && Number.isFinite(deltaPct);
  const direction = !isComparable || deltaPct === 0 ? "flat" : deltaPct > 0 ? "up" : "down";

  return (
    <span className="inline-flex items-baseline gap-1 text-xs text-on-surface-variant" data-testid="report-delta">
      <span
        aria-hidden="true"
        className={cn(
          "font-semibold tabular-nums",
          tone === "sentiment" && direction === "up" && "text-emerald-700 dark:text-emerald-300",
          tone === "sentiment" && direction === "down" && "text-error",
          (tone === "neutral" || direction === "flat") && "text-on-surface",
        )}
      >
        {formatDeltaPct(deltaPct)}
      </span>
      <span className="sr-only">{describeDeltaPct(deltaPct)}</span>
      <span>vs. periodo anterior</span>
    </span>
  );
}

type ReportChartCardProps = {
  children: ReactNode;
  /** Variación del total; solo se pasa con «Comparar con periodo anterior» activo. */
  delta?: ReportDeltaProps;
  /** Aviso de una línea bajo la cabecera (agrupación automática). */
  notice?: string | null;
  subtitle?: ReactNode;
  title: string;
  /** Total del periodo, junto al título. */
  total?: { label: string; value: string };
};

/** Marco del gráfico de un reporte: título, total, variación, aviso y gráfico. */
export function ReportChartCard({
  children,
  delta,
  notice,
  subtitle,
  title,
  total,
}: ReportChartCardProps) {
  return (
    <section
      aria-label={`Gráfico: ${title}`}
      className="min-w-0 space-y-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-4 shadow-sm sm:p-5"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p> : null}
        </div>
        {total || delta ? (
          <div className="flex min-w-0 flex-col items-start gap-0.5 sm:items-end">
            {total ? (
              <p className="text-sm text-on-surface-variant">
                {total.label}{" "}
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {total.value}
                </span>
              </p>
            ) : null}
            {delta ? <ReportDelta {...delta} /> : null}
          </div>
        ) : null}
      </div>
      {notice ? (
        <p className="text-xs text-on-surface-variant" role="note">
          {notice}
        </p>
      ) : null}
      {children}
    </section>
  );
}
