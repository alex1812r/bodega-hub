import { describe, expect, it } from "@jest/globals";

import {
  assertPackDistribution,
  convertPackToUnitsSchema,
  packConversionInputSchema,
} from "./packConversionSchemas";

describe("packConversionInputSchema", () => {
  it("accepts disabled conversion", () => {
    expect(packConversionInputSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("requires unitsPerPack when enabled", () => {
    const result = packConversionInputSchema.safeParse({
      enabled: true,
      mode: "create_unit",
      unitProduct: { salePriceRef: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts create_unit mode", () => {
    const result = packConversionInputSchema.parse({
      enabled: true,
      mode: "create_unit",
      unitsPerPack: 10,
      unitProduct: { salePriceRef: 1.5, name: "Unidad" },
    });
    expect(result.enabled).toBe(true);
    expect(result.unitsPerPack).toBe(10);
  });

  it("requires unitProductId for link_existing", () => {
    const result = packConversionInputSchema.safeParse({
      enabled: true,
      mode: "link_existing",
      unitsPerPack: 6,
    });
    expect(result.success).toBe(false);
  });
});

describe("packConversionInputSchema · mode assorted (PRO-12)", () => {
  const components = [
    { unitProductId: "a", unitsPerPack: 2 },
    { costWeight: 1.5, unitProductId: "b", unitsPerPack: 4 },
  ];

  it("accepts an assorted recipe and defaults costWeight to 1", () => {
    const result = packConversionInputSchema.parse({
      components,
      enabled: true,
      label: "  Surtido  ",
      mode: "assorted",
      totalUnits: 6,
    });

    expect(result.components).toEqual([
      { costWeight: 1, unitProductId: "a", unitsPerPack: 2 },
      { costWeight: 1.5, unitProductId: "b", unitsPerPack: 4 },
    ]);
    expect(result.label).toBe("Surtido");
  });

  it("does not ask an assorted recipe for the one to one fields", () => {
    const result = packConversionInputSchema.safeParse({ components, enabled: true, mode: "assorted", totalUnits: 6 });

    expect(result.success).toBe(true);
  });

  it.each([
    ["sum differs from totalUnits", { components, totalUnits: 7 }],
    ["one component", { components: components.slice(0, 1), totalUnits: 2 }],
    ["no components", { totalUnits: 6 }],
    ["duplicated product", { components: [components[0], { ...components[1], unitProductId: "a" }], totalUnits: 6 }],
    ["zero units", { components: [components[0], { unitProductId: "b", unitsPerPack: 0 }], totalUnits: 2 }],
    ["fractional units", { components: [components[0], { unitProductId: "b", unitsPerPack: 1.5 }], totalUnits: 3.5 }],
    ["negative cost weight", { components: [components[0], { costWeight: -1, unitProductId: "b", unitsPerPack: 4 }], totalUnits: 6 }],
    ["infinite cost weight", { components: [components[0], { costWeight: Infinity, unitProductId: "b", unitsPerPack: 4 }], totalUnits: 6 }],
    ["missing totalUnits", { components }],
    ["label over 80 characters", { components, label: "x".repeat(81), totalUnits: 6 }],
  ])("rejects %s", (_case, input) => {
    expect(packConversionInputSchema.safeParse({ enabled: true, mode: "assorted", ...input }).success).toBe(false);
  });

  it("ignores the recipe when the conversion is disabled", () => {
    expect(packConversionInputSchema.safeParse({ enabled: false, mode: "assorted" }).success).toBe(true);
  });
});

describe("convertPackToUnitsSchema · components (PRO-12)", () => {
  const base = { packProductId: "pack", packQuantity: 1 };

  it("keeps accepting the body without a distribution", () => {
    expect(convertPackToUnitsSchema.parse({ ...base, reason: "x" })).toEqual({ ...base, reason: "x" });
  });

  it("accepts a distribution with zeros", () => {
    const components = [
      { unitProductId: "a", units: 6 },
      { unitProductId: "b", units: 0 },
    ];

    expect(convertPackToUnitsSchema.parse({ ...base, components }).components).toEqual(components);
  });

  it.each([
    ["negative units", [{ unitProductId: "a", units: -1 }]],
    ["fractional units", [{ unitProductId: "a", units: 0.5 }]],
    ["duplicated component", [{ unitProductId: "a", units: 1 }, { unitProductId: "a", units: 2 }]],
    ["empty list", []],
    ["missing product", [{ units: 1 }]],
  ])("rejects %s", (_case, components) => {
    expect(convertPackToUnitsSchema.safeParse({ ...base, components }).success).toBe(false);
  });
});

describe("assertPackDistribution", () => {
  const recipe = { componentIds: ["a", "b", "c"], totalUnits: 6 };

  it("accepts a distribution that adds up to recipe units times packs, omitting zeros", () => {
    expect(() =>
      assertPackDistribution(recipe, 2, [
        { unitProductId: "a", units: 7 },
        { unitProductId: "c", units: 5 },
      ]),
    ).not.toThrow();
  });

  it.each([
    ["wrong sum", [{ unitProductId: "a", units: 5 }], "El reparto debe sumar 6 unidades (1 empaques × 6) y suma 5."],
    ["foreign product", [{ unitProductId: "z", units: 6 }], "Un producto del reparto no es componente de la receta del empaque."],
    [
      "repeated component",
      [{ unitProductId: "a", units: 3 }, { unitProductId: "a", units: 3 }],
      "El reparto repite un componente de la receta.",
    ],
  ])("rejects %s with 400", (_case, distribution, message) => {
    expect(() => assertPackDistribution(recipe, 1, distribution)).toThrow(
      expect.objectContaining({ message, status: 400 }),
    );
  });
});
