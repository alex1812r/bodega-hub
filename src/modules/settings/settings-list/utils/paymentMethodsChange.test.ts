/** CNF-11 · Qué métodos de pago se habilitan y deshabilitan al guardar los ajustes. */
import { buildPaymentMethodEffects, computePaymentMethodsChange } from "./paymentMethodsChange";

describe("paymentMethodsChange (CNF-11)", () => {
  it("sin diferencias no hay cambios, aunque cambie el orden", () => {
    expect(
      computePaymentMethodsChange(["efectivo_ves", "pago_movil"], ["pago_movil", "efectivo_ves"]),
    ).toEqual({ disabled: [], enabled: [], hasChanges: false });
  });

  it("separa los que se habilitan de los que se deshabilitan", () => {
    expect(
      computePaymentMethodsChange(
        ["efectivo_ves", "pago_movil"],
        ["efectivo_ves", "transferencia", "efectivo_usd"],
      ),
    ).toEqual({
      disabled: ["pago_movil"],
      enabled: expect.arrayContaining(["transferencia", "efectivo_usd"]),
      hasChanges: true,
    });
  });

  it("los efectos van con antes → después: primero lo que se deshabilita", () => {
    const effects = buildPaymentMethodEffects(
      computePaymentMethodsChange(["efectivo_ves", "pago_movil"], ["efectivo_ves", "transferencia"]),
    );

    expect(effects).toEqual([
      { after: "Deshabilitado", before: "Habilitado", label: "Pago movil", tone: "warning" },
      { after: "Habilitado", before: "Deshabilitado", label: "Transferencia", tone: "positive" },
    ]);
  });
});
