import {
  getPurchaseBalanceRef,
  getPurchasePaymentStatus,
  getPurchasePendingRef,
  hasPendingBalance,
  isPayablePurchaseStatus,
} from "./purchaseBalance";

// Compra de ref 20,00 a 36,50 = Bs 730,00.
const purchase = { paidRef: 0, paidVes: 0, status: "recibido", totalRef: 20, totalVes: 730 };

describe("purchaseBalance", () => {
  it("solo las compras pedidas o recibidas pueden deberse", () => {
    expect(isPayablePurchaseStatus("pedido")).toBe(true);
    expect(isPayablePurchaseStatus("recibido")).toBe(true);
    expect(isPayablePurchaseStatus("cancelado")).toBe(false);
    expect(isPayablePurchaseStatus("devuelto")).toBe(false);
  });

  it("el saldo en REF es total − pagado mientras queden Bs por pagar, y 0 al saldar", () => {
    expect(getPurchasePendingRef({ ...purchase, paidRef: 5.02, paidVes: 183.23, totalRef: 18, totalVes: 657 })).toBe(12.98);
    expect(getPurchasePendingRef(purchase)).toBe(20);
    expect(getPurchasePendingRef({ ...purchase, paidRef: 25, paidVes: 912.5 })).toBe(0);
    // Saldada en Bs a una tasa del día más alta: no queda saldo aunque falte REF.
    expect(getPurchasePendingRef({ ...purchase, paidRef: 18.25, paidVes: 730 })).toBe(0);
  });

  it.each([
    ["pedido", true],
    ["recibido", true],
    ["cancelado", false],
    ["devuelto", false],
  ])("una compra %s sin pagar cuenta como deuda: %s", (status, expected) => {
    const row = { ...purchase, status };

    expect(hasPendingBalance(row)).toBe(expected);
    expect(getPurchaseBalanceRef(row)).toBe(expected ? 20 : null);
  });

  it("GQ-07: con todo el REF pagado y céntimos de Bs por pagar SIGUE con saldo pendiente", () => {
    const residue = { paidRef: 161.1, paidVes: 141067.3, status: "recibido", totalRef: 161.1, totalVes: 141071.84 };

    expect(hasPendingBalance(residue)).toBe(true);
    expect(getPurchasePaymentStatus(residue)).toBe("parcial");
    expect(hasPendingBalance({ ...residue, paidVes: 141071.84 })).toBe(false);
    expect(getPurchasePaymentStatus({ ...residue, paidVes: 141071.84 })).toBe("pagada");
  });

  it("estado de pago: pagada, parcial o pendiente", () => {
    expect(getPurchasePaymentStatus({ ...purchase, paidRef: 20, paidVes: 730 })).toBe("pagada");
    expect(getPurchasePaymentStatus({ ...purchase, paidRef: 5, paidVes: 182.5 })).toBe("parcial");
    expect(getPurchasePaymentStatus(purchase)).toBe("pendiente");
  });
});
