import {
  computePaymentImpact,
  type PaymentImpactCashMovement,
  type PaymentImpactInputs,
  type PaymentImpactLedger,
  type PaymentImpactVaultMovement,
} from "./paymentImpact";

type Payment = PaymentImpactInputs["payment"];
type SaleDocument = Extract<PaymentImpactInputs["document"], { kind: "sale" }>;
type PurchaseDocument = Extract<PaymentImpactInputs["document"], { kind: "purchase" }>;
type FullLedger = Extract<PaymentImpactLedger, { kind: "full" }>;

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    amount: 1000,
    amountRef: 2,
    amountVes: 1000,
    changeMethod: null,
    changeRef: 0,
    changeVes: 0,
    currency: "VES",
    id: "pay-a",
    method: "efectivo_ves",
    status: "activo",
    ...overrides,
  };
}

function sale(overrides: Partial<SaleDocument> = {}): SaleDocument {
  return {
    contactName: "Cliente Demo",
    id: "sale-1",
    kind: "sale",
    number: "V-20261001-000001",
    paidVes: 1000,
    status: "pagada",
    totalVes: 1000,
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseDocument> = {}): PurchaseDocument {
  return {
    contactName: "Proveedor Demo",
    id: "purchase-1",
    kind: "purchase",
    number: "C-000009",
    paidRef: 2,
    paidVes: 1000,
    status: "recibido",
    totalRef: 4,
    totalVes: 2000,
    ...overrides,
  };
}

function ledger(overrides: Partial<FullLedger> = {}): FullLedger {
  return {
    cashMovements: [],
    kind: "full",
    vault: { balanceEfectivoVes: 800, balanceRef: 10, balanceVes: 5000, id: "vault-1" },
    vaultMovements: [],
    ...overrides,
  };
}

function cash(overrides: Partial<PaymentImpactCashMovement> = {}): PaymentImpactCashMovement {
  return {
    amountRef: 0,
    amountVes: 1000,
    registerName: "Caja 1",
    sessionStatus: "open",
    type: "sale_in",
    vaultTransferredAt: null,
    ...overrides,
  };
}

function vaultMovement(
  overrides: Partial<PaymentImpactVaultMovement> = {},
): PaymentImpactVaultMovement {
  return { amountRef: 0, amountVes: 1000, id: "vm-1", type: "sale_in", vaultId: "vault-1", ...overrides };
}

function inputs(overrides: Partial<PaymentImpactInputs> = {}): PaymentImpactInputs {
  return {
    action: "cancel",
    canCancelPayments: true,
    document: sale(),
    ledger: ledger(),
    payment: payment(),
    ...overrides,
  };
}

describe("computePaymentImpact · cobro de venta", () => {
  it("efectivo Bs con caja abierta: sale de esa caja y la venta vuelve a pendiente", () => {
    const impact = computePaymentImpact(inputs({ ledger: ledger({ cashMovements: [cash()] }) }));

    expect(impact).toMatchObject({
      action: "cancel",
      allowed: true,
      inexact: null,
      reason: null,
      reasonCode: null,
    });
    expect(impact.payment).toEqual({
      amount: 1000,
      amountRef: 2,
      amountVes: 1000,
      changeMethod: null,
      changeRef: 0,
      changeVes: 0,
      currency: "VES",
      direction: "entrada",
      id: "pay-a",
      method: "efectivo_ves",
      netVes: 1000,
      status: "activo",
      statusAfter: "anulado",
    });
    expect(impact.document).toEqual({
      contactName: "Cliente Demo",
      id: "sale-1",
      kind: "sale",
      number: "V-20261001-000001",
      paidRef: null,
      paidRefAfter: null,
      paidVes: 1000,
      paidVesAfter: 0,
      pendingRef: null,
      pendingRefAfter: null,
      pendingVes: 0,
      pendingVesAfter: 1000,
      status: "pagada",
      statusAfter: "pendiente_pago",
      totalRef: null,
      totalVes: 1000,
    });
    expect(impact.effects).toEqual([
      {
        balanceAfter: null,
        balanceBefore: null,
        currency: "VES",
        delta: -1000,
        note: null,
        physical: true,
        target: "caja",
        targetName: "Caja 1",
      },
    ]);
    expect(impact.description).toContain("Se anula el cobro: salen Bs.");
    expect(impact.description).toContain("de la caja «Caja 1»");
  });

  it("efectivo USD: el asiento que sale de la caja está en REF", () => {
    const impact = computePaymentImpact(
      inputs({
        ledger: ledger({ cashMovements: [cash({ amountRef: 2, amountVes: 0 })] }),
        payment: payment({ amount: 2, currency: "USD", method: "efectivo_usd" }),
      }),
    );

    expect(impact.effects).toEqual([
      expect.objectContaining({ currency: "USD", delta: -2, target: "caja", targetName: "Caja 1" }),
    ]);
    expect(impact.description).toContain("salen ref 2.00 de la caja «Caja 1»");
  });

  it("pago móvil: quita el asiento informativo de la caja y saca el cobro del baúl (cuenta)", () => {
    const impact = computePaymentImpact(
      inputs({
        ledger: ledger({
          cashMovements: [cash({ type: "account_in" })],
          vaultMovements: [vaultMovement()],
        }),
        payment: payment({ method: "pago_movil" }),
      }),
    );

    expect(impact.effects).toEqual([
      expect.objectContaining({ delta: -1000, physical: false, target: "caja", targetName: "Caja 1" }),
      {
        balanceAfter: 4000,
        balanceBefore: 5000,
        currency: "VES",
        delta: -1000,
        note: null,
        physical: true,
        target: "baul_cuenta",
        targetName: null,
      },
    ]);
    expect(impact.inexact).toBeNull();
    expect(impact.description).toContain("se quita el cobro por cuenta de");
    expect(impact.description).toContain("del baúl (cuenta)");
  });

  it("D22: si la cuenta del baúl no alcanza, dice el saldo que la RPC dejará (0), no el ideal", () => {
    const impact = computePaymentImpact(
      inputs({
        ledger: ledger({
          vault: { balanceEfectivoVes: 0, balanceRef: 0, balanceVes: 300, id: "vault-1" },
          vaultMovements: [vaultMovement()],
        }),
        payment: payment({ method: "transferencia" }),
      }),
    );
    const [effect] = impact.effects;

    expect(impact.allowed).toBe(true);
    expect(effect).toMatchObject({ balanceAfter: 0, balanceBefore: 300, delta: -300, target: "baul_cuenta" });
    expect(effect.note).toContain("dejará de cuadrar");
    expect(effect.note).toContain("recortado en");
    expect(impact.inexact).toBeNull();
  });

  it("D22 con la cuenta ya en 0: no se mueve nada y lo avisa", () => {
    const impact = computePaymentImpact(
      inputs({
        ledger: ledger({
          vault: { balanceEfectivoVes: 0, balanceRef: 0, balanceVes: 0, id: "vault-1" },
          vaultMovements: [vaultMovement()],
        }),
        payment: payment({ method: "punto_venta" }),
      }),
    );

    expect(impact.effects[0]).toMatchObject({ balanceAfter: 0, balanceBefore: 0, delta: 0 });
    expect(impact.effects[0].note).toContain("dejará de cuadrar");
    expect(impact.description).toContain("el baúl (cuenta) no cambia");
  });

  it("con vuelto en efectivo: devuelve el neto a la venta y repone el vuelto a la caja", () => {
    const impact = computePaymentImpact(
      inputs({
        document: sale({ paidVes: 800, totalVes: 800 }),
        ledger: ledger({
          cashMovements: [cash(), cash({ amountVes: 200, type: "change_out" })],
        }),
        payment: payment({ changeMethod: "efectivo_ves", changeVes: 200 }),
      }),
    );

    expect(impact.payment.netVes).toBe(800);
    expect(impact.document).toMatchObject({ paidVesAfter: 0, pendingVesAfter: 800, statusAfter: "pendiente_pago" });
    expect(impact.effects.map((effect) => [effect.target, effect.delta, effect.physical])).toEqual([
      ["caja", -1000, true],
      ["caja", 200, true],
    ]);
    expect(impact.description).toContain("(el vuelto entregado)");
  });

  it("con vuelto por cuenta: el retiro del vuelto vuelve al baúl antes de borrar la caja", () => {
    const impact = computePaymentImpact(
      inputs({
        document: sale({ paidVes: 800, totalVes: 800 }),
        ledger: ledger({
          cashMovements: [cash(), cash({ amountVes: 200, type: "account_out" })],
          vaultMovements: [vaultMovement({ amountVes: 200, id: "vm-w", type: "withdrawal" })],
        }),
        payment: payment({ changeMethod: "pago_movil", changeVes: 200 }),
      }),
    );

    expect(impact.effects.map((effect) => [effect.target, effect.delta, effect.physical])).toEqual([
      ["baul_cuenta", 200, true],
      ["caja", -1000, true],
      ["caja", 200, false],
    ]);
    expect(impact.effects[0]).toMatchObject({ balanceAfter: 5200, balanceBefore: 5000 });
  });

  it("cobro por cuenta con vuelto por cuenta: los saldos del baúl se encadenan", () => {
    const impact = computePaymentImpact(
      inputs({
        document: sale({ paidVes: 800, totalVes: 800 }),
        ledger: ledger({
          vaultMovements: [
            vaultMovement({ id: "vm-in" }),
            vaultMovement({ amountVes: 200, id: "vm-w", type: "withdrawal" }),
          ],
        }),
        payment: payment({ changeMethod: "transferencia", changeVes: 200, method: "pago_movil" }),
      }),
    );

    expect(impact.effects.map((effect) => [effect.balanceBefore, effect.balanceAfter])).toEqual([
      [5000, 5200],
      [5200, 4200],
    ]);
  });

  it("abono parcial: la venta sigue pendiente y el saldo crece en el neto", () => {
    const impact = computePaymentImpact(
      inputs({
        document: sale({ paidVes: 1500, status: "pendiente_pago", totalVes: 4000 }),
        ledger: ledger({ cashMovements: [cash()] }),
      }),
    );

    expect(impact.document).toMatchObject({
      paidVes: 1500,
      paidVesAfter: 500,
      pendingVes: 2500,
      pendingVesAfter: 3500,
      status: "pendiente_pago",
      statusAfter: "pendiente_pago",
    });
  });

  it("venta sobrepagada que sigue cubierta tras anular: se queda pagada", () => {
    const impact = computePaymentImpact(
      inputs({ document: sale({ paidVes: 2000, totalVes: 1000 }), ledger: ledger({ cashMovements: [cash()] }) }),
    );

    expect(impact.document).toMatchObject({ paidVesAfter: 1000, pendingVesAfter: 0, statusAfter: "pagada" });
  });

  it("venta en borrador: conserva su estado", () => {
    const impact = computePaymentImpact(inputs({ document: sale({ status: "borrador" }) }));

    expect(impact.document.statusAfter).toBe("borrador");
  });

  it("caja cerrada sin transferir: se predice el borrado y se avisa del cierre guardado", () => {
    const impact = computePaymentImpact(
      inputs({ ledger: ledger({ cashMovements: [cash({ sessionStatus: "closed" })] }) }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.effects[0].note).toContain("no se recalcula");
  });

  it("sin asientos (pago antiguo): se anula y no se mueve dinero", () => {
    const impact = computePaymentImpact(inputs({ payment: payment({ method: "pago_movil" }) }));

    expect(impact).toMatchObject({ allowed: true, effects: [], inexact: null });
    expect(impact.description).toBe(
      "Se anula el cobro. No tiene asientos de caja ni de baúl: no se mueve dinero.",
    );
  });
});

describe("computePaymentImpact · pago a proveedor", () => {
  it("efectivo Bs: vuelve al baúl (efectivo Bs) y baja lo pagado en Bs y REF, sin cambiar el estado", () => {
    const impact = computePaymentImpact(
      inputs({
        document: purchase(),
        ledger: ledger({ vaultMovements: [vaultMovement({ type: "purchase_out" })] }),
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.payment).toMatchObject({ direction: "salida", netVes: 1000, statusAfter: "anulado" });
    expect(impact.document).toEqual({
      contactName: "Proveedor Demo",
      id: "purchase-1",
      kind: "purchase",
      number: "C-000009",
      paidRef: 2,
      paidRefAfter: 0,
      paidVes: 1000,
      paidVesAfter: 0,
      pendingRef: 2,
      pendingRefAfter: 4,
      pendingVes: 1000,
      pendingVesAfter: 2000,
      status: "recibido",
      statusAfter: "recibido",
      totalRef: 4,
      totalVes: 2000,
    });
    expect(impact.effects).toEqual([
      {
        balanceAfter: 1800,
        balanceBefore: 800,
        currency: "VES",
        delta: 1000,
        note: null,
        physical: true,
        target: "baul_efectivo_ves",
        targetName: null,
      },
    ]);
    expect(impact.description).toContain("Se anula el pago al proveedor: vuelven Bs.");
    expect(impact.description).toContain("al baúl (efectivo Bs)");
  });

  it("efectivo USD: vuelve REF al baúl (efectivo REF)", () => {
    const impact = computePaymentImpact(
      inputs({
        document: purchase(),
        ledger: ledger({
          vaultMovements: [vaultMovement({ amountRef: 2, amountVes: 0, type: "purchase_out" })],
        }),
        payment: payment({ amount: 2, currency: "USD", method: "efectivo_usd" }),
      }),
    );

    expect(impact.effects).toEqual([
      expect.objectContaining({
        balanceAfter: 12,
        balanceBefore: 10,
        currency: "USD",
        delta: 2,
        target: "baul_ref",
      }),
    ]);
    expect(impact.description).toContain("vuelven ref 2.00 al baúl (efectivo REF)");
  });

  it("desde cuenta: vuelve Bs al baúl (cuenta) y no toca la caja", () => {
    const impact = computePaymentImpact(
      inputs({
        document: purchase(),
        ledger: ledger({
          cashMovements: [cash({ type: "account_in" })],
          vaultMovements: [vaultMovement({ type: "purchase_out" })],
        }),
        payment: payment({ method: "transferencia" }),
      }),
    );

    expect(impact.effects).toEqual([
      expect.objectContaining({ balanceAfter: 6000, balanceBefore: 5000, delta: 1000, target: "baul_cuenta" }),
    ]);
  });

  it("sin asiento de baúl: se anula y no vuelve dinero", () => {
    const impact = computePaymentImpact(inputs({ document: purchase() }));

    expect(impact).toMatchObject({ allowed: true, effects: [], inexact: null });
    expect(impact.description).toContain("no se mueve dinero");
  });

  it.each([
    ["cancelado", "CONFLICT", "No se puede anular un pago de una compra cancelada o devuelta"],
    ["devuelto", "CONFLICT", "No se puede anular un pago de una compra cancelada o devuelta"],
  ] as const)("compra %s: rechazo de la RPC", (status, reasonCode, reason) => {
    const impact = computePaymentImpact(inputs({ document: purchase({ status }) }));

    expect(impact).toMatchObject({ allowed: false, reason, reasonCode });
  });

  it("pagado en Bs menor que el pago → PT400; pagado en REF menor → PT400 de REF", () => {
    expect(
      computePaymentImpact(inputs({ document: purchase({ paidVes: 999.99 }) })),
    ).toMatchObject({
      allowed: false,
      reason: "El monto del pago excede lo registrado en la compra",
      reasonCode: "BAD_REQUEST",
    });
    expect(
      computePaymentImpact(inputs({ document: purchase({ paidRef: 1.99 }) })),
    ).toMatchObject({
      allowed: false,
      reason: "El monto REF del pago excede lo registrado en la compra",
      reasonCode: "BAD_REQUEST",
    });
  });
});

describe("computePaymentImpact · guardas en el orden de la RPC", () => {
  const transferred = ledger({
    cashMovements: [cash({ sessionStatus: "closed", vaultTransferredAt: "2026-10-02T04:00:00+00:00" })],
  });

  it("rol sin permiso de la RPC: PT403 antes que cualquier otra guarda", () => {
    const impact = computePaymentImpact(
      inputs({ canCancelPayments: false, payment: payment({ status: "anulado" }) }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "No autorizado para anular pagos",
      reasonCode: "FORBIDDEN",
    });
  });

  it("pago ya anulado: PT409 antes que el cierre transferido", () => {
    const impact = computePaymentImpact(
      inputs({ ledger: transferred, payment: payment({ status: "anulado" }) }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      description: "Ya estaba anulado: nada que revertir.",
      effects: [],
      reason: "El pago ya fue anulado",
      reasonCode: "CONFLICT",
    });
    expect(impact.payment).toMatchObject({ status: "anulado", statusAfter: "anulado" });
  });

  it("cierre de caja ya transferido al baúl: PT409 antes que el estado de la venta", () => {
    const impact = computePaymentImpact(
      inputs({ document: sale({ status: "devuelta" }), ledger: transferred }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason:
        "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo",
      reasonCode: "CONFLICT",
    });
  });

  it("venta cancelada o devuelta: PT409 antes que el monto", () => {
    const impact = computePaymentImpact(
      inputs({ document: sale({ paidVes: 0, status: "cancelada" }) }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "No se puede anular un pago de una venta cancelada o devuelta",
      reasonCode: "CONFLICT",
    });
  });

  it("cobrado menor que el neto del pago: PT400", () => {
    const impact = computePaymentImpact(inputs({ document: sale({ paidVes: 999.99 }) }));

    expect(impact).toMatchObject({
      allowed: false,
      reason: "El monto del pago excede lo registrado en la venta",
      reasonCode: "BAD_REQUEST",
    });
  });

  it("el neto, no el bruto, es lo que se compara con lo cobrado", () => {
    const impact = computePaymentImpact(
      inputs({
        document: sale({ paidVes: 800, totalVes: 800 }),
        payment: payment({ changeMethod: "efectivo_ves", changeVes: 200 }),
      }),
    );

    expect(impact.allowed).toBe(true);
  });

  it("con allowed=false no proyecta nada: saldos, estado y asientos como antes", () => {
    const impact = computePaymentImpact(
      inputs({
        document: sale({ paidVes: 500, status: "pendiente_pago", totalVes: 4000 }),
        ledger: ledger({ cashMovements: [cash()], vaultMovements: [vaultMovement()] }),
        payment: payment({ method: "pago_movil" }),
      }),
    );

    expect(impact.allowed).toBe(false);
    expect(impact.effects).toEqual([]);
    expect(impact.inexact).toBeNull();
    expect(impact.document).toMatchObject({
      paidVes: 500,
      paidVesAfter: 500,
      pendingVes: 3500,
      pendingVesAfter: 3500,
      statusAfter: "pendiente_pago",
    });
    expect(impact.payment.statusAfter).toBe("activo");
    expect(impact.description).toBe("No se puede anular el cobro: no cambia nada.");
  });
});

describe("computePaymentImpact · casos inexactos", () => {
  it("sin asientos disponibles (modo demo): documento exacto, dinero inexacto y sin cifras", () => {
    const impact = computePaymentImpact(
      inputs({ ledger: { kind: "unavailable", reason: "El modo demo no registra asientos." } }),
    );

    expect(impact).toMatchObject({
      allowed: true,
      description: "Se anula el cobro.",
      effects: [],
      inexact: { reason: "El modo demo no registra asientos." },
    });
    expect(impact.document).toMatchObject({ paidVesAfter: 0, statusAfter: "pendiente_pago" });
  });

  it("más de un asiento de baúl del mismo tipo: no inventa el saldo", () => {
    const impact = computePaymentImpact(
      inputs({
        document: purchase(),
        ledger: ledger({
          vaultMovements: [
            vaultMovement({ id: "vm-1", type: "purchase_out" }),
            vaultMovement({ id: "vm-2", type: "purchase_out" }),
          ],
        }),
      }),
    );

    expect(impact.effects).toEqual([]);
    expect(impact.inexact?.reason).toContain("más de un asiento de baúl");
    expect(impact.description).toBe("Se anula el pago al proveedor.");
  });

  it("baúl ilegible o de otro id: el asiento sale sin saldos y con inexact", () => {
    for (const vault of [null, { balanceEfectivoVes: 1, balanceRef: 1, balanceVes: 1, id: "otro" }]) {
      const impact = computePaymentImpact(
        inputs({
          ledger: ledger({ vault, vaultMovements: [vaultMovement()] }),
          payment: payment({ method: "pago_movil" }),
        }),
      );

      expect(impact.effects).toEqual([
        expect.objectContaining({ balanceAfter: null, balanceBefore: null, delta: -1000, target: "baul_cuenta" }),
      ]);
      expect(impact.inexact?.reason).toContain("No se pudo leer el saldo del baúl");
    }
  });

  it("asiento de caja de tipo desconocido: se declara", () => {
    const impact = computePaymentImpact(
      inputs({ ledger: ledger({ cashMovements: [cash(), cash({ type: "raro" })] }) }),
    );

    expect(impact.effects).toHaveLength(1);
    expect(impact.inexact?.reason).toContain("«raro»");
  });

  it("suma en céntimos: sin restos de coma flotante", () => {
    const impact = computePaymentImpact(
      inputs({
        document: sale({ paidVes: 0.3, totalVes: 0.3 }),
        ledger: ledger({
          vault: { balanceEfectivoVes: 0, balanceRef: 0, balanceVes: 0.3, id: "vault-1" },
          vaultMovements: [vaultMovement({ amountVes: 0.1 })],
        }),
        payment: payment({ amount: 0.1, amountVes: 0.1, method: "pago_movil" }),
      }),
    );

    expect(impact.document.paidVesAfter).toBe(0.2);
    expect(impact.effects[0]).toMatchObject({ balanceAfter: 0.2, delta: -0.1 });
  });
});
