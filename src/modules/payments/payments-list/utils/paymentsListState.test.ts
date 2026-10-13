import { parseDateRangeParams } from "@/shared/components/DateRangeField";

import {
  CLEARED_PAYMENTS_FILTERS,
  hasActivePaymentsFilters,
  paymentsListSchema,
  toPaymentsFilters,
  type PaymentsListState,
} from "./paymentsListState";

const DEFAULT_STATE: PaymentsListState = paymentsListSchema.parse({});
const TODAY = "2026-10-09";

/** Filtros como los calcula la pantalla: el rango sale de `parseDateRangeParams`. */
function filtersOf(state: PaymentsListState, salePaymentsOnly: boolean) {
  return toPaymentsFilters(state, salePaymentsOnly, parseDateRangeParams(state, TODAY));
}

describe("paymentsListState", () => {
  it("los valores por defecto no filtran nada", () => {
    expect(DEFAULT_STATE).toEqual({
      contactId: "",
      direction: "all",
      from: "",
      limit: 10,
      method: "all",
      page: 1,
      preset: "",
      purchaseId: "",
      saleId: "",
      to: "",
    });
    expect(filtersOf(DEFAULT_STATE, false)).toEqual({});
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

    expect(filtersOf(state, false)).toEqual({
      contactId: "cont-supplier",
      direction: "salida",
      from: "2026-10-01",
      method: "transferencia",
      purchaseId: "purchase-001",
      to: "2026-10-06",
    });
    expect(hasActivePaymentsFilters(state, false)).toBe(true);
  });

  it("INT-05 · un `preset` relativo viaja como sus fechas de hoy; un rango propio manda sobre él", () => {
    expect(filtersOf({ ...DEFAULT_STATE, preset: "last_month" }, false)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(filtersOf({ ...DEFAULT_STATE, preset: "today" }, false)).toEqual({
      from: TODAY,
      to: TODAY,
    });
    expect(
      filtersOf({ ...DEFAULT_STATE, from: "2026-08-03", preset: "last_month", to: "2026-08-05" }, false),
    ).toEqual({ from: "2026-08-03", to: "2026-08-05" });
    expect(paymentsListSchema.safeParse({ preset: "siempre" }).success).toBe(false);
  });

  it("vendedor: siempre entradas, sin purchaseId, y esos dos no cuentan como filtro activo", () => {
    const state: PaymentsListState = {
      ...DEFAULT_STATE,
      direction: "salida",
      purchaseId: "purchase-001",
    };

    expect(filtersOf(state, true)).toEqual({ direction: "entrada" });
    expect(filtersOf(DEFAULT_STATE, true)).toEqual({ direction: "entrada" });
    expect(hasActivePaymentsFilters(state, true)).toBe(false);
    expect(hasActivePaymentsFilters({ ...state, saleId: "sale-002" }, true)).toBe(true);
  });

  it.each([
    ["contactId", "cont-customer"],
    ["direction", "entrada"],
    ["from", "2026-10-01"],
    ["method", "efectivo_usd"],
    ["preset", "last_month"],
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
