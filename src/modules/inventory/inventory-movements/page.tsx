"use client";

import { SquarePen } from "lucide-react";
import { useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";

import {
  useInventory,
  useInventoryMovements,
  type InventoryMovement,
  type InventoryMovementFilters,
} from "../hooks/useInventory";
import { InventoryAdjustmentModal } from "./components/InventoryAdjustmentModal";
import { InventoryMovementDetailModal } from "./components/InventoryMovementDetailModal";
import { InventoryMovementsExportActions } from "./components/InventoryMovementsExportActions";
import { InventoryMovementsListFilters } from "./components/InventoryMovementsListFilters";
import { InventoryMovementsPageHeader } from "./components/InventoryMovementsPageHeader";
import {
  InventoryMovementsTable,
  type InventoryMovementRow,
} from "./components/InventoryMovementsTable";

type InventoryMovementsPageProps = {
  initialFilters?: InventoryMovementFilters;
};

function toMovementRow(movement: InventoryMovement): InventoryMovementRow {
  return {
    createdAt: movement.createdAt,
    id: movement.id,
    product: movement.product?.name ?? movement.productId,
    productSku: movement.product?.sku,
    purchaseId: movement.purchaseId,
    quantity: movement.quantityDelta,
    reason: movement.reason,
    saleId: movement.saleId,
    stockAfter: movement.stockAfter,
    type: movement.type,
  };
}

export function InventoryMovementsPage({
  initialFilters = {},
}: InventoryMovementsPageProps) {
  const [filters, setFilters] = useState<InventoryMovementFilters>(initialFilters);
  const [selectedMovement, setSelectedMovement] = useState<InventoryMovement | null>(null);
  const { limit, setLimit, setSkip, skip } = usePaginationState([
    filters.from,
    filters.productId,
    filters.to,
    filters.type,
  ]);
  const productsQuery = useInventory({ limit: 100 });
  const movementsQuery = useInventoryMovements({ ...filters, limit, skip });
  const productOptions = useMemo(
    () =>
      getPaginatedItems(productsQuery.data).map((product) => ({
        label: `${product.name} (${product.sku})`,
        value: product.id,
      })),
    [productsQuery.data],
  );
  const movements = getPaginatedItems(movementsQuery.data);
  const movementRows = useMemo(() => movements.map(toMovementRow), [movements]);
  const movementsById = useMemo(
    () => new Map(movements.map((movement) => [movement.id, movement])),
    [movements],
  );
  const totalMovements = movementsQuery.data?.total ?? 0;

  function handleFilterChange(patch: Partial<InventoryMovementFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSkip(0);
  }

  const adjustStockTrigger = (
    <Button className="w-full gap-2 shadow-sm sm:w-auto" size="sm">
      <SquarePen aria-hidden className="size-5" />
      Ajustar stock
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <InventoryMovementsPageHeader
        actions={
          <>
            <InventoryMovementsExportActions
              exportFilters={{
                from: filters.from,
                productId: filters.productId,
                to: filters.to,
                type: filters.type,
              }}
            />
            <Can permission="inventory.manage">
              <InventoryAdjustmentModal
                defaultProductId={filters.productId}
                trigger={adjustStockTrigger}
              />
            </Can>
          </>
        }
      />

      <InventoryMovementsListFilters
        filters={filters}
        onChange={handleFilterChange}
        productOptions={productOptions}
        productsError={productsQuery.error}
        productsLoading={productsQuery.isLoading}
      />

      <div className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
        <InventoryMovementsTable
          actions={(row) => [
            {
              label: "Ver detalle",
              onSelect: () => setSelectedMovement(movementsById.get(row.id) ?? null),
            },
          ]}
          error={movementsQuery.error}
          isFetching={movementsQuery.isFetching}
          isLoading={movementsQuery.isLoading}
          onRetry={() => void movementsQuery.refetch()}
          rows={movementRows}
        />

        <div className="border-t border-border bg-surface px-4 py-3 dark:border-slate-800 sm:px-6">
          <ResponsivePagination
            entityLabel="movimientos"
            isDisabled={movementsQuery.isFetching}
            limit={limit}
            onLimitChange={setLimit}
            onSkipChange={setSkip}
            skip={movementsQuery.data?.skip ?? skip}
            total={totalMovements}
            variant="stitch"
          />
        </div>
      </div>

      <InventoryMovementDetailModal
        movement={selectedMovement}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedMovement(null);
          }
        }}
        open={selectedMovement != null}
      />
    </div>
  );
}
