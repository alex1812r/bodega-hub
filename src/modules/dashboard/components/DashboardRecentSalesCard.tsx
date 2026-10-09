"use client";

import Link from "next/link";

import { isReportQueryOffline } from "@/modules/reports/reports-list/reportQueryState";
import { LoadingState } from "@/shared/components/LoadingState";
import { BUSINESS_TIMEZONE } from "@/shared/utils/caracasBusinessDay";
import { formatRef } from "@/shared/utils/currency";

import {
  type DashboardRequestScope,
  useDashboardRecentSales,
} from "../hooks/useDashboard";
import { DashboardCardBoundary } from "./DashboardCardBoundary";
import { DashboardOfflineNote } from "./DashboardOfflineNote";
import { SaleStatusBadge } from "./saleStatusBadge";

const RECENT_SALES_LIMIT = 4;

const caracasTimeFormatter = new Intl.DateTimeFormat("es-VE", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: BUSINESS_TIMEZONE,
});

/**
 * Hora de la venta en Caracas (`HH:mm`), no en la zona del navegador: con
 * Asia/Tokyo una venta de las 23:30 salía como 12:30 del día siguiente.
 */
export function formatCaracasTime(instant: string) {
  const date = new Date(instant);

  return Number.isNaN(date.getTime()) ? "—" : caracasTimeFormatter.format(date);
}

type DashboardRecentSalesCardProps = {
  scope?: DashboardRequestScope;
  showStore?: boolean;
  viewAllHref?: string;
  viewAllLabel?: string;
};

/** Ventas recientes, dentro de su límite de error: si falla, el resto del dashboard sigue. */
export function DashboardRecentSalesCard(props: DashboardRecentSalesCardProps = {}) {
  return (
    <DashboardCardBoundary>
      <RecentSalesCard {...props} />
    </DashboardCardBoundary>
  );
}

function RecentSalesCard({
  scope,
  showStore = false,
  viewAllHref = "/sales",
  viewAllLabel = "Ver todas",
}: DashboardRecentSalesCardProps) {
  const recentSales = useDashboardRecentSales({ limit: RECENT_SALES_LIMIT, skip: 0 }, scope);
  const rows = recentSales.data?.items ?? [];

  return (
    <div className="flex w-full min-w-0 flex-col rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Ventas recientes</h2>
        {viewAllHref ? (
          <Link
            className="text-sm font-medium text-primary no-underline hover:text-indigo-700"
            href={viewAllHref}
          >
            {viewAllLabel}
          </Link>
        ) : null}
      </div>

      {recentSales.isLoading ? (
        <LoadingState
          description="Consultando las últimas ventas registradas."
          title="Cargando ventas"
          variant="inline"
        />
      ) : recentSales.error ? (
        <p className="text-sm text-red-600">No pudimos cargar las ventas recientes.</p>
      ) : isReportQueryOffline(recentSales) ? (
        <DashboardOfflineNote onRetry={() => void recentSales.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay ventas recientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="px-2 py-3 font-medium">Ref</th>
                <th className="px-2 py-3 font-medium">Hora</th>
                {showStore ? <th className="px-2 py-3 font-medium">Tienda</th> : null}
                <th className="px-2 py-3 font-medium">Cliente</th>
                <th className="px-2 py-3 text-right font-medium">Monto (REF)</th>
                <th className="px-2 py-3 text-center font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr
                  className="border-b border-border/20 transition-colors hover:bg-surface-container-low"
                  key={sale.id}
                >
                  <td className="px-2 py-3 font-medium text-muted-foreground">{sale.invoiceNumber}</td>
                  <td className="px-2 py-3 text-muted-foreground">
                    {formatCaracasTime(sale.createdAt)}
                  </td>
                  {showStore ? (
                    <td className="px-2 py-3 text-muted-foreground">
                      {sale.storeId ? (
                        <Link
                          className="text-primary hover:underline"
                          href={`/platform/stores/${sale.storeId}`}
                        >
                          {sale.storeName ?? "Tienda"}
                        </Link>
                      ) : (
                        (sale.storeName ?? "—")
                      )}
                    </td>
                  ) : null}
                  <td className="px-2 py-3 text-foreground">{sale.customerName}</td>
                  <td className="px-2 py-3 text-right font-medium text-foreground">
                    {formatRef(sale.totalRef)}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <SaleStatusBadge status={sale.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
