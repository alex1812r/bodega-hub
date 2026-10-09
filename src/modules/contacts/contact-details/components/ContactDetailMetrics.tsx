import {
  AlertTriangle,
  ArrowDownLeft,
  CreditCard,
  Receipt,
  ShoppingCart,
} from "lucide-react";

import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import { usePermission } from "@/shared/auth/usePermission";
import type { ContactType } from "@/shared/mocks/erp-data";
import { formatRefUsd } from "@/shared/utils/currency";

import type { ContactDetailMetrics as ContactMetrics } from "../utils/computeContactDetailMetrics";
import { showsPayableMetric, showsReceivableMetric } from "../utils/computeContactDetailMetrics";

/** Filas con las que se sumó un total frente a las que tiene el contacto. */
export type ContactMetricCoverage = {
  loaded: number;
  total: number;
};

type ContactDetailMetricsProps = {
  contactType: ContactType;
  /**
   * Cobertura de cada total. El servidor no entrega la suma histórica: se suma
   * lo cargado, y si el contacto tiene más filas la tarjeta lo dice.
   */
  coverage?: {
    payments?: ContactMetricCoverage;
    purchases?: ContactMetricCoverage;
    sales?: ContactMetricCoverage;
  };
  metrics: ContactMetrics;
};

function CoverageNote({
  coverage,
  noun,
}: {
  coverage?: ContactMetricCoverage;
  /** Con artículo y género: "las últimas … ventas", "los últimos … pagos". */
  noun: { lastPlural: string; name: string };
}) {
  if (coverage && coverage.total > coverage.loaded) {
    return (
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
        Suma de {noun.lastPlural} {coverage.loaded} de {coverage.total} {noun.name}
      </p>
    );
  }

  return <p className="mt-1 text-xs text-muted-foreground">Histórico del contacto</p>;
}

/**
 * Resumen de la cabecera del contacto: total vendido (cliente), total comprado
 * (proveedor), ambos si es de los dos tipos, pagos y saldo pendiente.
 */
export function ContactDetailMetrics({ contactType, coverage, metrics }: ContactDetailMetricsProps) {
  const { can } = usePermission();
  const hasReceivable = metrics.receivableRef > 0;
  const hasPayable = metrics.payableRef > 0;
  const showCustomerSide = showsReceivableMetric(contactType);
  const showSupplierSide = showsPayableMetric(contactType) && can("purchases.view");

  return (
    <div
      aria-label="Resumen del contacto"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      role="group"
    >
      {showCustomerSide ? (
        <DashboardKpiCard
          icon={Receipt}
          label="Total vendido (REF)"
          trend={
            <CoverageNote
              coverage={coverage?.sales}
              noun={{ lastPlural: "las últimas", name: "ventas" }}
            />
          }
          value={formatRefUsd(metrics.salesTotalRef)}
        />
      ) : null}
      {showSupplierSide ? (
        <DashboardKpiCard
          icon={ShoppingCart}
          label="Total comprado (REF)"
          trend={
            <CoverageNote
              coverage={coverage?.purchases}
              noun={{ lastPlural: "las últimas", name: "compras" }}
            />
          }
          value={formatRefUsd(metrics.purchasesTotalRef)}
        />
      ) : null}
      <DashboardKpiCard
        accentClassName="bg-emerald-500/15"
        icon={CreditCard}
        iconClassName="text-emerald-600"
        label="Pagos Realizados (REF)"
        trend={
          <CoverageNote
            coverage={coverage?.payments}
            noun={{ lastPlural: "los últimos", name: "pagos" }}
          />
        }
        value={formatRefUsd(metrics.paymentsTotalRef)}
      />
      {showCustomerSide ? (
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
      {showSupplierSide ? (
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
