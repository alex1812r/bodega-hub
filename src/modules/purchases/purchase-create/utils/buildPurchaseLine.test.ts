import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import { applyLastPurchaseCost } from "./buildPurchaseCatalog";
import { buildPurchaseLine } from "./buildPurchaseLine";

/** COM-F11 · costo con el que nace una línea: el último neto recibido si el producto ya se compró. */

const bulto = {
  id: "pack-bulto",
  isActive: true,
  isDefault: true,
  label: "Bulto",
  supplierProductId: "supp-cable",
  unitsPerPack: 12,
};

function product(overrides: Partial<PurchaseCatalogProduct> = {}): PurchaseCatalogProduct {
  return {
    costWithTaxRef: 2494.41,
    currentStock: 0,
    link: "none",
    name: "Taladro",
    packUnits: [],
    productId: "prod-drill",
    sku: "ELE-TAL-001",
    taxRate: 16,
    unitCostRef: 2150.35,
    ...overrides,
  };
}

const lineInput = { costCurrency: "ref" as const, id: "line-1", rateVes: 510 };

describe("applyLastPurchaseCost", () => {
  it("con compra previa, el costo sugerido es su unitario neto tal cual", () => {
    const resolved = applyLastPurchaseCost(product({ lastCostPending: true }), 2494.41);

    expect(resolved.unitCostRef).toBe(2494.41);
    expect(resolved.lastPurchaseUnitCostRef).toBe(2494.41);
    expect(resolved).not.toHaveProperty("lastCostPending");
    // El chip «último costo» sigue mostrando el costo con IVA guardado.
    expect(resolved.costWithTaxRef).toBe(2494.41);
  });

  it("sin compras previas conserva el costo con IVA entre la alícuota de la categoría", () => {
    const resolved = applyLastPurchaseCost(
      product({ costWithTaxRef: 11.6, lastCostPending: true, lastPurchaseUnitCostRef: 99 }),
      undefined,
    );

    expect(resolved.unitCostRef).toBe(10);
    expect(resolved).not.toHaveProperty("lastPurchaseUnitCostRef");
    expect(resolved).not.toHaveProperty("lastCostPending");
  });

  it("un último costo de 0 (regalo) es un costo, no «sin compras»", () => {
    expect(applyLastPurchaseCost(product(), 0).unitCostRef).toBe(0);
  });
});

describe("buildPurchaseLine", () => {
  it("por unidad: la línea nace con el último neto", () => {
    const line = buildPurchaseLine(applyLastPurchaseCost(product(), 2494.41), lineInput);

    expect(line).toMatchObject({ entryMode: "unit", taxRate: 16, unitCostRef: 2494.41 });
  });

  it("con empaque por defecto: costo del empaque = último unitario neto × unidades", () => {
    const line = buildPurchaseLine(
      applyLastPurchaseCost(
        product({ costWithTaxRef: 1.48, defaultPackUnit: bulto, packUnits: [bulto] }),
        1.48,
      ),
      lineInput,
    );

    // Exenta a 1,48: 1,48 × 12 = 17,76 (dividido entre 1,16 saldría 15,31).
    expect(line).toMatchObject({ entryMode: "pack", packCostRef: 17.76, unitsPerPack: 12 });
  });

  it("con empaque y sin compras previas: del costo con IVA del empaque, como antes", () => {
    const line = buildPurchaseLine(
      applyLastPurchaseCost(
        product({ costWithTaxRef: 1.16, defaultPackUnit: bulto, packUnits: [bulto] }),
        undefined,
      ),
      lineInput,
    );

    expect(line).toMatchObject({ entryMode: "pack", packCostRef: 12, unitsPerPack: 12 });
  });
});
