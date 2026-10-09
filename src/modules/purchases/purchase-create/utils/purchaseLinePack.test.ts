import { createPackDraftItem, createUnitDraftItem } from "../types";
import { getDraftLineTotals } from "./normalizePurchaseLine";
import {
  applyCustomPackLabel,
  applyPackPreset,
  getDefaultPackUnit,
  isCustomPackLine,
  normalizeStandardPackLabel,
  toUnitLine,
} from "./purchaseLinePack";

const RATE = 510;

function packUnit(id: string, input: { isDefault?: boolean; label: string; unitsPerPack: number }) {
  return {
    id,
    isActive: true,
    isDefault: input.isDefault ?? false,
    label: input.label,
    supplierProductId: "supp-1",
    unitsPerPack: input.unitsPerPack,
  };
}

const caja = packUnit("pack-caja", { label: "Caja", unitsPerPack: 12 });
const bulto = packUnit("pack-bulto", { isDefault: true, label: "Bulto", unitsPerPack: 24 });

function unitLine() {
  return createUnitDraftItem({
    costCurrency: "ves",
    id: "line-1",
    productId: "prod-1",
    quantity: 5,
    rateVes: RATE,
    taxRate: 16,
    unitCostRef: 2,
  });
}

describe("purchaseLinePack", () => {
  it("getDefaultPackUnit: el marcado por defecto, si no el primero, si no ninguno", () => {
    expect(getDefaultPackUnit([caja, bulto])).toBe(bulto);
    expect(getDefaultPackUnit([caja])).toBe(caja);
    expect(getDefaultPackUnit([])).toBeNull();
    expect(getDefaultPackUnit(undefined)).toBeNull();
  });

  it("normalizeStandardPackLabel: ignora mayúsculas y cae en Bulto", () => {
    expect(normalizeStandardPackLabel(" manga ")).toBe("Manga");
    expect(normalizeStandardPackLabel("Saco")).toBe("Bulto");
  });

  it("applyPackPreset con empaque guardado: costo del empaque = unitario x unidades", () => {
    const line = applyPackPreset(unitLine(), caja, RATE);

    expect(line).toMatchObject({
      entryMode: "pack",
      packCostRef: 24,
      packCostVes: 12240,
      packCount: 1,
      packLabel: "Caja",
      packUnitId: "pack-caja",
      quantity: 12,
      unitsPerPack: 12,
    });
    expect(isCustomPackLine(line)).toBe(false);
  });

  it("applyPackPreset sin empaque guardado: personalizado, Bulto de 1 unidad", () => {
    const line = applyPackPreset(unitLine(), null, RATE);

    expect(line).toMatchObject({
      entryMode: "pack",
      packCostVes: 1020,
      packCount: 1,
      packLabel: "Bulto",
      quantity: 1,
      unitsPerPack: 1,
    });
    expect(line.packUnitId).toBeUndefined();
    expect(isCustomPackLine(line)).toBe(true);
  });

  it("applyCustomPackLabel conserva unidades y costo del empaque guardado", () => {
    const line = applyCustomPackLabel(applyPackPreset(unitLine(), caja, RATE), "Manga", RATE);

    expect(line).toMatchObject({
      packCostVes: 12240,
      packLabel: "Manga",
      unitsPerPack: 12,
    });
    expect(line.packUnitId).toBeUndefined();
  });

  it("toUnitLine conserva las unidades totales y el monto de la línea", () => {
    const pack = createPackDraftItem({
      costCurrency: "ves",
      id: "line-2",
      packCostRef: 12,
      packCount: 3,
      packLabel: "Caja",
      packUnitId: "pack-caja",
      productId: "prod-1",
      rateVes: RATE,
      taxRate: 16,
      unitsPerPack: 12,
    });
    const unit = toUnitLine(pack, RATE);

    expect(unit).toMatchObject({
      entryMode: "unit",
      packCostRef: 0,
      packCostVes: 0,
      quantity: 36,
      unitCostRef: 1,
      unitCostVes: 510,
    });
    expect(getDraftLineTotals(unit, RATE)).toEqual(getDraftLineTotals(pack, RATE));
  });
});
