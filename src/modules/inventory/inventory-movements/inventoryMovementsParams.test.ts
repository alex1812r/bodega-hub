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
    expect(toMovementFilters(INVENTORY_MOVEMENTS_NO_FILTERS, "V-")).toEqual({
      document: undefined,
      documentKind: undefined,
      from: undefined,
      productId: undefined,
      to: undefined,
      type: undefined,
    });
    expect(
      toMovementFilters(
        {
          documentKind: "sin_documento",
          from: "2026-10-01",
          productId: "p-1",
          to: "2026-10-05",
          type: "ajuste_salida",
        },
        " V-00 ",
      ),
    ).toEqual({
      document: "V-00",
      documentKind: "sin_documento",
      from: "2026-10-01",
      productId: "p-1",
      to: "2026-10-05",
      type: "ajuste_salida",
    });
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
