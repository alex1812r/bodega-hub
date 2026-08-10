"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  CategoryMock,
  ProductMock,
  ProductPackConversionSummary,
  StockMovementMock,
  StockMovementType,
} from "@/shared/mocks/erp-data";

import type { InventoryAdjustmentType } from "../inventory-movements/utils/movementTypeLabels";

export type InventoryFilters = PaginationParams & {
  categoryId?: string;
  lowStock?: boolean;
  maxPriceRef?: number;
  minPriceRef?: number;
  search?: string;
  stockStatus?: string;
};

export type InventoryMovementFilters = PaginationParams & {
  from?: string;
  productId?: string;
  to?: string;
  type?: StockMovementType;
};

export type InventoryItem = ProductMock & {
  category?: CategoryMock;
};

export type InventoryMovement = StockMovementMock & {
  product?: ProductMock;
};

export type { InventoryAdjustmentType };

export type InventoryAdjustmentInput = {
  productId: string;
  quantityDelta: number;
  reason?: string;
  type?: InventoryAdjustmentType;
};

export type PackConversionListItem = ProductPackConversionSummary & {
  packProduct: ProductPackConversionSummary["linkedProduct"];
};

export type ConvertPackToUnitsInput = {
  packProductId: string;
  packQuantity: number;
  reason?: string;
};

export type ConvertPackToUnitsResult = {
  conversionId: string;
  packMovement: StockMovementMock;
  packQuantity: number;
  unitCostRef: number;
  unitMovement: StockMovementMock;
  unitQuantity: number;
  unitsPerPack: number;
};

export const inventoryQueryKeys = {
  all: ["inventory"] as const,
  adjustments: () => [...inventoryQueryKeys.all, "adjustments"] as const,
  list: (filters: InventoryFilters = {}) =>
    [...inventoryQueryKeys.all, "list", filters] as const,
  movements: (filters: InventoryMovementFilters = {}) =>
    [...inventoryQueryKeys.all, "movements", filters] as const,
  packConversions: () => [...inventoryQueryKeys.all, "pack-conversions"] as const,
  stockCard: (filters: InventoryMovementFilters = {}) =>
    [...inventoryQueryKeys.all, "stock-card", filters] as const,
};

export function useInventory(filters: InventoryFilters = {}) {
  return useQuery({
    queryKey: inventoryQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<InventoryItem>>("/api/inventory", {
        query: filters,
      }),
  });
}

export function useInventoryMovements(
  filters: InventoryMovementFilters = {},
) {
  return useQuery({
    queryKey: inventoryQueryKeys.movements(filters),
    queryFn: () =>
      apiFetch<PaginatedList<InventoryMovement>>("/api/inventory/movements", {
        query: filters,
      }),
  });
}

export function useStockCard(filters: InventoryMovementFilters = {}) {
  return useQuery({
    enabled: Boolean(filters.productId),
    queryKey: inventoryQueryKeys.stockCard(filters),
    queryFn: () =>
      apiFetch<PaginatedList<InventoryMovement>>("/api/inventory/stock-card", {
        query: filters,
      }),
  });
}

export function useAdjustInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InventoryAdjustmentInput) =>
      apiFetch<InventoryMovement>("/api/inventory/adjustments", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.all });
    },
  });
}

export function usePackConversions() {
  return useQuery({
    queryKey: inventoryQueryKeys.packConversions(),
    queryFn: () => apiFetch<PackConversionListItem[]>("/api/inventory/pack-conversions"),
  });
}

export function useConvertPackToUnits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ConvertPackToUnitsInput) =>
      apiFetch<ConvertPackToUnitsResult>("/api/inventory/conversions", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
