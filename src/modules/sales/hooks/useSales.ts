"use client";

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { cashKeys } from "@/modules/cash/hooks/useCash";
import { productsQueryKeys } from "@/modules/products/hooks/useProducts";
import { apiFetch } from "@/shared/api/apiFetch";
import type {
  ContactMock,
  PaymentMethod,
  PaymentMock,
  ProductMock,
  SaleItemMock,
  SaleMock,
  SaleStatus,
  StockMovementType,
} from "@/shared/mocks/erp-data";

export type SalesFilters = PaginationParams & {
  customerId?: string;
  from?: string;
  search?: string;
  status?: SaleStatus | string;
  to?: string;
};

/** Desglose de billetes por moneda: `{"USD":{"1":3}}`. */
type PaymentDenominations = Partial<Record<"USD" | "VES", Record<string, number>>>;

/** Linea de cobro que viaja con la venta (mismo contrato que `POST /api/payments`, sin `saleId`). */
export type SaleCreatePaymentInput = {
  amount: number;
  bankName?: string;
  change?: {
    amount: number;
    bankName?: string;
    method?: PaymentMethod;
    phone?: string;
    referenceCode?: string;
  };
  changeDenominations?: PaymentDenominations | null;
  currency?: "USD" | "VES";
  method: PaymentMethod;
  notes?: string;
  phone?: string;
  receivedDenominations?: PaymentDenominations | null;
  referenceCode?: string;
};

export type SaleCreateInput = {
  /**
   * Clave de idempotencia (uuid) por intento de cobro. Con la misma clave el
   * servidor devuelve la venta ya registrada en vez de crear otra.
   */
  clientRequestId?: string;
  customerId: string;
  discountRef?: number;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  notes?: string;
  /**
   * Cobros registrados en la misma transaccion que la venta
   * (`create_sale_with_payments`): si uno falla no queda venta ni descuento de stock.
   */
  payments?: SaleCreatePaymentInput[];
  refRateVes?: number;
  taxRef?: number;
};

export type SaleListItem = SaleMock & {
  customer?: ContactMock;
  itemsCount: number;
};

export type SaleItemWithProduct = SaleItemMock & {
  product?: ProductMock;
};

export type SaleDetail = SaleMock & {
  customer?: ContactMock;
  items: SaleItemWithProduct[];
  payments: PaymentMock[];
};

export type SaleReturnResult = {
  sale: SaleDetail;
  stockMovements: Array<{
    createdAt: string;
    id: string;
    productId: string;
    quantityDelta: number;
    reason?: string;
    saleId: string;
    stockAfter?: number;
    type: StockMovementType;
  }>;
};

export type SaleReceipt = {
  customer?: ContactMock;
  invoiceNumber: string;
  items: SaleItemWithProduct[];
  paidVes: number;
  pendingVes: number;
  saleId: string;
  totalRef: number;
  totalVes: number;
};

export const salesQueryKeys = {
  all: ["sales"] as const,
  detail: (id: string) => [...salesQueryKeys.all, "detail", id] as const,
  list: (filters: SalesFilters = {}) =>
    [...salesQueryKeys.all, "list", filters] as const,
  receipt: (id: string) => [...salesQueryKeys.detail(id), "receipt"] as const,
};

export function useSales(filters: SalesFilters = {}) {
  return useQuery({
    queryKey: salesQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PaginatedList<SaleListItem>>("/api/sales", {
        query: filters,
      }),
  });
}

export function useSale(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: salesQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<SaleDetail>(`/api/sales/${id}`),
  });
}

export function useSaleReceipt(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: salesQueryKeys.receipt(id ?? ""),
    queryFn: () => apiFetch<SaleReceipt>(`/api/sales/${id}/receipt`),
  });
}

/**
 * Todo lo que una venta registrada deja obsoleto. Se exporta porque una venta
 * tambien puede confirmarse fuera de la mutacion: cuando la respuesta del cobro
 * se pierde y el POS la recupera consultando por `clientRequestId`.
 */
export function invalidateAfterSaleRegistered(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: salesQueryKeys.all });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  // `inventory` cubre existencias, movimientos y kardex (`inventoryQueryKeys`).
  void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  // El catalogo del POS se cachea 5 min: sin esto el cajero seguia viendo el
  // stock previo a la venta y el carrito le dejaba pedir unidades que ya no habia.
  void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
  void queryClient.invalidateQueries({ queryKey: ["contacts"] });
  void queryClient.invalidateQueries({ queryKey: ["reports"] });
  // Una venta cobrada mueve el cajón: sesión, movimientos y turnos abiertos en caché quedan
  // obsoletos y «Mi caja» los relee al montar (antes enseñaba el cajón previo a la venta y
  // prellenaba el cierre con él). Solo se MARCAN (`refetchType: "none"`): el POS tiene
  // montadas las queries de movimientos y cajas y no debe pedirlas en el camino de cobro;
  // la única que relee, la sesión, la pide él mismo después del cobro.
  void queryClient.invalidateQueries({ queryKey: cashKeys.all, refetchType: "none" });
}

export function useCreateSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SaleCreateInput) =>
      apiFetch<SaleMock>("/api/sales", {
        body: input,
        method: "POST",
      }),
    onSuccess: () => {
      invalidateAfterSaleRegistered(queryClient);
    },
    // Nunca reintentar a ciegas un cobro: si la respuesta se perdio tras el commit,
    // quien llama consulta por `clientRequestId` antes de volver a enviar (C3).
    retry: false,
  });
}

export function useCancelSale(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (saleId?: string) =>
      apiFetch<SaleDetail>(`/api/sales/${saleId ?? id}/cancel`, {
        method: "PATCH",
      }),
    onSuccess: (sale, saleId) => {
      const affectedSaleId = saleId ?? id ?? sale.id;
      queryClient.setQueryData(salesQueryKeys.detail(affectedSaleId), sale);
      void queryClient.invalidateQueries({ queryKey: salesQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // Cancelar devuelve el stock: inventario y catalogo quedan obsoletos.
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useReturnSale(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (saleId?: string) =>
      apiFetch<SaleReturnResult>(`/api/sales/${saleId ?? id}/return`, {
        method: "POST",
      }),
    onSuccess: (result, saleId) => {
      const affectedSaleId = saleId ?? id ?? result.sale.id;
      queryClient.setQueryData(salesQueryKeys.detail(affectedSaleId), result.sale);
      void queryClient.invalidateQueries({ queryKey: salesQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      // Devolver anula los pagos de la venta: los de efectivo salen del cajón del turno.
      void queryClient.invalidateQueries({ queryKey: cashKeys.all });
    },
  });
}
