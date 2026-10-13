"use client";

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
import type { InventoryOverviewItem } from "../services/inventoryOverview";
import type {
  MovementDocumentKind,
  MovementDocumentKindFilter,
} from "../utils/inventoryMovementFilters";
import {
  UNCERTAIN_STOCK_REQUEST_MESSAGE,
  describeStockRequestError,
} from "../utils/stockRequestError";

export type InventoryFilters = PaginationParams & {
  categoryId?: string;
  lowStock?: boolean;
  maxPriceRef?: number;
  minPriceRef?: number;
  /** Id exacto de un producto. */
  productId?: string;
  search?: string;
  /** Lista por comas de `ok`, `low`, `out`. */
  stockStatus?: string;
};

/**
 * Filtros de `/api/inventory/movements`. `/api/inventory/stock-card` solo
 * atiende `productId`, `type`, `from` y `to`.
 */
export type InventoryMovementFilters = PaginationParams & {
  /** Texto parcial del número de venta o de compra. */
  document?: string;
  /** `sin_documento` = ajustes y asientos históricos sin venta, compra ni conversión. */
  documentKind?: MovementDocumentKindFilter;
  /** Día de Caracas `YYYY-MM-DD`, inclusive. */
  from?: string;
  productId?: string;
  purchaseId?: string;
  saleId?: string;
  /** Día de Caracas `YYYY-MM-DD`, inclusive. */
  to?: string;
  type?: StockMovementType;
};

export type InventoryMovementDocumentKind = MovementDocumentKind;

/** Un producto con su categoría (`GET /api/products/{id}`, formularios de stock). */
export type InventoryItem = ProductMock & {
  category?: CategoryMock;
};

export type { InventoryOverviewItem };

export type InventoryMovement = StockMovementMock & {
  /**
   * Documento del movimiento (solo en `/api/inventory/movements`). `null` =
   * sin documento: la UI lo muestra como "Ajuste manual".
   */
  documentKind?: InventoryMovementDocumentKind | null;
  /** Número de la venta o compra; `null` en una conversión o sin documento. */
  documentNumber?: string | null;
  product?: ProductMock;
};

export type { InventoryAdjustmentType };

export type InventoryAdjustmentInput = {
  /**
   * Clave de idempotencia del intento (C6): el servidor no duplica el ajuste.
   * Obligatoria en la UI; sale de `useRequestAttempt`.
   */
  clientRequestId: string;
  productId: string;
  quantityDelta: number;
  reason?: string;
  type?: InventoryAdjustmentType;
};

export type PackConversionListItem = ProductPackConversionSummary & {
  packProduct: ProductPackConversionSummary["linkedProduct"];
};

export type ConvertPackToUnitsInput = {
  /**
   * Clave de idempotencia del intento (C6): el servidor no duplica la conversión.
   * Obligatoria en la UI; sale de `useRequestAttempt`.
   */
  clientRequestId: string;
  /**
   * Reparto real de la apertura de un surtido: unidades que salieron de cada
   * componente. Debe sumar `totalUnits × packQuantity`. Sin él se usa la receta.
   */
  components?: { unitProductId: string; units: number }[];
  packProductId: string;
  packQuantity: number;
  reason?: string;
};

/** Lo que recibió un componente en una apertura. */
export type ConvertPackToUnitsComponentResult = {
  /** Parte del valor del empaque asignada al componente (4 decimales). */
  allocatedValueRef: number;
  costWeight: number;
  isActive: boolean;
  movement: StockMovementMock;
  /** Costo del producto tras la apertura (promedio ponderado). */
  newCostRef: number;
  /** Costo por unidad de lo que entró en esta apertura. */
  unitCostRef: number;
  unitProductId: string;
  units: number;
};

export type ConvertPackToUnitsResult = {
  /** Una entrada por componente con unidades, por id de producto. */
  components: ConvertPackToUnitsComponentResult[];
  conversionId: string;
  packMovement: StockMovementMock;
  packQuantity: number;
  totalUnits: number;
  /** Costo medio por unidad; en un surtido, el de cada componente va en `components`. */
  unitCostRef: number;
  /** La entrada del primer componente (en un surtido, ver `components`). */
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
  product: (id: string) => [...inventoryQueryKeys.all, "product", id] as const,
  stockCard: (filters: InventoryMovementFilters = {}) =>
    [...inventoryQueryKeys.all, "stock-card", filters] as const,
};

/** Vista única de stock (`GET /api/inventory`): todos los filtros los aplica el servidor. */
export function useInventory(filters: InventoryFilters = {}, enabled = true) {
  return useQuery({
    enabled,
    queryKey: inventoryQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<InventoryOverviewItem>>("/api/inventory", {
        query: filters,
      }),
  });
}

/**
 * Un producto por id (`GET /api/products/{id}`), para precargar un formulario de
 * stock sin pedir el catálogo. Cuelga de `inventoryQueryKeys.all`: se refresca
 * con cada ajuste o conversión.
 */
export function useInventoryProduct(id: string | undefined, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(id),
    queryKey: inventoryQueryKeys.product(id ?? ""),
    queryFn: () => apiFetch<InventoryItem>(`/api/products/${id}`),
  });
}

export function useInventoryMovements(
  filters: InventoryMovementFilters = {},
  enabled = true,
) {
  return useQuery({
    enabled,
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

/** Lo que cambia con un movimiento de stock: vistas de inventario y fichas de producto. */
function invalidateStockQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.all });
  void queryClient.invalidateQueries({ queryKey: ["products"] });
}

/**
 * Tras un envío fallido: si el resultado es incierto (el criterio de
 * `describeStockRequestError`: sin respuesta, 5xx o 408) el movimiento pudo
 * registrarse, así que el stock en caché ya no es de fiar y se vuelve a pedir.
 * Un rechazo del servidor (resto de 4xx) no movió nada.
 */
function invalidateStockQueriesIfUncertain(queryClient: QueryClient, error: unknown) {
  if (describeStockRequestError(error) === UNCERTAIN_STOCK_REQUEST_MESSAGE) {
    invalidateStockQueries(queryClient);
  }
}

/**
 * Un envío que mueve stock se intenta siempre, también sin conexión. Con el
 * modo por defecto (`online`) React Query deja la mutación en pausa sin red y
 * la envía sola al volver: el movimiento saldría cuando el usuario ya no lo
 * espera. Con `always` el `fetch` falla al instante y el usuario decide si
 * reintenta (con la misma clave de idempotencia).
 */
const STOCK_MUTATION_NETWORK_MODE = "always";

export function useAdjustInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InventoryAdjustmentInput) =>
      apiFetch<InventoryMovement>("/api/inventory/adjustments", {
        body: input,
        method: "POST",
      }),
    // Sin reintento automatico: el reintento lo decide el usuario y viaja con la
    // misma clave de idempotencia.
    retry: false,
    networkMode: STOCK_MUTATION_NETWORK_MODE,
    onSuccess: () => invalidateStockQueries(queryClient),
    onError: (error) => invalidateStockQueriesIfUncertain(queryClient, error),
  });
}

/** Recetas activas de la tienda: la misma consulta para `usePackConversions` y la búsqueda de empaques. */
export const packConversionsQueryOptions = {
  queryKey: inventoryQueryKeys.packConversions(),
  queryFn: () => apiFetch<PackConversionListItem[]>("/api/inventory/pack-conversions"),
};

export function usePackConversions() {
  return useQuery(packConversionsQueryOptions);
}

export function useConvertPackToUnits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ConvertPackToUnitsInput) =>
      apiFetch<ConvertPackToUnitsResult>("/api/inventory/conversions", {
        body: input,
        method: "POST",
      }),
    retry: false,
    networkMode: STOCK_MUTATION_NETWORK_MODE,
    onSuccess: () => invalidateStockQueries(queryClient),
    onError: (error) => invalidateStockQueriesIfUncertain(queryClient, error),
  });
}
