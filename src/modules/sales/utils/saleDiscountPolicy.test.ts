import { ApiError } from "@/lib/api/apiError";

import {
  assertSaleDiscountAllowed,
  assertSaleDiscountBelowBodySubtotal,
  canApplySaleDiscount,
  saleBodySubtotalCents,
  SALE_DISCOUNT_OVER_SUBTOTAL_MESSAGE,
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

describe("saleDiscountPolicy · descuento contra el subtotal del cuerpo (POS-F3)", () => {
  const lines = [
    { quantity: 2, unitPriceRef: 6.2 },
    { quantity: 1, unitPriceRef: 5 },
  ];

  it("suma el subtotal en céntimos, línea a línea, sin arrastrar coma flotante", () => {
    expect(saleBodySubtotalCents(lines)).toBe(1740);
    expect(saleBodySubtotalCents([{ quantity: 3, unitPriceRef: 0.1 }, { quantity: 1, unitPriceRef: 0.2 }])).toBe(50);
    expect(saleBodySubtotalCents([...lines, { quantity: 1 }])).toBeNull();
  });

  it("rechaza con 400 el descuento igual o mayor al subtotal y deja pasar subtotal − 0,01", () => {
    for (const discountRef of [17.4, 27.4]) {
      expect(() => assertSaleDiscountBelowBodySubtotal(discountRef, lines)).toThrow(
        expect.objectContaining({ message: SALE_DISCOUNT_OVER_SUBTOTAL_MESSAGE, status: 400 }),
      );
    }

    expect(() => assertSaleDiscountBelowBodySubtotal(17.39, lines)).not.toThrow();
    expect(() => assertSaleDiscountBelowBodySubtotal(0, [{ quantity: 1, unitPriceRef: 0 }])).not.toThrow();
  });

  it("no decide cuando alguna línea no trae precio (lo pone el RPC)", () => {
    expect(() => assertSaleDiscountBelowBodySubtotal(999, [...lines, { quantity: 1 }])).not.toThrow();
  });
});
