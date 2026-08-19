"use client";

import { Receipt } from "lucide-react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ErrorState } from "@/shared/components/ErrorState";
import { ResponsivePagination } from "@/shared/components/Pagination";
import { formatCaracasDateTime } from "@/shared/utils/caracasBusinessDay";
import { cn } from "@/shared/utils/cn";
import { formatRef, formatVes } from "@/shared/utils/currency";

import type { ProductSaleHistoryRow } from "../../hooks/useProducts";
import { useProductSalesHistory } from "../hooks/useProductSalesHistory";
import { ProductDetailSectionCard } from "./ProductDetailSectionCard";

const statusLabels: Record<ProductSaleHistoryRow["status"], string> = {
  borrador: "Borrador",
  cancelada: "Cancelada",
  devuelta: "Devuelta",
  pagada: "Pagada",
  pendiente_pago: "Pendiente de pago",
};

const statusClassNames: Record<ProductSaleHistoryRow["status"], string> = {
  borrador: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  cancelada: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  devuelta: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  pagada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  pendiente_pago: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

type ProductDetailSalesHistoryCardProps = {
  productId: string;
};

export function ProductDetailSalesHistoryCard({
  productId,
}: ProductDetailSalesHistoryCardProps) {
  const sales = useProductSalesHistory(productId);
  const rows = getPaginatedItems(sales.data);
  const total = sales.data?.total ?? 0;
  const showPagination = total > sales.limit;

  return (
    <ProductDetailSectionCard
      title={
        <span className="flex items-center gap-2">
          <Receipt aria-hidden className="size-5 text-on-surface-variant" />
          Historial de ventas
        </span>
      }
    >
      {sales.data && sales.data.total > 0 ? (
        <div className="grid grid-cols-1 gap-4 border-b border-outline-variant px-5 py-4 md:grid-cols-3">
          <TotalsCard label="Unidades" value={String(sales.data.totals.units)} />
          <TotalsCard label="Total REF" value={formatRef(sales.data.totals.totalRef)} />
          <TotalsCard label="Total VES" value={formatVes(sales.data.totals.totalVes)} />
        </div>
      ) : null}

      {sales.error ? (
        <div className="px-5 py-6">
          <ErrorState
            description={
              sales.error instanceof Error
                ? sales.error.message
                : "No pudimos cargar el historial de ventas."
            }
            onRetry={() => void sales.refetch()}
            title="No pudimos cargar las ventas"
          />
        </div>
      ) : sales.isLoading ? (
        <p className="px-5 py-8 text-center text-sm text-on-surface-variant">
          Cargando historial de ventas...
        </p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-on-surface-variant">
          Aún no hay ventas registradas para este producto.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-container-low text-xs font-semibold text-on-surface-variant dark:border-slate-800">
                <th className="px-5 py-3">Factura</th>
                <th className="px-5 py-3">Fecha y hora</th>
                <th className="px-5 py-3 text-right">Cantidad</th>
                <th className="px-5 py-3 text-right">Precio unit. REF</th>
                <th className="px-5 py-3 text-right">Subtotal REF</th>
                <th className="px-5 py-3 text-right">Subtotal VES</th>
                <th className="px-5 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 dark:divide-slate-800">
              {rows.map((row) => {
                const isCancelled = row.status === "cancelada";

                return (
                  <tr
                    className={cn(
                      "transition-colors hover:bg-surface-bright/50 dark:hover:bg-slate-800/50",
                      isCancelled && "text-on-surface-variant",
                    )}
                    key={row.id}
                  >
                    <td className="px-5 py-3 font-medium text-foreground">{row.invoiceNumber}</td>
                    <td className="px-5 py-3 text-foreground">
                      {formatCaracasDateTime(row.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{row.quantity}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatRef(row.unitPriceRef)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatRef(row.subtotalRef)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatVes(row.subtotalVes)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded px-2 py-1 text-[11px] font-semibold leading-none",
                          statusClassNames[row.status],
                        )}
                      >
                        {statusLabels[row.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPagination ? (
        <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
          <ResponsivePagination
            entityLabel="ventas"
            isDisabled={sales.isFetching}
            limit={sales.limit}
            onLimitChange={sales.setLimit}
            onSkipChange={sales.setSkip}
            skip={sales.data?.skip ?? sales.skip}
            total={total}
            variant="stitch"
          />
        </div>
      ) : null}

      {sales.data && rows.length > 0 ? (
        <p className="px-5 py-3 text-xs text-on-surface-variant">
          Totales sin ventas canceladas.
        </p>
      ) : null}
    </ProductDetailSectionCard>
  );
}

function TotalsCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-outline">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
