import type { PaymentMethod } from "@/shared/mocks/erp-data";

import {
  amountToCoverRemainingVes,
  buildRemainingFillHelperText,
  buildVesAmountHelperText,
  canUseMixedPayments,
  createDefaultMixedPaymentLines,
  getAvailablePaymentMethods,
  getAllocatedVes,
  getRemainingRef,
  getRemainingVes,
  getSaleTotalVes,
  methodRequiresPaymentDetails,
  paymentAmountToRef,
  paymentAmountToVes,
  pickNextAvailablePaymentMethod,
  refToPaymentAmount,
  usdAmountToCoverVes,
  validateMixedPayments,
  validateSinglePaymentDetails,
  type PosMixedPaymentLine,
} from "./mixedPayments";

const rateVes = 40;

function line(
  overrides: Partial<PosMixedPaymentLine> & Pick<PosMixedPaymentLine, "method">,
): PosMixedPaymentLine {
  return {
    amount: 0,
    id: overrides.id ?? `line-${overrides.method}`,
    ...overrides,
  };
}

describe("mixedPayments utils", () => {
  it("converts USD amounts 1:1 to REF and VES amounts using the rate", () => {
    expect(paymentAmountToRef("efectivo_usd", 10, rateVes)).toBe(10);
    expect(paymentAmountToRef("efectivo_ves", 200, rateVes)).toBe(5);
    expect(paymentAmountToVes("efectivo_usd", 10, rateVes)).toBe(400);
    expect(paymentAmountToVes("efectivo_ves", 200, rateVes)).toBe(200);
    expect(refToPaymentAmount("efectivo_usd", 5, rateVes)).toBe(5);
    expect(refToPaymentAmount("efectivo_ves", 5, rateVes)).toBe(200);
  });

  it("computes remaining REF excluding a line for fill-remaining", () => {
    const lines = [
      line({ amount: 10, id: "a", method: "efectivo_usd" }),
      line({ amount: 0, id: "b", method: "efectivo_ves" }),
    ];

    expect(getRemainingRef(15, lines, rateVes)).toBe(5);
    expect(getRemainingRef(15, lines, rateVes, "b")).toBe(5);
    expect(getRemainingRef(15, lines, rateVes, "a")).toBe(15);
    expect(getRemainingVes(15, lines, rateVes, "b")).toBe(200);
  });

  it("builds helper texts for VES amounts and remaining fill", () => {
    expect(buildVesAmountHelperText(200, rateVes)).toContain("ref 5.00");
    expect(buildVesAmountHelperText(200, rateVes)).toContain("=");
    expect(buildRemainingFillHelperText("efectivo_ves", 200, rateVes)).toContain(
      "ref 5.00",
    );
    expect(buildRemainingFillHelperText("efectivo_usd", 200, rateVes)).toContain(
      "Restante:",
    );
  });

  it("validates mixed payments covering the total with required fields", () => {
    const valid = validateMixedPayments(
      15,
      [
        line({ amount: 10, method: "efectivo_usd" }),
        line({
          amount: 200,
          bankName: "0134 - Banesco",
          method: "pago_movil",
          phone: "04141234567",
          referenceCode: "1234",
        }),
      ],
      rateVes,
    );
    expect(valid.isValid).toBe(true);

    const incomplete = validateMixedPayments(
      15,
      createDefaultMixedPaymentLines().map((item, index) =>
        index === 0 ? { ...item, amount: 10 } : item,
      ),
      rateVes,
    );
    expect(incomplete.isValid).toBe(false);
    expect(incomplete.errors.some((error) => error.includes("Falta"))).toBe(true);
  });

  it("rejects 150 Bs + 1.11 USD when VES still short (real POS case)", () => {
    const rate = 764.3486;
    const totalRef = 1.31;
    expect(getSaleTotalVes(totalRef, rate)).toBe(1001.3);

    const shortLines = [
      line({
        amount: 150,
        bankName: "0102 - Banco de Venezuela",
        id: "pm",
        method: "pago_movil",
        phone: "04125555555",
        referenceCode: "0000",
      }),
      line({ amount: 1.11, id: "usd", method: "efectivo_usd" }),
    ];

    expect(getAllocatedVes(shortLines, rate)).toBe(998.43);
    const short = validateMixedPayments(totalRef, shortLines, rate);
    expect(short.isValid).toBe(false);
    expect(short.errors.some((error) => error.includes("Falta"))).toBe(true);

    const coveredUsd = usdAmountToCoverVes(getRemainingVes(totalRef, shortLines.slice(0, 1), rate), rate);
    expect(coveredUsd).toBe(1.12);
    expect(paymentAmountToVes("efectivo_usd", coveredUsd, rate)).toBeGreaterThanOrEqual(
      getRemainingVes(totalRef, shortLines.slice(0, 1), rate),
    );

    const filled = validateMixedPayments(
      totalRef,
      [
        shortLines[0],
        line({ amount: coveredUsd, id: "usd", method: "efectivo_usd" }),
      ],
      rate,
    );
    expect(filled.isValid).toBe(true);
  });

  it("fills remaining VES exactly with efectivo_ves", () => {
    const rate = 764.3486;
    const totalRef = 1.31;
    const lines = [
      line({
        amount: 150,
        bankName: "0102 - Banco de Venezuela",
        id: "pm",
        method: "pago_movil",
        phone: "04125555555",
        referenceCode: "0000",
      }),
      line({ amount: 0, id: "cash", method: "efectivo_ves" }),
    ];
    const remaining = getRemainingVes(totalRef, lines, rate, "cash");
    expect(remaining).toBe(851.3);
    expect(amountToCoverRemainingVes("efectivo_ves", remaining, rate)).toBe(851.3);
  });

  it("excludes already selected methods from available options", () => {
    const lines = [
      line({ amount: 10, id: "a", method: "efectivo_usd" }),
      line({ amount: 200, id: "b", method: "efectivo_ves" }),
    ];

    // Exclude line b (VES): USD is taken → VES stays available for this row's select.
    expect(getAvailablePaymentMethods(lines, "b")).toEqual([
      "efectivo_ves",
      "pago_movil",
      "punto_venta",
      "transferencia",
    ]);
    // Exclude line a (USD): VES is taken → USD stays available for this row's select.
    expect(getAvailablePaymentMethods(lines, "a")).toEqual([
      "efectivo_usd",
      "pago_movil",
      "punto_venta",
      "transferencia",
    ]);
    // Without exclude: both USD and VES are taken.
    expect(getAvailablePaymentMethods(lines)).toEqual([
      "pago_movil",
      "punto_venta",
      "transferencia",
    ]);
    expect(pickNextAvailablePaymentMethod(lines)).toBe("pago_movil");
  });

  it("limits available methods to the store-enabled subset", () => {
    const lines = [line({ amount: 10, id: "a", method: "efectivo_usd" })];
    const enabled = ["efectivo_usd", "pago_movil"] as const;

    expect(getAvailablePaymentMethods(lines, undefined, enabled)).toEqual(["pago_movil"]);
    expect(pickNextAvailablePaymentMethod(lines, enabled)).toBe("pago_movil");
    expect(canUseMixedPayments(["efectivo_ves"])).toBe(false);
    expect(canUseMixedPayments(["efectivo_ves", "pago_movil"])).toBe(true);
  });

  it("rejects invalid pago movil reference", () => {
    const result = validateMixedPayments(
      10,
      [
        line({ amount: 5, method: "efectivo_usd" }),
        line({
          amount: 200,
          bankName: "0134 - Banesco",
          method: "pago_movil" as PaymentMethod,
          phone: "04141234567",
          referenceCode: "12",
        }),
      ],
      rateVes,
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => error.includes("4 digitos"))).toBe(true);
  });

  it("flags pago movil and transferencia as requiring payment details", () => {
    expect(methodRequiresPaymentDetails("pago_movil")).toBe(true);
    expect(methodRequiresPaymentDetails("transferencia")).toBe(true);
    expect(methodRequiresPaymentDetails("efectivo_ves")).toBe(false);
    expect(methodRequiresPaymentDetails("punto_venta")).toBe(false);
    expect(methodRequiresPaymentDetails(null)).toBe(false);
  });

  it("validates single-method pago movil and transferencia details", () => {
    expect(validateSinglePaymentDetails("efectivo_ves", null).isValid).toBe(true);

    expect(validateSinglePaymentDetails("pago_movil", null).isValid).toBe(false);

    expect(
      validateSinglePaymentDetails("pago_movil", {
        bankName: "0134 - Banesco",
        phone: "04141234567",
        referenceCode: "1234",
      }).isValid,
    ).toBe(true);

    expect(
      validateSinglePaymentDetails("transferencia", {
        bankName: "0134 - Banesco",
        phone: "",
        referenceCode: "TRX-999",
      }).isValid,
    ).toBe(true);

    expect(
      validateSinglePaymentDetails("transferencia", {
        bankName: "0134 - Banesco",
        phone: "",
        referenceCode: "",
      }).isValid,
    ).toBe(false);
  });
});
