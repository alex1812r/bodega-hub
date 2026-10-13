import { ApiError } from "@/lib/api/apiError";
import { mockEntityStoreId } from "@/lib/api/assertStoreResource";
import {
  mockContacts,
  mockPayments,
  mockProductPackConversions,
  mockProducts,
  mockStockMovements,
} from "@/shared/mocks/erp-data";
import { roundMoney } from "@/shared/utils/currency";

import {
  computePurchaseImpact,
  type PurchaseImpactAction,
  type PurchaseImpactDisassembleEntry,
  type PurchaseImpactInputs,
} from "./purchaseImpact";
import { findMockPurchase } from "./purchaseMockStore";
import { getPurchaseById } from "./purchases.mock-server";

export type PurchaseImpactOptions = {
  /** Ausente = `false`, igual que el cargador real. */
  canViewPayments?: boolean;
  disassemble?: PurchaseImpactDisassembleEntry[] | null;
};

/**
 * Mismos datos que el cargador real, leídos del mock. Compra ajena o
 * inexistente → 404.
 *
 * El impact sigue a las RPC reales, no a las mutaciones del mock (que no mueven
 * stock en las líneas sin desarme ni guardan la cancelación): en modo demo el
 * efecto mostrado es el de la base.
 */
export function loadPurchaseImpactInputs(
  purchaseId: string,
  action: PurchaseImpactAction,
  storeId: string,
  options: PurchaseImpactOptions = {},
): PurchaseImpactInputs {
  const stored = findMockPurchase(purchaseId);

  if (!stored || mockEntityStoreId(stored) !== storeId) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  const purchase = getPurchaseById(purchaseId, storeId);
  const recipes =
    action === "receive" && purchase.status === "pedido"
      ? mockProductPackConversions.filter(
          (recipe) =>
            recipe.isActive &&
            recipe.storeId === storeId &&
            purchase.items.some((item) => item.productId === recipe.packProductId),
        )
      : [];
  const packIds = new Set(
    mockProductPackConversions
      .filter((recipe) => recipe.isActive && recipe.storeId === storeId)
      .map((recipe) => recipe.packProductId),
  );
  const productIds = new Set([
    ...purchase.items.map((item) => item.productId),
    ...recipes.flatMap((recipe) => recipe.components.map((component) => component.unitProductId)),
  ]);
  const returnedByProduct: Record<string, number> = {};

  if (action !== "receive") {
    for (const movement of mockStockMovements) {
      if (movement.purchaseId === purchaseId && movement.type === "devolucion_proveedor") {
        returnedByProduct[movement.productId] =
          (returnedByProduct[movement.productId] ?? 0) - movement.quantityDelta;
      }
    }
  }

  return {
    action,
    canViewPayments: options.canViewPayments ?? false,
    disassemble: action === "receive" ? (options.disassemble ?? null) : null,
    items: purchase.items.map((item) => ({
      disassembled: item.disassembled,
      disassembleOnReceive: item.disassembleOnReceive,
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      taxRate: item.taxRate ?? 0,
      // Como el mock de recepción: en una línea por empaque de un producto EMPAQUE
      // la unidad es el empaque y su costo, el del empaque.
      unitCostRef: roundMoney(
        item.entryMode === "pack" && packIds.has(item.productId)
          ? (item.packCostRef ?? item.unitCostRef)
          : item.unitCostRef,
      ),
    })),
    payments:
      action === "receive"
        ? []
        : mockPayments
            .filter((payment) => payment.purchaseId === purchaseId)
            .map((payment) => ({
              amount: payment.amount,
              amountRef: payment.amountRef,
              amountVes: payment.amountVes,
              createdAt: payment.createdAt,
              currency: payment.method === "efectivo_usd" ? ("USD" as const) : ("VES" as const),
              id: payment.id,
              method: payment.method,
              status: payment.status ?? ("activo" as const),
            })),
    products: mockProducts
      .filter((product) => productIds.has(product.id) && mockEntityStoreId(product) === storeId)
      .map((product) => ({
        currentCostRef: product.currentCostRef,
        currentStock: product.currentStock,
        id: product.id,
        isActive: product.isActive,
        name: product.name,
        sku: product.sku,
      })),
    purchase: {
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      status: purchase.status,
      supplierName: mockContacts.find((contact) => contact.id === purchase.supplierId)?.name ?? null,
    },
    recipes: recipes.map((recipe) => ({
      components: recipe.components.map((component) => ({
        costWeight: component.costWeight,
        unitProductId: component.unitProductId,
        unitsPerPack: component.unitsPerPack,
      })),
      conversionId: recipe.id,
      packProductId: recipe.packProductId,
      totalUnits: recipe.totalUnits,
    })),
    returnedByProduct,
  };
}

export function getPurchaseImpact(
  id: string,
  action: PurchaseImpactAction,
  storeId: string,
  options: PurchaseImpactOptions = {},
) {
  return computePurchaseImpact(loadPurchaseImpactInputs(id, action, storeId, options));
}
