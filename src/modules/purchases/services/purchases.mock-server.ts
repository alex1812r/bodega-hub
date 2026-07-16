import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockProducts,
  mockPurchaseItems,
  mockPurchases,
  type PurchaseMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { normalizePurchaseLine } from "../schemas/purchaseItem.schema";

export type PurchaseInput = Partial<
  Pick<PurchaseMock, "discountRef" | "refRateVes" | "status" | "supplierId" | "taxRef">
> & {
  exchangeRateId?: string;
  items?: PurchaseItemInput[];
  notes?: string;
  purchaseNumber?: string;
};

function matchesPurchaseSearch(
  purchase: PurchaseMock,
  supplierName: string | undefined,
  search: string,
) {
  const term = search.trim().toLowerCase();
  if (!term) {
    return true;
  }

  const number = purchase.purchaseNumber.toLowerCase();
  const supplier = (supplierName ?? "").toLowerCase();

  return number.includes(term) || supplier.includes(term);
}

export function listPurchases(searchParams: URLSearchParams, storeId: string) {
  const from = searchParams.get("from");
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");

  const items = mockPurchases
    .filter((purchase) => {
      const purchaseDate = purchase.createdAt.slice(0, 10);
      const supplier = mockContacts.find((contact) => contact.id === purchase.supplierId);

      return (
        (purchase.storeId ?? DEFAULT_STORE_ID) === storeId &&
        (!status || purchase.status === status) &&
        (!supplierId || purchase.supplierId === supplierId) &&
        (!from || purchaseDate >= from) &&
        (!to || purchaseDate <= to) &&
        (!search || matchesPurchaseSearch(purchase, supplier?.name, search))
      );
    })
    .map((purchase) => ({
      ...purchase,
      itemsCount: mockPurchaseItems.filter((item) => item.purchaseId === purchase.id).length,
      supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
    }));

  return paginateList(items, searchParams);
}

export function getPurchaseById(id: string, storeId: string) {
  const purchase = mockPurchases.find((item) => item.id === id);
  assertMockStoreResource(purchase, storeId, "Compra no encontrada.");

  const items = mockPurchaseItems
    .filter((item) => item.purchaseId === id)
    .map((item) => ({
      ...item,
      product: mockProducts.find((product) => product.id === item.productId),
    }));

  return {
    ...purchase,
    items,
    payments: mockPayments.filter((payment) => payment.purchaseId === id),
    supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
  };
}

export function createPurchase(input: PurchaseInput, storeId: string) {
  const refRateVes = input.refRateVes ?? 510;
  const subtotalRef =
    input.items?.reduce((total, item) => total + normalizePurchaseLine(item).subtotalRef, 0) ?? 0;
  const totalRef = subtotalRef - (input.discountRef ?? 0) + (input.taxRef ?? 0);

  const status = input.status ?? "recibido";

  return {
    createdAt: new Date().toISOString(),
    discountRef: input.discountRef ?? 0,
    id: `purchase-mock-${Date.now()}`,
    paidVes: 0,
    purchaseNumber: input.purchaseNumber ?? `C-MOCK-${Date.now()}`,
    refRateVes,
    status,
    storeId,
    subtotalRef,
    supplierId: input.supplierId ?? "cont-supplier",
    taxRef: input.taxRef ?? 0,
    totalRef,
    totalVes: Math.round(totalRef * refRateVes * 100) / 100,
    userId: "user-demo",
  } satisfies PurchaseMock;
}

export function receivePurchase(id: string, storeId: string) {
  const purchase = getPurchaseById(id, storeId);

  if (purchase.status !== "pedido") {
    throw new ApiError(400, "BAD_REQUEST", "Solo se pueden recibir compras en estado pedido.");
  }

  return {
    ...purchase,
    status: "recibido",
  };
}

export function cancelPurchase(id: string, storeId: string) {
  return {
    ...getPurchaseById(id, storeId),
    status: "cancelado",
  };
}

export function returnPurchase(id: string, storeId: string) {
  const purchase = getPurchaseById(id, storeId);

  return {
    purchase: {
      ...purchase,
      status: "devuelto",
    },
    stockMovements: purchase.items.map((item) => ({
      createdAt: new Date().toISOString(),
      id: `mov-purchase-return-${item.productId}-${Date.now()}`,
      productId: item.productId,
      purchaseId: purchase.id,
      quantityDelta: -item.quantity,
      reason: `Devolucion de compra ${purchase.purchaseNumber}`,
      storeId,
      type: "devolucion_proveedor",
    })),
  };
}
