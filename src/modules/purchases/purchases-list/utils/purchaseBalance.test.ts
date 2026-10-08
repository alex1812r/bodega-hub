import {
  getPurchaseBalanceRef,
  getPurchasePaymentStatus,
  getPurchasePendingRef,
  hasPendingBalance,
} from "./purchaseBalance";
import {
  hasActivePurchasesFilters,
  purchasesListSchema,
  toPurchasesFilters,
} from "./purchasesListState";

describe("purchaseBalance", () => {
  it("el saldo es total − pagado en REF, redondeado y nunca negativo", () => {
    expect(getPurchasePendingRef({ paidRef: 5.02, totalRef: 18 })).toBe(12.98);
    expect(getPurchasePendingRef({ totalRef: 20 })).toBe(20);
    expect(getPurchasePendingRef({ paidRef: 25, totalRef: 20 })).toBe(0);
    expect(getPurchasePendingRef({ paidRef: 0.1, totalRef: 0.3 })).toBe(0.2);
  });

  it.each([
    ["pedido", true],
    ["recibido", true],
    ["cancelado", false],
    ["devuelto", false],
  ])("una compra %s con deuda cuenta como saldo pendiente: %s", (status, expected) => {
    const purchase = { paidRef: 0, status, totalRef: 20 };

    expect(hasPendingBalance(purchase)).toBe(expected);
    expect(getPurchaseBalanceRef(purchase)).toBe(expected ? 20 : null);
  });

  it("menos de un céntimo de REF no es saldo pendiente", () => {
    expect(hasPendingBalance({ paidRef: 19.996, status: "recibido", totalRef: 20 })).toBe(false);
    expect(hasPendingBalance({ paidRef: 19.99, status: "recibido", totalRef: 20 })).toBe(true);
    expect(hasPendingBalance({ paidRef: 20, status: "recibido", totalRef: 20 })).toBe(false);
  });

  it("estado de pago con los umbrales del detalle de compra", () => {
    expect(getPurchasePaymentStatus({ paidRef: 20, totalRef: 20 })).toBe("pagada");
    expect(getPurchasePaymentStatus({ paidRef: 5.02, totalRef: 18 })).toBe("parcial");
    expect(getPurchasePaymentStatus({ paidRef: 0, totalRef: 18 })).toBe("pendiente");
    expect(getPurchasePaymentStatus({ totalRef: 18 })).toBe("pendiente");
  });
});

describe("purchasesListState", () => {
  const defaults = purchasesListSchema.parse({});

  it("sin parámetros: todas las compras, página 1, sin filtros activos", () => {
    expect(defaults).toEqual({
      from: "",
      limit: 10,
      page: 1,
      pendingBalance: "",
      search: "",
      status: "all",
      to: "",
    });
    expect(hasActivePurchasesFilters(defaults)).toBe(false);
    expect(toPurchasesFilters(defaults, "")).toEqual({
      from: undefined,
      pendingBalance: undefined,
      search: undefined,
      status: undefined,
      to: undefined,
    });
  });

  it("traduce el estado de la URL a los filtros del endpoint", () => {
    const state = {
      ...defaults,
      from: "2026-05-01",
      pendingBalance: "1" as const,
      search: "  acme ",
      status: "recibido" as const,
      to: "2026-05-31",
    };

    expect(hasActivePurchasesFilters(state)).toBe(true);
    expect(toPurchasesFilters(state, state.search)).toEqual({
      from: "2026-05-01",
      pendingBalance: "1",
      search: "acme",
      status: "recibido",
      to: "2026-05-31",
    });
  });

  it("rechaza fechas y valores que no existen", () => {
    expect(purchasesListSchema.shape.from.safeParse("2026-02-31").success).toBe(false);
    expect(purchasesListSchema.shape.pendingBalance.safeParse("si").success).toBe(false);
    expect(purchasesListSchema.shape.status.safeParse("pagada").success).toBe(false);
  });
});
