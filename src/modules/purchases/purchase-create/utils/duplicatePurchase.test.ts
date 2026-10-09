import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import type { PurchaseProductResolutions } from "../services/resolvePurchaseProducts";
import {
  buildDuplicatedPurchaseLines,
  type PurchaseDuplicateSourceItem,
} from "./duplicatePurchase";

const cajaPack = {
  id: "pack-caja",
  isActive: true,
  isDefault: true,
  label: "Caja",
  supplierProductId: "supp-refresco",
  unitsPerPack: 12,
};

function product(overrides: Partial<PurchaseCatalogProduct>): PurchaseCatalogProduct {
  return {
    costWithTaxRef: 0,
    currentStock: 0,
    link: "none",
    name: "Producto",
    packUnits: [],
    productId: "prod",
    sku: "SKU",
    taxRate: 0,
    unitCostRef: 0,
    ...overrides,
  };
}

function sourceItem(overrides: Partial<PurchaseDuplicateSourceItem>): PurchaseDuplicateSourceItem {
  return {
    productId: "prod",
    purchaseId: "purchase-1",
    quantity: 1,
    subtotalRef: 0,
    subtotalVes: 0,
    unitCostRef: 0,
    unitCostVes: 0,
    ...overrides,
  };
}

function build(sourceItems: PurchaseDuplicateSourceItem[], products: PurchaseProductResolutions) {
  let sequence = 0;

  return buildDuplicatedPurchaseLines(sourceItems, products, {
    costCurrency: "ves",
    nextId: () => `line-${(sequence += 1)}`,
    rateVes: 510,
  });
}

describe("buildDuplicatedPurchaseLines", () => {
  it("línea por unidad: misma cantidad, costo del vínculo sin IVA y alícuota de la categoría actual", () => {
    const { lines } = build(
      [sourceItem({ productId: "prod-harina", quantity: 7, taxRate: 16, unitCostRef: 9 })],
      new Map([
        [
          "prod-harina",
          {
            product: product({
              costWithTaxRef: 2.16,
              link: "linked",
              productId: "prod-harina",
              taxRate: 8,
              unitCostRef: 2,
            }),
            status: "active",
          },
        ],
      ]),
    );

    expect(lines.items).toEqual([
      expect.objectContaining({
        costCurrency: "ves",
        entryMode: "unit",
        id: "line-1",
        productId: "prod-harina",
        quantity: 7,
        taxRate: 8,
        unitCostRef: 2,
        unitCostVes: 1020,
      }),
    ]);
  });

  it("sin vínculo (o con vínculo sin costo) usa el costo de la línea de origen", () => {
    const { lines } = build(
      [
        sourceItem({ productId: "prod-cable", quantity: 2, unitCostRef: 3.5 }),
        sourceItem({ productId: "prod-pila", quantity: 4, unitCostRef: 1.25 }),
      ],
      new Map([
        [
          "prod-cable",
          {
            product: product({ costWithTaxRef: 9, productId: "prod-cable", unitCostRef: 9 }),
            status: "active",
          },
        ],
        [
          "prod-pila",
          { product: product({ link: "preferred", productId: "prod-pila" }), status: "active" },
        ],
      ]),
    );

    expect(lines.items.map((item) => [item.productId, item.quantity, item.unitCostRef])).toEqual([
      ["prod-cable", 2, 3.5],
      ["prod-pila", 4, 1.25],
    ]);
  });

  it("línea por empaque: misma etiqueta, unidades y empaques; costo del vínculo por empaque", () => {
    const { lines } = build(
      [
        sourceItem({
          entryMode: "pack",
          packCostRef: 30,
          packCount: 3,
          packLabel: "Caja",
          productId: "prod-refresco",
          quantity: 36,
          unitCostRef: 2.5,
          unitsPerPack: 12,
        }),
      ],
      new Map([
        [
          "prod-refresco",
          {
            product: product({
              costWithTaxRef: 1.16,
              link: "preferred",
              packUnits: [cajaPack],
              productId: "prod-refresco",
              taxRate: 16,
              unitCostRef: 1,
            }),
            status: "active",
          },
        ],
      ]),
    );

    expect(lines.items).toEqual([
      expect.objectContaining({
        entryMode: "pack",
        packCostRef: 12,
        packCostVes: 6120,
        packCount: 3,
        packLabel: "Caja",
        packUnitId: "pack-caja",
        quantity: 36,
        taxRate: 16,
        unitsPerPack: 12,
      }),
    ]);
  });

  it("empaque que el proveedor ya no tiene guardado: se conserva como personalizado con el costo de origen", () => {
    const { lines } = build(
      [
        sourceItem({
          entryMode: "pack",
          packCostRef: 30,
          packCount: 2,
          packLabel: "Manga",
          productId: "prod-refresco",
          quantity: 12,
          unitCostRef: 5,
          unitsPerPack: 6,
        }),
      ],
      new Map([
        ["prod-refresco", { product: product({ productId: "prod-refresco" }), status: "active" }],
      ]),
    );

    expect(lines.items[0]).toMatchObject({
      entryMode: "pack",
      packCostRef: 30,
      packCount: 2,
      packLabel: "Manga",
      quantity: 12,
      unitsPerPack: 6,
    });
    expect(lines.items[0].packUnitId).toBeUndefined();
  });

  it("las líneas nacen desbloqueadas, asentadas y sin alícuotas elegidas a mano", () => {
    const { lineMeta, lines } = build(
      [sourceItem({ productId: "prod-cable", unitCostRef: 2 })],
      new Map([
        [
          "prod-cable",
          {
            product: product({ name: "Cable HDMI", productId: "prod-cable", sku: "ELE-CAB-001" }),
            status: "active",
          },
        ],
      ]),
    );

    expect(lines.locks).toEqual({ locked: {} });
    expect(lines.taxState).toEqual({ choices: {}, exempt: false });
    expect(lines.review.baselines["line-1"]).toEqual({ item: lines.items[0], taxChoice: null });
    expect(lineMeta.get("prod-cable")).toEqual({
      name: "Cable HDMI",
      packUnits: [],
      sku: "ELE-CAB-001",
      taxRate: 0,
    });
  });

  it("omite los productos inactivos o inexistentes y los lista en un aviso", () => {
    const { lines, notices } = build(
      [
        sourceItem({ productId: "prod-cable", unitCostRef: 2 }),
        sourceItem({ productId: "prod-viejo", unitCostRef: 1 }),
        sourceItem({
          product: { name: "Jabón azul" } as PurchaseDuplicateSourceItem["product"],
          productId: "prod-borrado",
        }),
      ],
      new Map([
        ["prod-cable", { product: product({ productId: "prod-cable" }), status: "active" }],
        ["prod-viejo", { name: "Galleta María", status: "unavailable" }],
      ]),
    );

    expect(lines.items.map((item) => item.productId)).toEqual(["prod-cable"]);
    expect(notices).toEqual([
      "No se duplicaron 2 productos que ya no existen o están inactivos: Galleta María, Jabón azul.",
    ]);
  });
});

// COM-F11 · el costo de la línea duplicada es el neto de la última compra recibida.
describe("buildDuplicatedPurchaseLines · último costo neto recibido (COM-F11)", () => {
  it("línea por unidad: usa el último neto, no el costo con IVA del vínculo entre la alícuota de la categoría", () => {
    const { lines } = build(
      [sourceItem({ productId: "prod-taladro", quantity: 3, unitCostRef: 9 })],
      new Map([
        [
          "prod-taladro",
          {
            // Última compra exenta a 2.494,41: el vínculo guarda 2.494,41 y la categoría es 16 %.
            product: product({
              costWithTaxRef: 2494.41,
              lastPurchaseUnitCostRef: 2494.41,
              link: "preferred",
              productId: "prod-taladro",
              taxRate: 16,
              unitCostRef: 2494.41,
            }),
            status: "active",
          },
        ],
      ]),
    );

    expect(lines.items).toHaveLength(1);
    expect(lines.items[0]).toMatchObject({ quantity: 3, taxRate: 16, unitCostRef: 2494.41 });
  });

  it("línea por empaque: último unitario neto por las unidades del empaque", () => {
    const { lines } = build(
      [
        sourceItem({
          entryMode: "pack",
          packCostRef: 99,
          packCount: 2,
          packLabel: "Caja",
          productId: "prod-refresco",
          quantity: 24,
          unitsPerPack: 12,
        }),
      ],
      new Map([
        [
          "prod-refresco",
          {
            product: product({
              costWithTaxRef: 1.48,
              lastPurchaseUnitCostRef: 1.48,
              link: "linked",
              packUnits: [cajaPack],
              productId: "prod-refresco",
              taxRate: 16,
              unitCostRef: 1.48,
            }),
            status: "active",
          },
        ],
      ]),
    );

    expect(lines.items[0]).toMatchObject({
      entryMode: "pack",
      packCostRef: 17.76,
      packCount: 2,
      unitsPerPack: 12,
    });
  });

  it("sin vínculo pero comprado antes a otro proveedor: el último neto gana a la línea de origen", () => {
    const { lines } = build(
      [sourceItem({ productId: "prod-lija", quantity: 1, unitCostRef: 9 })],
      new Map([
        [
          "prod-lija",
          {
            product: product({
              costWithTaxRef: 4.64,
              lastPurchaseUnitCostRef: 4,
              productId: "prod-lija",
              taxRate: 16,
              unitCostRef: 4,
            }),
            status: "active",
          },
        ],
      ]),
    );

    expect(lines.items[0]).toMatchObject({ unitCostRef: 4 });
  });
});
