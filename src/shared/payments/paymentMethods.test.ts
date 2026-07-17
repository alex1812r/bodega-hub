import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  isPaymentMethod,
  isPaymentMethodEnabled,
  normalizeEnabledPaymentMethods,
  PAYMENT_METHODS,
} from "./paymentMethods";

describe("paymentMethods catalog", () => {
  it("exposes all five payment methods by default", () => {
    expect(PAYMENT_METHODS).toHaveLength(5);
    expect(DEFAULT_ENABLED_PAYMENT_METHODS).toEqual([...PAYMENT_METHODS]);
  });

  it("normalizes invalid or empty values to the default set", () => {
    expect(normalizeEnabledPaymentMethods(null)).toEqual([...PAYMENT_METHODS]);
    expect(normalizeEnabledPaymentMethods([])).toEqual([...PAYMENT_METHODS]);
    expect(normalizeEnabledPaymentMethods(["nope", "efectivo_ves", "efectivo_ves"])).toEqual([
      "efectivo_ves",
    ]);
  });

  it("filters candidates by enabled methods", () => {
    expect(
      filterEnabledPaymentMethods(["pago_movil", "transferencia"], PAYMENT_METHODS),
    ).toEqual(["pago_movil", "transferencia"]);
    expect(isPaymentMethodEnabled("efectivo_usd", ["pago_movil"])).toBe(false);
    expect(isPaymentMethod("transferencia")).toBe(true);
    expect(isPaymentMethod("cheque")).toBe(false);
  });
});
