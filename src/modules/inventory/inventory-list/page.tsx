"use client";

import { Filter } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { isMockDataSource } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { Modal } from "@/shared/components/Modal";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";

import { useCategories } from "../../products/hooks/useProducts";
import { InventoryAdjustmentModal } from "../inventory-movements/components/InventoryAdjustmentModal";
import {
  useInventory,
  type InventoryFilters,
  type InventoryItem,
} from "../hooks/useInventory";
import { InventoryContentGrid } from "./components/InventoryContentGrid";
import { InventoryExportActions } from "./components/InventoryExportActions";
import {
  defaultInventorySidebarFilters,
  InventoryFiltersSidebar,
  type InventorySidebarFilters,
} from "./components/InventoryFiltersSidebar";
import { InventorySkuCell } from "./components/InventorySkuCell";
import { InventoryStockStatusBadge } from "./components/InventoryStockStatusBadge";
import { sidebarFiltersToQuery } from "./utils/inventoryFilterState";

const stickySkuHeaderClass =
  "sticky left-0 z-10 w-[5.75rem] max-w-[5.75rem] bg-surface-container dark:bg-slate-950";

const stickySkuCellClass =
  "sticky left-0 z-10 w-[5.75rem] max-w-[5.75rem] bg-inherit transition-colors group-hover:bg-surface-container-low dark:group-hover:bg-slate-800";

const columns: DataTableColumn<InventoryItem>[] = [
  {
    cellClassName: stickySkuCellClass,
    className: stickySkuHeaderClass,
    header: "SKU",
    hideInCard: true,
    key: "sku",
    render: (item) => <InventorySkuCell sku={item.sku} />,
  },
  {
    cellClassName: "min-w-[8rem] max-w-[16rem] font-medium",
    header: "Producto",
    key: "product",
    render: (item) => (
      <span
        className="line-clamp-2 min-w-0 text-sm leading-snug text-foreground"
        title={item.name}
      >
        {item.name}
      </span>
    ),
  },
  {
    cellClassName: "text-on-surface-variant",
    header: "Categoria",
    key: "category",
    render: (item) => item.category?.name ?? "Sin categoria",
    visibility: "md",
  },
  {
    align: "right",
    cellClassName: "font-medium tabular-nums",
    header: "Stock actual",
    key: "currentStock",
    render: (item) => (
      <span className={cn(item.currentStock === 0 && "text-destructive")}>
        {item.currentStock}
      </span>
    ),
  },
  {
    align: "right",
    cellClassName: "tabular-nums text-on-surface-variant",
    header: "Stock minimo",
    key: "minStock",
    render: (item) => item.minStock,
    visibility: "md",
  },
  {
    align: "center",
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

export function InventoryListPage() {
  const { can } = usePermission();

  const [draftFilters, setDraftFilters] = useState<InventorySidebarFilters>(
    defaultInventorySidebarFilters,
  );
  const [appliedFilters, setAppliedFilters] = useState<
    Pick<InventoryFilters, "categoryId" | "search" | "stockStatus">
  >({});
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const { limit, setLimit, setSkip, skip } = usePaginationState([
    appliedFilters.categoryId,
    appliedFilters.search,
    appliedFilters.stockStatus,
  ]);

  const inventoryQuery = useInventory({
    ...appliedFilters,
    limit,
    skip,
  });
  const categories = useCategories();
  const inventory = getPaginatedItems(inventoryQuery.data);
  const categoryOptions = getPaginatedItems(categories.data);
  const totalProducts = inventoryQuery.data?.total ?? 0;

  const rowActions = useMemo(
    () =>
      function inventoryRowActions(item: InventoryItem): ActionMenuItem[] {
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

  function applyFilters() {
    setAppliedFilters(sidebarFiltersToQuery(draftFilters));
    setSkip(0);
    setMobileFiltersOpen(false);
  }

  function clearFilters() {
    setDraftFilters(defaultInventorySidebarFilters);
    setAppliedFilters({});
    setSkip(0);
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EntityListPage
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InventoryExportActions exportFilters={appliedFilters} />
            <Can permission="inventory.manage">
              <div className="flex flex-wrap items-center gap-2">
                <InventoryAdjustmentModal />
                <Button asChild size="sm" variant="outline">
                  <Link href="/inventory/movements">Ver todos los movimientos</Link>
                </Button>
              </div>
            </Can>
          </div>
        }
        description="Consulta existencias, alertas de stock bajo y accede al kardex. El catalogo y precios se gestionan en Productos."
        layout="sections"
        title="Inventario"
      >
        <InventoryContentGrid
          aside={
            <InventoryFiltersSidebar
              categories={categoryOptions}
              filters={draftFilters}
              onApply={applyFilters}
              onChange={setDraftFilters}
              onClear={clearFilters}
            />
          }
        >
          <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
            <div className="flex items-center justify-between border-b border-border bg-surface-container-low px-4 py-3 lg:hidden dark:border-slate-800">
              <span className="text-sm font-medium text-foreground">
                {totalProducts} referencia{totalProducts === 1 ? "" : "s"} con stock
              </span>
              <Button
                onClick={() => setMobileFiltersOpen(true)}
                size="sm"
                variant="outline"
              >
                <Filter aria-hidden className="size-4" />
                Filtros
              </Button>
            </div>

            <DataTable
              actions={rowActions}
              cardSubtitle={(item) => (
                <span className="inline-flex items-center gap-2">
                  <InventorySkuCell sku={item.sku} />
                  <span>
                    {item.currentStock} uds · min {item.minStock}
                  </span>
                </span>
              )}
              cardTitle={(item) => item.name}
              columns={columns}
              data={inventory}
              embedded
              variant="stitch"
              emptyState={
                <EmptyState
                  description="Ajusta los filtros o registra un movimiento de inventario."
                  title="No hay referencias para mostrar"
                />
              }
              error={inventoryQuery.error}
              getRowId={(item) => item.id}
              isFetching={inventoryQuery.isFetching}
              isLoading={inventoryQuery.isLoading}
              onRetry={() => void inventoryQuery.refetch()}
            />

            <div className="border-t border-border bg-surface-container-lowest px-4 py-4 dark:border-slate-800">
              <ResponsivePagination
                isDisabled={inventoryQuery.isFetching}
                limit={limit}
                onLimitChange={setLimit}
                onSkipChange={setSkip}
                skip={inventoryQuery.data?.skip ?? skip}
                total={totalProducts}
                variant="embedded"
              />
            </div>
          </div>
        </InventoryContentGrid>

        <Modal
          description={
            isMockDataSource()
              ? "Filtros de existencias conectados a la API mock."
              : "Filtra existencias por categoria, busqueda y estado de stock."
          }
          onOpenChange={setMobileFiltersOpen}
          open={mobileFiltersOpen}
          title="Filtros"
        >
          <InventoryFiltersSidebar
            categories={categoryOptions}
            className="border-0 p-0 shadow-none"
            filters={draftFilters}
            onApply={applyFilters}
            onChange={setDraftFilters}
            onClear={clearFilters}
          />
        </Modal>
      </EntityListPage>
    </div>
  );
}
