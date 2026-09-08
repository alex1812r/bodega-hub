"use client";

import { HandCoins, Percent, Receipt, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardKpiCard } from "@/modules/dashboard/components/DashboardKpiCard";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useSettings } from "@/modules/settings/hooks/useSettings";
import { Can } from "@/shared/auth/Can";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { PageHeader } from "@/shared/components/PageHeader";
import { formatRefUsd } from "@/shared/utils/currency";

import { PayrollBreakdown } from "../components/PayrollBreakdown";
import { PayrollItemRow } from "../components/PayrollItemRow";
import { PayrollSalesModal } from "../components/PayrollSalesModal";
import {
  payrollPeriodStatusLabels,
  payrollPeriodStatusVariants,
} from "../components/payrollLabels";
import {
  useApprovePayrollPeriod,
  usePayrollPeriod,
  useRecomputePayrollPeriod,
} from "../hooks/usePayroll";
import { exportPayrollReceiptPdf } from "../payroll-receipt/services/exportPayrollReceiptPdf";
import type { PayrollItem } from "../types";
import { formatPeriodLabel } from "../utils/quincena";

import { PayrollCancelPaymentModal } from "./components/PayrollCancelPaymentModal";
import { PayrollPayModal } from "./components/PayrollPayModal";
import { PayrollVaultPanel } from "./components/PayrollVaultPanel";

type PayrollPeriodDetailPageProps = {
  periodId: string;
};

export function PayrollPeriodDetailPage({ periodId }: PayrollPeriodDetailPageProps) {
  const detailQuery = usePayrollPeriod(periodId);
  const recompute = useRecomputePayrollPeriod(periodId);
  const approve = useApprovePayrollPeriod(periodId);
  const appSettings = useSettings();
  const exchangeRate = useCurrentExchangeRate();
  const [cancelItem, setCancelItem] = useState<PayrollItem | null>(null);
  const [salesItem, setSalesItem] = useState<PayrollItem | null>(null);
  const [payItems, setPayItems] = useState<PayrollItem[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = detailQuery.data;
  const period = detail?.period;
  const items = useMemo(() => detail?.items ?? [], [detail]);
  const pendingItems = useMemo(
    () => items.filter((item) => item.status === "pendiente"),
    [items],
  );
  const pendingRef = pendingItems.reduce((total, item) => total + item.totalRef, 0);

  if (detailQuery.isLoading) {
    return (
      <LoadingState
        description="Estamos trayendo los items y las ventas comisionadas."
        title="Cargando quincena..."
        variant="page"
      />
    );
  }

  if (detailQuery.error || !detail || !period) {
    return (
      <ErrorState
        description="No pudimos cargar el detalle de esta quincena."
        onRetry={() => void detailQuery.refetch()}
        title="Quincena no disponible"
      />
    );
  }

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);

    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "No pudimos completar la operacion.",
      );
    }
  }

  function handleReceipt(item: PayrollItem) {
    if (!period) {
      return;
    }

    exportPayrollReceiptPdf({
      item,
      period,
      sales: detail?.salesByItem[item.id] ?? [],
      storeName: appSettings.data?.businessName ?? "BodegaHub",
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <>
            <PageBackButton href="/payroll" label="Volver a nomina" size="sm" />
            <Can permission="payroll.manage">
              <>
                {period.status === "borrador" ? (
                  <>
                    <Button
                      disabled={recompute.isPending}
                      onClick={() => void runAction(() => recompute.mutateAsync())}
                      size="sm"
                      variant="outline"
                    >
                      {recompute.isPending ? "Recalculando..." : "Recalcular"}
                    </Button>
                    <Button
                      disabled={approve.isPending}
                      onClick={() => void runAction(() => approve.mutateAsync())}
                      size="sm"
                    >
                      {approve.isPending ? "Aprobando..." : "Aprobar"}
                    </Button>
                  </>
                ) : null}
                {period.status === "aprobado" ? (
                  <Button
                    disabled={pendingItems.length === 0}
                    onClick={() => setPayItems(pendingItems)}
                    size="sm"
                  >
                    Pagar todos
                  </Button>
                ) : null}
              </>
            </Can>
          </>
        }
        badge={
          <Badge variant={payrollPeriodStatusVariants[period.status]}>
            {payrollPeriodStatusLabels[period.status]}
          </Badge>
        }
        description={`${period.periodKey} · del ${period.fromDate} al ${period.toDate}`}
        title={formatPeriodLabel(period.periodKey)}
      />

      {actionError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      ) : null}

      {detail.salesWithoutCashier > 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {detail.salesWithoutCashier} ventas de la quincena no tienen cajero asignado: no
          comisionan a nadie.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardKpiCard
          accentClassName="bg-indigo-500/15"
          icon={Receipt}
          iconClassName="text-primary"
          label="Ventas comisionables"
          value={formatRefUsd(period.salesRef)}
        />
        <DashboardKpiCard
          accentClassName="bg-emerald-500/15"
          icon={Percent}
          iconClassName="text-emerald-600"
          label="Comision"
          value={formatRefUsd(period.commissionRef)}
        />
        <DashboardKpiCard
          accentClassName="bg-red-500/15"
          icon={RotateCcw}
          iconClassName="text-red-600"
          label="Reversos"
          value={formatRefUsd(period.reversalRef)}
        />
        <DashboardKpiCard
          accentClassName="bg-amber-500/15"
          icon={HandCoins}
          iconClassName="text-amber-600"
          label="Total nomina"
          value={formatRefUsd(period.totalRef)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <PayrollBreakdown
            commissionRef={period.commissionRef}
            grossProfitRef={period.grossProfitRef}
            reinvestPct={detail.settings.reinvestPct}
            reservePct={detail.settings.reservePct}
            warnSharePct={detail.settings.warnShareOfGrossProfitPct}
          />

          <Card>
            <CardHeader>
              <CardTitle>Comision por cajero</CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <EmptyState
                  className="py-8"
                  description="Ningun cajero elegible genero ventas comisionables en esta quincena."
                  title="Sin items"
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-outline-variant">
                  <table className="min-w-full">
                    <thead className="bg-surface-container-low text-left">
                      <tr>
                        <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Cajero
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          N.º ventas
                        </th>
                        <th className="hidden px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                          Ventas REF
                        </th>
                        <th className="hidden px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                          %
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Comision
                        </th>
                        <th className="hidden px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
                          Reversos
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Total
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Estado
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <PayrollItemRow
                          item={item}
                          key={item.id}
                          onCancelPayment={setCancelItem}
                          onPay={(target) => setPayItems([target])}
                          onReceipt={handleReceipt}
                          onViewSales={setSalesItem}
                          periodStatus={period.status}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <PayrollVaultPanel
          pendingRef={pendingRef}
          rateVes={exchangeRate.data?.rateVes ?? 0}
        />
      </div>

      <PayrollSalesModal
        cashierName={salesItem?.fullName ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setSalesItem(null);
          }
        }}
        open={salesItem !== null}
        sales={salesItem ? (detail.salesByItem[salesItem.id] ?? []) : []}
      />

      <PayrollPayModal
        items={payItems}
        onOpenChange={(open) => {
          if (!open) {
            setPayItems([]);
          }
        }}
        open={payItems.length > 0}
      />

      <PayrollCancelPaymentModal
        item={cancelItem}
        onOpenChange={(open) => {
          if (!open) {
            setCancelItem(null);
          }
        }}
      />
    </div>
  );
}
