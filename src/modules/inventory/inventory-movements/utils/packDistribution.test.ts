import {
  buildDefaultPackDistribution,
  checkPackDistribution,
  type PackDistributionUnits,
  parsePackDistribution,
  toPackDistributionList,
} from "./packDistribution";

/** Surtido de 6: 2 Cola + 2 Manzana + 2 Naranja por empaque. */
const recipe = [
  { unitProductId: "cola", unitsPerPack: 2 },
  { unitProductId: "manzana", unitsPerPack: 2 },
  { unitProductId: "naranja", unitsPerPack: 2 },
];

describe("buildDefaultPackDistribution", () => {
  it("reparte unidades por empaque × empaques a cada componente", () => {
    expect(buildDefaultPackDistribution(recipe, 3)).toEqual({ cola: 6, manzana: 6, naranja: 6 });
    expect(
      buildDefaultPackDistribution(
        [
          { unitProductId: "a", unitsPerPack: 5 },
          { unitProductId: "b", unitsPerPack: 1 },
        ],
        2,
      ),
    ).toEqual({ a: 10, b: 2 });
  });
});

describe("parsePackDistribution", () => {
  it("un componente sin tocar vale lo de la receta; el tecleado, lo tecleado", () => {
    expect(parsePackDistribution(recipe, 3, {})).toEqual({ cola: 6, manzana: 6, naranja: 6 });
    expect(parsePackDistribution(recipe, 3, { cola: "7", manzana: "5" })).toEqual({
      cola: 7,
      manzana: 5,
      naranja: 6,
    });
  });

  it("un campo vacío reparte 0", () => {
    expect(parsePackDistribution(recipe, 3, { cola: "", manzana: "  " })).toEqual({
      cola: 0,
      manzana: 0,
      naranja: 6,
    });
  });

  it("un texto con decimales o que no es un número queda como NaN; «3,0» es 3", () => {
    const parsed = parsePackDistribution(recipe, 3, { cola: "2.5", manzana: "abc", naranja: "3,0" });

    expect(parsed.cola).toBeNaN();
    expect(parsed.manzana).toBeNaN();
    expect(parsed.naranja).toBe(3);
  });

  it("ignora productos que no son de la receta", () => {
    expect(parsePackDistribution(recipe, 1, { otro: "9" })).toEqual({ cola: 2, manzana: 2, naranja: 2 });
  });
});

describe("checkPackDistribution", () => {
  it("sin reparto vale la receta: válido y sin ajuste", () => {
    expect(checkPackDistribution(recipe, 3, undefined)).toEqual({
      difference: 0,
      distributedTotal: 18,
      expectedTotal: 18,
      hasInvalidUnits: false,
      isAdjusted: false,
      isValid: true,
      message: null,
      units: { cola: 6, manzana: 6, naranja: 6 },
    });
  });

  it("3 empaques 2-2-2 con uno a 3-1-2 (7 / 5 / 6): suma 18, válido y ajustado", () => {
    expect(checkPackDistribution(recipe, 3, { cola: 7, manzana: 5, naranja: 6 })).toMatchObject({
      difference: 0,
      distributedTotal: 18,
      expectedTotal: 18,
      isAdjusted: true,
      isValid: true,
      message: null,
    });
  });

  it("la suma se comprueba contra el TOTAL de los empaques, no empaque a empaque: todo a un componente vale", () => {
    expect(checkPackDistribution(recipe, 3, { cola: 18, manzana: 0, naranja: 0 })).toMatchObject({
      isAdjusted: true,
      isValid: true,
    });
  });

  it("faltan o sobran unidades: dice cuántas y cuánto debe sumar", () => {
    expect(checkPackDistribution(recipe, 3, { cola: 7, manzana: 5, naranja: 5 })).toMatchObject({
      difference: -1,
      isValid: false,
      message: "Faltan 1 unidad(es) por repartir: el reparto debe sumar 18.",
    });
    expect(checkPackDistribution(recipe, 3, { cola: 9 })).toMatchObject({
      difference: 3,
      isValid: false,
      message: "Sobran 3 unidad(es): el reparto debe sumar 18.",
    });
  });

  it("negativos, decimales y NaN: reparto inválido aunque la suma cuadre", () => {
    const invalid: PackDistributionUnits[] = [
      { cola: -1, manzana: 13, naranja: 6 },
      { cola: 6.5, manzana: 5.5, naranja: 6 },
      { cola: Number.NaN },
    ];

    for (const bad of invalid) {
      expect(checkPackDistribution(recipe, 3, bad)).toMatchObject({
        hasInvalidUnits: true,
        isValid: false,
        message: "Las unidades del reparto deben ser enteros mayores o iguales a cero.",
      });
    }
  });

  it("un reparto con las mismas unidades que la receta no es un ajuste", () => {
    expect(checkPackDistribution(recipe, 1, { cola: 2, manzana: 2, naranja: 2 }).isAdjusted).toBe(false);
  });
});

describe("toPackDistributionList", () => {
  it("una entrada por componente, en el orden de la receta, con los ceros", () => {
    expect(toPackDistributionList(recipe, { naranja: 6, cola: 12, manzana: 0 })).toEqual([
      { unitProductId: "cola", units: 12 },
      { unitProductId: "manzana", units: 0 },
      { unitProductId: "naranja", units: 6 },
    ]);
  });
});
