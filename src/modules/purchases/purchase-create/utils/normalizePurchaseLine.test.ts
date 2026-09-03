import {
  draftToPurchaseItemInput,
  getDraftLineTotals,
  getDraftTotalWithTax,
  sumDraftPurchaseTotals,
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
    // El unitario Bs sale del costo REF del bulto (1.98 / 12 -> Bs), no del
    // unitario REF ya redondeado a 0.17: encadenar dos redondeos desviaba el
    // bulto un 3% (12 x 128.64 = 1543.68 vs 1498.29).
    expect(synced.unitCostVes).toBe(124.86);
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

describe("getDraftLineTotals", () => {
  const rate = 756.71;

  function pack(overrides: Partial<PurchaseDraftItem> = {}): PurchaseDraftItem {
    return {
      costCurrency: "ves",
      entryMode: "pack",
      id: "line-1",
      packCostRef: 0,
      packCostVes: 1755.33,
      packCount: 1,
      packLabel: "Bulto",
      productId: "prod-1",
      quantity: 100,
      taxRate: 0,
      unitCostRef: 0,
      unitCostVes: 0,
      unitsPerPack: 100,
      ...overrides,
    };
  }

  it("derives the REF subtotal from the line's VES amount, not from the rounded unit cost", () => {
    const synced = syncLineCostFields(pack(), rate);
    const totals = getDraftLineTotals(synced, rate);

    // 1755.33 Bs / 756.71 = 2.32 REF. El unitario REF redondeado (0.02) por
    // 100 unidades daria 2.00 REF: 14% menos de lo que realmente se pago.
    expect(synced.unitCostRef).toBe(0.02);
    expect(totals.subtotalVes).toBe(1755.33);
    expect(totals.subtotalRef).toBe(2.32);
    expect(roundMoney(synced.quantity * synced.unitCostRef)).toBe(2);
  });

  it("derives the VES subtotal from the REF amount when the line is captured in REF", () => {
    const synced = syncLineCostFields(
      pack({ costCurrency: "ref", packCostRef: 2.32, packCostVes: 0 }),
      rate,
    );
    const totals = getDraftLineTotals(synced, rate);

    expect(totals.subtotalRef).toBe(2.32);
    expect(totals.subtotalVes).toBe(roundMoney(refToVes(2.32, rate)));
  });

  it("applies the line tax on each currency and keeps total = subtotal + tax", () => {
    const synced = syncLineCostFields(pack({ taxRate: 16 }), rate);
    const totals = getDraftLineTotals(synced, rate);

    expect(totals.taxRef).toBe(roundMoney(totals.subtotalRef * 0.16));
    expect(totals.taxVes).toBe(roundMoney(totals.subtotalVes * 0.16));
    expect(totals.totalRef).toBe(roundMoney(totals.subtotalRef + totals.taxRef));
    expect(totals.totalVes).toBe(roundMoney(totals.subtotalVes + totals.taxVes));
  });

  it("sends to the RPC exactly the amounts shown on the line", () => {
    const synced = syncLineCostFields(pack({ taxRate: 16 }), rate);
    const totals = getDraftLineTotals(synced, rate);
    const payload = draftToPurchaseItemInput(synced, rate);

    expect(payload.subtotalRef).toBe(totals.subtotalRef);
    expect(payload.subtotalVes).toBe(totals.subtotalVes);
    expect(payload.taxRef).toBe(totals.taxRef);
    expect(payload.taxVes).toBe(totals.taxVes);
  });

  it("makes the header totals the exact sum of the visible lines", () => {
    const items = [
      syncLineCostFields(pack({ id: "a", taxRate: 16 }), rate),
      syncLineCostFields(
        pack({ id: "b", packCostVes: 7314.24, packCount: 3, taxRate: 16, unitsPerPack: 24 }),
        rate,
      ),
      syncLineCostFields(
        pack({
          costCurrency: "ref",
          entryMode: "unit",
          id: "c",
          quantity: 7,
          taxRate: 0,
          unitCostRef: 1.35,
        }),
        rate,
      ),
    ];
    const totals = sumDraftPurchaseTotals(items, rate);
    const lines = items.map((item) => getDraftLineTotals(item, rate));

    expect(totals.subtotalRef).toBe(
      roundMoney(lines.reduce((sum, line) => sum + line.subtotalRef, 0)),
    );
    expect(totals.subtotalVes).toBe(
      roundMoney(lines.reduce((sum, line) => sum + line.subtotalVes, 0)),
    );
    expect(totals.taxRef).toBe(roundMoney(lines.reduce((sum, line) => sum + line.taxRef, 0)));
    expect(totals.taxVes).toBe(roundMoney(lines.reduce((sum, line) => sum + line.taxVes, 0)));
  });
});
