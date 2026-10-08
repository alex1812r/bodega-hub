"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ClientApiError } from "@/shared/api/apiFetch";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import {
  ResponsivePagination,
  getTotalPages,
  useUrlPaginationState,
} from "@/shared/components/Pagination";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { cn } from "@/shared/utils/cn";

import { useAllCategories } from "../../products/hooks/useProducts";
import { InventoryAdjustmentModal } from "../inventory-movements/components/InventoryAdjustmentModal";
import { InventoryPackConversionModal } from "../inventory-movements/components/InventoryPackConversionModal";
import { useInventory, type InventoryOverviewItem } from "../hooks/useInventory";
import { InventoryExportActions } from "./components/InventoryExportActions";
import { InventoryLastMovementCell } from "./components/InventoryLastMovementCell";
import { InventoryListFilters } from "./components/InventoryListFilters";
import { InventoryReconciliationBadge } from "./components/InventoryReconciliationBadge";
import { InventorySkuCell } from "./components/InventorySkuCell";
import { InventoryStockStatusBadge } from "./components/InventoryStockStatusBadge";
import {
  INVENTORY_LIST_NO_FILTERS,
  INVENTORY_LIST_TEXT_FIELDS,
  hasInventoryListFilters,
  inventoryListSchema,
  toInventoryFilters,
} from "./inventoryListParams";

/**
 * Ocho columnas de datos + acciones en el ancho que deja el menú lateral a
 * 1280 px (≈ 940 px): padding lateral de 8 px en vez de 16 (la primera conserva
 * 16 a la izquierda). "Categoría" solo desde lg; por debajo de md la lista va en
 * tarjetas, con todas las cifras.
 */
const compactColumnClass = "px-2";
const numericCellClass = "px-2 tabular-nums";

/** Nombre del producto y, para admin, el aviso de descuadre (tabla y tarjeta). */
function InventoryProductName({ item }: { item: InventoryOverviewItem }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <span className="line-clamp-2 min-w-0 text-sm leading-snug text-foreground" title={item.name}>
        {item.name}
      </span>
      <InventoryReconciliationBadge diff={item.reconciliationDiff} />
    </span>
  );
}

const columns: DataTableColumn<InventoryOverviewItem>[] = [
  {
    cellClassName: "min-w-[10rem] max-w-[16rem] px-2 pl-4 font-medium",
    className: "px-2 pl-4",
    header: "Producto",
    hideInCard: true,
    key: "product",
    render: (item) => (
      <div className="flex min-w-0 flex-col gap-1">
        <InventoryProductName item={item} />
        <InventorySkuCell className="max-w-[9rem]" sku={item.sku} />
      </div>
    ),
  },
  {
    cellClassName: "px-2 text-on-surface-variant",
    className: compactColumnClass,
    header: "Categoría",
    key: "category",
    render: (item) => item.category?.name ?? "Sin categoría",
    visibility: "lg",
  },
  {
    align: "right",
    cellClassName: cn(numericCellClass, "font-medium"),
    className: compactColumnClass,
    header: "Stock",
    key: "currentStock",
    render: (item) => (
      <span
        className={cn(
          item.currentStock === 0 && "text-error",
          item.currentStock < 0 && "font-semibold text-error",
        )}
        data-negative={item.currentStock < 0 ? "true" : undefined}
        title={item.currentStock < 0 ? "Stock negativo" : undefined}
      >
        {item.currentStock}
      </span>
    ),
  },
  {
    align: "right",
    cellClassName: cn(numericCellClass, "text-on-surface-variant"),
    className: compactColumnClass,
    header: "Mínimo",
    key: "minStock",
    render: (item) => item.minStock,
  },
  {
    align: "right",
    cellClassName: numericCellClass,
    className: compactColumnClass,
    header: "Entradas 30 d",
    key: "entries30d",
    render: (item) => item.entries30d,
  },
  {
    align: "right",
    cellClassName: numericCellClass,
    className: compactColumnClass,
    header: "Salidas 30 d",
    key: "exits30d",
    render: (item) => item.exits30d,
  },
  {
    cellClassName: "min-w-[7rem] px-2",
    className: compactColumnClass,
    header: "Último movimiento",
    key: "lastMovement",
    render: (item) => (
      <InventoryLastMovementCell at={item.lastMovementAt} type={item.lastMovementType} />
    ),
  },
  {
    align: "center",
    cellClassName: "px-2",
    className: compactColumnClass,
    header: "Estado",
    key: "status",
    render: (item) => (
      <InventoryStockStatusBadge
        className="mx-auto"
        currentStock={item.currentStock}
        minStock={item.minStock}
      />
    ),
  },
];

function InventoryList() {
  const { can } = usePermission();
  const list = useUrlListState(inventoryListSchema, { textFields: INVENTORY_LIST_TEXT_FIELDS });
  const { setState: setListState, state } = list;
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);

  // Los campos reflejan lo tecleado al instante; la consulta espera lo mismo que la URL.
  const search = useDebouncedValue(state.search, URL_LIST_DEBOUNCE_MS);
  const minPrice = useDebouncedValue(state.minPrice, URL_LIST_DEBOUNCE_MS);
  const maxPrice = useDebouncedValue(state.maxPrice, URL_LIST_DEBOUNCE_MS);
  const { category, lowStock, status } = state;
  const filters = useMemo(
    () => toInventoryFilters({ category, lowStock, status }, { maxPrice, minPrice, search }),
    [category, lowStock, maxPrice, minPrice, search, status],
  );

  const inventoryQuery = useInventory({ ...filters, limit, skip });
  const categories = useAllCategories();
  const inventory = getPaginatedItems(inventoryQuery.data);
  const totalProducts = inventoryQuery.data?.total ?? 0;
  const categoryOptions = getPaginatedItems(categories.data).map((item) => ({
    label: item.name,
    value: item.id,
  }));
  const hasFilters = hasInventoryListFilters(state);
  const isForbidden =
    inventoryQuery.error instanceof ClientApiError && inventoryQuery.error.status === 403;

  const lastPage = getTotalPages(totalProducts, limit);
  // `?page=9999`: el servidor responde lista vacía con el total real; la página pedida no existe.
  const isPagePastTheEnd = inventoryQuery.data !== undefined && state.page > lastPage;

  // La lista acota la página contra su total y corrige la URL (regla 15).
  useEffect(() => {
    if (isPagePastTheEnd) {
      setListState({ page: lastPage });
    }
  }, [isPagePastTheEnd, lastPage, setListState]);

  const rowActions = useMemo(
    () =>
      function inventoryRowActions(item: InventoryOverviewItem): ActionMenuItem[] {
        const items: ActionMenuItem[] = [
          {
            href: `/inventory/movements?productId=${item.id}`,
            label: "Kardex / movimientos",
          },
        ];

        if (can("inventory.manage")) {
          items.push({
            href: `/inventory/movements?productId=${item.id}`,
            label: "Registrar ajuste",
          });
        }

        return items;
      },
    [can],
  );

  function clearFilters() {
    setListState(INVENTORY_LIST_NO_FILTERS);
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InventoryExportActions exportFilters={filters} />
            <Can permission="inventory.manage">
              <div className="flex flex-wrap items-center gap-2">
                <InventoryPackConversionModal />
                <InventoryAdjustmentModal />
                <Button asChild size="sm" variant="outline">
                  <Link href="/inventory/movements">Ver todos los movimientos</Link>
                </Button>
              </div>
            </Can>
          </div>
        }
        description="Consulta existencias, entradas y salidas de los últimos 30 días y el último movimiento de cada producto. El catálogo y los precios se gestionan en Productos."
        layout="sections"
        title="Inventario"
      >
        {isForbidden ? (
          <div className="rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
            <EmptyState
              description="Pide al administrador de la tienda el permiso para consultar el inventario."
              icon={<Lock aria-hidden className="h-5 w-5" />}
              title="No tienes permiso para ver el inventario"
            />
          </div>
        ) : (
          <>
            <InventoryListFilters
              categoryOptions={categoryOptions}
              filters={state}
              hasFilters={hasFilters}
              onChange={setListState}
              onClear={clearFilters}
            />

            <div className="flex w-full flex-col md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-surface-container-lowest md:shadow-sm dark:md:border-slate-800">
              <DataTable
                actions={rowActions}
                cardSubtitle={(item) => (
                  <span className="inline-flex items-center gap-2">
                    <InventorySkuCell sku={item.sku} />
                  </span>
                )}
                cardTitle={(item) => <InventoryProductName item={item} />}
                columns={columns}
                data={isPagePastTheEnd ? [] : inventory}
                embedded
                emptyState={
                  hasFilters ? (
                    <EmptyState
                      action={
                        <Button onClick={clearFilters} size="sm" variant="outline">
                          Limpiar filtros
                        </Button>
                      }
                      description="Prueba con otra búsqueda o quita algún filtro."
                      title="Ningún producto coincide con los filtros"
                    />
                  ) : (
                    <EmptyState
                      description="Crea tus productos en Productos y registra una compra o un ajuste para ver aquí sus existencias."
                      title="Aún no hay productos en el inventario"
                    />
                  )
                }
                error={inventoryQuery.error}
                getRowId={(item) => item.id}
                isFetching={inventoryQuery.isFetching}
                isLoading={inventoryQuery.isLoading || isPagePastTheEnd}
                onRetry={() => void inventoryQuery.refetch()}
                variant="stitch"
              />

              <div className="mt-3 rounded-xl border border-border bg-surface-container-lowest px-4 py-3 shadow-sm dark:border-slate-800 md:mt-0 md:rounded-none md:border-0 md:border-t md:shadow-none dark:md:border-slate-800">
                <ResponsivePagination
                  entityLabel="productos"
                  isDisabled={inventoryQuery.isFetching}
                  limit={limit}
                  onLimitChange={setLimit}
                  onSkipChange={setSkip}
                  skip={inventoryQuery.data?.skip ?? skip}
                  total={totalProducts}
                  variant="stitch"
                />
              </div>
            </div>
          </>
        )}
      </EntityListPage>
    </div>
  );
}

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const InventoryListPage = withUrlListBoundary(InventoryList);
