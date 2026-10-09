"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import {
  getTotalPages,
  ResponsivePagination,
  useUrlPaginationState,
} from "@/shared/components/Pagination";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { formatDateTimeShort } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";
import { withReturnTo } from "@/shared/utils/returnTo";

import {
  type SaleListItem,
  useCancelSale,
  useReturnSale,
  useSales,
} from "../hooks/useSales";
import { SalesExportActions } from "./components/SalesExportActions";
import { SalesListFilters } from "./components/SalesListFilters";
import { estimatePaidRef, SalesMoneyCell } from "./components/SalesMoneyCell";
import { SalesStatusBadge } from "./components/SalesStatusBadge";
import { salesListSchema, toSalesFilters } from "./salesListParams";

const detailLinkClass =
  "rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

/** Columna del número; `detailHref` lleva a la venta con la URL de la lista en `returnTo`. */
function buildInvoiceColumn(
  detailHref: (saleId: string) => string,
): DataTableColumn<SaleListItem> {
  return {
    cellClassName: "font-medium text-primary",
    header: "N° Factura",
    hideInCard: true,
    key: "invoice",
    render: (sale) => (
      <Link className={detailLinkClass} href={detailHref(sale.id)}>
        {formatInvoiceNumber(sale.invoiceNumber)}
      </Link>
    ),
  };
}

const staticColumns: DataTableColumn<SaleListItem>[] = [
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
    header: "Total",
    key: "total",
    render: (sale) => (
      <SalesMoneyCell
        refAmount={sale.totalRef}
        strike={sale.status === "cancelada"}
        vesAmount={sale.totalVes}
      />
    ),
  },
  {
    align: "right",
    header: "Pagado",
    key: "paid",
    render: (sale) => (
      <SalesMoneyCell
        className={cn(
          isPartiallyPaid(sale) && "[&_span:first-child]:text-amber-700 dark:[&_span:first-child]:text-amber-400",
        )}
        muted={sale.status !== "cancelada" && !isPartiallyPaid(sale)}
        refAmount={estimatePaidRef(
          sale.paidVes,
          sale.totalRef,
          sale.totalVes,
          sale.refRateVes,
        )}
        strike={sale.status === "cancelada"}
        vesAmount={sale.paidVes}
      />
    ),
    visibility: "md",
  },
];

function SalesList() {
  // Búsqueda, filtros, página y tamaño viven en la URL: recarga, "atrás" y volver del detalle los conservan.
  const list = useUrlListState(salesListSchema);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const filters = toSalesFilters(list.state, debouncedSearch);
  const sales = useSales({ ...filters, limit, skip });
  const cancelSale = useCancelSale();
  const returnSale = useReturnSale();
  const salesItems = getPaginatedItems(sales.data);
  const totalSales = sales.data?.total ?? 0;
  const { href: listHref, setState: setListState } = list;
  // El detalle vuelve a esta URL exacta (filtros y página) con "Volver".
  const columns = useMemo(
    () => [
      buildInvoiceColumn((saleId) => withReturnTo(`/sales/${saleId}`, listHref)),
      ...staticColumns,
    ],
    [listHref],
  );
  const lastPage = getTotalPages(totalSales, limit);
  const isPastLastPage = sales.isSuccess && !sales.isFetching && list.state.page > lastPage;

  // Una página más allá de la última (`?page=9999`, o un enlace viejo) cae en la
  // última que existe, y la URL lo refleja.
  useEffect(() => {
    if (isPastLastPage) {
      setListState({ page: lastPage });
    }
  }, [isPastLastPage, lastPage, setListState]);

  useScrollRestoration(listHref, { ready: !sales.isLoading });

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
            <SalesExportActions exportFilters={filters} />
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
        <SalesListFilters onChange={list.setState} state={list.state} />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(sale) => [
              { href: withReturnTo(`/sales/${sale.id}`, listHref), label: "Ver detalle" },
              { href: `/payments?saleId=${sale.id}`, label: "Registrar pago" },
              { href: withReturnTo(`/sales/${sale.id}`, listHref), label: "Ver recibo" },
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
            cardTitle={(sale) => (
              <Link className={detailLinkClass} href={withReturnTo(`/sales/${sale.id}`, listHref)}>
                {formatInvoiceNumber(sale.invoiceNumber)}
              </Link>
            )}
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

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const SalesListPage = withUrlListBoundary(SalesList);
