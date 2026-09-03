import type { PaymentMethod } from "@/shared/mocks/erp-data";

import {
  amountToCoverRemainingVes,
  buildRemainingFillHelperText,
  buildVesAmountHelperText,
  canUseMixedPayments,
  changeAmountForOverage,
  createCheckoutForMethod,
  createDefaultMixedPaymentLines,
  getAvailablePaymentMethods,
  getAllocatedVes,
  getChangeMethodOptions,
  getChangeVes,
  getDefaultChangeMethod,
  getMaxChangeRoundingVes,
  getRemainingRef,
  getRemainingVes,
  getSaleTotalVes,
  getTenderOverageVes,
  methodRequiresPaymentDetails,
  paymentAmountToRef,
  paymentAmountToVes,
  pickChangeCarrierLineId,
  pickNextAvailablePaymentMethod,
  refToPaymentAmount,
  usdAmountToCoverVes,
  validateCheckout,
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

describe("tender con vuelto", () => {
  // Caso de la spec: venta de $2,30 pagada con billetes de $1.
  const rate = 801.17;
  const totalRef = 2.3;
  const usdTender = [line({ amount: 3, id: "usd", method: "efectivo_usd" })];

  function checkoutWithChange(
    changeAmount: number,
    changeMethod: PosMixedPaymentLine["method"] = "efectivo_ves",
  ) {
    return {
      change: { amount: changeAmount, method: changeMethod },
      changeCarrierLineId: "usd",
      lines: usdTender,
    };
  }

  it("computes the overage a tender leaves over the sale total", () => {
    expect(getSaleTotalVes(totalRef, rate)).toBe(1842.69);
    expect(getTenderOverageVes(totalRef, usdTender, rate)).toBe(560.82);
    // Pago exacto: sin excedente.
    expect(
      getTenderOverageVes(totalRef, [line({ amount: 1842.69, method: "efectivo_ves" })], rate),
    ).toBe(0);
  });

  it("converts an overage into a change amount without ever overshooting", () => {
    expect(changeAmountForOverage("efectivo_ves", 560.82, rate)).toBe(560.82);
    expect(changeAmountForOverage("pago_movil", 560.82, rate)).toBe(560.82);
    // USD trunca a centavos: devolver de mas descuadra la gaveta.
    expect(changeAmountForOverage("efectivo_usd", 560.82, rate)).toBe(0.7);
    expect(paymentAmountToVes("efectivo_usd", 0.7, rate)).toBeLessThanOrEqual(560.82);
    expect(changeAmountForOverage("efectivo_ves", 0, rate)).toBe(0);
  });

  it("converts a declared change back to VES", () => {
    expect(getChangeVes({ amount: 560, method: "efectivo_ves" }, rate)).toBe(560);
    expect(getChangeVes({ amount: 0.7, method: "efectivo_usd" }, rate)).toBe(560.82);
    expect(getChangeVes(null, rate)).toBe(0);
  });

  it("accepts an overage absorbed by the declared change", () => {
    // Bs 560 es lo maximo entregable en billetes; Bs 0,82 quedan en la gaveta.
    const result = validateCheckout(totalRef, checkoutWithChange(560), rate);
    expect(result.isValid).toBe(true);
  });

  it("rejects a cash change bigger than the drawer", () => {
    const result = validateCheckout(totalRef, checkoutWithChange(560), rate, undefined, {
      ves: 100,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain("No hay suficiente efectivo en la caja");
  });

  it("counts the cash received in this sale as available for the change", () => {
    const result = validateCheckout(totalRef, checkoutWithChange(560), rate, undefined, {
      ves: 560,
    });

    expect(result.isValid).toBe(true);
  });

  it("still rejects an overage with no change declared", () => {
    const result = validateCheckout(
      totalRef,
      { change: null, changeCarrierLineId: null, lines: usdTender },
      rate,
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => error.includes("excede el total"))).toBe(true);
  });

  it("rejects change over the overage, change with no overage and short change", () => {
    const tooMuch = validateCheckout(totalRef, checkoutWithChange(600), rate);
    expect(tooMuch.isValid).toBe(false);
    expect(tooMuch.errors.some((error) => error.includes("supera el excedente"))).toBe(true);

    const noOverage = validateCheckout(
      totalRef,
      {
        change: { amount: 100, method: "efectivo_ves" },
        changeCarrierLineId: "ves",
        lines: [line({ amount: 1842.69, id: "ves", method: "efectivo_ves" })],
      },
      rate,
    );
    expect(noOverage.isValid).toBe(false);
    expect(noOverage.errors.some((error) => error.includes("No hay excedente"))).toBe(true);

    // Bs 550 deja Bs 10,82 sin devolver: cabe otro billete de Bs 10.
    const short = validateCheckout(totalRef, checkoutWithChange(550), rate);
    expect(short.isValid).toBe(false);
    expect(short.errors.some((error) => error.includes("sin devolver"))).toBe(true);
  });

  it("requires an exact change amount when it is paid from the account", () => {
    expect(validateCheckout(totalRef, checkoutWithChange(560.82, "pago_movil"), rate).isValid).toBe(
      true,
    );

    const rounded = validateCheckout(totalRef, checkoutWithChange(560, "pago_movil"), rate);
    expect(rounded.isValid).toBe(false);
    expect(rounded.errors.some((error) => error.includes("sin devolver"))).toBe(true);
  });

  it("caps the acceptable rounding at the smallest bill of the change currency", () => {
    expect(getMaxChangeRoundingVes("efectivo_ves", rate)).toBe(9.99);
    expect(getMaxChangeRoundingVes("efectivo_usd", rate)).toBe(801.16);
    expect(getMaxChangeRoundingVes("pago_movil", rate)).toBe(0.01);
    expect(getMaxChangeRoundingVes("transferencia", rate)).toBe(0.01);
  });

  it("puts the change on the received line that can cover it", () => {
    const lines = [
      line({ amount: 2, id: "usd", method: "efectivo_usd" }),
      line({ amount: 300, id: "ves", method: "efectivo_ves" }),
    ];

    // 2 USD = Bs 1602,34 es la unica linea que alcanza Bs 900.
    expect(pickChangeCarrierLineId(lines, rate, 900)).toBe("usd");
    // Con Bs 100 gana la de mayor monto en Bs.
    expect(pickChangeCarrierLineId(lines, rate, 100)).toBe("usd");
    expect(pickChangeCarrierLineId(lines, rate, 5000)).toBeNull();
    expect(pickChangeCarrierLineId(lines, rate, 0)).toBeNull();
  });

  it("defaults the change method to cash Bs when the drawer has bolivares", () => {
    expect(getDefaultChangeMethod(undefined, 5000)).toBe("efectivo_ves");
    expect(getDefaultChangeMethod(undefined, 0)).toBe("pago_movil");
    expect(getDefaultChangeMethod(["efectivo_usd", "punto_venta"], 5000)).toBe("efectivo_usd");
    expect(getDefaultChangeMethod(["punto_venta"], 5000)).toBeNull();
    expect(getChangeMethodOptions()).toEqual([
      "efectivo_ves",
      "pago_movil",
      "efectivo_usd",
      "transferencia",
    ]);
    // Punto de venta no devuelve vuelto.
    expect(getChangeMethodOptions(["punto_venta", "efectivo_ves"])).toEqual(["efectivo_ves"]);
  });

  it("prefills a single exact line from the quick method chip", () => {
    const checkout = createCheckoutForMethod("efectivo_ves", totalRef, rate);

    expect(checkout.change).toBeNull();
    expect(checkout.lines).toHaveLength(1);
    expect(checkout.lines[0].amount).toBe(1842.69);
    expect(validateCheckout(totalRef, checkout, rate).isValid).toBe(true);
  });

  it("keeps the classic mixed payment rule of at least two lines", () => {
    const single = validateMixedPayments(totalRef, [
      line({ amount: 1842.69, method: "efectivo_ves" }),
    ], rate);

    expect(single.isValid).toBe(false);
    expect(single.errors.some((error) => error.includes("al menos 2"))).toBe(true);
  });
});
