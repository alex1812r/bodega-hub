import type { PackConversionListItem } from "../../hooks/useInventory";
import { describePackRecipe, searchPackOptions } from "./packProductOptions";

function linked(id: string, name: string, sku: string, currentStock = 1) {
  return { currentCostRef: 1.5, currentStock, id, name, salePriceRef: 2.5, sku };
}

function recipe(packId: string, name: string, sku: string): PackConversionListItem {
  return {
    id: `ppc-${packId}`,
    linkedProduct: linked(`${packId}-unit`, `${name} suelto`, `${sku}-U`),
    packProduct: linked(packId, name, sku, 7),
    role: "pack",
    unitsPerPack: 12,
  };
}

const recipes = [
  recipe("pack-malta", "Caja de malta", "MAL-CAJ-012"),
  recipe("pack-cafe", "Bulto de café", "CAF-BUL-020"),
  recipe("pack-agua", "Bulto de agua", "AGU-BUL-024"),
];

describe("searchPackOptions", () => {
  it("busca por nombre sin distinguir mayúsculas ni tildes y ordena por nombre", () => {
    expect(searchPackOptions(recipes, "BULTO", 8).map((option) => option.label)).toEqual([
      "Bulto de agua",
      "Bulto de café",
    ]);
    expect(searchPackOptions(recipes, "cafe", 8).map((option) => option.id)).toEqual(["pack-cafe"]);
  });

  it("busca por SKU", () => {
    expect(searchPackOptions(recipes, "mal-caj", 8).map((option) => option.id)).toEqual([
      "pack-malta",
    ]);
  });

  it("no ofrece el producto unidad ni lo que no coincide, y respeta el límite", () => {
    expect(searchPackOptions(recipes, "suelto", 8)).toEqual([]);
    expect(searchPackOptions(recipes, "de", 2)).toHaveLength(2);
  });

  it("la opción lleva el stock, el SKU y los precios del empaque", () => {
    expect(searchPackOptions(recipes, "malta", 8)).toEqual([
      {
        barcode: null,
        categoryId: "",
        currentCostRef: 1.5,
        currentStock: 7,
        id: "pack-malta",
        isActive: true,
        label: "Caja de malta",
        salePriceRef: 2.5,
        sku: "MAL-CAJ-012",
      },
    ]);
  });
});

describe("describePackRecipe", () => {
  it("1 a 1: la unidad y cuántas trae", () => {
    expect(describePackRecipe(recipes[0])).toBe("→ Caja de malta suelto (x12)");
  });

  it("surtido: cuántos productos y el total de unidades", () => {
    const component = (unitProductId: string, name: string) => ({
      costWeight: 1,
      currentStock: 0,
      isActive: true,
      name,
      sku: `${unitProductId}-sku`,
      unitProductId,
      unitsPerPack: 6,
    });

    expect(
      describePackRecipe({
        ...recipes[0],
        components: [component("u-cola", "Cola"), component("u-uva", "Uva")],
        kind: "assorted",
      }),
    ).toBe("→ surtido de 2 productos (x12)");
  });
});
