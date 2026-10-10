import { ApiError } from "@/lib/api/apiError";

import {
  assertSaleDiscountAllowed,
  canApplySaleDiscount,
  SALE_DISCOUNT_DECIMALS_MESSAGE,
  SALE_DISCOUNT_FORBIDDEN_MESSAGE,
  SALE_DISCOUNT_INVALID_MESSAGE,
  SALE_DISCOUNT_NEGATIVE_MESSAGE,
} from "./saleDiscountPolicy";

function rejection(discountRef: number, role: string | undefined) {
  try {
    assertSaleDiscountAllowed(discountRef, role);
  } catch (error) {
    if (error instanceof ApiError) {
      return { code: error.code, message: error.message, status: error.status };
    }

    throw error;
  }

  return null;
}

describe("saleDiscountPolicy", () => {
  it("solo el vendedor (y un rol desconocido) queda sin descuento", () => {
    expect(canApplySaleDiscount("vendedor")).toBe(false);
    expect(canApplySaleDiscount(undefined)).toBe(false);
    expect(canApplySaleDiscount("admin")).toBe(true);
    expect(canApplySaleDiscount("superadmin")).toBe(true);
  });

  it.each([
    ["vendedor", 0],
    ["admin", 0],
    ["admin", 0.01],
    ["admin", 19.99],
    ["admin", 1234.5],
  ])("acepta %s con descuento %s", (role, discountRef) => {
    expect(rejection(discountRef, role)).toBeNull();
  });

  it.each([0.01, 5, 14.99])("rechaza con 403 al vendedor con descuento %s", (discountRef) => {
    expect(rejection(discountRef, "vendedor")).toEqual({
      code: "FORBIDDEN",
      message: SALE_DISCOUNT_FORBIDDEN_MESSAGE,
      status: 403,
    });
  });

  it.each<[string, number, string]>([
    ["NaN", Number.NaN, SALE_DISCOUNT_INVALID_MESSAGE],
    ["Infinity", Number.POSITIVE_INFINITY, SALE_DISCOUNT_INVALID_MESSAGE],
    ["-Infinity", Number.NEGATIVE_INFINITY, SALE_DISCOUNT_INVALID_MESSAGE],
    ["negativo", -0.01, SALE_DISCOUNT_NEGATIVE_MESSAGE],
    ["3 decimales", 1.005, SALE_DISCOUNT_DECIMALS_MESSAGE],
    ["suma en coma flotante", 0.1 + 0.2, SALE_DISCOUNT_DECIMALS_MESSAGE],
  ])("rechaza con 400 la forma inválida (%s) antes de mirar el rol", (_caso, discountRef, message) => {
    for (const role of ["vendedor", "admin"]) {
      expect(rejection(discountRef, role)).toEqual({ code: "BAD_REQUEST", message, status: 400 });
    }
  });
});
