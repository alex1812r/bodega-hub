"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PaginatedList, PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import { inventoryQueryKeys } from "@/modules/inventory/hooks/useInventory";
import {
  useSupplierProducts as useContactSupplierProducts,
  type SupplierProductsFilters,
} from "@/modules/contacts/hooks/useSupplierProducts";
import type { SupplierProduct } from "@/modules/contacts/types/supplierProducts";
import type { PurchaseItemInput } from "@/modules/purchases/schemas/purchaseItem.schema";
import type {
  PurchaseItemDisassemble,
  ReceivePurchaseOptions,
} from "@/modules/purchases/services/purchaseDisassemble";
import type { PaymentFormPayload } from "@/shared/payments/PaymentFormFields";
import type {
  ContactMock,
  PaymentMock,
  ProductMock,
  PurchaseItemMock,
  PurchaseMock,
  PurchaseStatus,
} from "@/shared/mocks/erp-data";

export type PurchasesFilters = PaginationParams & {
  /** `YYYY-MM-DD`, día operativo Caracas. */
  from?: string;
  /** `"1"`: solo compras vigentes (pedidas o recibidas) con saldo por pagar. */
  pendingBalance?: "1";
  search?: string;
  status?: PurchaseStatus | string;
  supplierId?: string;
  to?: string;
};

export type PurchaseInput = {
  /** Clave de idempotencia del intento: el servidor no duplica la compra (C6). */
  clientRequestId?: string;
  discountRef: number;
  discountVes: number;
  items: PurchaseItemInput[];
  notes?: string;
  refRateVes: number;
  status?: PurchaseStatus;
  subtotalRef: number;
  subtotalVes: number;
  supplierId: string;
  taxRef: number;
  taxVes: number;
  exchangeRateId?: string;
  /**
   * Pago inicial opcional: los campos de `POST /api/payments` sin el documento, con
   * su propia clave de idempotencia. Se registra justo después de crear la compra.
   */
  initialPayment?: PaymentFormPayload & { clientRequestId: string };
  purchaseNumber?: string;
};

/**
 * Resultado del pago inicial. `failed`: la compra SÍ se creó y quedó pendiente de
 * pago; `message` es el motivo que dio el servidor.
 */
export type PurchaseInitialPaymentResult =
  | { paymentId: string; status: "registered" }
  | { message: string; status: "failed" };

/** La compra creada; lleva `initialPayment` solo si se envió un pago inicial. */
export type CreatedPurchase = PurchaseMock & {
  initialPayment?: PurchaseInitialPaymentResult;
};

export type PurchaseListRow = PurchaseMock & {
  itemsCount: number;
  supplier?: ContactMock;
};

/** Con `pendingBalance=1` el listado trae la suma del saldo de todo el filtro. */
export type PurchasesList = PaginatedList<PurchaseListRow> & {
  pendingBalanceRef?: number;
};

export type PurchaseDetails = PurchaseMock & {
  /** Cada línea lleva lo del desarme al recibir (COM-14): id, marca, desarmada y receta. */
  items: Array<PurchaseItemMock & PurchaseItemDisassemble & { product?: ProductMock }>;
  notes?: string;
  payments: Array<PaymentMock & { contact?: ContactMock }>;
  supplier?: ContactMock;
  updatedAt?: string;
};

export type SupplierProductWithProduct = SupplierProduct & {
  product?: ProductMock;
};

export type PurchaseReturnResult = {
  purchase: PurchaseDetails;
  stockMovements: Array<{
    createdAt: string;
    id: string;
    productId: string;
    purchaseId: string;
    quantityDelta: number;
    reason: string;
    type: string;
  }>;
};

export const purchasesQueryKeys = {
  all: ["purchases"] as const,
  detail: (id: string) => [...purchasesQueryKeys.all, "detail", id] as const,
  list: (filters: PurchasesFilters = {}) =>
    [...purchasesQueryKeys.all, "list", filters] as const,
  supplierProducts: (supplierId: string) =>
    [...purchasesQueryKeys.all, "supplier-products", supplierId] as const,
};

export function usePurchases(filters: PurchasesFilters = {}) {
  return useQuery({
    queryKey: purchasesQueryKeys.list(filters),
    queryFn: () =>
      apiFetch<PurchasesList>("/api/purchases", {
        query: filters,
      }),
  });
}

export function usePurchase(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: purchasesQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<PurchaseDetails>(`/api/purchases/${id}`),
  });
}

export function useSupplierProducts(
  supplierId?: string,
  filters: Omit<SupplierProductsFilters, "supplierId"> = {},
) {
  return useContactSupplierProducts(supplierId, filters);
}

export function useCreatePurchase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PurchaseInput) =>
      apiFetch<CreatedPurchase>("/api/purchases", {
        body: input,
        method: "POST",
      }),
    // Sin reintento automatico: el reintento lo decide el usuario y viaja con la
    // misma clave de idempotencia.
    retry: false,
    onSuccess: (purchase) => {
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
      // Una compra recibida mueve stock y costo: productos, inventario y movimientos.
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.all });

      // Con pago inicial, registrado o de resultado dudoso: la lista de pagos cambió.
      if (purchase.initialPayment) {
        void queryClient.invalidateQueries({ queryKey: ["payments"] });
      }
    },
  });
}

export function useCancelPurchase(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (purchaseId?: string) => {
      const targetId = purchaseId ?? id;

      if (!targetId) {
        throw new Error("Debes indicar la compra a cancelar.");
      }

      return apiFetch<PurchaseDetails>(`/api/purchases/${targetId}/cancel`, {
        method: "PATCH",
      });
    },
    onSuccess: (purchase) => {
      queryClient.setQueryData(purchasesQueryKeys.detail(purchase.id), purchase);
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
    },
  });
}

export function useReturnPurchase(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (purchaseId?: string) => {
      const targetId = purchaseId ?? id;

      if (!targetId) {
        throw new Error("Debes indicar la compra a devolver.");
      }

      return apiFetch<PurchaseReturnResult>(`/api/purchases/${targetId}/return`, {
        method: "POST",
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(purchasesQueryKeys.detail(result.purchase.id), result.purchase);
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
    },
  });
}

/**
 * Qué recibir: el id de la compra (se desarman las líneas que el pedido guardó
 * marcadas) o, desde la confirmación de recepción (COM-14), además la lista de
 * líneas a desarmar y la clave de idempotencia del intento.
 */
export type ReceivePurchaseInput = string | ({ purchaseId?: string } & ReceivePurchaseOptions);

export function useReceivePurchase(id?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input?: ReceivePurchaseInput) => {
      const { purchaseId, ...options } = typeof input === "string" ? { purchaseId: input } : (input ?? {});
      const targetId = purchaseId ?? id;

      if (!targetId) {
        throw new Error("Debes indicar la compra a recibir.");
      }

      return apiFetch<PurchaseDetails>(`/api/purchases/${targetId}/receive`, {
        // Sin opciones no viaja cuerpo: la petición es la de siempre.
        ...(Object.keys(options).length > 0 ? { body: options } : {}),
        method: "PATCH",
      });
    },
    // Sin reintento automático: el reintento lo decide el usuario, con la misma clave.
    retry: false,
    onSuccess: (purchase) => {
      queryClient.setQueryData(purchasesQueryKeys.detail(purchase.id), purchase);
      void queryClient.invalidateQueries({ queryKey: purchasesQueryKeys.all });
      // Recibir sube el costo: productos, su detalle y la cola "Por revisar" (lista y resumen).
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      // Recibir mueve stock (y, al desarmar, abre empaques): inventario y movimientos.
      void queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.all });
    },
  });
}
