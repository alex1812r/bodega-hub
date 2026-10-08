"use client";

import { Lock, SquarePen } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ClientApiError } from "@/shared/api/apiFetch";
import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
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
import { RETURN_TO_PARAM, isSafeInternalPath } from "@/shared/utils/returnTo";

import { useInventoryMovements, type InventoryMovement } from "../hooks/useInventory";
import { InventoryAdjustmentModal } from "./components/InventoryAdjustmentModal";
import { InventoryMovementDetailModal } from "./components/InventoryMovementDetailModal";
import { InventoryMovementsExportActions } from "./components/InventoryMovementsExportActions";
import {
  InventoryMovementsListFilters,
  MOVEMENTS_RANGE_INVERTED_MESSAGE,
} from "./components/InventoryMovementsListFilters";
import { InventoryMovementsPageHeader } from "./components/InventoryMovementsPageHeader";
import {
  InventoryMovementsTable,
  type InventoryMovementRow,
} from "./components/InventoryMovementsTable";
import { InventoryPackConversionModal } from "./components/InventoryPackConversionModal";
import {
  INVENTORY_MOVEMENTS_NO_FILTERS,
  INVENTORY_MOVEMENTS_TEXT_FIELDS,
  hasInventoryMovementsFilters,
  inventoryMovementsSchema,
  isMovementsRangeInverted,
  toMovementFilters,
} from "./inventoryMovementsParams";

function toMovementRow(movement: InventoryMovement): InventoryMovementRow {
  return {
    conversionId: movement.conversionId,
    createdAt: movement.createdAt,
    documentKind: movement.documentKind,
    documentNumber: movement.documentNumber,
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

function InventoryMovements() {
  const list = useUrlListState(inventoryMovementsSchema, {
    textFields: INVENTORY_MOVEMENTS_TEXT_FIELDS,
  });
  const { href: listHref, setState: setListState, state } = list;
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  const hasReturnTo = isSafeInternalPath(useSearchParams().get(RETURN_TO_PARAM));
  const [selectedMovement, setSelectedMovement] = useState<InventoryMovement | null>(null);

  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedDocument = useDebouncedValue(state.document, URL_LIST_DEBOUNCE_MS);
  // Al limpiar el campo no se espera: no se consulta otra vez con el texto anterior.
  const document = state.document.trim() === "" ? "" : debouncedDocument;
  const { documentKind, from, productId, to, type } = state;
  const filters = useMemo(
    () => toMovementFilters({ documentKind, from, productId, to, type }, document),
    [document, documentKind, from, productId, to, type],
  );
  const isRangeInverted = isMovementsRangeInverted(state);
  const hasFilters = hasInventoryMovementsFilters(state);

  const movementsQuery = useInventoryMovements({ ...filters, limit, skip }, !isRangeInverted);
  const movementsData = isRangeInverted ? undefined : movementsQuery.data;
  const movements = getPaginatedItems(movementsData);
  const movementRows = useMemo(() => movements.map(toMovementRow), [movements]);
  const movementsById = useMemo(
    () => new Map(movements.map((movement) => [movement.id, movement])),
    [movements],
  );
  const totalMovements = movementsData?.total ?? 0;
  const isForbidden =
    movementsQuery.error instanceof ClientApiError && movementsQuery.error.status === 403;

  const lastPage = getTotalPages(totalMovements, limit);
  // `?page=9999`: el servidor responde lista vacía con el total real; la página pedida no existe.
  const isPagePastTheEnd = movementsData !== undefined && state.page > lastPage;

  // La lista acota la página contra su total y corrige la URL (regla 15).
  useEffect(() => {
    if (isPagePastTheEnd) {
      setListState({ page: lastPage });
    }
  }, [isPagePastTheEnd, lastPage, setListState]);

  function clearFilters() {
    setListState(INVENTORY_MOVEMENTS_NO_FILTERS);
  }

  const adjustStockTrigger = (
    <Button className="w-full gap-2 shadow-sm sm:w-auto" size="sm">
      <SquarePen aria-hidden className="size-5" />
      Ajustar stock
    </Button>
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <InventoryMovementsPageHeader
        actions={
          isForbidden ? null : (
            <>
              <InventoryMovementsExportActions
                disabledReason={isRangeInverted ? MOVEMENTS_RANGE_INVERTED_MESSAGE : undefined}
                exportFilters={filters}
              />
              <Can permission="inventory.manage">
                <InventoryPackConversionModal defaultPackProductId={filters.productId} />
                <InventoryAdjustmentModal
                  defaultProductId={filters.productId}
                  trigger={adjustStockTrigger}
                />
              </Can>
            </>
          )
        }
        hasReturnTo={hasReturnTo}
      />

      {isForbidden ? (
        <div className="rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
          <EmptyState
            description="Pide al administrador de la tienda el permiso para consultar el inventario."
            icon={<Lock aria-hidden className="h-5 w-5" />}
            title="No tienes permiso para ver los movimientos de inventario"
          />
        </div>
      ) : (
        <>
          <InventoryMovementsListFilters
            filters={state}
            hasFilters={hasFilters}
            isRangeInverted={isRangeInverted}
            onChange={setListState}
            onClear={clearFilters}
          />

          <div className="flex w-full min-w-0 flex-col md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-surface-container-lowest md:shadow-sm dark:md:border-slate-800">
            <InventoryMovementsTable
              actions={(row) => [
                {
                  label: "Ver detalle",
                  onSelect: () => setSelectedMovement(movementsById.get(row.id) ?? null),
                },
              ]}
              emptyKind={isRangeInverted ? "invalid-range" : hasFilters ? "filtered" : "none"}
              error={isRangeInverted ? null : movementsQuery.error}
              isFetching={movementsQuery.isFetching}
              isLoading={!isRangeInverted && (movementsQuery.isLoading || isPagePastTheEnd)}
              onClearFilters={clearFilters}
              onRetry={() => void movementsQuery.refetch()}
              returnTo={listHref}
              rows={isPagePastTheEnd ? [] : movementRows}
            />

            <div className="mt-3 rounded-xl border border-border bg-surface-container-lowest px-4 py-3 shadow-sm dark:border-slate-800 md:mt-0 md:rounded-none md:border-0 md:border-t md:shadow-none dark:md:border-slate-800">
              <ResponsivePagination
                entityLabel="movimientos"
                isDisabled={movementsQuery.isFetching || isRangeInverted}
                limit={limit}
                onLimitChange={setLimit}
                onSkipChange={setSkip}
                skip={movementsData?.skip ?? skip}
                total={totalMovements}
                variant="stitch"
              />
            </div>
          </div>
        </>
      )}

      <InventoryMovementDetailModal
        movement={selectedMovement}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedMovement(null);
          }
        }}
        open={selectedMovement != null}
        returnTo={listHref}
      />
    </div>
  );
}

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const InventoryMovementsPage = withUrlListBoundary(InventoryMovements);
