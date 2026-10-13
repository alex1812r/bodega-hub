import { computeSaleImpact, type SaleImpactInputs, type SaleImpactLedger } from "./saleImpact";

type Payment = SaleImpactInputs["payments"][number];

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    amount: 1000,
    amountRef: 2,
    amountVes: 1000,
    changeMethod: null,
    changeRef: 0,
    changeVes: 0,
    createdAt: "2026-10-01T10:00:00.000000+00:00",
    currency: "VES",
    id: "pay-a",
    method: "efectivo_ves",
    status: "activo",
    ...overrides,
  };
}

const emptyLedger: SaleImpactLedger = {
  cashMovements: [],
  kind: "full",
  vault: { balanceVes: 5000, id: "vault-1" },
  vaultMovements: [],
};

function inputs(overrides: Partial<SaleImpactInputs> = {}): SaleImpactInputs {
  return {
    action: "return",
    items: [
      { productId: "prod-b", quantity: 2 },
      { productId: "prod-a", quantity: 3 },
      { productId: "prod-b", quantity: 1 },
    ],
    ledger: emptyLedger,
    payments: [],
    products: [
      { currentStock: 10, id: "prod-a", isActive: true, name: "Harina", sku: "har-1" },
      { currentStock: 4, id: "prod-b", isActive: false, name: "Arroz", sku: null },
    ],
    returnedByProduct: {},
    sale: {
      customerName: "Cliente Demo",
      id: "sale-1",
      invoiceNumber: "V-20261001-000001",
      paidVes: 0,
      status: "pendiente_pago",
    },
    ...overrides,
  };
}

function cash(
  overrides: Partial<Extract<SaleImpactLedger, { kind: "full" }>["cashMovements"][number]> = {},
) {
  return {
    amountRef: 0,
    amountVes: 1000,
    paymentId: "pay-a",
    registerName: "Caja 1",
    sessionId: "session-1",
    sessionStatus: "open" as const,
    type: "sale_in",
    vaultTransferredAt: null,
    ...overrides,
  };
}

describe("computeSaleImpact · stock", () => {
  it("repone por producto lo vendido menos lo ya devuelto, incluido un producto inactivo", () => {
    const impact = computeSaleImpact(inputs({ returnedByProduct: { "prod-a": 1 } }));

    expect(impact.allowed).toBe(true);
    expect(impact.stock).toEqual([
      {
        inexact: null,
        isActive: false,
        productId: "prod-b",
        productName: "Arroz",
        quantityDelta: 3,
        sku: null,
        stockAfter: 7,
        stockBefore: 4,
      },
      {
        inexact: null,
        isActive: true,
        productId: "prod-a",
        productName: "Harina",
        quantityDelta: 2,
        sku: "har-1",
        stockAfter: 12,
        stockBefore: 10,
      },
    ]);
  });

  it("no mueve un producto ya devuelto por completo", () => {
    const impact = computeSaleImpact(inputs({ returnedByProduct: { "prod-a": 3, "prod-b": 5 } }));

    expect(impact.stock.map((line) => [line.quantityDelta, line.stockAfter])).toEqual([
      [0, 4],
      [0, 10],
    ]);
  });

  it("rechaza con el PT404 de la RPC si un producto ya no está en la tienda", () => {
    const impact = computeSaleImpact(
      inputs({
        action: "cancel",
        products: [{ currentStock: 4, id: "prod-b", isActive: true, name: "Arroz", sku: null }],
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason:
        "Producto no encontrado en tu tienda (prod-a): no se puede reponer el stock de la venta V-20261001-000001",
      reasonCode: "NOT_FOUND",
    });
    expect(impact.stock[1]).toMatchObject({
      inexact: { reason: expect.any(String) },
      productName: null,
      stockAfter: null,
      stockBefore: null,
    });
    // Sin proyección: la línea que sí existe no cambia.
    expect(impact.stock[0]).toMatchObject({ quantityDelta: 0, stockAfter: 4, stockBefore: 4 });
    expect(impact.inexact).not.toBeNull();
  });
});

describe("computeSaleImpact · cancel", () => {
  it("pendiente sin pagos: se anula y repone el stock", () => {
    const impact = computeSaleImpact(inputs({ action: "cancel" }));

    expect(impact).toMatchObject({
      action: "cancel",
      allowed: true,
      document: {
        contactName: "Cliente Demo",
        id: "sale-1",
        number: "V-20261001-000001",
        status: "pendiente_pago",
        statusAfter: "cancelada",
      },
      inexact: null,
      paidVes: 0,
      paidVesAfter: 0,
      payments: [],
      reason: null,
      refund: null,
    });
    expect(impact.stock.map((line) => line.quantityDelta)).toEqual([3, 3]);
  });

  it("con un pago ya anulado: nada que revertir y se permite", () => {
    const impact = computeSaleImpact(
      inputs({ action: "cancel", payments: [payment({ status: "anulado" })] }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.payments).toEqual([
      expect.objectContaining({
        description: "Ya estaba anulado: nada que revertir.",
        effects: [],
        outcome: "already_cancelled",
        status: "anulado",
        statusAfter: "anulado",
      }),
    ]);
  });

  it("con pagos activos: rechaza con el mensaje de cancel_sale y no proyecta nada", () => {
    const impact = computeSaleImpact(
      inputs({
        action: "cancel",
        payments: [
          payment({ amountVes: 1000.1, id: "pay-a" }),
          payment({ amountVes: 2000.2, changeVes: 500, id: "pay-b" }),
          payment({ id: "pay-c", status: "anulado" }),
        ],
        sale: { ...inputs().sale, paidVes: 2500.3, status: "pagada" },
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      // Suma el bruto (`amount_ves`), no el neto, y siempre con dos decimales.
      reason:
        "La venta V-20261001-000001 tiene 2 pago(s) activo(s) por Bs 3000.30. Anula primero los pagos y luego cancela la venta.",
      reasonCode: "CONFLICT",
    });
    expect(impact.document.statusAfter).toBe("pagada");
    expect(impact.paidVes).toBe(2500.3);
    expect(impact.paidVesAfter).toBe(2500.3);
    expect(impact.payments.map((line) => line.outcome)).toEqual([
      "blocks_action",
      "blocks_action",
      "already_cancelled",
    ]);
    expect(impact.stock.every((line) => line.quantityDelta === 0)).toBe(true);
  });

  it.each([
    ["cancelada", "La venta ya fue cancelada o devuelta"],
    ["devuelta", "La venta ya fue cancelada o devuelta"],
    ["borrador", "Solo se pueden cancelar ventas pagadas o pendientes de pago"],
  ] as const)("venta %s: rechaza con el PT409 de la RPC", (status, reason) => {
    const impact = computeSaleImpact(
      inputs({
        action: "cancel",
        payments: [payment()],
        sale: { ...inputs().sale, status },
      }),
    );

    expect(impact).toMatchObject({ allowed: false, reason, reasonCode: "CONFLICT" });
    expect(impact.document.statusAfter).toBe(status);
    // La guarda de estado va antes que la de pagos activos.
    expect(impact.payments[0].outcome).toBe("unchanged");
  });
});

describe("computeSaleImpact · return", () => {
  it("efectivo Bs con caja abierta: anula el pago y revierte el asiento de esa caja", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: { ...emptyLedger, cashMovements: [cash()] },
        payments: [payment()],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact).toMatchObject({
      allowed: true,
      document: { status: "pagada", statusAfter: "devuelta" },
      inexact: null,
      paidVes: 1000,
      paidVesAfter: 0,
      refund: {
        byMethod: [{ amount: 1000, amountVes: 1000, currency: "VES", method: "efectivo_ves" }],
        changeToRecover: [],
        netVes: 1000,
      },
    });
    expect(impact.payments).toEqual([
      {
        amount: 1000,
        amountRef: 2,
        amountVes: 1000,
        changeVes: 0,
        currency: "VES",
        description: "Se anula: se revierte de la caja «Caja 1».",
        effects: [
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
        ],
        inexact: null,
        method: "efectivo_ves",
        netVes: 1000,
        outcome: "reverted",
        paymentId: "pay-a",
        status: "activo",
        statusAfter: "anulado",
      },
    ]);
  });

  it("efectivo REF con vuelto en Bs: revierte el cobro en USD y devuelve el vuelto a la gaveta", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: {
          ...emptyLedger,
          cashMovements: [
            cash({ amountRef: 20, amountVes: 0 }),
            cash({ amountVes: 250.5, type: "change_out" }),
          ],
        },
        payments: [
          payment({
            amount: 20,
            amountRef: 20,
            amountVes: 10000,
            changeMethod: "efectivo_ves",
            changeVes: 250.5,
            currency: "USD",
            method: "efectivo_usd",
          }),
        ],
        sale: { ...inputs().sale, paidVes: 9749.5, status: "pagada" },
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.paidVesAfter).toBe(0);
    expect(impact.payments[0].netVes).toBe(9749.5);
    expect(impact.payments[0].effects.map((effect) => [effect.currency, effect.delta])).toEqual([
      ["USD", -20],
      ["VES", 250.5],
    ]);
    expect(impact.refund).toEqual({
      byMethod: [{ amount: 20, amountVes: 10000, currency: "USD", method: "efectivo_usd" }],
      changeToRecover: [
        { amount: 250.5, amountVes: 250.5, currency: "VES", method: "efectivo_ves" },
      ],
      netVes: 9749.5,
    });
  });

  it("pago por cuenta: sale del baúl (cuenta) con saldo antes y después, encadenando pagos", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: {
          cashMovements: [cash({ amountVes: 3000, type: "account_in" })],
          kind: "full",
          vault: { balanceVes: 5000, id: "vault-1" },
          vaultMovements: [
            { amountVes: 3000, id: "vm-1", paymentId: "pay-a", type: "sale_in", vaultId: "vault-1" },
            { amountVes: 1500, id: "vm-2", paymentId: "pay-b", type: "sale_in", vaultId: "vault-1" },
          ],
        },
        payments: [
          // Desordenados: la RPC los recorre por `created_at, id`.
          payment({
            amount: 1500,
            amountVes: 1500,
            createdAt: "2026-10-01T10:05:00.000000+00:00",
            id: "pay-b",
            method: "transferencia",
          }),
          payment({ amount: 3000, amountVes: 3000, id: "pay-a", method: "pago_movil" }),
        ],
        sale: { ...inputs().sale, paidVes: 4500, status: "pagada" },
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.payments.map((line) => line.paymentId)).toEqual(["pay-a", "pay-b"]);
    expect(impact.payments[0].description).toBe(
      "Se anula: se revierte de la caja «Caja 1» y se revierte del baúl (cuenta).",
    );
    expect(impact.payments[0].effects).toEqual([
      expect.objectContaining({ delta: -3000, physical: false, target: "caja" }),
      expect.objectContaining({
        balanceAfter: 2000,
        balanceBefore: 5000,
        delta: -3000,
        note: null,
        target: "baul_cuenta",
      }),
    ]);
    expect(impact.payments[1].effects).toEqual([
      expect.objectContaining({ balanceAfter: 500, balanceBefore: 2000, delta: -1500 }),
    ]);
    expect(impact.paidVesAfter).toBe(0);
  });

  it("cuenta sin saldo suficiente: la RPC recorta el baúl a 0 y el impact lo dice", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: {
          cashMovements: [],
          kind: "full",
          vault: { balanceVes: 400, id: "vault-1" },
          vaultMovements: [
            { amountVes: 1000, id: "vm-1", paymentId: "pay-a", type: "sale_in", vaultId: "vault-1" },
          ],
        },
        payments: [payment({ method: "punto_venta" })],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact.payments[0].effects).toEqual([
      expect.objectContaining({
        balanceAfter: 0,
        balanceBefore: 400,
        delta: -400,
        note: expect.stringContaining("no cubre"),
      }),
    ]);
  });

  it("vuelto por cuenta: primero vuelve al baúl y después sale el cobro", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: {
          cashMovements: [],
          kind: "full",
          vault: { balanceVes: 100, id: "vault-1" },
          vaultMovements: [
            { amountVes: 1000, id: "vm-1", paymentId: "pay-a", type: "sale_in", vaultId: "vault-1" },
            { amountVes: 300, id: "vm-2", paymentId: "pay-a", type: "withdrawal", vaultId: "vault-1" },
          ],
        },
        payments: [payment({ changeMethod: "pago_movil", changeVes: 300, method: "pago_movil" })],
        sale: { ...inputs().sale, paidVes: 700, status: "pagada" },
      }),
    );

    expect(
      impact.payments[0].effects.map((effect) => [effect.balanceBefore, effect.balanceAfter]),
    ).toEqual([
      [100, 400],
      [400, 0],
    ]);
    expect(impact.refund?.changeToRecover).toEqual([
      { amount: 300, amountVes: 300, currency: "VES", method: "pago_movil" },
    ]);
    expect(impact.refund?.netVes).toBe(700);
  });

  it("pago sin asientos: se anula y no hay nada que revertir", () => {
    const impact = computeSaleImpact(
      inputs({
        payments: [payment()],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact.payments[0]).toMatchObject({
      description: "Se anula. No tiene asientos de caja ni de baúl: nada que revertir.",
      effects: [],
      inexact: null,
      outcome: "reverted",
    });
  });

  it("caja cerrada sin transferir: revierte el asiento y avisa de que el cierre no se recalcula", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: { ...emptyLedger, cashMovements: [cash({ sessionStatus: "closed" })] },
        payments: [payment()],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.payments[0].effects[0].note).toContain("cierre guardado no se recalcula");
  });

  it("cierre ya transferido al baúl: rechaza la devolución entera con el mensaje de la RPC", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: {
          ...emptyLedger,
          cashMovements: [
            cash({ paymentId: "pay-a" }),
            cash({
              paymentId: "pay-b",
              sessionStatus: "closed",
              vaultTransferredAt: "2026-10-02T00:00:00.000000+00:00",
            }),
          ],
        },
        payments: [
          payment({ id: "pay-a" }),
          payment({ createdAt: "2026-10-01T11:00:00.000000+00:00", id: "pay-b" }),
        ],
        sale: { ...inputs().sale, paidVes: 2000, status: "pagada" },
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason:
        "No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo",
      reasonCode: "CONFLICT",
      refund: null,
    });
    expect(impact.document.statusAfter).toBe("pagada");
    expect(impact.paidVesAfter).toBe(2000);
    expect(impact.payments.map((line) => [line.outcome, line.effects.length])).toEqual([
      ["unchanged", 0],
      ["blocks_action", 0],
    ]);
    expect(impact.stock.every((line) => line.quantityDelta === 0)).toBe(true);
  });

  it("neto mayor que lo cobrado en la venta: rechaza con el PT400 de la RPC", () => {
    const impact = computeSaleImpact(
      inputs({
        payments: [payment()],
        sale: { ...inputs().sale, paidVes: 999.99, status: "pendiente_pago" },
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "El monto del pago excede lo registrado en la venta",
      reasonCode: "BAD_REQUEST",
    });
  });

  it("pago ya anulado y pendiente de pago: nada que revertir, repone stock", () => {
    const impact = computeSaleImpact(inputs({ payments: [payment({ status: "anulado" })] }));

    expect(impact.allowed).toBe(true);
    expect(impact.payments[0].outcome).toBe("already_cancelled");
    expect(impact.refund).toEqual({ byMethod: [], changeToRecover: [], netVes: 0 });
    expect(impact.document.statusAfter).toBe("devuelta");
  });

  it("venta ya devuelta: rechaza y no toca los pagos", () => {
    const impact = computeSaleImpact(
      inputs({ payments: [payment()], sale: { ...inputs().sale, status: "devuelta" } }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "La venta ya fue cancelada o devuelta",
      reasonCode: "CONFLICT",
    });
    expect(impact.payments[0].outcome).toBe("unchanged");
  });

  it("borrador: rechaza con el mensaje de return_sale", () => {
    const impact = computeSaleImpact(inputs({ sale: { ...inputs().sale, status: "borrador" } }));

    expect(impact.reason).toBe("Solo se pueden devolver ventas pagadas o pendientes de pago");
  });
});

describe("computeSaleImpact · partes inexactas", () => {
  it("sin asientos disponibles (demo): anula el pago, sin efectos y con inexact", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: { kind: "unavailable", reason: "Sin asientos en demo." },
        payments: [payment()],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact.allowed).toBe(true);
    expect(impact.payments[0]).toMatchObject({
      effects: [],
      inexact: { reason: "Sin asientos en demo." },
      outcome: "reverted",
      statusAfter: "anulado",
    });
    expect(impact.inexact).toEqual({ reason: "Sin asientos en demo." });
    expect(impact.paidVesAfter).toBe(0);
  });

  it("sin asientos disponibles: la guarda de lo cobrado se sigue aplicando", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: { kind: "unavailable", reason: "Sin asientos en demo." },
        payments: [payment()],
        sale: { ...inputs().sale, paidVes: 500, status: "pendiente_pago" },
      }),
    );

    expect(impact).toMatchObject({
      allowed: false,
      reason: "El monto del pago excede lo registrado en la venta",
    });
  });

  it("dos asientos de baúl del mismo tipo: no inventa el saldo", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: {
          cashMovements: [],
          kind: "full",
          vault: { balanceVes: 5000, id: "vault-1" },
          vaultMovements: [
            { amountVes: 1000, id: "vm-1", paymentId: "pay-a", type: "sale_in", vaultId: "vault-1" },
            { amountVes: 1000, id: "vm-2", paymentId: "pay-a", type: "sale_in", vaultId: "vault-1" },
          ],
        },
        payments: [payment({ method: "pago_movil" })],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact.payments[0].effects).toEqual([]);
    expect(impact.payments[0].inexact?.reason).toContain("más de un asiento");
  });

  it("baúl ilegible: da el importe que sale pero no el saldo", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: {
          cashMovements: [],
          kind: "full",
          vault: null,
          vaultMovements: [
            { amountVes: 1000, id: "vm-1", paymentId: "pay-a", type: "sale_in", vaultId: "vault-1" },
          ],
        },
        payments: [payment({ method: "pago_movil" })],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact.payments[0].effects).toEqual([
      expect.objectContaining({ balanceAfter: null, balanceBefore: null, delta: -1000 }),
    ]);
    expect(impact.payments[0].inexact).not.toBeNull();
  });

  it("asiento de caja de tipo desconocido: lo declara inexacto", () => {
    const impact = computeSaleImpact(
      inputs({
        ledger: { ...emptyLedger, cashMovements: [cash({ type: "otro" })] },
        payments: [payment()],
        sale: { ...inputs().sale, paidVes: 1000, status: "pagada" },
      }),
    );

    expect(impact.payments[0].effects).toEqual([]);
    expect(impact.payments[0].inexact?.reason).toContain("«otro»");
  });
});

it("no modifica los datos de entrada", () => {
  const data = inputs({
    payments: [payment({ createdAt: "2026-10-01T12:00:00.000000+00:00", id: "pay-z" }), payment()],
    sale: { ...inputs().sale, paidVes: 2000, status: "pagada" },
  });
  const snapshot = JSON.parse(JSON.stringify(data));

  computeSaleImpact(data);
  computeSaleImpact({ ...data, action: "cancel" });

  expect(data).toEqual(snapshot);
});
