import { Badge } from "@/shared/components/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import {
  ownerBreakdown,
  semaphoreLevel,
  shareOfGrossProfit,
  type PayrollSemaphoreLevel,
} from "../utils/payrollMath";

import { PAYROLL_SEMAPHORE_HELP, payrollSemaphoreLabels } from "./payrollLabels";

export type PayrollBreakdownProps = {
  /** Comisiones de la quincena (sin reversos: el semáforo mide lo devengado). */
  commissionRef: number;
  className?: string;
  /** `null` cuando el reporte de margen no devolvió datos. */
  grossProfitRef: number | null;
  reinvestPct: number;
  reservePct: number;
  /** Umbral configurable del semáforo (`warnShareOfGrossProfitPct`). */
  warnSharePct: number;
};

const semaphoreBadgeVariants: Record<
  PayrollSemaphoreLevel,
  "danger" | "default" | "success" | "warning"
> = {
  ambar: "warning",
  rojo: "danger",
  "sin-datos": "default",
  verde: "success",
};

const semaphoreBarClasses: Record<PayrollSemaphoreLevel, string> = {
  ambar: "bg-amber-500",
  rojo: "bg-red-600",
  "sin-datos": "bg-slate-300 dark:bg-slate-700",
  verde: "bg-emerald-500",
};

function BreakdownRow({
  emphasis = false,
  hint,
  label,
  value,
}: {
  emphasis?: boolean;
  hint?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant py-2 last:border-b-0">
      <span className="min-w-0 text-sm text-on-surface-variant">
        {label}
        {hint ? (
          <span className="ml-1 text-xs text-on-surface-variant/80">({hint})</span>
        ) : null}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums text-sm text-foreground",
          emphasis && "text-base font-semibold",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Semáforo `comisiones / ganancia bruta` + desglose informativo para el dueño.
 * Solo informa: nunca bloquea un pago.
 */
export function PayrollBreakdown({
  className,
  commissionRef,
  grossProfitRef,
  reinvestPct,
  reservePct,
  warnSharePct,
}: PayrollBreakdownProps) {
  const sharePct = shareOfGrossProfit(commissionRef, grossProfitRef);
  const level = semaphoreLevel(sharePct, warnSharePct);
  const breakdown = ownerBreakdown(grossProfitRef, commissionRef, reinvestPct, reservePct);
  const barWidth = sharePct == null ? 0 : Math.min(100, Math.max(0, sharePct));

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Comisiones sobre la ganancia bruta</CardTitle>
          <Badge variant={semaphoreBadgeVariants[level]}>{payrollSemaphoreLabels[level]}</Badge>
        </div>
        <CardDescription>{PAYROLL_SEMAPHORE_HELP}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="text-2xl font-semibold tabular-nums text-foreground"
              data-testid="payroll-share-pct"
            >
              {sharePct == null ? "Sin datos" : `${sharePct.toFixed(2)} %`}
            </span>
            <span className="text-xs text-on-surface-variant">
              Umbral de alerta: {warnSharePct.toFixed(0)} %
            </span>
          </div>
          <div
            aria-label="Porcentaje de la ganancia bruta que se va en comisiones"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(barWidth)}
            className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            role="progressbar"
          >
            <div
              className={cn("h-full rounded-full transition-all", semaphoreBarClasses[level])}
              style={{ width: `${String(barWidth)}%` }}
            />
          </div>
          {sharePct == null ? (
            <p className="text-xs text-on-surface-variant">
              No tenemos la ganancia bruta de esta quincena, asi que el semaforo queda sin
              calcular.
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-outline-variant p-3">
          <p className="mb-1 text-sm font-medium text-foreground">
            Queda para gastos, reinversion y reserva
          </p>
          {breakdown ? (
            <div>
              <BreakdownRow
                label="Ganancia bruta"
                value={formatRefUsd(grossProfitRef ?? 0)}
              />
              <BreakdownRow label="Comisiones" value={`-${formatRefUsd(commissionRef)}`} />
              <BreakdownRow
                emphasis
                label="Queda"
                value={formatRefUsd(breakdown.afterCommissionRef)}
              />
              <BreakdownRow
                hint={`${reinvestPct.toFixed(0)} %`}
                label="Reinversion sugerida"
                value={formatRefUsd(breakdown.reinvestRef)}
              />
              <BreakdownRow
                hint={`${reservePct.toFixed(0)} %`}
                label="Reserva sugerida"
                value={formatRefUsd(breakdown.reserveRef)}
              />
              <BreakdownRow label="Libre" value={formatRefUsd(breakdown.freeRef)} />
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">
              Sin ganancia bruta no podemos sugerir reinversion ni reserva.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
