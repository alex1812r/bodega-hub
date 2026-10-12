import { documentBalance } from "./documentBalance";

// GQ-07 / F8. La compra C-20261012-000011 de la pasada 2: total ref 161,10 /
// Bs 141.071,84 (suma de líneas ya redondeadas; ref × 875,6505 = 141.067,30).
// «Completar saldo» en USD paga 161,10 → `register_payment` descuenta Bs 141.067,30.
const evidencePurchase = {
  paidRef: 161.1,
  paidVes: 141067.3,
  refRateVes: 875.6505,
  status: "recibido",
  totalRef: 161.1,
  totalVes: 141071.84,
  type: "purchase" as const,
};

describe("documentBalance", () => {
  it("una compra con paid_ref = total_ref pero Bs por pagar NO está saldada: el servidor aún acepta el pago", () => {
    expect(documentBalance(evidencePurchase)).toEqual({
      open: true,
      paymentStatus: "parcial",
      pendingRef: 0,
      pendingVes: 4.54,
      settled: false,
    });
  });

  it("al pagar el residuo en Bs queda saldada con saldo 0 en las dos monedas", () => {
    expect(documentBalance({ ...evidencePurchase, paidRef: 161.11, paidVes: 141071.84 })).toEqual({
      open: false,
      paymentStatus: "pagada",
      pendingRef: 0,
      pendingVes: 0,
      settled: true,
    });
  });

  it("sentido inverso: pagada en Bs con paid_ref < total_ref (tasa del día más alta) está saldada y sin saldo en REF", () => {
    const balance = documentBalance({
      paidRef: 44.1,
      paidVes: 41503.75,
      refRateVes: 875.6505,
      status: "recibido",
      totalRef: 47.4,
      totalVes: 41503.75,
      type: "purchase",
    });

    expect(balance).toMatchObject({ open: false, pendingRef: 0, pendingVes: 0, settled: true });
    expect(balance.paymentStatus).toBe("pagada");
  });

  it("sentido inverso: el máximo en USD (47,39 de 47,40) deja «parcial» con el mismo saldo en todas partes", () => {
    expect(
      documentBalance({
        paidRef: 47.39,
        paidVes: 41497.08,
        refRateVes: 875.6505,
        status: "recibido",
        totalRef: 47.4,
        totalVes: 41503.75,
        type: "purchase",
      }),
    ).toEqual({ open: true, paymentStatus: "parcial", pendingRef: 0.01, pendingVes: 6.67, settled: false });
  });

  it("compra sin pagos: pendiente por el total", () => {
    expect(documentBalance({ ...evidencePurchase, paidRef: 0, paidVes: 0 })).toEqual({
      open: true,
      paymentStatus: "pendiente",
      pendingRef: 161.1,
      pendingVes: 141071.84,
      settled: false,
    });
  });

  it.each(["cancelado", "devuelto"])("una compra %s no es deuda vigente aunque le falte dinero", (status) => {
    expect(documentBalance({ ...evidencePurchase, paidRef: 0, paidVes: 0, status })).toMatchObject({
      open: false,
      settled: false,
    });
  });

  it("venta: saldada exactamente cuando paid_ves >= total_ves (el `pagada` de register_payment)", () => {
    const sale = { refRateVes: 875.6505, status: "pendiente_pago", totalRef: 161.1, totalVes: 141071.84, type: "sale" as const };

    expect(documentBalance({ ...sale, paidVes: 141067.3 })).toEqual({
      open: true,
      paymentStatus: "parcial",
      // round(4,54 / 875,6505, 2): la cuenta de `report_open_documents_aging`.
      pendingRef: 0.01,
      pendingVes: 4.54,
      settled: false,
    });
    expect(documentBalance({ ...sale, paidVes: 141071.84, status: "pagada" })).toMatchObject({
      open: false,
      pendingRef: 0,
      pendingVes: 0,
      settled: true,
    });
    // Redondeo a favor: lo cobrado de más no es saldo negativo.
    expect(documentBalance({ ...sale, paidVes: 141080, status: "pagada" })).toMatchObject({
      pendingRef: 0,
      pendingVes: 0,
      settled: true,
    });
  });

  it("venta en borrador, anulada o devuelta: no es cuenta por cobrar", () => {
    for (const status of ["borrador", "cancelada", "devuelta"]) {
      expect(
        documentBalance({ paidVes: 0, refRateVes: 36.5, status, totalRef: 10, totalVes: 365, type: "sale" }).open,
      ).toBe(false);
    }
  });

  it("no arrastra errores de coma flotante: 0,1 + 0,2 pagados de 0,3 es saldo 0", () => {
    expect(
      documentBalance({ paidRef: 0.3, paidVes: 0.1 + 0.2, refRateVes: 1, status: "recibido", totalRef: 0.3, totalVes: 0.3, type: "purchase" }),
    ).toMatchObject({ pendingVes: 0, settled: true });
  });

  it("tasa de 4 decimales: ref 10,00 a 875,6505 guardado como Bs 8.756,50 y pagado con 10 USD (Bs 8.756,51) queda saldado", () => {
    expect(
      documentBalance({ paidRef: 10, paidVes: 8756.51, refRateVes: 875.6505, status: "recibido", totalRef: 10, totalVes: 8756.5, type: "purchase" }),
    ).toMatchObject({ open: false, pendingRef: 0, pendingVes: 0, settled: true });
  });

  it("sin importes en Bs (quien solo conoce el estado) no hay saldo que pagar", () => {
    expect(documentBalance({ status: "recibido", type: "purchase" })).toMatchObject({ open: false, pendingVes: 0 });
  });
});
