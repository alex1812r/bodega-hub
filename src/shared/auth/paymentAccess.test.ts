import {
  assertCanAccessPayment,
  assertCanCreatePurchasePayment,
  assertCanQueryPurchasePayments,
  canViewPurchasePayments,
  isPurchasePayment,
  PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE,
} from "./paymentAccess";

describe("paymentAccess", () => {
  it("allows purchase payments for non-vendedor roles", () => {
    expect(canViewPurchasePayments("admin")).toBe(true);
    expect(canViewPurchasePayments("contador")).toBe(true);
    expect(canViewPurchasePayments("almacen")).toBe(true);
    expect(canViewPurchasePayments("vendedor")).toBe(false);
  });

  it("detects purchase-linked payments", () => {
    expect(isPurchasePayment({ purchaseId: "purchase-001" })).toBe(true);
    expect(isPurchasePayment({ purchase_id: "purchase-001" })).toBe(true);
    expect(isPurchasePayment({ direction: "salida" })).toBe(true);
    expect(isPurchasePayment({ direction: "entrada", saleId: "sale-001" } as never)).toBe(false);
  });

  it("blocks vendedor from querying purchase filters", () => {
    expect(() =>
      assertCanQueryPurchasePayments("vendedor", new URLSearchParams("purchaseId=p-1")),
    ).toThrow(PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);

    expect(() =>
      assertCanQueryPurchasePayments("vendedor", new URLSearchParams("direction=salida")),
    ).toThrow(PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);

    expect(() =>
      assertCanQueryPurchasePayments("vendedor", new URLSearchParams("direction=entrada")),
    ).not.toThrow();
  });

  it("blocks vendedor from accessing a purchase payment", () => {
    expect(() =>
      assertCanAccessPayment("vendedor", { purchaseId: "purchase-001", direction: "salida" }),
    ).toThrow(PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);

    expect(() =>
      assertCanAccessPayment("vendedor", { direction: "entrada" }),
    ).not.toThrow();
  });

  it("blocks vendedor from creating purchase payments", () => {
    expect(() =>
      assertCanCreatePurchasePayment("vendedor", { purchaseId: "purchase-001" }),
    ).toThrow(PURCHASE_PAYMENTS_FORBIDDEN_MESSAGE);

    expect(() => assertCanCreatePurchasePayment("vendedor", { purchaseId: undefined })).not.toThrow();
  });
});
