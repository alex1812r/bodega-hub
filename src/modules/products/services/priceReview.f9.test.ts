/**
 * @jest-environment node
 *
 * PRO-F9 · piezas puras: destinos de un reprecio, comparación de costos como la
 * base, % normalizado, huella del alta y esquemas de los cuerpos.
 */

import { priceFromMarkup } from "@/shared/utils/pricing";

import {
  buildCostChangedMessage,
  isSameCostRef,
  normalizeRepriceMarkupPct,
  resolveRepriceTargets,
} from "./priceReview";
import {
  buildProductCreateFingerprint,
  createProductSchema,
  keepProductPriceSchema,
  productPriceSchema,
  repriceProductsSchema,
} from "./productSchemas";

describe("resolveRepriceTargets", () => {
  it("une items y productIds sin repetir, en orden, y el costo esperado de items manda", () => {
    expect(
      resolveRepriceTargets({
        items: [
          { expectedCostRef: 12, productId: "a" },
          { expectedCostRef: 9, productId: "b" },
          { expectedCostRef: 99, productId: "a" },
        ],
        productIds: ["c", "b", "c"],
      }),
    ).toEqual([
      { expectedCostRef: 12, productId: "a" },
      { expectedCostRef: 9, productId: "b" },
      { expectedCostRef: null, productId: "c" },
    ]);
    expect(resolveRepriceTargets({})).toEqual([]);
  });
});

describe("costo esperado", () => {
  it("compara a dos decimales, como assert_expected_cost_ref, y redacta el mismo mensaje que la base", () => {
    expect(isSameCostRef(8, 8.004)).toBe(true);
    expect(isSameCostRef(8, 8.01)).toBe(false);
    expect(isSameCostRef(0.1 + 0.2, 0.3)).toBe(true);
    expect(buildCostChangedMessage(12, 20)).toBe("El costo cambió de 12.00 a 20.00; revisa el precio");
  });
});

describe("normalizeRepriceMarkupPct", () => {
  it("deja el % a dos decimales con la regla de priceFromMarkup, sin cambiar el precio que esta calcula", () => {
    // 1.005 × 100 = 100.4999… en coma flotante: @bodega/core lo toma como 1,00 %.
    expect(normalizeRepriceMarkupPct(1.005)).toBe(1);
    expect(normalizeRepriceMarkupPct(12.5)).toBe(12.5);
    expect(normalizeRepriceMarkupPct(30)).toBe(30);

    for (const [cost, pct] of [
      [200, 1.005],
      [1.02, 25],
      [9.99, 33.333],
      [1234.56, 0.004],
    ]) {
      expect(priceFromMarkup(cost, normalizeRepriceMarkupPct(pct))).toBe(priceFromMarkup(cost, pct));
    }
  });
});

describe("buildProductCreateFingerprint", () => {
  it("no depende del orden de las claves ni de los undefined, y cambia con cualquier valor", () => {
    const base = buildProductCreateFingerprint({
      currentStock: 9,
      name: "Harina",
      packConversion: { enabled: true, unitsPerPack: 6 },
      salePriceRef: 5,
    });

    expect(
      buildProductCreateFingerprint({
        packConversion: { unitsPerPack: 6, enabled: true },
        salePriceRef: 5,
        sku: undefined,
        name: "Harina",
        currentStock: 9,
      }),
    ).toBe(base);
    expect(buildProductCreateFingerprint({ currentStock: 20, name: "Harina", packConversion: { enabled: true, unitsPerPack: 6 }, salePriceRef: 5 })).not.toBe(base);
  });
});

describe("esquemas (PRO-F9)", () => {
  it("clientRequestId del alta es opcional y, si viene, un uuid", () => {
    const base = { categoryId: "cat-1", name: "Harina", salePriceRef: 5 };

    expect(createProductSchema.parse(base)).not.toHaveProperty("clientRequestId");
    expect(
      createProductSchema.parse({ ...base, clientRequestId: "11111111-1111-4111-8111-111111111111" }).clientRequestId,
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(createProductSchema.safeParse({ ...base, clientRequestId: "abc" }).success).toBe(false);
  });

  it("expectedCostRef es opcional en precio y mantener; no admite negativos ni texto", () => {
    expect(productPriceSchema.parse({ salePriceRef: 5 }).expectedCostRef).toBeUndefined();
    expect(productPriceSchema.parse({ expectedCostRef: 0, salePriceRef: 5 }).expectedCostRef).toBe(0);
    expect(keepProductPriceSchema.parse({}).expectedCostRef).toBeUndefined();
    expect(keepProductPriceSchema.parse({ expectedCostRef: 9.5 }).expectedCostRef).toBe(9.5);
    expect(productPriceSchema.safeParse({ expectedCostRef: -1, salePriceRef: 5 }).success).toBe(false);
    expect(keepProductPriceSchema.safeParse({ expectedCostRef: "9" }).success).toBe(false);
  });

  it("el reprecio admite productIds, items o ambos: de 1 a 100 productos distintos", () => {
    const ids = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
    const items = (count: number) => ids(count, "i").map((productId) => ({ expectedCostRef: 1, productId }));

    expect(repriceProductsSchema.safeParse({ markupPct: 30, productIds: ["a"] }).success).toBe(true);
    expect(repriceProductsSchema.safeParse({ items: items(100), markupPct: 30 }).success).toBe(true);
    expect(repriceProductsSchema.safeParse({ items: items(50), markupPct: 30, productIds: ids(50, "p") }).success).toBe(true);
    expect(repriceProductsSchema.safeParse({ items: items(51), markupPct: 30, productIds: ids(50, "p") }).success).toBe(false);
    expect(repriceProductsSchema.safeParse({ markupPct: 30 }).success).toBe(false);
    expect(repriceProductsSchema.safeParse({ items: [], markupPct: 30, productIds: [] }).success).toBe(false);
    expect(repriceProductsSchema.safeParse({ items: [{ productId: "a" }], markupPct: 30 }).success).toBe(false);
  });
});
