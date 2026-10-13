/**
 * @jest-environment node
 */
/**
 * COM-14 · preferencia «Desarmar siempre al recibir compras» de la receta en el
 * mock: misma lectura y mismas reglas de escritura que `packConversion.server`
 * (ausente = no cambia; una receta reemplazada la conserva).
 */

import { mockProductPackConversions, mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { packConversionInputSchema } from "./packConversionSchemas";
import { getProductById, listPackConversions, updateProduct } from "./products.mock-server";

function seedProduct(id: string, name: string) {
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
    storeId: DEFAULT_STORE_ID,
  });
}

function link(unitProductId: string, unitsPerPack: number, extra: Record<string, unknown> = {}) {
  return packConversionInputSchema.parse({
    enabled: true,
    mode: "link_existing",
    unitProductId,
    unitsPerPack,
    ...extra,
  });
}

function assorted(extra: Record<string, unknown> = {}) {
  return packConversionInputSchema.parse({
    components: [
      { unitProductId: "ad-cola", unitsPerPack: 2 },
      { unitProductId: "ad-manzana", unitsPerPack: 2 },
      { unitProductId: "ad-naranja", unitsPerPack: 2 },
    ],
    enabled: true,
    mode: "assorted",
    totalUnits: 6,
    ...extra,
  });
}

function save(packProductId: string, packConversion: ReturnType<typeof link>) {
  return updateProduct(packProductId, { packConversion }, DEFAULT_STORE_ID).packConversion;
}

function activeRecipe(packProductId: string) {
  return mockProductPackConversions.find(
    (item) => item.packProductId === packProductId && item.isActive,
  );
}

function listed(packProductId: string) {
  return listPackConversions(DEFAULT_STORE_ID).find((item) => item.packProduct.id === packProductId);
}

beforeAll(() => {
  seedProduct("ad-caja", "Caja de cola");
  seedProduct("ad-surtido", "Caja surtida");
  seedProduct("ad-cola", "Refresco cola");
  seedProduct("ad-manzana", "Refresco manzana");
  seedProduct("ad-naranja", "Refresco naranja");
});

describe("products.mock-server · preferencia «Desarmar siempre al recibir compras»", () => {
  it("una receta nueva nace sin la preferencia y no la envía", () => {
    const summary = save("ad-caja", link("ad-cola", 12));

    expect(summary).not.toHaveProperty("alwaysDisassembleOnReceive");
    expect(activeRecipe("ad-caja")).not.toHaveProperty("alwaysDisassembleOnReceive");
    expect(listed("ad-caja")).not.toHaveProperty("alwaysDisassembleOnReceive");
  });

  it("guardarla en true: la devuelven el detalle del producto y el listado de recetas", () => {
    const summary = save("ad-caja", link("ad-cola", 12, { alwaysDisassembleOnReceive: true }));

    expect(summary).toMatchObject({ alwaysDisassembleOnReceive: true, role: "pack" });
    expect(getProductById("ad-caja", DEFAULT_STORE_ID).packConversion).toMatchObject({
      alwaysDisassembleOnReceive: true,
    });
    expect(listed("ad-caja")).toMatchObject({ alwaysDisassembleOnReceive: true });
  });

  it("guardar la receta sin nombrarla no la cambia, ni al editar en sitio ni al reemplazar la receta", () => {
    const before = activeRecipe("ad-caja")?.id;

    expect(save("ad-caja", link("ad-cola", 24))).toMatchObject({
      alwaysDisassembleOnReceive: true,
      id: before,
      unitsPerPack: 24,
    });

    const replaced = save("ad-caja", link("ad-manzana", 24));

    expect(replaced?.id).not.toBe(before);
    expect(replaced).toMatchObject({ alwaysDisassembleOnReceive: true });
    expect(mockProductPackConversions.filter((item) => item.packProductId === "ad-caja" && item.isActive)).toHaveLength(1);
  });

  it("guardarla en false la quita", () => {
    const summary = save("ad-caja", link("ad-manzana", 24, { alwaysDisassembleOnReceive: false }));

    expect(summary).not.toHaveProperty("alwaysDisassembleOnReceive");
    expect(activeRecipe("ad-caja")).not.toHaveProperty("alwaysDisassembleOnReceive");
  });

  it("vale igual para un surtido, y desactivar la receta no deja la preferencia en otra", () => {
    expect(save("ad-surtido", assorted({ alwaysDisassembleOnReceive: true }))).toMatchObject({
      alwaysDisassembleOnReceive: true,
      kind: "assorted",
    });
    expect(save("ad-surtido", assorted({ label: "Surtido 6" }))).toMatchObject({
      alwaysDisassembleOnReceive: true,
      label: "Surtido 6",
    });

    save("ad-surtido", packConversionInputSchema.parse({ enabled: false }));

    expect(activeRecipe("ad-surtido")).toBeUndefined();
    expect(listed("ad-surtido")).toBeUndefined();
  });

  it("no es un booleano: la forma se rechaza con el aviso en español", () => {
    const result = packConversionInputSchema.safeParse({
      alwaysDisassembleOnReceive: "si",
      enabled: true,
      mode: "link_existing",
      unitProductId: "ad-cola",
      unitsPerPack: 12,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Indica si el empaque se desarma siempre al recibir compras.",
    ]);
  });
});
