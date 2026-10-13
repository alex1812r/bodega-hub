import { mockEntityStoreId } from "@/lib/api/assertStoreResource";
import {
  mockPurchaseItems,
  mockPurchases,
  type PurchaseItemMock,
  type PurchaseMock,
} from "@/shared/mocks/erp-data";

import { createdMockPurchases } from "./purchaseMockStore";

/**
 * Último costo de compra de un producto: el unitario SIN IVA de su línea más reciente en
 * una compra recibida, con la alícuota que llevó esa línea. `supplier` = la compra era del
 * proveedor consultado; `any` = de otro (ese proveedor nunca lo vendió).
 */
export type PurchaseLastCost = {
  productId: string;
  source: "any" | "supplier";
  taxRate: number;
  unitCostRef: number;
};

export type PurchaseLastCostsQuery = {
  productIds: string[];
  supplierId: string;
};

/** Productos que `GET /api/purchases/last-costs` admite en una consulta. */
export const MAX_LAST_COST_PRODUCT_IDS = 50;

type MockPurchaseLine = { item: PurchaseItemMock; purchase: PurchaseMock };

/**
 * Líneas de las compras recibidas de la tienda, de la más reciente a la más antigua
 * (por fecha de creación de la compra; entre dos iguales, la registrada después).
 * Semilla y compras creadas en esta ejecución del mock.
 */
function receivedLinesNewestFirst(storeId: string): MockPurchaseLine[] {
  const seeded = mockPurchases.map((purchase) => ({
    items: mockPurchaseItems.filter((item) => item.purchaseId === purchase.id),
    purchase,
  }));

  return [...seeded, ...createdMockPurchases().values()]
    .filter(
      ({ purchase }) => purchase.status === "recibido" && mockEntityStoreId(purchase) === storeId,
    )
    .reverse()
    .sort((first, second) => second.purchase.createdAt.localeCompare(first.purchase.createdAt))
    .flatMap(({ items, purchase }) => items.map((item) => ({ item, purchase })));
}

/**
 * Último costo de compra de cada producto pedido: primero entre las compras recibidas de
 * `supplierId`; si no hay, entre las de cualquier proveedor. Un producto sin ninguna línea
 * recibida no aparece. No cuentan pedidos sin recibir, compras anuladas ni devueltas.
 */
export function listPurchaseLastCosts(
  { productIds, supplierId }: PurchaseLastCostsQuery,
  storeId: string,
): PurchaseLastCost[] {
  const lines = receivedLinesNewestFirst(storeId);

  return [...new Set(productIds)].flatMap((productId): PurchaseLastCost[] => {
    const ofProduct = lines.filter(({ item }) => item.productId === productId);
    const fromSupplier = ofProduct.find(({ purchase }) => purchase.supplierId === supplierId);
    const line = fromSupplier ?? ofProduct[0];

    return line
      ? [
          {
            productId,
            source: fromSupplier ? "supplier" : "any",
            taxRate: line.item.taxRate ?? 0,
            unitCostRef: line.item.unitCostRef,
          },
        ]
      : [];
  });
}
