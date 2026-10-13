import {
  buildDefaultPackOpeningDistribution,
  computePackOpeningEffect,
  type PackOpeningRecipe,
  toPackOpeningRequestComponents,
} from "./packOpeningEffect";

function component(unitProductId: string, name: string, currentStock: number, isActive = true) {
  return { currentStock, isActive, name, sku: `${unitProductId}-sku`, unitProductId, unitsPerPack: 2 };
}

const recipe: PackOpeningRecipe = {
  components: [
    component("prod-cola", "Cola", 12),
    component("prod-manzana", "Manzana", 0),
    component("prod-naranja", "Naranja", 5, false),
  ],
  pack: { currentStock: 9, name: "Surtido A" },
};

describe("buildDefaultPackOpeningDistribution", () => {
  it("reparte receta × empaques", () => {
    expect(buildDefaultPackOpeningDistribution(recipe.components, 3)).toEqual({
      "prod-cola": 6,
      "prod-manzana": 6,
      "prod-naranja": 6,
    });
  });

  it("respeta recetas desiguales", () => {
    expect(
      buildDefaultPackOpeningDistribution(
        [
          { unitProductId: "a", unitsPerPack: 4 },
          { unitProductId: "b", unitsPerPack: 1 },
        ],
        2,
      ),
    ).toEqual({ a: 8, b: 2 });
  });

  it.each([0, -1, 2.5, Number.NaN])("cantidad %p: todo en 0", (packQuantity) => {
    expect(buildDefaultPackOpeningDistribution(recipe.components, packQuantity)).toEqual({
      "prod-cola": 0,
      "prod-manzana": 0,
      "prod-naranja": 0,
    });
  });
});

describe("computePackOpeningEffect", () => {
  it("reparto por receta: deltas, stocks resultantes y totales", () => {
    const effect = computePackOpeningEffect({
      distribution: buildDefaultPackOpeningDistribution(recipe.components, 3),
      packQuantity: 3,
      recipe,
    });

    expect(effect).toEqual({
      components: [
        {
          delta: 6,
          isActive: true,
          isValidUnits: true,
          name: "Cola",
          sku: "prod-cola-sku",
          stockAfter: 18,
          stockBefore: 12,
          unitProductId: "prod-cola",
          units: 6,
        },
        {
          delta: 6,
          isActive: true,
          isValidUnits: true,
          name: "Manzana",
          sku: "prod-manzana-sku",
          stockAfter: 6,
          stockBefore: 0,
          unitProductId: "prod-manzana",
          units: 6,
        },
        {
          delta: 6,
          isActive: false,
          isValidUnits: true,
          name: "Naranja",
          sku: "prod-naranja-sku",
          stockAfter: 11,
          stockBefore: 5,
          unitProductId: "prod-naranja",
          units: 6,
        },
      ],
      difference: 0,
      distributedTotal: 18,
      expectedTotal: 18,
      isValid: true,
      issues: [],
      pack: { delta: -3, name: "Surtido A", stockAfter: 6, stockBefore: 9 },
      packQuantity: 3,
    });
  });

  it("reparto real distinto de la receta que suma lo mismo: válido", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 10, "prod-manzana": 2, "prod-naranja": 0 },
      packQuantity: 2,
      recipe,
    });

    expect(effect.isValid).toBe(true);
    expect(effect.expectedTotal).toBe(12);
    expect(effect.distributedTotal).toBe(12);
    expect(effect.components.map((item) => item.stockAfter)).toEqual([22, 2, 5]);
  });

  it("un componente que falta en el reparto cuenta 0", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 6 },
      packQuantity: 1,
      recipe,
    });

    expect(effect.isValid).toBe(true);
    expect(effect.components.map((item) => item.units)).toEqual([6, 0, 0]);
  });

  it("un producto que no es de la receta se ignora", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 6, "prod-otro": 4 },
      packQuantity: 1,
      recipe,
    });

    expect(effect.distributedTotal).toBe(6);
    expect(effect.components).toHaveLength(3);
    expect(effect.isValid).toBe(true);
  });

  it("faltan unidades: diferencia negativa y `sum_mismatch`", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 2, "prod-manzana": 2, "prod-naranja": 1 },
      packQuantity: 1,
      recipe,
    });

    expect(effect.difference).toBe(-1);
    expect(effect.issues).toEqual(["sum_mismatch"]);
    expect(effect.isValid).toBe(false);
  });

  it("sobran unidades: diferencia positiva y `sum_mismatch`", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 5, "prod-manzana": 2, "prod-naranja": 2 },
      packQuantity: 1,
      recipe,
    });

    expect(effect.difference).toBe(3);
    expect(effect.issues).toEqual(["sum_mismatch"]);
  });

  it("abrir más empaques de los que hay: `pack_negative` con el stock resultante negativo", () => {
    const effect = computePackOpeningEffect({
      distribution: buildDefaultPackOpeningDistribution(recipe.components, 10),
      packQuantity: 10,
      recipe,
    });

    expect(effect.pack).toEqual({ delta: -10, name: "Surtido A", stockAfter: -1, stockBefore: 9 });
    expect(effect.issues).toEqual(["pack_negative"]);
    expect(effect.isValid).toBe(false);
  });

  it("abrir exactamente todo el stock del empaque es válido", () => {
    const effect = computePackOpeningEffect({
      distribution: buildDefaultPackOpeningDistribution(recipe.components, 9),
      packQuantity: 9,
      recipe,
    });

    expect(effect.pack.stockAfter).toBe(0);
    expect(effect.isValid).toBe(true);
  });

  it("unidades con decimales: `invalid_units` aunque la suma coincida", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 2.5, "prod-manzana": 1.5, "prod-naranja": 2 },
      packQuantity: 1,
      recipe,
    });

    expect(effect.distributedTotal).toBe(6);
    expect(effect.issues).toEqual(["invalid_units"]);
    expect(effect.components.map((item) => item.isValidUnits)).toEqual([false, false, true]);
  });

  it("unidades negativas: `invalid_units` aunque la suma coincida", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 8, "prod-manzana": -2, "prod-naranja": 0 },
      packQuantity: 1,
      recipe,
    });

    expect(effect.issues).toEqual(["invalid_units"]);
    expect(effect.components[1]).toMatchObject({ isValidUnits: false, units: -2 });
  });

  it("unidades no numéricas: cuentan 0 y son `invalid_units`", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": Number.NaN, "prod-manzana": 3, "prod-naranja": 3 },
      packQuantity: 1,
      recipe,
    });

    expect(effect.components[0]).toMatchObject({ isValidUnits: false, stockAfter: 12, units: 0 });
    expect(effect.issues).toEqual(["invalid_units"]);
  });

  it.each([0, -2, 1.5, Number.NaN])("cantidad de empaques %p: `invalid_quantity`", (packQuantity) => {
    const effect = computePackOpeningEffect({ distribution: {}, packQuantity, recipe });

    expect(effect.issues).toContain("invalid_quantity");
    expect(effect.expectedTotal).toBe(0);
    expect(effect.isValid).toBe(false);
  });

  it("sin empaques no deja `-0` en el delta", () => {
    const effect = computePackOpeningEffect({ distribution: {}, packQuantity: 0, recipe });

    expect(Object.is(effect.pack.delta, 0)).toBe(true);
    expect(effect.pack.stockAfter).toBe(9);
  });

  it("acumula todos los problemas a la vez", () => {
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 1.5 },
      packQuantity: 10,
      recipe,
    });

    expect(effect.issues).toEqual(["pack_negative", "invalid_units", "sum_mismatch"]);
  });
});

describe("toPackOpeningRequestComponents", () => {
  it("omite los 0 y ordena por id de producto, sea cual sea el orden de la receta", () => {
    const shuffled: PackOpeningRecipe = {
      ...recipe,
      components: [recipe.components[2], recipe.components[0], recipe.components[1]],
    };
    const effect = computePackOpeningEffect({
      distribution: { "prod-cola": 4, "prod-manzana": 0, "prod-naranja": 2 },
      packQuantity: 1,
      recipe: shuffled,
    });

    expect(toPackOpeningRequestComponents(effect)).toEqual([
      { unitProductId: "prod-cola", units: 4 },
      { unitProductId: "prod-naranja", units: 2 },
    ]);
  });
});
