import {
  getDraftTotalWithTax,
  switchCostCurrency,
  syncLineCostFields,
} from "./normalizePurchaseLine";
import { refToVes, roundMoney, vesToRef } from "@/shared/utils/currency";
import type { PurchaseDraftItem } from "../types";

describe("currency conversion helpers", () => {
  const rate = 756.71;

  it("converts VES to REF and back within 2-decimal rounding", () => {
    const ves = 1500;
    const ref = roundMoney(vesToRef(ves, rate));
    expect(ref).toBe(1.98);
    expect(roundMoney(refToVes(ref, rate))).toBe(1498.29);
  });

  it("returns 0 REF when rate is invalid", () => {
    expect(vesToRef(1500, 0)).toBe(0);
    expect(vesToRef(1500, -1)).toBe(0);
  });
});

describe("syncLineCostFields", () => {
  const rate = 756.71;

  function basePack(overrides: Partial<PurchaseDraftItem> = {}): PurchaseDraftItem {
    return {
      costCurrency: "ves",
      entryMode: "pack",
      id: "line-1",
      packCostRef: 0,
      packCostVes: 1500,
      packCount: 1,
      packLabel: "Bulto",
      productId: "prod-1",
      quantity: 12,
      taxRate: 16,
      unitCostRef: 0,
      unitCostVes: 0,
      unitsPerPack: 12,
      ...overrides,
    };
  }

  it("derives unit VES and REF costs from pack VES (1500 / 12 / 756.71)", () => {
    const synced = syncLineCostFields(basePack(), rate);

    expect(synced.packCostVes).toBe(1500);
    expect(synced.unitCostVes).toBe(125);
    expect(synced.packCostRef).toBe(1.98);
    expect(synced.unitCostRef).toBe(0.17);
    expect(synced.quantity).toBe(12);
  });

  it("derives VES mirror when editing pack REF", () => {
    const synced = syncLineCostFields(
      basePack({
        costCurrency: "ref",
        packCostRef: 1.98,
        packCostVes: 0,
      }),
      rate,
    );

    expect(synced.packCostRef).toBe(1.98);
    expect(synced.unitCostRef).toBe(0.17);
    expect(synced.packCostVes).toBe(1498.29);
    expect(synced.unitCostVes).toBe(128.64);
  });

  it("keeps REF equivalent stable when switching currency ves ↔ ref", () => {
    const inVes = syncLineCostFields(basePack(), rate);
    const inRef = switchCostCurrency(inVes, "ref", rate);
    const backToVes = switchCostCurrency(inRef, "ves", rate);

    expect(inRef.costCurrency).toBe("ref");
    expect(inRef.packCostRef).toBe(inVes.packCostRef);
    expect(backToVes.costCurrency).toBe("ves");
    expect(backToVes.packCostRef).toBe(inVes.packCostRef);
    // Round-trip via REF may adjust VES by FX rounding to 2 decimals.
    expect(backToVes.packCostVes).toBe(roundMoney(refToVes(inVes.packCostRef, rate)));
  });

  it("syncs unit mode from VES input", () => {
    const synced = syncLineCostFields(
      {
        costCurrency: "ves",
        entryMode: "unit",
        id: "line-2",
        packCostRef: 0,
        packCostVes: 0,
        packCount: 1,
        packLabel: "",
        productId: "prod-2",
        quantity: 3,
        taxRate: 16,
        unitCostRef: 0,
        unitCostVes: 125,
        unitsPerPack: 1,
      },
      rate,
    );

    expect(synced.unitCostVes).toBe(125);
    expect(synced.unitCostRef).toBe(0.17);
  });

  it("computes totals with category tax rate", () => {
    const synced = syncLineCostFields(basePack(), rate);
    const subtotalRef = synced.packCostRef;
    expect(getDraftTotalWithTax(subtotalRef, 16)).toBe(roundMoney(subtotalRef * 1.16));
  });
});
