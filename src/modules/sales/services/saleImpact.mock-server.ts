import { ApiError } from "@/lib/api/apiError";
import { mockEntityStoreId } from "@/lib/api/assertStoreResource";
import {
  mockContacts,
  mockPayments,
  mockProducts,
  mockSaleItems,
  mockSales,
  mockStockMovements,
} from "@/shared/mocks/erp-data";

import { computeSaleImpact, type SaleImpactAction, type SaleImpactInputs } from "./saleImpact";

const DEMO_LEDGER_REASON =
  "El modo demo no registra asientos de caja ni de baúl por pago: no se puede anticipar de dónde sale el dinero.";

/** Mismos datos que el cargador real, leídos del mock. Venta ajena o inexistente → 404. */
export function loadSaleImpactInputs(
  saleId: string,
  action: SaleImpactAction,
  storeId: string,
): SaleImpactInputs {
  const sale = mockSales.find((item) => item.id === saleId);

  if (!sale || mockEntityStoreId(sale) !== storeId) {
    throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
  }

  const items = mockSaleItems
    .filter((item) => item.saleId === saleId)
    .map((item) => ({ productId: item.productId, quantity: item.quantity }));
  const productIds = new Set(items.map((item) => item.productId));
  const returnedByProduct: Record<string, number> = {};

  for (const movement of mockStockMovements) {
    if (movement.saleId === saleId && movement.type === "devolucion_cliente") {
      returnedByProduct[movement.productId] =
        (returnedByProduct[movement.productId] ?? 0) + movement.quantityDelta;
    }
  }

  return {
    action,
    items,
    ledger: { kind: "unavailable", reason: DEMO_LEDGER_REASON },
    payments: mockPayments
      .filter((payment) => payment.saleId === saleId)
      .map((payment) => ({
        amount: payment.amount,
        amountRef: payment.amountRef,
        amountVes: payment.amountVes,
        // El mock de pagos no guarda el vuelto.
        changeMethod: null,
        changeRef: 0,
        changeVes: 0,
        createdAt: payment.createdAt,
        currency: payment.method === "efectivo_usd" ? ("USD" as const) : ("VES" as const),
        id: payment.id,
        method: payment.method,
        status: payment.status ?? ("activo" as const),
      })),
    products: mockProducts
      .filter((product) => productIds.has(product.id) && mockEntityStoreId(product) === storeId)
      .map((product) => ({
        currentStock: product.currentStock,
        id: product.id,
        isActive: product.isActive,
        name: product.name,
        sku: product.sku,
      })),
    returnedByProduct,
    sale: {
      customerName: mockContacts.find((contact) => contact.id === sale.customerId)?.name ?? null,
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      paidVes: sale.paidVes,
      status: sale.status,
    },
  };
}

export function getSaleImpact(id: string, action: SaleImpactAction, storeId: string) {
  return computeSaleImpact(loadSaleImpactInputs(id, action, storeId));
}
