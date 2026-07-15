import {
  AlertTriangle,
  ArrowDownLeft,
  CreditCard,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";

import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import type { ContactType } from "@/shared/mocks/erp-data";
import { formatRefUsd } from "@/shared/utils/currency";

import type { ContactDetailMetrics as ContactMetrics } from "../utils/computeContactDetailMetrics";
import { showsPayableMetric, showsReceivableMetric } from "../utils/computeContactDetailMetrics";

type ContactDetailMetricsProps = {
  contactType: ContactType;
  metrics: ContactMetrics;
};

export function ContactDetailMetrics({ contactType, metrics }: ContactDetailMetricsProps) {
  const hasReceivable = metrics.receivableRef > 0;
  const hasPayable = metrics.payableRef > 0;
  const showReceivable = showsReceivableMetric(contactType);
  const showPayable = showsPayableMetric(contactType);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <DashboardKpiCard
        icon={ShoppingCart}
        label={metrics.operationsLabel}
        trend={
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <TrendingUp aria-hidden className="size-3.5 text-emerald-600" />
            <span className="text-emerald-600">Histórico</span> del contacto
          </p>
        }
        value={formatRefUsd(metrics.operationsTotalRef)}
      />
      <DashboardKpiCard
        accentClassName="bg-emerald-500/15"
        icon={CreditCard}
        iconClassName="text-emerald-600"
        label="Pagos Realizados (REF)"
        trend={
          <p className="mt-1 text-xs text-muted-foreground">Histórico total</p>
        }
        value={formatRefUsd(metrics.paymentsTotalRef)}
      />
      {showReceivable ? (
        <DashboardKpiCard
          accentClassName="bg-amber-500/15"
          icon={ArrowDownLeft}
          iconClassName="text-amber-700"
          label="Por Cobrar (REF)"
          trend={
            hasReceivable ? (
              <p className="mt-1 text-xs text-amber-700">Saldo pendiente del cliente</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Sin saldo por cobrar</p>
            )
          }
          value={
            <span className={hasReceivable ? "text-amber-700" : undefined}>
              {formatRefUsd(metrics.receivableRef)}
            </span>
          }
        />
      ) : null}
      {showPayable ? (
        <DashboardKpiCard
          accentClassName="bg-red-500/15"
          icon={AlertTriangle}
          iconClassName="text-red-600"
          label="Por Pagar (REF)"
          trend={
            hasPayable ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-500">
                <AlertTriangle aria-hidden className="size-3.5" />
                Saldo pendiente al proveedor
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Sin saldo por pagar</p>
            )
          }
          value={
            <span className={hasPayable ? "text-red-600" : undefined}>
              {formatRefUsd(metrics.payableRef)}
            </span>
          }
          variant={hasPayable ? "alert" : "default"}
        />
      ) : null}
    </div>
  );
}
