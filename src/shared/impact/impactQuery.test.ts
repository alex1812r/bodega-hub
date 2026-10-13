/**
 * CNF-F10 · un impact con cifras `null` donde el contrato exige un número no vale:
 * el modal lo pintaría con `toLocaleString` y tumbaría la página. Los `null` que el
 * contrato permite (saldos de caja, stock de un producto que ya no existe…) sí pasan.
 */
import { hasImpactShape } from "./impactQuery";

const document = { contactName: null, id: "sale-1", number: "V-0001", status: "paid", statusAfter: "returned" };

function moneyEffect(overrides: Record<string, unknown> = {}) {
  return {
    balanceAfter: null,
    balanceBefore: null,
    currency: "VES",
    delta: -400,
    note: null,
    physical: true,
    target: "caja",
    targetName: "Caja 1",
    ...overrides,
  };
}

function paymentLine(overrides: Record<string, unknown> = {}) {
  return {
    amount: 400,
    amountRef: 10,
    amountVes: 400,
    changeVes: 0,
    currency: "VES",
    description: "Se anula.",
    effects: [moneyEffect()],
    inexact: null,
    method: "efectivo_ves",
    netVes: 400,
    outcome: "reverted",
    paymentId: "pay-1",
    status: "active",
    statusAfter: "cancelled",
    ...overrides,
  };
}

function stockLine(overrides: Record<string, unknown> = {}) {
  return {
    inexact: null,
    isActive: true,
    productId: "prod-1",
    productName: "Cable",
    quantityDelta: 2,
    sku: null,
    stockAfter: 12,
    stockBefore: 10,
    ...overrides,
  };
}

function saleImpact(overrides: Record<string, unknown> = {}) {
  return {
    action: "return",
    allowed: true,
    document,
    inexact: null,
    paidVes: 400,
    paidVesAfter: 0,
    payments: [paymentLine()],
    reason: null,
    reasonCode: null,
    refund: {
      byMethod: [{ amount: 400, amountVes: 400, currency: "VES", method: "efectivo_ves" }],
      changeToRecover: [],
      netVes: 400,
    },
    stock: [stockLine()],
    ...overrides,
  };
}

const SALE_SHAPE = { action: "return", arrays: ["payments", "stock"], documentId: "sale-1" };

describe("hasImpactShape · cifras que el modal pinta (CNF-F10)", () => {
  it("acepta un impact completo", () => {
    expect(hasImpactShape(saleImpact(), SALE_SHAPE)).toBe(true);
  });

  it("acepta los `null` que el contrato permite", () => {
    const impact = saleImpact({
      payments: [paymentLine({ effects: [moneyEffect({ balanceAfter: null, balanceBefore: null })] })],
      refund: null,
      stock: [
        stockLine({
          inexact: { reason: "El producto ya no existe." },
          isActive: null,
          productName: null,
          quantityDelta: 0,
          sku: null,
          stockAfter: null,
          stockBefore: null,
        }),
      ],
    });

    expect(hasImpactShape(impact, SALE_SHAPE)).toBe(true);
  });

  it.each([
    ["monto de un pago en null", { payments: [paymentLine({ amountVes: null })] }],
    ["neto de un pago ausente", { payments: [paymentLine({ netVes: undefined })] }],
    ["asiento de un pago con delta null", { payments: [paymentLine({ effects: [moneyEffect({ delta: null })] })] }],
    ["saldo de baúl como texto", { payments: [paymentLine({ effects: [moneyEffect({ balanceAfter: "12" })] })] }],
    ["unidades de un producto en null", { stock: [stockLine({ quantityDelta: null })] }],
    ["stock que no es un número", { stock: [stockLine({ stockAfter: Number.NaN })] }],
    ["una línea que no es un objeto", { stock: [null] }],
    ["cobrado de la venta en null", { paidVes: null }],
    ["devolución por método con monto null", {
      refund: { byMethod: [{ amount: null, amountVes: 400, currency: "VES", method: "zelle" }], changeToRecover: [], netVes: 400 },
    }],
  ])("rechaza %s", (_label, overrides) => {
    expect(hasImpactShape(saleImpact(overrides), SALE_SHAPE)).toBe(false);
  });

  it("compra: rechaza cifras null en costos, desarmes y productos que bloquean; acepta sus null permitidos", () => {
    const shape = {
      action: "receive",
      arrays: ["blockingProducts", "costs", "disassemble", "payments", "stock"],
      documentId: "sale-1",
    };
    const purchase = (overrides: Record<string, unknown> = {}) => ({
      action: "receive",
      allowed: true,
      blockingProducts: [{ available: null, productId: "p", productName: null, required: null, sku: null }],
      costs: [{ costRefAfter: 9, costRefBefore: null, inexact: null, isActive: true, productId: "p", productName: "P", sku: null, source: "purchase_line" }],
      disassemble: [
        {
          components: [{ isActive: true, productId: "u", productName: "U", sku: null, stockAfter: 12, stockBefore: 0, unitsIn: 12 }],
          packProductId: "p",
          packProductName: "P",
          packsOut: 1,
          purchaseItemId: "it-1",
        },
      ],
      document,
      inexact: null,
      payments: [],
      paymentsRestricted: false,
      reason: null,
      reasonCode: null,
      stock: [{ ...stockLine(), componentsIn: 0, disassembledOut: 0, purchasedIn: 2 }],
      ...overrides,
    });

    expect(hasImpactShape(purchase(), shape)).toBe(true);
    expect(hasImpactShape(purchase({ stock: [{ ...stockLine(), componentsIn: 0, disassembledOut: 0, purchasedIn: null }] }), shape)).toBe(false);
    expect(
      hasImpactShape(
        purchase({ disassemble: [{ components: [], packProductId: "p", packProductName: "P", packsOut: null, purchaseItemId: "it-1" }] }),
        shape,
      ),
    ).toBe(false);
    expect(
      hasImpactShape(
        purchase({
          disassemble: [
            {
              components: [{ isActive: true, productId: "u", productName: "U", sku: null, stockAfter: 12, stockBefore: 0, unitsIn: null }],
              packProductId: "p",
              packProductName: "P",
              packsOut: 1,
              purchaseItemId: "it-1",
            },
          ],
        }),
        shape,
      ),
    ).toBe(false);
  });

  it("pago: rechaza cifras null del pago y del documento; acepta los REF en null de una venta", () => {
    const shape = { action: "cancel", arrays: ["effects"] };
    const payment = (overrides: Record<string, unknown> = {}) => ({
      action: "cancel",
      allowed: true,
      description: "Se anula.",
      document: {
        ...document,
        kind: "sale",
        paidRef: null,
        paidRefAfter: null,
        paidVes: 400,
        paidVesAfter: 0,
        pendingRef: null,
        pendingRefAfter: null,
        pendingVes: 0,
        pendingVesAfter: 400,
        totalRef: null,
        totalVes: 400,
      },
      effects: [moneyEffect()],
      inexact: null,
      payment: { amount: 400, amountRef: 10, amountVes: 400, changeMethod: null, changeRef: 0, changeVes: 0, currency: "VES", direction: "entrada", id: "pay-1", method: "efectivo_ves", netVes: 400, status: "active", statusAfter: "cancelled" },
      reason: null,
      reasonCode: null,
      ...overrides,
    });

    expect(hasImpactShape(payment(), shape)).toBe(true);
    expect(hasImpactShape(payment({ effects: [moneyEffect({ delta: null })] }), shape)).toBe(false);
    expect(hasImpactShape(payment({ payment: { ...payment().payment, amountVes: null } }), shape)).toBe(false);
    expect(hasImpactShape(payment({ document: { ...payment().document, pendingVesAfter: null } }), shape)).toBe(false);
  });
});
