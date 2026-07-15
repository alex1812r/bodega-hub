"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";

import {
  type SaleListItem,
  type SalesFilters,
  useCancelSale,
  useReturnSale,
  useSales,
} from "../hooks/useSales";
import { SalesExportActions } from "./components/SalesExportActions";
import { SalesListFilters } from "./components/SalesListFilters";
import { SalesStatusBadge } from "./components/SalesStatusBadge";

function formatInvoiceNumber(invoiceNumber: string) {
  return invoiceNumber.startsWith("#") ? invoiceNumber : `#${invoiceNumber}`;
}

function isPartiallyPaid(sale: SaleListItem) {
  return (
    sale.status === "pendiente_pago" &&
    sale.paidVes > 0 &&
    sale.paidVes < sale.totalVes
  );
}

const columns: DataTableColumn<SaleListItem>[] = [
  {
    cellClassName: "font-medium text-primary",
    header: "N° Factura",
    hideInCard: true,
    key: "invoice",
    render: (sale) => formatInvoiceNumber(sale.invoiceNumber),
  },
  {
    cellClassName: "text-on-surface-variant",
    header: "Fecha y Hora",
    key: "date",
    render: (sale) => formatDateTimeShort(sale.createdAt),
    visibility: "md",
  },
  {
    header: "Cliente",
    key: "customer",
    render: (sale) => sale.customer?.name ?? sale.customerId,
  },
  {
    header: "Estado",
    key: "status",
    render: (sale) => <SalesStatusBadge status={sale.status} />,
  },
  {
    align: "right",
    cellClassName: "tabular-nums",
    header: "Total (REF)",
    key: "totalRef",
    render: (sale) => (
      <span
        className={cn(
          sale.status === "cancelada" && "text-slate-400 line-through",
        )}
      >
        {formatRefUsd(sale.totalRef)}
      </span>
    ),
  },
  {
    align: "right",
    cellClassName: "tabular-nums",
    header: "Total (VES)",
    key: "totalVes",
    render: (sale) => (
      <span
        className={cn(
          sale.status === "cancelada" && "text-slate-400 line-through",
        )}
      >
        {formatVesBs(sale.totalVes)}
      </span>
    ),
    visibility: "lg",
  },
  {
    align: "right",
    cellClassName: "tabular-nums",
    header: "Pagado (VES)",
    key: "paidVes",
    render: (sale) => (
      <span
        className={cn(
          sale.status === "cancelada" && "text-slate-400",
          isPartiallyPaid(sale) && "text-amber-700 dark:text-amber-400",
          !isPartiallyPaid(sale) &&
            sale.status !== "cancelada" &&
            "text-on-surface-variant",
        )}
      >
        {formatVesBs(sale.paidVes)}
      </span>
    ),
    visibility: "lg",
  },
];

export function SalesListPage() {
  const [filters, setFilters] = useState<SalesFilters>({});
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.search,
    filters.status,
    filters.from,
    filters.to,
  ]);
  const sales = useSales({ ...filters, limit, skip });
  const cancelSale = useCancelSale();
  const returnSale = useReturnSale();
  const salesItems = getPaginatedItems(sales.data);
  const totalSales = sales.data?.total ?? 0;

  function handleFilterChange(patch: Partial<SalesFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSkip(0);
  }

  async function handleCancelSale(saleId: string) {
    await cancelSale.mutateAsync(saleId);
  }

  async function handleReturnSale(saleId: string) {
    await returnSale.mutateAsync(saleId);
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-start">
            <SalesExportActions
              exportFilters={{
                from: filters.from,
                search: filters.search,
                status: filters.status,
                to: filters.to,
              }}
            />
            <Can permission="sales.create">
              <Button asChild className="w-full gap-1 sm:w-auto" size="sm">
                <Link href="/sales/create">
                  <Plus aria-hidden className="size-[1.125rem]" />
                  Nueva venta
                </Link>
              </Button>
            </Can>
          </div>
        }
        description="Gestión y seguimiento de facturación"
        layout="sections"
        title="Ventas"
      >
        <SalesListFilters filters={filters} onChange={handleFilterChange} />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(sale) => [
              { href: `/sales/${sale.id}`, label: "Ver detalle" },
              { href: `/payments?saleId=${sale.id}`, label: "Registrar pago" },
              { href: `/sales/${sale.id}`, label: "Ver recibo" },
              {
                disabled: cancelSale.isPending || sale.status === "cancelada",
                label: "Anular",
                onSelect: () => void handleCancelSale(sale.id),
                variant: "danger",
              },
              {
                disabled: returnSale.isPending || sale.status === "devuelta",
                label: "Devolver",
                onSelect: () => void handleReturnSale(sale.id),
              },
            ]}
            cardSubtitle={(sale) => sale.customer?.name ?? sale.customerId}
            cardTitle={(sale) => formatInvoiceNumber(sale.invoiceNumber)}
            columns={columns}
            data={salesItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  <Can permission="sales.create">
                    <Button asChild size="sm">
                      <Link href="/sales/create">Nueva venta</Link>
                    </Button>
                  </Can>
                }
                description="Crea una venta o ajusta los filtros para ver otros resultados."
                title="No hay ventas para mostrar"
              />
            }
            error={sales.error ?? cancelSale.error ?? returnSale.error}
            getRowId={(sale) => sale.id}
            isFetching={sales.isFetching}
            isLoading={sales.isLoading}
            onRetry={() => void sales.refetch()}
            variant="stitch-purchases"
          />

          <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
            <ResponsivePagination
              entityLabel="ventas"
              isDisabled={sales.isFetching}
              limit={limit}
              onLimitChange={setLimit}
              onSkipChange={setSkip}
              skip={sales.data?.skip ?? skip}
              total={totalSales}
              variant="stitch"
            />
          </div>
        </div>
      </EntityListPage>
    </div>
  );
}
