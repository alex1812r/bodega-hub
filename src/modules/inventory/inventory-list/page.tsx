"use client";

import { useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Badge } from "@/shared/components/Badge";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";

import { useInventory, type InventoryItem } from "../hooks/useInventory";
import { InventoryAdjustmentModal } from "../inventory-movements/components/InventoryAdjustmentModal";

type InventoryStatus = "agotado" | "bajo" | "ok";

const statusVariant = {
  agotado: "danger",
  bajo: "warning",
  ok: "success",
} as const;

function getInventoryStatus(item: InventoryItem): InventoryStatus {
  if (item.currentStock === 0) {
    return "agotado";
  }

  if (item.currentStock <= item.minStock) {
    return "bajo";
  }

  return "ok";
}

const columns: DataTableColumn<InventoryItem>[] = [
  {
    header: "Producto",
    hideInCard: true,
    key: "product",
    render: (item) => item.name,
  },
  { header: "SKU", key: "sku", render: (item) => item.sku, visibility: "md" },
  { header: "Stock", key: "stock", render: (item) => item.currentStock },
  {
    header: "Minimo",
    key: "minimumStock",
    render: (item) => item.minStock,
    visibility: "md",
  },
  {
    header: "Estado",
    key: "status",
    render: (item) => {
      const status = getInventoryStatus(item);

      return <Badge variant={statusVariant[status]}>{status}</Badge>;
    },
  },
];

export function InventoryListPage() {
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const { limit, setLimit, setSkip, skip } = usePaginationState([search, stockFilter]);
  const inventoryQuery = useInventory({
    limit,
    lowStock: stockFilter === "low" ? true : undefined,
    search: search.trim() || undefined,
    skip,
  });
  const inventory = getPaginatedItems(inventoryQuery.data);

  return (
    <EntityListPage
      actions={<InventoryAdjustmentModal />}
      description="Listado basico de existencias para revisar stock disponible y alertas."
      title="Inventario"
    >
      <FilterPanel>
        <Input
          label="Producto o SKU"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar producto"
          value={search}
        />
        <SelectField
          label="Estado"
          onChange={(event) => setStockFilter(event.target.value)}
          options={[
            { label: "Stock bajo o agotado", value: "low" },
          ]}
          placeholder="Todos"
          value={stockFilter}
        />
      </FilterPanel>

      <DataTable
        cardSubtitle={(item) => item.sku}
        cardTitle={(item) => item.name}
        actions={() => [
          { href: "/inventory/movements", label: "Ver movimientos" },
          { href: "/inventory/movements", label: "Ajustar stock" },
        ]}
        columns={columns}
        data={inventory}
        emptyState={
          <EmptyState
            description="Ajusta los filtros o registra un nuevo movimiento de inventario."
            title="No hay productos para mostrar"
          />
        }
        error={inventoryQuery.error}
        getRowId={(item) => item.id}
        isFetching={inventoryQuery.isFetching}
        isLoading={inventoryQuery.isLoading}
        onRetry={() => void inventoryQuery.refetch()}
      />
      <ResponsivePagination
        isDisabled={inventoryQuery.isFetching}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={inventoryQuery.data?.skip ?? skip}
        total={inventoryQuery.data?.total ?? 0}
      />
    </EntityListPage>
  );
}
