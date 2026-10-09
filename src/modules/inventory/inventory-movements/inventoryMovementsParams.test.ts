import { parseDateRangeParams } from "@/shared/components/DateRangeField";

import {
  hasInventoryMovementsFilters,
  INVENTORY_MOVEMENTS_NO_FILTERS,
  inventoryMovementsSchema,
  isMovementDocumentTooShort,
  isMovementsRangeInverted,
  toMovementFilters,
} from "./inventoryMovementsParams";

jest.mock("next/navigation", () => ({
  usePathname: () => "/inventory/movements",
  useSearchParams: () => new URLSearchParams(),
}));

describe("inventoryMovementsParams", () => {
  it("defaults to no filters, page 1 and 10 rows", () => {
    expect(inventoryMovementsSchema.parse({})).toEqual({
      ...INVENTORY_MOVEMENTS_NO_FILTERS,
      limit: 10,
      page: 1,
    });
  });

  it("accepts every known movement type and rejects the rest", () => {
    expect(inventoryMovementsSchema.shape.type.safeParse("conversion_salida").success).toBe(true);
    expect(inventoryMovementsSchema.shape.type.safeParse("robo").success).toBe(false);
    expect(inventoryMovementsSchema.shape.documentKind.safeParse("factura").success).toBe(false);
  });

  it("detects an inverted range only with both dates", () => {
    expect(isMovementsRangeInverted({ from: "2026-10-05", to: "2026-10-01" })).toBe(true);
    expect(isMovementsRangeInverted({ from: "2026-10-05", to: "2026-10-05" })).toBe(false);
    expect(isMovementsRangeInverted({ from: "2026-10-05", to: "" })).toBe(false);
    expect(isMovementsRangeInverted({ from: "", to: "2026-10-01" })).toBe(false);
  });

  it("treats 1 or 2 characters of document as too short", () => {
    expect(isMovementDocumentTooShort("")).toBe(false);
    expect(isMovementDocumentTooShort("  ")).toBe(false);
    expect(isMovementDocumentTooShort("V")).toBe(true);
    expect(isMovementDocumentTooShort(" V- ")).toBe(true);
    expect(isMovementDocumentTooShort("V-0")).toBe(false);
  });

  it("sends the document only from 3 characters and drops the empty filters", () => {
    expect(toMovementFilters(INVENTORY_MOVEMENTS_NO_FILTERS, "V-", {})).toEqual({
      document: undefined,
      documentKind: undefined,
      from: undefined,
      productId: undefined,
      purchaseId: undefined,
      saleId: undefined,
      to: undefined,
      type: undefined,
    });
    expect(
      toMovementFilters(
        {
          documentKind: "sin_documento",
          productId: "p-1",
          purchaseId: "",
          saleId: "",
          type: "ajuste_salida",
        },
        " V-00 ",
        { from: "2026-10-01", to: "2026-10-05" },
      ),
    ).toEqual({
      document: "V-00",
      documentKind: "sin_documento",
      from: "2026-10-01",
      productId: "p-1",
      purchaseId: undefined,
      saleId: undefined,
      to: "2026-10-05",
      type: "ajuste_salida",
    });
  });

  // INT-05: el rango de la consulta sale de `parseDateRangeParams`, no de `state.from/to`.
  it("resolves a relative preset of the URL with the operating day and counts it as a filter", () => {
    const state = inventoryMovementsSchema.parse({ preset: "last_month" });
    const range = parseDateRangeParams(state, "2026-10-09");

    expect(state).toMatchObject({ from: "", preset: "last_month", to: "" });
    expect(toMovementFilters(state, "", range)).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(hasInventoryMovementsFilters(state)).toBe(true);
    expect(hasInventoryMovementsFilters({ ...state, ...INVENTORY_MOVEMENTS_NO_FILTERS })).toBe(false);
    expect(inventoryMovementsSchema.safeParse({ preset: "siempre" }).success).toBe(false);
  });

  // DET-05: «Ver movimientos de stock» del detalle de una venta o una compra.
  it("reads the sale and the purchase of the URL and sends them to the server as exact filters", () => {
    const state = inventoryMovementsSchema.parse({ purchaseId: "purchase-7", saleId: "sale-1" });

    expect(state).toMatchObject({ purchaseId: "purchase-7", saleId: "sale-1" });
    expect(toMovementFilters(state, "", {})).toMatchObject({
      purchaseId: "purchase-7",
      saleId: "sale-1",
    });
    expect(inventoryMovementsSchema.parse({ saleId: "sale-1" })).toMatchObject({
      purchaseId: "",
      saleId: "sale-1",
    });
  });

  it("rejects a sale or purchase id longer than 64 characters", () => {
    expect(inventoryMovementsSchema.shape.saleId.safeParse("x".repeat(65)).success).toBe(false);
    expect(inventoryMovementsSchema.shape.purchaseId.safeParse("x".repeat(65)).success).toBe(
      false,
    );
    expect(inventoryMovementsSchema.shape.saleId.safeParse("x".repeat(64)).success).toBe(true);
  });

  it("counts the sale and the purchase of the URL as filters, and clearing removes them", () => {
    expect(
      hasInventoryMovementsFilters({ ...INVENTORY_MOVEMENTS_NO_FILTERS, saleId: "sale-1" }),
    ).toBe(true);
    expect(
      hasInventoryMovementsFilters({ ...INVENTORY_MOVEMENTS_NO_FILTERS, purchaseId: "purchase-7" }),
    ).toBe(true);
    expect(INVENTORY_MOVEMENTS_NO_FILTERS).toMatchObject({ purchaseId: "", saleId: "" });
  });

  it("counts a typed document as a filter even before it is sent", () => {
    expect(hasInventoryMovementsFilters(INVENTORY_MOVEMENTS_NO_FILTERS)).toBe(false);
    expect(hasInventoryMovementsFilters({ ...INVENTORY_MOVEMENTS_NO_FILTERS, document: "V" })).toBe(
      true,
    );
    expect(
      hasInventoryMovementsFilters({ ...INVENTORY_MOVEMENTS_NO_FILTERS, documentKind: "compra" }),
    ).toBe(true);
  });
});
