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

/** PRO-F8 · los avisos de forma llegan a la pantalla en `issues`: van en español. */
describe("mensajes de validación en español (PRO-F8)", () => {
  const ENGLISH = /\b(expected|invalid|too small|too big|received|required)\b/i;

  function messages(result: { error?: { issues: { message: string }[] }; success: boolean }) {
    expect(result.success).toBe(false);

    return (result.error?.issues ?? []).map((issue) => issue.message);
  }

  it.each([
    ["0 empaques", 0],
    ["empaques negativos", -2],
    ["medio empaque", 0.5],
    ["texto", "dos"],
    ["sin cantidad", undefined],
  ])("abrir %s", (_case, packQuantity) => {
    expect(
      messages(convertPackToUnitsSchema.safeParse({ packProductId: "pack", packQuantity })),
    ).toEqual(["La cantidad de empaques debe ser un entero mayor que 0."]);
  });

  it("abrir sin empaque o con un motivo que no es texto", () => {
    expect(
      messages(convertPackToUnitsSchema.safeParse({ packProductId: "", packQuantity: 1 })),
    ).toEqual(["Selecciona el empaque que vas a abrir."]);
    expect(
      messages(convertPackToUnitsSchema.safeParse({ packQuantity: 1, reason: 5 })),
    ).toEqual(["Selecciona el empaque que vas a abrir.", "El motivo debe ser un texto."]);
  });

  it.each([
    ["unidades por empaque con decimales", { enabled: true, mode: "link_existing", unitProductId: "u", unitsPerPack: 2.5 }],
    ["unidades por empaque como texto", { enabled: true, mode: "link_existing", unitProductId: "u", unitsPerPack: "6" }],
    ["una sola unidad por empaque", { enabled: true, mode: "link_existing", unitProductId: "u", unitsPerPack: 1 }],
    ["producto unidad vacío", { enabled: true, mode: "link_existing", unitProductId: "", unitsPerPack: 6 }],
    ["modo desconocido", { enabled: true, mode: "otro", unitsPerPack: 6 }],
    ["sin decir si está activo", { mode: "link_existing" }],
    ["componentes que no son una lista", { components: "x", enabled: true, mode: "assorted", totalUnits: 4 }],
    ["nombre de receta que no es texto", { enabled: false, label: 5 }],
    [
      "unidad nueva con precio negativo, costo negativo y nombre vacío",
      {
        enabled: true,
        mode: "create_unit",
        unitProduct: { currentCostRef: -1, name: "", salePriceRef: -1 },
        unitsPerPack: 6,
      },
    ],
    [
      "unidad nueva sin precio y con SKU y código de barras que no son texto",
      { enabled: true, mode: "create_unit", unitProduct: { barcode: 5, sku: 7 }, unitsPerPack: 6 },
    ],
    [
      "componente sin producto ni unidades",
      { components: [{}, { unitProductId: "b", unitsPerPack: 2 }], enabled: true, mode: "assorted", totalUnits: 4 },
    ],
  ])("receta: %s", (_case, input) => {
    const found = messages(packConversionInputSchema.safeParse(input));

    expect(found.length).toBeGreaterThan(0);
    for (const message of found) {
      expect(message).not.toMatch(ENGLISH);
    }
  });

  it("reparto: producto que no es texto", () => {
    const found = messages(
      convertPackToUnitsSchema.safeParse({
        components: [{ unitProductId: 3, units: 1 }],
        packProductId: "pack",
        packQuantity: 1,
      }),
    );

    expect(found).toEqual(["Cada componente del reparto requiere su producto."]);
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
