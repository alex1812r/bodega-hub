import {
  CLEARED_PAYMENTS_FILTERS,
  hasActivePaymentsFilters,
  paymentsListSchema,
  toPaymentsFilters,
  type PaymentsListState,
} from "./paymentsListState";

const DEFAULT_STATE: PaymentsListState = paymentsListSchema.parse({});

describe("paymentsListState", () => {
  it("los valores por defecto no filtran nada", () => {
    expect(DEFAULT_STATE).toEqual({
      contactId: "",
      direction: "all",
      from: "",
      limit: 10,
      method: "all",
      page: 1,
      purchaseId: "",
      saleId: "",
      to: "",
    });
    expect(toPaymentsFilters(DEFAULT_STATE, false)).toEqual({});
    expect(hasActivePaymentsFilters(DEFAULT_STATE, false)).toBe(false);
  });

  it("traduce el estado de la URL a los filtros de la API", () => {
    const state: PaymentsListState = {
      ...DEFAULT_STATE,
      contactId: "cont-supplier",
      direction: "salida",
      from: "2026-10-01",
      method: "transferencia",
      purchaseId: "purchase-001",
      to: "2026-10-06",
    };

    expect(toPaymentsFilters(state, false)).toEqual({
      contactId: "cont-supplier",
      direction: "salida",
      from: "2026-10-01",
      method: "transferencia",
      purchaseId: "purchase-001",
      to: "2026-10-06",
    });
    expect(hasActivePaymentsFilters(state, false)).toBe(true);
  });

  it("vendedor: siempre entradas, sin purchaseId, y esos dos no cuentan como filtro activo", () => {
    const state: PaymentsListState = {
      ...DEFAULT_STATE,
      direction: "salida",
      purchaseId: "purchase-001",
    };

    expect(toPaymentsFilters(state, true)).toEqual({ direction: "entrada" });
    expect(toPaymentsFilters(DEFAULT_STATE, true)).toEqual({ direction: "entrada" });
    expect(hasActivePaymentsFilters(state, true)).toBe(false);
    expect(hasActivePaymentsFilters({ ...state, saleId: "sale-002" }, true)).toBe(true);
  });

  it.each([
    ["contactId", "cont-customer"],
    ["direction", "entrada"],
    ["from", "2026-10-01"],
    ["method", "efectivo_usd"],
    ["purchaseId", "purchase-001"],
    ["saleId", "sale-002"],
    ["to", "2026-10-06"],
  ] as const)("%s cuenta como filtro activo y «Limpiar filtros» lo quita", (key, value) => {
    const state = { ...DEFAULT_STATE, [key]: value };

    expect(hasActivePaymentsFilters(state, false)).toBe(true);
    expect(hasActivePaymentsFilters({ ...state, ...CLEARED_PAYMENTS_FILTERS }, false)).toBe(false);
  });

  it("la pagina y el tamaño no son filtros", () => {
    expect(hasActivePaymentsFilters({ ...DEFAULT_STATE, limit: 50, page: 4 }, false)).toBe(false);
    expect(CLEARED_PAYMENTS_FILTERS).not.toHaveProperty("limit");
  });
});
