import {
  mockPurchases,
  type PurchaseItemMock,
  type PurchaseMock,
} from "@/shared/mocks/erp-data";
import { mockState } from "@/shared/mocks/mockStore";

/**
 * Compras creadas en esta ejecución del mock. Módulo hoja (solo datos y estado
 * del mock): lo leen `purchases.mock-server` y `priceReview.mock-server` sin que
 * el segundo importe al primero, que cerraba un ciclo de imports con inventario.
 */
export function createdMockPurchases() {
  return mockState(
    "purchases:created",
    () => new Map<string, { items: PurchaseItemMock[]; purchase: PurchaseMock }>(),
  );
}

/**
 * La compra tal como la guarda el mock, sea de la semilla o creada en esta
 * ejecucion. Sin control de tienda: quien la expone lo hace con `getPurchaseById`.
 */
export function findMockPurchase(id: string): PurchaseMock | undefined {
  return createdMockPurchases().get(id)?.purchase ?? mockPurchases.find((item) => item.id === id);
}
