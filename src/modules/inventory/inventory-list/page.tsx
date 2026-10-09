"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ClientApiError } from "@/shared/api/apiFetch";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { PageBackButton } from "@/shared/components/PageBackButton";
import {
  ResponsivePagination,
  getTotalPages,
  useUrlPaginationState,
} from "@/shared/components/Pagination";
import { Typography } from "@/shared/components/Typography";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { cn } from "@/shared/utils/cn";
import { RETURN_TO_PARAM, isSafeInternalPath, withChainedReturnTo } from "@/shared/utils/returnTo";

import { useAllCategories } from "../../products/hooks/useProducts";
import { InventoryAdjustmentModal } from "../inventory-movements/components/InventoryAdjustmentModal";
import { InventoryPackConversionModal } from "../inventory-movements/components/InventoryPackConversionModal";
import { useInventory, type InventoryOverviewItem } from "../hooks/useInventory";
import { RestockPurchaseButton } from "../restock";
import { InventoryExportActions } from "./components/InventoryExportActions";
import { InventoryLastMovementCell } from "./components/InventoryLastMovementCell";
import { InventoryListFilters } from "./components/InventoryListFilters";
import {
  InventoryMovementsToggle,
  getInventoryMovementsPanelId,
  getInventoryProductAnchorId,
} from "./components/InventoryMovementsToggle";
import { InventoryProductMovementsPanel } from "./components/InventoryProductMovementsPanel";
import { InventorySelectedProduct } from "./components/InventorySelectedProduct";
import { InventorySkuCell } from "./components/InventorySkuCell";
import { InventoryProductName, InventoryStockValue } from "./components/InventoryStockCells";
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
 * 16 a la izquierda). "Categoría" y "Último movimiento" solo desde xl: con el
 * menú lateral fijo a 1024 px quedan ≈ 690 px y "Acciones" debe verse sin
 * desplazar la tabla. Por debajo de md la lista va en tarjetas, con todas las cifras.
 */
const compactColumnClass = "px-2";
/** Columna secundaria de la tabla: oculta hasta xl (en tarjetas se muestra siempre). */
const wideOnlyColumnClass = "hidden px-2 xl:table-cell";
const numericCellClass = "px-2 tabular-nums";

/** Códigos con los que `GET /api/inventory?productId=` dice "ese id no es de un producto". */
const PRODUCT_NOT_FOUND_STATUSES = [400, 404];

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Columnas fijas: todas menos "Producto", que lleva el botón de movimientos. */
const figureColumns: DataTableColumn<InventoryOverviewItem>[] = [
  {
    cellClassName: "px-2 text-on-surface-variant",
    className: wideOnlyColumnClass,
    header: "Categoría",
    key: "category",
    render: (item) => item.category?.name ?? "Sin categoría",
  },
  {
    align: "right",
    cellClassName: cn(numericCellClass, "font-medium"),
    className: compactColumnClass,
    header: "Stock",
    key: "currentStock",
    render: (item) => <InventoryStockValue currentStock={item.currentStock} />,
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
    headerClassName: "whitespace-nowrap",
    key: "entries30d",
    render: (item) => item.entries30d,
  },
  {
    align: "right",
    cellClassName: numericCellClass,
    className: compactColumnClass,
    header: "Salidas 30 d",
    headerClassName: "whitespace-nowrap",
    key: "exits30d",
    render: (item) => item.exits30d,
  },
  {
    cellClassName: "min-w-[7rem] px-2",
    className: wideOnlyColumnClass,
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
  // Se llegó desde otra lista (celda Stock de `/products`): se ofrece volver a ella.
  const hasReturnTo = isSafeInternalPath(useSearchParams().get(RETURN_TO_PARAM));

  // Los campos reflejan lo tecleado al instante; la consulta espera lo mismo que la URL.
  const search = useDebouncedValue(state.search, URL_LIST_DEBOUNCE_MS);
  const minPrice = useDebouncedValue(state.minPrice, URL_LIST_DEBOUNCE_MS);
  const maxPrice = useDebouncedValue(state.maxPrice, URL_LIST_DEBOUNCE_MS);
  const { category, lowStock, product: selectedProductId, status } = state;
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

  // Al volver de los movimientos o de un documento la lista reaparece a la altura en que se dejó.
  useScrollRestoration(list.href, { ready: !inventoryQuery.isLoading });

  const isSelectedInPage =
    selectedProductId !== "" && inventory.some((item) => item.id === selectedProductId);
  // El producto de la URL no está en la página visible: se pide aparte y se fija
  // arriba. Se espera a que la página cargue para no pedirlo si ya viene en ella.
  const mustFetchSelected =
    selectedProductId !== "" &&
    inventoryQuery.data !== undefined &&
    !isPagePastTheEnd &&
    !isSelectedInPage;
  const selectedQuery = useInventory(
    { limit: 10, productId: selectedProductId, skip: 0 },
    mustFetchSelected,
  );
  // Mientras la lista recarga (otro filtro u otra página) el bloque fijado sigue con lo ya leído.
  const showSelectedBlock =
    selectedProductId !== "" &&
    !isSelectedInPage &&
    (mustFetchSelected || selectedQuery.data !== undefined);
  const isSelectedNotFound =
    selectedQuery.error instanceof ClientApiError &&
    PRODUCT_NOT_FOUND_STATUSES.includes(selectedQuery.error.status);
  const selectedItem = selectedQuery.data
    ? (getPaginatedItems(selectedQuery.data).find((item) => item.id === selectedProductId) ?? null)
    : isSelectedNotFound
      ? null
      : undefined;

  // Producto con el que se llegó a la pantalla (`/inventory?product=<id>`): la
  // página se desplaza hasta él una sola vez, cuando ya está pintado.
  const arrivalProductRef = useRef(selectedProductId);
  const isSelectedRendered = isSelectedInPage || showSelectedBlock;

  useEffect(() => {
    const arrivalProductId = arrivalProductRef.current;

    if (arrivalProductId === "" || arrivalProductId !== selectedProductId || !isSelectedRendered) {
      return;
    }

    arrivalProductRef.current = "";

    const anchor = document.getElementById(getInventoryProductAnchorId(arrivalProductId));

    // jsdom no implementa `scrollIntoView`.
    if (anchor && typeof anchor.scrollIntoView === "function") {
      anchor.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
    }
  }, [isSelectedRendered, selectedProductId]);

  // Sin `page` en el patch la lista volvería a la página 1: abrir o cerrar los
  // movimientos de una fila no cambia de página.
  const currentPage = state.page;
  const toggleProduct = useCallback(
    (productId: string) => {
      arrivalProductRef.current = "";
      setListState({
        page: currentPage,
        product: productId === selectedProductId ? "" : productId,
      });
    },
    [currentPage, selectedProductId, setListState],
  );
  const clearProduct = useCallback(() => {
    arrivalProductRef.current = "";
    setListState({ page: currentPage, product: "" });
  }, [currentPage, setListState]);

  const columns = useMemo<DataTableColumn<InventoryOverviewItem>[]>(
    () => [
      {
        cellClassName: "min-w-[10rem] max-w-[16rem] px-2 pl-4 font-medium",
        className: "px-2 pl-4",
        header: "Producto",
        hideInCard: true,
        key: "product",
        render: (item) => (
          <div className="flex min-w-0 items-start gap-1">
            <InventoryMovementsToggle
              className="-ml-2"
              isExpanded={item.id === selectedProductId}
              onToggle={toggleProduct}
              productId={item.id}
              productName={item.name}
            />
            <div className="flex min-w-0 flex-col gap-1 pt-1.5">
              <InventoryProductName item={item} />
              <InventorySkuCell className="max-w-[9rem]" sku={item.sku} />
            </div>
          </div>
        ),
      },
      ...figureColumns,
    ],
    [selectedProductId, toggleProduct],
  );

  // Los movimientos del producto vuelven a esta lista tal como está, con su `returnTo`.
  const listHref = list.href;
  const rowActions = useMemo(
    () =>
      function inventoryRowActions(item: InventoryOverviewItem): ActionMenuItem[] {
        const movementsHref = withChainedReturnTo(
          `/inventory/movements?productId=${encodeURIComponent(item.id)}`,
          listHref,
        );
        const items: ActionMenuItem[] = [{ href: movementsHref, label: "Kardex / movimientos" }];

        if (can("inventory.manage")) {
          items.push({ href: movementsHref, label: "Registrar ajuste" });
        }

        return items;
      },
    [can, listHref],
  );

  function clearFilters() {
    setListState(INVENTORY_LIST_NO_FILTERS);
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      {/*
        Cabecera propia: hasta seis acciones según filtro, permiso y `returnTo`.
        El título conserva al menos 20rem; si las acciones no caben a su lado
        bajan a su propia línea y allí se parten.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 grow basis-80">
          <Typography as="h1" variant="h1">
            Inventario
          </Typography>
          <Typography className="mt-2 max-w-2xl" variant="muted">
            Consulta existencias, entradas y salidas de los últimos 30 días y el último movimiento
            de cada producto. El catálogo y los precios se gestionan en Productos.
          </Typography>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:max-w-full">
          {hasReturnTo ? <PageBackButton chained fallbackHref="/inventory" size="sm" /> : null}
          <InventoryExportActions exportFilters={filters} />
          {state.lowStock ? <RestockPurchaseButton size="sm" variant="primary" /> : null}
          <Can permission="inventory.manage">
            <div className="flex flex-wrap items-center gap-2">
              <InventoryPackConversionModal />
              <InventoryAdjustmentModal />
              <Button asChild size="sm" variant="outline">
                <Link href={withChainedReturnTo("/inventory/movements", listHref)}>
                  Ver todos los movimientos
                </Link>
              </Button>
            </div>
          </Can>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
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

            {showSelectedBlock ? (
              <InventorySelectedProduct
                error={isSelectedNotFound ? null : selectedQuery.error}
                isLoading={selectedQuery.isLoading}
                item={selectedItem}
                onClear={clearProduct}
                onRetry={() => void selectedQuery.refetch()}
                productId={selectedProductId}
                returnTo={list.href}
              />
            ) : null}

            <div className="flex w-full flex-col md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-surface-container-lowest md:shadow-sm dark:md:border-slate-800">
              <DataTable
                actions={rowActions}
                cardSubtitle={(item) => (
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <InventorySkuCell sku={item.sku} />
                    <InventoryMovementsToggle
                      isExpanded={item.id === selectedProductId}
                      onToggle={toggleProduct}
                      productId={item.id}
                      productName={item.name}
                      showLabel
                    />
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
                renderExpandedRow={(item) =>
                  item.id === selectedProductId ? (
                    <InventoryProductMovementsPanel
                      id={getInventoryMovementsPanelId(item.id)}
                      product={item}
                      returnTo={list.href}
                    />
                  ) : null
                }
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
      </div>
    </div>
  );
}

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const InventoryListPage = withUrlListBoundary(InventoryList);
