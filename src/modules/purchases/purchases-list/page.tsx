"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
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
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";
import { withReturnTo } from "@/shared/utils/returnTo";

import {
  type PurchaseListRow,
  useCancelPurchase,
  usePurchases,
  useReturnPurchase,
} from "../hooks/usePurchases";
import { PurchaseNumberCell } from "./components/PurchaseNumberCell";
import { PurchasePaymentStatusBadge } from "./components/PurchasePaymentStatusBadge";
import { PurchaseSupplierCell } from "./components/PurchaseSupplierCell";
import { PurchasesExportActions } from "./components/PurchasesExportActions";
import { PurchasesListFilters } from "./components/PurchasesListFilters";
import { PurchasesStatusBadge } from "./components/PurchasesStatusBadge";
import {
  getPurchaseBalanceRef,
  getPurchasePaymentStatus,
  isPayablePurchaseStatus,
  PURCHASE_BALANCE_TOLERANCE_REF,
} from "./utils/purchaseBalance";
import {
  CLEARED_PURCHASES_FILTERS,
  hasActivePurchasesFilters,
  purchasesListSchema,
  toPurchasesFilters,
} from "./utils/purchasesListState";

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

/** Una compra cancelada o devuelta no se debe: ni estado de pago ni saldo. */
function NotApplicable() {
  return (
    <span className="text-muted-foreground" title="No aplica">
      —
    </span>
  );
}

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
    header: "Pago",
    key: "paymentStatus",
    render: (purchase) =>
      isPayablePurchaseStatus(purchase.status) ? (
        <PurchasePaymentStatusBadge status={getPurchasePaymentStatus(purchase)} />
      ) : (
        <NotApplicable />
      ),
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
  {
    align: "right",
    cellClassName: "tabular-nums text-on-surface-variant",
    header: "Pagado (REF)",
    key: "paidRef",
    render: (purchase) => formatRefUsd(purchase.paidRef ?? 0),
    visibility: "lg",
  },
  {
    align: "right",
    cellClassName: "font-semibold tabular-nums",
    header: "Saldo (REF)",
    key: "balanceRef",
    render: (purchase) => {
      const balanceRef = getPurchaseBalanceRef(purchase);

      if (balanceRef === null) {
        return <NotApplicable />;
      }

      return (
        <span
          className={cn(
            balanceRef >= PURCHASE_BALANCE_TOLERANCE_REF ? "text-destructive" : "text-foreground",
          )}
        >
          {formatRefUsd(balanceRef)}
        </span>
      );
    },
  },
];

function PurchasesList() {
  // Búsqueda, filtros, página y tamaño viven en la URL: recarga, "atrás" y volver del detalle los conservan.
  const list = useUrlListState(purchasesListSchema);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const filters = toPurchasesFilters(list.state, debouncedSearch);
  const purchases = usePurchases({ ...filters, limit, skip });
  const cancelPurchase = useCancelPurchase();
  // Recibir exige el mismo permiso que el botón «Recibir mercancía» del detalle.
  const canReceive = usePermission().can("purchases.create");
  const returnPurchase = useReturnPurchase();
  const purchaseItems = getPaginatedItems(purchases.data);
  const totalPurchases = purchases.data?.total ?? 0;
  const pendingBalanceRef = purchases.data?.pendingBalanceRef;
  const hasActiveFilters = hasActivePurchasesFilters(list.state);
  const { setState: setListState } = list;
  const lastPage = getTotalPages(totalPurchases, limit);
  const isPastLastPage = purchases.isSuccess && !purchases.isFetching && list.state.page > lastPage;

  // Una página más allá de la última (`?page=99`, o un enlace viejo) cae en la
  // última que existe, y la URL lo refleja.
  useEffect(() => {
    if (isPastLastPage) {
      setListState({ page: lastPage });
    }
  }, [isPastLastPage, lastPage, setListState]);

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
        <PurchasesListFilters
          hasActiveFilters={hasActiveFilters}
          onChange={list.setState}
          onClear={() => list.setState(CLEARED_PURCHASES_FILTERS)}
          state={list.state}
        />

        {filters.pendingBalance && pendingBalanceRef !== undefined ? (
          <p
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant shadow-sm dark:border-slate-800 sm:px-6"
            role="status"
          >
            <span>
              Saldo pendiente en {totalPurchases} {totalPurchases === 1 ? "compra" : "compras"}
            </span>
            <span className="text-base font-semibold tabular-nums text-destructive">
              {formatRefUsd(pendingBalanceRef)}
            </span>
          </p>
        ) : null}

        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(purchase) => [
              { href: withReturnTo(`/purchases/${purchase.id}`, list.href), label: "Ver detalle" },
              { href: `/payments?purchaseId=${purchase.id}`, label: "Registrar pago" },
              // No recibe: abre el detalle con la previsualización de la recepción.
              ...(purchase.status === "pedido" && canReceive
                ? [
                    {
                      href: withReturnTo(`/purchases/${purchase.id}?receive=1`, list.href),
                      label: "Recibir mercancía…",
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
              hasActiveFilters ? (
                <EmptyState
                  action={
                    <Button
                      onClick={() => list.setState(CLEARED_PURCHASES_FILTERS)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Limpiar filtros
                    </Button>
                  }
                  description="Ninguna compra coincide con los filtros. Ajústalos o límpialos para ver otros resultados."
                  title="No hay compras para mostrar"
                />
              ) : (
                <EmptyState
                  action={
                    <Can permission="purchases.create">
                      <Button asChild size="sm">
                        <Link href="/purchases/create">Nueva compra</Link>
                      </Button>
                    </Can>
                  }
                  description="Registra una compra para verla aquí."
                  title="No hay compras para mostrar"
                />
              )
            }
            error={purchases.error ?? cancelPurchase.error ?? returnPurchase.error}
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

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const PurchasesListPage = withUrlListBoundary(PurchasesList);
