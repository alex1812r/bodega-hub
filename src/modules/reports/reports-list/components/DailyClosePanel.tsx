"use client";

import { Landmark, TrendingDown, Wallet } from "lucide-react";

import type { DailyCloseSummary } from "@/modules/reports/services/dailyCloseSummary";
import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRef, formatVes } from "@/shared/utils/currency";

type DailyClosePanelProps = {
  data?: DailyCloseSummary;
  isLoading?: boolean;
  periodLabel?: string;
};

function Stat({ hint, label, value }: { hint?: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-on-surface-variant">{hint}</p> : null}
    </div>
  );
}

export function DailyClosePanel({ data, isLoading, periodLabel }: DailyClosePanelProps) {
  if (isLoading || !data) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        Cargando cierre del dia...
      </p>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Cierre del dia</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Dia operativo Caracas{periodLabel ? ` · ${periodLabel}` : ""}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat hint={`${data.sales.salesCount} ventas`} label="Ventas REF" value={formatRef(data.sales.totalRef)} />
        <Stat label="Ventas VES" value={formatVes(data.sales.totalVes)} />
        <Stat
          hint={`${data.paymentsSummary.paymentCount} pagos activos`}
          label="Cobros REF"
          value={formatRef(data.paymentsSummary.totalRef)}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <Wallet aria-hidden className="h-4 w-4 text-primary" />
          Mix de pagos
        </div>
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
          {data.payments.map((row) => (
            <li className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm" key={row.method}>
              <span>{paymentMethodLabels[row.method] ?? row.method}</span>
              <span className="tabular-nums text-muted-foreground">
                {row.paymentCount} · {formatRef(row.amountRef)} · {formatVes(row.amountVes)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <TrendingDown aria-hidden className="h-4 w-4 text-amber-600" />
          Perdida FX de tenencias VES
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat hint={`Tasa ${formatVes(data.fx.valuationRateVes)}`} label="Perdida REF" value={formatRef(data.fx.vesLossRef)} />
          <Stat label="Capital REF hoy" value={formatRef(data.fx.capitalRefToday)} />
          <Stat hint={`${data.fx.depreciationPctOnVes}% sobre VES`} label="VES expuesto" value={formatVes(data.fx.vesExposed)} />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <Landmark aria-hidden className="h-4 w-4 text-primary" />
          Caja y baul
        </div>
        {data.vault || data.cash ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.vault ? (
              <>
                <Stat label="Baul REF" value={formatRef(data.vault.balanceRef)} />
                <Stat label="Baul cuenta VES" value={formatVes(data.vault.balanceVes)} />
                <Stat label="Baul efectivo VES" value={formatVes(data.vault.balanceEfectivoVes)} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin snapshot de baul.</p>
            )}
            {data.cash ? (
              <>
                <Stat
                  hint={`${data.cash.openSessionCount} sesiones abiertas`}
                  label="Caja teorica REF"
                  value={formatRef(data.cash.theoreticalOpenRef)}
                />
                <Stat
                  hint={`${data.cash.pendingClosureCount} cierres pendientes`}
                  label="Cierres pendientes REF"
                  value={formatRef(data.cash.pendingClosureRef)}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin snapshot de caja.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay saldos de caja/baul disponibles para este alcance.
          </p>
        )}
      </div>
    </section>
  );
}
