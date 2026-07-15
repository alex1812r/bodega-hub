"use client";

import Link from "next/link";

import { LoadingState } from "@/shared/components/LoadingState";
import { formatRef } from "@/shared/utils/currency";
import { DATE_FORMATS, formatDate } from "@/shared/utils/date";

import { useDashboardRecentSales } from "../hooks/useDashboard";
import { SaleStatusBadge } from "./saleStatusBadge";

const RECENT_SALES_LIMIT = 4;

export function DashboardRecentSalesCard() {
  const recentSales = useDashboardRecentSales({ limit: RECENT_SALES_LIMIT, skip: 0 });
  const rows = recentSales.data?.items ?? [];

  return (
    <div className="flex w-full min-w-0 flex-col rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Ventas recientes</h2>
        <Link
          className="text-sm font-medium text-primary no-underline hover:text-indigo-700"
          href="/sales"
        >
          Ver todas
        </Link>
      </div>

      {recentSales.isLoading ? (
        <LoadingState
          description="Consultando las ultimas ventas registradas."
          title="Cargando ventas"
          variant="inline"
        />
      ) : recentSales.error ? (
        <p className="text-sm text-red-600">No pudimos cargar las ventas recientes.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay ventas recientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="px-2 py-3 font-medium">Ref</th>
                <th className="px-2 py-3 font-medium">Hora</th>
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
                    {formatDate(sale.createdAt, DATE_FORMATS.time)}
                  </td>
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
