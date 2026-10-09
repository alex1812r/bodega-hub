"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import type { ActionMenuItem } from "@/shared/components/ActionsMenu";
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
import { getPurchaseActions } from "../utils/purchaseActions";
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

/*
 * Anchos de columna. La tabla vive en una tarjeta `@container` y las columnas
 * siguen el ancho de ESA tarjeta, no el de la ventana (a 1280 px con el menú
 * lateral abierto quedan 942 px):
 * - siempre: N° Compra, Proveedor, Estado, Pago, Total, Saldo y Acciones;
 * - desde `@6xl` (1152 px): además Fecha, que hasta entonces va bajo el número;
 * - desde `@7xl` (1280 px): además Pagado (= Total − Saldo).
 */
const compactColumnClass = "px-2 @6xl:px-3";
const amountColumnClass = `whitespace-nowrap ${compactColumnClass}`;

/** En la tarjeta móvil el número es el enlace al detalle, como en la tabla. */
const cardTitleLinkClass =
  "rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Una compra cancelada o devuelta no se debe: ni estado de pago ni saldo. */
function NotApplicable() {
  return (
    <span className="text-muted-foreground" title="No aplica">
      —
    </span>
  );
}

/** Columnas de la tabla; `listHref` es la URL de la lista, que viaja al detalle como `returnTo`. */
function buildColumns(listHref: string): DataTableColumn<PurchaseListRow>[] {
  return [
    {
      className: compactColumnClass,
      header: "N° Compra",
      hideInCard: true,
      key: "purchase",
      render: (purchase) => (
        <>
          <PurchaseNumberCell
            href={withReturnTo(`/purchases/${purchase.id}`, listHref)}
            purchaseNumber={formatPurchaseNumber(purchase.purchaseNumber)}
          />
          <span className="mt-0.5 block whitespace-nowrap text-xs text-on-surface-variant @6xl:hidden">
            {formatDateTimeShort(purchase.createdAt)}
          </span>
        </>
      ),
    },
    {
      cellClassName: "text-on-surface-variant",
      className: "hidden whitespace-nowrap px-3 @6xl:table-cell",
      header: "Fecha",
      key: "date",
      render: (purchase) => formatDateTimeShort(purchase.createdAt),
    },
    {
      className: compactColumnClass,
      header: "Proveedor",
      key: "supplier",
      render: (purchase) => (
        <PurchaseSupplierCell
          name={purchase.supplier?.name ?? purchase.supplierId}
        />
      ),
    },
    {
      className: compactColumnClass,
      header: "Estado",
      key: "status",
      render: (purchase) => <PurchasesStatusBadge status={purchase.status} />,
    },
    {
      className: compactColumnClass,
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
      className: amountColumnClass,
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
      className: "hidden whitespace-nowrap px-3 @7xl:table-cell",
      header: "Pagado (REF)",
      key: "paidRef",
      render: (purchase) => formatRefUsd(purchase.paidRef ?? 0),
    },
    {
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      className: amountColumnClass,
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
}

function PurchasesList() {
  // Búsqueda, filtros, página y tamaño viven en la URL: recarga, "atrás" y volver del detalle los conservan.
  const list = useUrlListState(purchasesListSchema);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const filters = toPurchasesFilters(list.state, debouncedSearch);
  const purchases = usePurchases({ ...filters, limit, skip });
  const cancelPurchase = useCancelPurchase();
  // Las acciones de fila siguen las mismas reglas de permiso y estado que el detalle.
  const access = usePermission();
  const returnPurchase = useReturnPurchase();
  const purchaseItems = getPaginatedItems(purchases.data);
  const totalPurchases = purchases.data?.total ?? 0;
  const pendingBalanceRef = purchases.data?.pendingBalanceRef;
  const hasActiveFilters = hasActivePurchasesFilters(list.state);
  const { href: listHref, setState: setListState } = list;
  const columns = useMemo(() => buildColumns(listHref), [listHref]);
  const lastPage = getTotalPages(totalPurchases, limit);
  const isPastLastPage = purchases.isSuccess && !purchases.isFetching && list.state.page > lastPage;

  // Una página más allá de la última (`?page=99`, o un enlace viejo) cae en la
  // última que existe, y la URL lo refleja.
  useEffect(() => {
    if (isPastLastPage) {
      setListState({ page: lastPage });
    }
  }, [isPastLastPage, lastPage, setListState]);

  // Al volver del detalle la lista reaparece a la altura en que se dejó.
  useScrollRestoration(listHref, { ready: !purchases.isLoading });

  // "Volver" de la compra nueva regresa a esta lista con sus filtros.
  const createHref = withReturnTo("/purchases/create", listHref);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <PurchasesExportActions exportFilters={filters} />
            <Can permission="purchases.create">
              <Button asChild className="w-full gap-1 sm:w-auto" size="sm">
                <Link href={createHref}>
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

        <div className="@container flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <DataTable
            actions={(purchase) => {
              const allowed = getPurchaseActions(purchase, access);
              const rowActions: ActionMenuItem[] = [
                { href: withReturnTo(`/purchases/${purchase.id}`, listHref), label: "Ver detalle" },
              ];

              if (allowed.canPay) {
                rowActions.push({
                  href: `/payments?purchaseId=${purchase.id}`,
                  label: "Registrar pago",
                });
              }

              // No recibe: abre el detalle con la previsualización de la recepción.
              if (allowed.canReceive) {
                rowActions.push({
                  href: withReturnTo(`/purchases/${purchase.id}?receive=1`, listHref),
                  label: "Recibir mercancía…",
                });
              }

              if (allowed.canCancelOrReturn) {
                rowActions.push(
                  {
                    disabled: !allowed.isOpen,
                    label: "Cancelar",
                    onSelect: () => void cancelPurchase.mutateAsync(purchase.id),
                    variant: "danger",
                  },
                  {
                    disabled: !allowed.isOpen,
                    label: "Devolver",
                    onSelect: () => void returnPurchase.mutateAsync(purchase.id),
                    variant: "danger",
                  },
                );
              }

              return rowActions;
            }}
            cardSubtitle={(purchase) => purchase.supplier?.name ?? purchase.supplierId}
            cardTitle={(purchase) => (
              <Link
                className={cardTitleLinkClass}
                href={withReturnTo(`/purchases/${purchase.id}`, listHref)}
              >
                {formatPurchaseNumber(purchase.purchaseNumber)}
              </Link>
            )}
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
                        <Link href={createHref}>Nueva compra</Link>
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
