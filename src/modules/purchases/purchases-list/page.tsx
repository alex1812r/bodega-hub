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
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";

import {
  type PurchaseListRow,
  type PurchasesFilters,
  useCancelPurchase,
  usePurchases,
  useReceivePurchase,
  useReturnPurchase,
} from "../hooks/usePurchases";
import { PurchaseNumberCell } from "./components/PurchaseNumberCell";
import { PurchaseSupplierCell } from "./components/PurchaseSupplierCell";
import { PurchasesExportActions } from "./components/PurchasesExportActions";
import { PurchasesListFilters } from "./components/PurchasesListFilters";
import { PurchasesStatusBadge } from "./components/PurchasesStatusBadge";

function formatPurchaseNumber(purchaseNumber: string) {
  if (purchaseNumber.startsWith("#")) {
    return purchaseNumber;
  }

  const normalized = purchaseNumber.replace(/^C-?/i, "");
  return `#C-${normalized}`;
}

const purchaseNumberHeaderClass = "w-[5.75rem] max-w-[5.75rem]";

const purchaseNumberCellClass =
  "min-w-0 w-[5.75rem] max-w-[5.75rem] overflow-hidden";

const columns: DataTableColumn<PurchaseListRow>[] = [
  {
    cellClassName: purchaseNumberCellClass,
    className: purchaseNumberHeaderClass,
    header: "N° Compra",
    hideInCard: true,
    key: "purchase",
    render: (purchase) => (
      <PurchaseNumberCell purchaseNumber={formatPurchaseNumber(purchase.purchaseNumber)} />
    ),
  },
  {
    cellClassName: "text-on-surface-variant",
    header: "Fecha",
    key: "date",
    render: (purchase) => formatDateTimeShort(purchase.createdAt),
    visibility: "md",
  },
  {
    header: "Proveedor",
    key: "supplier",
    render: (purchase) => (
      <PurchaseSupplierCell
        name={purchase.supplier?.name ?? purchase.supplierId}
      />
    ),
  },
  {
    header: "Estado",
    key: "status",
    render: (purchase) => <PurchasesStatusBadge status={purchase.status} />,
  },
  {
    align: "right",
    cellClassName: "font-medium tabular-nums",
    header: "Total (REF)",
    key: "totalRef",
    render: (purchase) => (
      <span
        className={cn(
          purchase.status === "cancelado" && "text-muted-foreground line-through",
        )}
      >
        {formatRefUsd(purchase.totalRef)}
      </span>
    ),
  },
];

export function PurchasesListPage() {
  const [filters, setFilters] = useState<PurchasesFilters>({});
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.search,
    filters.status,
    filters.from,
    filters.to,
  ]);
  const purchases = usePurchases({ ...filters, limit, skip });
  const cancelPurchase = useCancelPurchase();
  const receivePurchase = useReceivePurchase();
  const returnPurchase = useReturnPurchase();
  const purchaseItems = getPaginatedItems(purchases.data);
  const totalPurchases = purchases.data?.total ?? 0;

  function handleFilterChange(patch: Partial<PurchasesFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSkip(0);
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <PurchasesExportActions exportFilters={filters} />
            <Can permission="purchases.create">
              <Button asChild className="w-full gap-1 sm:w-auto" size="sm">
                <Link href="/purchases/create">
                  <Plus aria-hidden className="size-5" />
                  Nueva compra
                </Link>
              </Button>
            </Can>
          </div>
        }
        description="Gestión y seguimiento de órdenes de compra a proveedores"
        layout="sections"
        title="Compras"
      >
        <PurchasesListFilters filters={filters} onChange={handleFilterChange} />

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(purchase) => [
              { href: `/purchases/${purchase.id}`, label: "Ver detalle" },
              { href: `/payments?purchaseId=${purchase.id}`, label: "Registrar pago" },
              ...(purchase.status === "pedido"
                ? [
                    {
                      disabled: receivePurchase.isPending,
                      label: "Recibir pedido",
                      onSelect: () => void receivePurchase.mutateAsync(purchase.id),
                    },
                  ]
                : []),
              {
                label: "Cancelar",
                onSelect: () => void cancelPurchase.mutateAsync(purchase.id),
                variant: "danger",
              },
              {
                label: "Devolver",
                onSelect: () => void returnPurchase.mutateAsync(purchase.id),
                variant: "danger",
              },
            ]}
            cardSubtitle={(purchase) => purchase.supplier?.name ?? purchase.supplierId}
            cardTitle={(purchase) => formatPurchaseNumber(purchase.purchaseNumber)}
            columns={columns}
            data={purchaseItems}
            embedded
            emptyState={
              <EmptyState
                action={
                  <Can permission="purchases.create">
                    <Button asChild size="sm">
                      <Link href="/purchases/create">Nueva compra</Link>
                    </Button>
                  </Can>
                }
                description="Registra una compra o ajusta los filtros para ver otros resultados."
                title="No hay compras para mostrar"
              />
            }
            error={
              purchases.error ??
              cancelPurchase.error ??
              receivePurchase.error ??
              returnPurchase.error
            }
            getRowId={(purchase) => purchase.id}
            isFetching={purchases.isFetching}
            isLoading={purchases.isLoading}
            onRetry={() => void purchases.refetch()}
            variant="stitch-purchases"
          />

          <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
            <ResponsivePagination
              entityLabel="compras"
              isDisabled={purchases.isFetching}
              limit={limit}
              onLimitChange={setLimit}
              onSkipChange={setSkip}
              skip={purchases.data?.skip ?? skip}
              total={totalPurchases}
              variant="stitch"
            />
          </div>
        </div>
      </EntityListPage>
    </div>
  );
}
