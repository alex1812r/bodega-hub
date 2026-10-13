/**
 * @jest-environment node
 */
/**
 * COM-06 · el mock de pagos encuentra también las compras creadas en la sesión
 * (`createPurchase` del mock), no solo las de la semilla: pagar una compra recién
 * creada la abona, cuelga el pago de ella y el detalle la muestra pagada.
 */

import {
  createPurchase,
  getPurchaseById,
} from "@/modules/purchases/services/purchases.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { cancelPayment, createPayment, getPaymentById, listPayments } from "./payments.mock-server";

function createMockPurchase() {
  return createPurchase(
    {
      discountRef: 0,
      discountVes: 0,
      items: [
        {
          costCurrency: "ref",
          entryMode: "unit",
          productId: "prod-cable",
          quantity: 2,
          subtotalRef: 4,
          subtotalVes: 2040,
          taxRate: 0,
          taxRef: 0,
          taxVes: 0,
          unitCostRef: 2,
          unitCostVes: 1020,
        },
      ],
      refRateVes: 510,
      status: "pedido",
      subtotalRef: 4,
      subtotalVes: 2040,
      supplierId: "cont-supplier",
      taxRef: 0,
      taxVes: 0,
    },
    DEFAULT_STORE_ID,
  );
}

describe("payments.mock-server · compra creada en la sesión (COM-06)", () => {
  it("el pago se guarda como salida de la compra, con su proveedor, su saldo y su documento", () => {
    const purchase = createMockPurchase();

    const payment = createPayment(
      { amount: 1020, method: "efectivo_ves", purchaseId: purchase.id },
      DEFAULT_STORE_ID,
    );

    expect(payment).toMatchObject({
      contactId: "cont-supplier",
      direction: "salida",
      pendingBalanceVes: 1020,
      purchaseId: purchase.id,
      relatedDocument: { href: `/purchases/${purchase.id}` },
    });
    expect(payment.documentBalance).toMatchObject({ paidVes: 1020, pendingVes: 1020 });
    expect(getPaymentById(payment.id, DEFAULT_STORE_ID).relatedDocument?.href).toBe(
      `/purchases/${purchase.id}`,
    );

    const listed = listPayments(
      new URLSearchParams({ purchaseId: purchase.id }),
      DEFAULT_STORE_ID,
    ).items;

    expect(listed.map((item) => item.id)).toEqual([payment.id]);
    expect(listed[0]?.relatedDocument?.href).toBe(`/purchases/${purchase.id}`);
  });

  it("el detalle de la compra la muestra pagada y anular el pago la devuelve a pendiente", () => {
    const purchase = createMockPurchase();

    const payment = createPayment(
      { amount: 2040, method: "efectivo_ves", purchaseId: purchase.id },
      DEFAULT_STORE_ID,
    );
    const paid = getPurchaseById(purchase.id, DEFAULT_STORE_ID, { canViewPayments: true });

    expect(paid.paidVes).toBe(2040);
    expect(paid.paidRef).toBe(4);
    expect(paid.payments.map((item) => item.id)).toEqual([payment.id]);

    cancelPayment(payment.id, DEFAULT_STORE_ID);

    expect(getPurchaseById(purchase.id, DEFAULT_STORE_ID).paidVes).toBe(0);
  });

  it("una compra de otra tienda sigue sin poder pagarse", () => {
    const purchase = createMockPurchase();

    expect(() =>
      createPayment(
        { amount: 100, method: "efectivo_ves", purchaseId: purchase.id },
        "store-ajena",
      ),
    ).toThrow("No tienes permisos para realizar esta operacion en este recurso.");
  });
});
