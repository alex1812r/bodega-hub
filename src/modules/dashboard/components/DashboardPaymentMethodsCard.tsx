"use client";

import { Wallet } from "lucide-react";
import Link from "next/link";

import { usePaymentMethodsReport } from "@/modules/reports/hooks/useReports";
import { Button } from "@/shared/components/Button";
import { LoadingState } from "@/shared/components/LoadingState";
import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRef, formatVes } from "@/shared/utils/currency";

type DashboardPaymentMethodsCardProps = {
  from?: string;
  fromStart?: boolean;
  periodLabel?: string;
  to?: string;
};

export function DashboardPaymentMethodsCard({
  from,
  fromStart,
  periodLabel,
  to,
}: DashboardPaymentMethodsCardProps) {
  const query = usePaymentMethodsReport({ from, fromStart, to });
  const items = query.data?.items ?? [];
  const summary = query.data?.summary;

  return (
    <div className="rounded-xl border border-border bg-surface-container-lowest shadow-sm">
      <div className="flex items-center justify-between gap-3 rounded-t-xl border-b border-border/50 bg-surface-container-low/50 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Wallet aria-hidden className="h-5 w-5 text-primary" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Mix de pagos</h2>
            {periodLabel ? (
              <p className="text-xs text-muted-foreground">{periodLabel}</p>
            ) : null}
          </div>
        </div>
        {summary ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {summary.paymentCount} pagos · {formatRef(summary.totalRef)}
          </span>
        ) : null}
      </div>

      <div className="p-3">
        {query.isLoading ? (
          <LoadingState
            description="Cobros de venta por metodo."
            title="Cargando mix de pagos"
            variant="inline"
          />
        ) : query.error ? (
          <p className="p-2 text-sm text-red-600">No pudimos cargar el mix de pagos.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((row) => (
              <li className="flex items-center justify-between gap-3 py-1.5 text-sm" key={row.method}>
                <span className="min-w-0 truncate text-foreground">
                  {paymentMethodLabels[row.method] ?? row.method}
                </span>
                <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                  {row.paymentCount} · {formatRef(row.amountRef)} · {formatVes(row.amountVes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border/50 px-4 py-3">
        <Button asChild className="w-full" size="sm" variant="secondary">
          <Link href="/reports">Ver reporte</Link>
        </Button>
      </div>
    </div>
  );
}
