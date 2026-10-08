/**
 * @jest-environment node
 */
/**
 * PRO-12 · receta de empaque con N componentes en el mock: mismo modelo
 * (cabecera + componentes), mismas reglas y la misma forma de lectura que
 * `packConversion.server`.
 */

import { mockProductPackConversions, mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { packConversionInputSchema } from "./packConversionSchemas";
import { getProductById, listPackConversions, updateProduct } from "./products.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function seedProduct(id: string, name: string, storeId = DEFAULT_STORE_ID) {
  mockProducts.push({
    categoryId: "cat-tools",
    currentCostRef: 1.5,
    currentStock: 4,
    id,
    isActive: true,
    minStock: 0,
    name,
    salePriceRef: 2,
    sku: id,
    storeId,
  });
}

function assorted(components: [string, number, number?][], label?: string) {
  return packConversionInputSchema.parse({
    components: components.map(([unitProductId, unitsPerPack, costWeight]) => ({
      ...(costWeight === undefined ? {} : { costWeight }),
      unitProductId,
      unitsPerPack,
    })),
    enabled: true,
    label,
    mode: "assorted",
    totalUnits: components.reduce((total, [, units]) => total + units, 0),
  });
}

function link(unitProductId: string, unitsPerPack: number) {
  return packConversionInputSchema.parse({ enabled: true, mode: "link_existing", unitProductId, unitsPerPack });
}

function recipesOf(packProductId: string) {
  return mockProductPackConversions.filter((item) => item.packProductId === packProductId);
}

function save(packProductId: string, packConversion: ReturnType<typeof link>) {
  return updateProduct(packProductId, { packConversion }, DEFAULT_STORE_ID).packConversion;
}

beforeAll(() => {
  seedProduct("ms-pack", "Caja surtida");
  seedProduct("ms-pack-2", "Bulto de cola");
  seedProduct("ms-cola", "Refresco cola");
  seedProduct("ms-naranja", "Refresco naranja");
  seedProduct("ms-uva", "Refresco uva");
  seedProduct("ms-ajeno", "Producto de otra tienda", OTHER_STORE_ID);
});

describe("products.mock-server · receta surtida", () => {
  it("guarda cabecera + componentes y los lee con la forma del server", () => {
    const summary = save("ms-pack", assorted([["ms-uva", 2], ["ms-cola", 3, 2], ["ms-naranja", 1]], " Surtido 6 "));

    expect(recipesOf("ms-pack")).toEqual([
      expect.objectContaining({
        components: [
          { costWeight: 1, unitProductId: "ms-uva", unitsPerPack: 2 },
          { costWeight: 2, unitProductId: "ms-cola", unitsPerPack: 3 },
          { costWeight: 1, unitProductId: "ms-naranja", unitsPerPack: 1 },
        ],
        isActive: true,
        label: "Surtido 6",
        totalUnits: 6,
        // Columnas de compatibilidad, como las deja el trigger de la cabecera.
        unitProductId: null,
        unitsPerPack: 6,
      }),
    ]);
    expect(summary).toEqual({
      components: [
        { costWeight: 2, currentStock: 4, isActive: true, name: "Refresco cola", sku: "ms-cola", unitProductId: "ms-cola", unitsPerPack: 3 },
        { costWeight: 1, currentStock: 4, isActive: true, name: "Refresco naranja", sku: "ms-naranja", unitProductId: "ms-naranja", unitsPerPack: 1 },
        { costWeight: 1, currentStock: 4, isActive: true, name: "Refresco uva", sku: "ms-uva", unitProductId: "ms-uva", unitsPerPack: 2 },
      ],
      id: recipesOf("ms-pack")[0].id,
      kind: "assorted",
      label: "Surtido 6",
      linkedProduct: { currentCostRef: 1.5, currentStock: 4, id: "ms-cola", name: "Refresco cola", salePriceRef: 2, sku: "ms-cola" },
      role: "pack",
      sources: [],
      totalUnits: 6,
      unitsPerPack: 6,
    });
  });

  it("una unidad puede salir de dos recetas: sources las trae todas y los campos de siempre describen la primera por nombre del empaque", () => {
    // `ms-cola` ya es componente del surtido: enlazarla a otro empaque ya no es un 409.
    save("ms-pack-2", link("ms-cola", 12));

    const summary = getProductById("ms-cola", DEFAULT_STORE_ID).packConversion;

    expect(summary).toMatchObject({
      kind: "single",
      linkedProduct: { id: "ms-pack-2", name: "Bulto de cola" },
      role: "unit",
      totalUnits: 12,
      unitsPerPack: 12,
    });
    expect(summary?.sources).toEqual([
      { conversionId: recipesOf("ms-pack-2")[0].id, packName: "Bulto de cola", packProductId: "ms-pack-2", totalUnits: 12, unitsPerPack: 12 },
      { conversionId: recipesOf("ms-pack")[0].id, packName: "Caja surtida", packProductId: "ms-pack", totalUnits: 6, unitsPerPack: 3 },
    ]);
  });

  it("listPackConversions trae el par sembrado y el surtido", () => {
    const items = listPackConversions(DEFAULT_STORE_ID);

    expect(items.find((item) => item.packProduct.id === "prod-cigar-pack")).toMatchObject({
      id: "ppc-cigars",
      kind: "single",
      linkedProduct: { id: "prod-cigar-unit" },
      role: "pack",
      totalUnits: 10,
      unitsPerPack: 10,
    });
    expect(items.find((item) => item.packProduct.id === "ms-pack")).toMatchObject({
      kind: "assorted",
      linkedProduct: { id: "ms-cola" },
      unitsPerPack: 6,
    });
  });

  it("la misma receta no crea otra; con otro nombre solo cambia el nombre", () => {
    const before = recipesOf("ms-pack").length;

    const summary = save("ms-pack", assorted([["ms-cola", 3, 2], ["ms-naranja", 1], ["ms-uva", 2]], "Mixto"));

    expect(recipesOf("ms-pack")).toHaveLength(before);
    expect(summary).toMatchObject({ kind: "assorted", label: "Mixto" });
  });

  it("editar un surtido crea receta nueva y deja la anterior inactiva con sus componentes intactos", () => {
    const previous = recipesOf("ms-pack").find((item) => item.isActive);
    const previousComponents = JSON.stringify(previous?.components);

    const summary = save("ms-pack", assorted([["ms-cola", 4], ["ms-uva", 2]]));

    expect(previous?.isActive).toBe(false);
    expect(JSON.stringify(previous?.components)).toBe(previousComponents);
    expect(recipesOf("ms-pack").filter((item) => item.isActive)).toHaveLength(1);
    expect(summary?.id).not.toBe(previous?.id);
    expect(summary?.components?.map((component) => component.unitProductId)).toEqual(["ms-cola", "ms-uva"]);
  });

  it("de surtido a 1 a 1 y de vuelta: siempre una sola receta activa", () => {
    const single = save("ms-pack", link("ms-naranja", 8));

    expect(single).toMatchObject({ kind: "single", linkedProduct: { id: "ms-naranja" }, role: "pack", unitsPerPack: 8 });
    expect(recipesOf("ms-pack").find((item) => item.isActive)).toMatchObject({
      components: [{ costWeight: 1, unitProductId: "ms-naranja", unitsPerPack: 8 }],
      totalUnits: 8,
      unitProductId: "ms-naranja",
      unitsPerPack: 8,
    });

    // Misma unidad: se edita en sitio (misma receta).
    const edited = save("ms-pack", link("ms-naranja", 9));
    expect(edited?.id).toBe(single?.id);
    expect(edited?.unitsPerPack).toBe(9);

    const back = save("ms-pack", assorted([["ms-naranja", 2], ["ms-uva", 2]]));
    expect(back).toMatchObject({ kind: "assorted", totalUnits: 4 });
    expect(back?.id).not.toBe(single?.id);
    expect(recipesOf("ms-pack").filter((item) => item.isActive)).toHaveLength(1);
  });

  it("rechaza con los códigos del server: el empaque como componente (400), componente inexistente o de otra tienda (404), componente que es empaque (409)", () => {
    const active = recipesOf("ms-pack").find((item) => item.isActive)?.id;

    expect(() => save("ms-pack", assorted([["ms-pack", 2], ["ms-uva", 2]]))).toThrow(
      expect.objectContaining({ message: "El empaque no puede ser componente de sí mismo.", status: 400 }),
    );
    expect(() => save("ms-pack", assorted([["no-existe", 2], ["ms-uva", 2]]))).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => save("ms-pack", assorted([["ms-ajeno", 2], ["ms-uva", 2]]))).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => save("ms-pack", assorted([["ms-pack-2", 2], ["ms-uva", 2]]))).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => save("ms-pack", link("ms-pack-2", 6))).toThrow(expect.objectContaining({ status: 409 }));

    expect(recipesOf("ms-pack").find((item) => item.isActive)?.id).toBe(active);
  });

  it("desactivar apaga la receta y el producto deja de tener vínculo", () => {
    const product = updateProduct("ms-pack", { packConversion: { enabled: false } }, DEFAULT_STORE_ID);

    expect(product.packConversion).toBeUndefined();
    expect(recipesOf("ms-pack").some((item) => item.isActive)).toBe(false);
    expect(getProductById("ms-uva", DEFAULT_STORE_ID).packConversion).toBeUndefined();
  });

  it("el par sembrado se lee como siempre desde los dos lados", () => {
    expect(getProductById("prod-cigar-pack", DEFAULT_STORE_ID).packConversion).toMatchObject({
      id: "ppc-cigars",
      linkedProduct: { id: "prod-cigar-unit", name: "Cigarro individual" },
      role: "pack",
      unitsPerPack: 10,
    });
    expect(getProductById("prod-cigar-unit", DEFAULT_STORE_ID).packConversion).toMatchObject({
      id: "ppc-cigars",
      linkedProduct: { id: "prod-cigar-pack", name: "Caja cigarros (x10)" },
      role: "unit",
      sources: [
        { conversionId: "ppc-cigars", packName: "Caja cigarros (x10)", packProductId: "prod-cigar-pack", totalUnits: 10, unitsPerPack: 10 },
      ],
      unitsPerPack: 10,
    });
  });
});
