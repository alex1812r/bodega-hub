"use client";

import { Package, Plus, Search } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/auth/Can";
import { usePermission } from "@/shared/auth/usePermission";
import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { ResponsivePagination, usePaginationState, useSortState } from "@/shared/components/Pagination";
import { formControlClassName } from "@/shared/styles/form-controls";
import { getPaginatedItems } from "@/lib/api/pagination";
import { InventorySkuCell } from "@/modules/inventory/inventory-list/components/InventorySkuCell";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";

import { useSupplierProducts } from "../../hooks/useSupplierProducts";
import { EditSupplierProductModal } from "../../components/supplier-products/EditSupplierProductModal";
import { LinkSupplierProductModal } from "../../components/supplier-products/LinkSupplierProductModal";
import { RegisterSupplierPriceModal } from "../../components/supplier-products/RegisterSupplierPriceModal";
import { SupplierProductOriginChip } from "../../components/supplier-products/SupplierProductOriginChip";
import { SupplierProductPriceHistoryModal } from "../../components/supplier-products/SupplierProductPriceHistoryModal";
import { SupplierProductStatusBadge } from "../../components/supplier-products/SupplierProductStatusBadge";
import { UnlinkSupplierProductConfirmModal } from "../../components/supplier-products/UnlinkSupplierProductConfirmModal";
import {
  formatSupplierProductPackUnitsSummary,
  getSupplierProductPackCostRef,
  ManageSupplierProductPackUnitsModal,
} from "../../components/supplier-products/ManageSupplierProductPackUnitsModal";

import type { SupplierProduct } from "../../types/supplierProducts";

type ContactSupplierProductsTabProps = {
  supplierId: string;
  supplierName?: string;
};

type ActiveModal = "edit" | "history" | "packUnits" | "register" | "unlink" | null;

const skuHeaderClass = "w-[5.75rem] max-w-[5.75rem]";
const skuCellClass = "min-w-0 w-[5.75rem] max-w-[5.75rem] overflow-hidden";

export function ContactSupplierProductsTab({
  supplierId,
  supplierName,
}: ContactSupplierProductsTabProps) {
  const { can } = usePermission();
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const searchTerm = search.trim();
  const hasSearch = searchTerm.length > 0;
  const { handleSort, sortBy, sortOrder } = useSortState({
    defaultSortBy: "updatedAt",
    defaultSortOrder: "desc",
  });
  const pagination = usePaginationState([searchTerm, activeOnly, sortBy, sortOrder], 10);
  const [selected, setSelected] = useState<SupplierProduct | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  const query = useSupplierProducts(supplierId, {
    activeOnly,
    limit: pagination.limit,
    search: searchTerm || undefined,
    skip: pagination.skip,
    sortBy,
    sortOrder,
  });

  const rows = getPaginatedItems(query.data);
  const total = query.data?.total ?? 0;

  const columns: DataTableColumn<SupplierProduct>[] = [
    {
      header: "Producto",
      key: "product",
      render: (row) => row.product?.name ?? row.productId,
      sortable: true,
    },
    {
      cellClassName: skuCellClass,
      className: skuHeaderClass,
      header: "SKU interno",
      key: "sku",
      render: (row) =>
        row.product?.sku ? <InventorySkuCell sku={row.product.sku} /> : "—",
      sortable: true,
    },
    {
      cellClassName: skuCellClass,
      className: skuHeaderClass,
      header: "SKU proveedor",
      key: "supplierSku",
      render: (row) =>
        row.supplierSku ? <InventorySkuCell sku={row.supplierSku} /> : "—",
      sortable: true,
    },
    {
      align: "right",
      header: "Costo unit. (REF)",
      key: "lastCostRef",
      render: (row) => (
        <span className="font-mono tabular-nums">{formatRefUsd(row.lastCostRef ?? 0)}</span>
      ),
      sortable: true,
    },
    {
      align: "right",
      header: "Precio empaque (REF)",
      key: "packCostRef",
      render: (row) => {
        const packCostRef = getSupplierProductPackCostRef(
          row.lastCostRef,
          row.packUnits,
          row.defaultPackUnit,
          row.lastPackCostRef,
        );

        return (
          <span className="font-mono tabular-nums">
            {packCostRef == null ? "—" : formatRefUsd(packCostRef)}
          </span>
        );
      },
      sortable: true,
    },
    {
      header: "Empaques",
      key: "packUnits",
      render: (row) => (
        <span className="text-sm text-on-surface-variant">
          {formatSupplierProductPackUnitsSummary(row.packUnits)}
        </span>
      ),
    },
    {
      header: "Última actualización",
      key: "updatedAt",
      render: (row) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm">{row.updatedAt ? formatDateTimeShort(row.updatedAt) : "—"}</span>
          <SupplierProductOriginChip origin={row.lastPriceOrigin} />
        </div>
      ),
      sortable: true,
    },
    {
      header: "Estado",
      key: "isActive",
      render: (row) => <SupplierProductStatusBadge isActive={row.isActive} />,
      sortable: true,
    },
  ];

  function openModal(modal: ActiveModal, row: SupplierProduct) {
    setSelected(row);
    setActiveModal(modal);
  }

  function buildActions(row: SupplierProduct): ActionMenuItem[] {
    if (!can("products.manage") || row.isActive === false) {
      return can("products.view")
        ? [
            {
              label: "Ver historial",
              onSelect: () => openModal("history", row),
            },
          ]
        : [];
    }

    return [
      { label: "Registrar precio", onSelect: () => openModal("register", row) },
      { label: "Gestionar empaques", onSelect: () => openModal("packUnits", row) },
      { label: "Ver historial", onSelect: () => openModal("history", row) },
      { label: "Editar", onSelect: () => openModal("edit", row) },
      {
        label: "Desvincular",
        onSelect: () => openModal("unlink", row),
        variant: "danger",
      },
    ];
  }

  const emptyState = (
    <EmptyState
      action={
        can("products.manage") && !hasSearch ? (
          <Can permission="products.manage">
            <LinkSupplierProductModal
              supplierId={supplierId}
              supplierName={supplierName}
              trigger={
                <Button className="gap-2" size="sm" type="button">
                  <Plus aria-hidden className="size-5" />
                  Vincular producto
                </Button>
              }
            />
          </Can>
        ) : undefined
      }
      description={
        hasSearch
          ? "Prueba con otro nombre o SKU, o desactiva el filtro Solo activos."
          : can("products.manage")
            ? "Vincula productos del catálogo para registrar cotizaciones sin crear una compra."
            : "No hay productos para mostrar con los filtros actuales."
      }
      icon={<Package aria-hidden className="h-5 w-5" />}
      title={hasSearch ? "Sin resultados" : "No hay productos vinculados"}
    />
  );

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Productos que maneja</h3>
          <p className="text-sm text-on-surface-variant">
            Catálogo de productos y precios de cotización de este proveedor
          </p>
        </div>
        <Can permission="products.manage">
          <LinkSupplierProductModal
            supplierId={supplierId}
            supplierName={supplierName}
            trigger={
              <Button className="w-full gap-2 sm:w-auto" size="sm" type="button">
                <Plus aria-hidden className="size-5" />
                Vincular producto
              </Button>
            }
          />
        </Can>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 sm:max-w-sm sm:flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 z-10 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className={cn(formControlClassName, "w-full pl-10")}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, SKU o codigo de barras..."
            type="search"
            value={search}
          />
        </div>
        <button
          className={cn(
            "inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            activeOnly
              ? "border-primary bg-primary/10 text-primary"
              : "border-outline-variant text-on-surface-variant",
          )}
          onClick={() => setActiveOnly((current) => !current)}
          type="button"
        >
          Solo activos
        </button>
      </div>

      <DataTable
        actions={can("products.manage") || can("products.view") ? buildActions : undefined}
        columns={columns}
        data={rows}
        embedded
        emptyState={emptyState}
        error={query.error}
        getRowId={(row) => row.id}
        isFetching={query.isFetching}
        isLoading={query.isLoading}
        loadingRows={5}
        onRetry={() => void query.refetch()}
        onSortChange={handleSort}
        sortBy={sortBy}
        sortOrder={sortOrder}
        variant="stitch-purchases"
      />

      {!query.isLoading && total > 0 ? (
        <div className="border-t border-outline-variant px-4 py-3">
          <ResponsivePagination
            entityLabel="productos"
            isDisabled={query.isFetching}
            limit={pagination.limit}
            onLimitChange={pagination.setLimit}
            onSkipChange={pagination.setSkip}
            skip={query.data?.skip ?? pagination.skip}
            total={total}
            variant="stitch"
          />
        </div>
      ) : null}

      <RegisterSupplierPriceModal
        onOpenChange={(open: boolean) => !open && setActiveModal(null)}
        open={activeModal === "register"}
        supplierProduct={selected}
      />
      <SupplierProductPriceHistoryModal
        onOpenChange={(open: boolean) => !open && setActiveModal(null)}
        onRegisterPrice={
          can("products.manage") && selected?.isActive !== false
            ? () => setActiveModal("register")
            : undefined
        }
        open={activeModal === "history"}
        supplierProduct={selected}
      />
      <EditSupplierProductModal
        onOpenChange={(open: boolean) => !open && setActiveModal(null)}
        open={activeModal === "edit"}
        supplierProduct={selected}
      />
      <ManageSupplierProductPackUnitsModal
        onOpenChange={(open: boolean) => !open && setActiveModal(null)}
        open={activeModal === "packUnits"}
        supplierProduct={selected}
      />
      <UnlinkSupplierProductConfirmModal
        onOpenChange={(open: boolean) => !open && setActiveModal(null)}
        open={activeModal === "unlink"}
        supplierProduct={selected}
      />
    </div>
  );
}
