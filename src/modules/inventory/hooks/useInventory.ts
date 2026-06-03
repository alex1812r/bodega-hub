"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ProductMock,
  StockMovementMock,
  StockMovementType,
} from "@/shared/mocks/erp-data";

export type InventoryFilters = PaginationParams & {
  lowStock?: boolean;
  search?: string;
};

export type InventoryMovementFilters = PaginationParams & {
  productId?: string;
};

export type InventoryItem = ProductMock;

export type InventoryMovement = StockMovementMock & {
  product?: ProductMock;
};

export type InventoryAdjustmentType = Extract<
  StockMovementType,
  | "ajuste_entrada"
  | "ajuste_salida"
  | "devolucion_cliente"
  | "devolucion_proveedor"
  | "inventario_inicial"
>;

export type InventoryAdjustmentInput = {
  productId: string;
  quantityDelta: number;
  reason?: string;
  type?: InventoryAdjustmentType;
};

export const inventoryQueryKeys = {
  all: ["inventory"] as const,
  adjustments: () => [...inventoryQueryKeys.all, "adjustments"] as const,
  list: (filters: InventoryFilters = {}) =>
    [...inventoryQueryKeys.all, "list", filters] as const,
  movements: (filters: InventoryMovementFilters = {}) =>
    [...inventoryQueryKeys.all, "movements", filters] as const,
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
