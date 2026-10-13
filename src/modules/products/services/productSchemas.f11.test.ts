/**
 * PRO-F11 · bajos de CAOS pasada 2 en los esquemas de precio:
 * - B7: un % de reprecio menor que 0,01 pasaba la validación y fallaba fila a
 *   fila (o se redondeaba a 0,01 % y dejaba el precio igual al costo);
 * - B8: `expectedCostRef` sin tope: 1e308 acababa en un 409 cuyo mensaje
 *   llevaba un número de 309 cifras.
 */
import {
  keepProductPriceSchema,
  productPriceSchema,
  repriceProductsSchema,
} from "./productSchemas";

/** Tope de `current_cost_ref`, `numeric(12,2)`. */
const MAX_COST = 9_999_999_999.99;

describe("productSchemas · % mínimo del reprecio (B7)", () => {
  it.each([0.001, 0.004, 0.005, 0.0099])("rechaza un %% de %s", (markupPct) => {
    expect(repriceProductsSchema.safeParse({ markupPct, productIds: ["p-1"] }).success).toBe(false);
  });

  it("acepta 0,01 %", () => {
    expect(repriceProductsSchema.safeParse({ markupPct: 0.01, productIds: ["p-1"] }).success).toBe(
      true,
    );
  });
});

describe("productSchemas · tope del costo esperado (B8)", () => {
  it("rechaza un costo esperado mayor que el tope de la columna", () => {
    expect(productPriceSchema.safeParse({ expectedCostRef: 1e308, salePriceRef: 10 }).success).toBe(
      false,
    );
    expect(keepProductPriceSchema.safeParse({ expectedCostRef: 1e13 }).success).toBe(false);
    expect(
      repriceProductsSchema.safeParse({
        items: [{ expectedCostRef: 1e308, productId: "p-1" }],
        markupPct: 20,
      }).success,
    ).toBe(false);
  });

  it("acepta el tope y los costos normales", () => {
    expect(keepProductPriceSchema.safeParse({ expectedCostRef: MAX_COST }).success).toBe(true);
    expect(productPriceSchema.safeParse({ expectedCostRef: 9, salePriceRef: 10 }).success).toBe(true);
    expect(
      repriceProductsSchema.safeParse({
        items: [{ expectedCostRef: 0, productId: "p-1" }],
        markupPct: 20,
      }).success,
    ).toBe(true);
  });
});
