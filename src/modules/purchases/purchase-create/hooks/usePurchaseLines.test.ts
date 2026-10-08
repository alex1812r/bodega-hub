import type { TaxRate } from "@/shared/hooks/useTaxRates";

import { createPackDraftItem, createUnitDraftItem, type PurchaseDraftItem } from "../types";
import { draftToPurchaseItemInput } from "../utils/normalizePurchaseLine";
import { getEditedLinesSummary } from "../utils/purchaseLineReview";
import { buildPurchaseWebLines } from "../utils/purchaseLineTax";
import {
  EMPTY_PURCHASE_LINES_STATE,
  purchaseLinesReducer,
  type PurchaseLinesAction,
  type PurchaseLinesState,
} from "./usePurchaseLines";

const RATE_VES = 510;

function buildRate(code: string, label: string, pct: number): TaxRate {
  return {
    code,
    id: `tax-${code}`,
    isActive: true,
    isDefault: code === "general",
    isGlobal: true,
    label,
    pct,
    sortOrder: pct,
  };
}

const rates = [
  buildRate("exento", "Exento", 0),
  buildRate("reducida", "Reducida", 8),
  buildRate("general", "General", 16),
];

function cable(input: Partial<Parameters<typeof createUnitDraftItem>[0]> = {}) {
  return createUnitDraftItem({
    id: "line-cable",
    productId: "prod-cable",
    rateVes: RATE_VES,
    taxRate: 16,
    unitCostVes: 1020,
    ...input,
  });
}

function refresco() {
  return createPackDraftItem({
    id: "line-refresco",
    packCostVes: 6120,
    packLabel: "Caja",
    packUnitId: "pack-caja",
    productId: "prod-refresco",
    rateVes: RATE_VES,
    taxRate: 16,
    unitsPerPack: 12,
  });
}

function run(...actions: PurchaseLinesAction[]) {
  return actions.reduce(purchaseLinesReducer, EMPTY_PURCHASE_LINES_STATE);
}

function add(line: PurchaseDraftItem, lockOthers = false): PurchaseLinesAction {
  return { line, lockOthers, rateVes: RATE_VES, type: "productAdded" };
}

function update(itemId: string, input: Partial<PurchaseDraftItem>): PurchaseLinesAction {
  return { input, itemId, rateVes: RATE_VES, type: "lineUpdated" };
}

function webLines(state: PurchaseLinesState) {
  return buildPurchaseWebLines({
    getCategoryPct: () => 16,
    items: state.items,
    locks: state.locks,
    rateVes: RATE_VES,
    rates,
    review: state.review,
    taxState: state.taxState,
  });
}

function lockedIds(state: PurchaseLinesState) {
  return webLines(state)
    .filter((line) => line.locked)
    .map((line) => line.item.id);
}

function summary(state: PurchaseLinesState) {
  return getEditedLinesSummary(webLines(state), (productId) => productId).map(
    (line) => `${line.name}: ${line.text}`,
  );
}

describe("purchaseLinesReducer · línea editada (COM-13)", () => {
  it("lo que se cambia en una línea recién nacida es su primera captura, no una edición", () => {
    const state = run(
      add(cable()),
      update("line-cable", { quantity: 5 }),
      { code: "reducida", itemId: "line-cable", type: "lineTaxChosen" },
      { itemId: "line-cable", type: "lineSettled" },
    );

    expect(state.review.baselines["line-cable"]).toMatchObject({
      item: { quantity: 5 },
      taxChoice: "reducida",
    });
    expect(summary(state)).toEqual([]);
  });

  it("una vez asentada, cada cambio sale con antes → después y deshacerlo la deja sin editar", () => {
    const settled = run(add(cable()), { itemId: "line-cable", type: "lineSettled" });
    const edited = [
      update("line-cable", { quantity: 8 }),
      update("line-cable", { unitCostVes: 1100.5 }),
      { code: "reducida", itemId: "line-cable", type: "lineTaxChosen" } as const,
    ].reduce(purchaseLinesReducer, settled);

    expect(summary(edited)).toEqual([
      "prod-cable: Cantidad 1 → 8 · Costo Bs. 1.020,00 → Bs. 1.100,50 · IVA General 16 % → Reducida 8 %",
    ]);
    expect(webLines(edited)[0]).toMatchObject({ edited: true });

    const undone = [
      update("line-cable", { quantity: 1 }),
      update("line-cable", { unitCostVes: 1020 }),
      { code: "general", itemId: "line-cable", type: "lineTaxChosen" } as const,
    ].reduce(purchaseLinesReducer, edited);

    expect(summary(undone)).toEqual([]);
  });

  it("asentar dos veces conserva la primera foto", () => {
    const state = run(
      add(cable()),
      { itemId: "line-cable", type: "lineSettled" },
      update("line-cable", { quantity: 8 }),
      { itemId: "line-cable", type: "lineSettled" },
    );

    expect(summary(state)).toEqual(["prod-cable: Cantidad 1 → 8"]);
  });

  it("agregar otro producto asienta las líneas que había", () => {
    const state = run(add(cable()), add(refresco()), update("line-cable", { quantity: 2 }));

    expect(state.items.map((item) => item.id)).toEqual(["line-refresco", "line-cable"]);
    expect(Object.keys(state.review.baselines)).toEqual(["line-cable"]);
    expect(lockedIds(state)).toEqual([]);
    expect(summary(state)).toEqual(["prod-cable: Cantidad 1 → 2"]);
  });

  it("volver a agregar el mismo producto suma 1 a la existente, la sube y cuenta como edición", () => {
    const state = run(
      add(cable()),
      add(refresco()),
      add(cable({ id: "line-cable-2" })),
      add(createPackDraftItem({ ...refresco(), id: "line-refresco-2", rateVes: RATE_VES })),
    );

    expect(state.items.map((item) => item.id)).toEqual(["line-refresco", "line-cable"]);
    expect(summary(state)).toEqual([
      "prod-refresco: Empaques 1 → 2",
      "prod-cable: Cantidad 1 → 2",
    ]);
  });

  it("cambiar el empaque de una línea asentada cuenta como edición", () => {
    const toPack = run(
      add(cable()),
      { itemId: "line-cable", type: "lineSettled" },
      update("line-cable", {
        entryMode: "pack",
        packCostVes: 12240,
        packCount: 1,
        packLabel: "Caja",
        unitsPerPack: 12,
      }),
    );

    expect(summary(toPack)).toEqual(["prod-cable: Empaque Por unidad → Caja × 12 u · Cantidad 1 → 12"]);

    const packCost = run(
      add(refresco()),
      { itemId: "line-refresco", type: "lineSettled" },
      update("line-refresco", { packCostVes: 6300, unitsPerPack: 24 }),
    );

    expect(summary(packCost)).toEqual([
      "prod-refresco: Empaque Caja × 12 u → Caja × 24 u · Costo por empaque Bs. 6.120,00 → Bs. 6.300,00",
    ]);
  });

  it("la moneda de la compra y la compra exenta no cuentan como edición de cada línea", () => {
    const state = run(
      add(cable()),
      { code: "reducida", itemId: "line-cable", type: "lineTaxChosen" },
      { itemId: "line-cable", type: "lineSettled" },
      { currency: "ref", rateVes: RATE_VES, type: "costCurrencyChanged" },
      { exempt: true, type: "exemptChanged" },
    );

    expect(state.items[0]).toMatchObject({ costCurrency: "ref", unitCostRef: 2 });
    expect(webLines(state)[0]?.tax.code).toBe("exento");
    expect(summary(state)).toEqual([]);

    // Un costo cambiado en la moneda nueva se compara y se muestra en esa moneda.
    const edited = purchaseLinesReducer(state, update("line-cable", { unitCostRef: 2.5 }));
    expect(summary(edited)).toEqual(["prod-cable: Costo ref 2.00 → ref 2.50"]);
  });

  it("un catálogo de alícuotas que llega tarde no convierte la línea en editada", () => {
    const state = run(add(cable()), { itemId: "line-cable", type: "lineSettled" });
    const before = buildPurchaseWebLines({
      getCategoryPct: () => 16,
      items: state.items,
      rateVes: RATE_VES,
      rates: [],
      review: state.review,
      taxState: state.taxState,
    });

    expect(before[0]).toMatchObject({ edited: false, tax: { code: null } });
    expect(webLines(state)[0]).toMatchObject({ edited: false, tax: { code: "general" } });
  });

  it("quitar la línea o cambiar de proveedor borra su historial", () => {
    const state = run(add(cable()), add(refresco()), { itemId: "line-cable", type: "lineRemoved" });

    expect(state.review.baselines).toEqual({});
    expect(state.items.map((item) => item.id)).toEqual(["line-refresco"]);

    const exempt = purchaseLinesReducer(state, { exempt: true, type: "exemptChanged" });
    expect(purchaseLinesReducer(exempt, { type: "supplierChanged" })).toEqual({
      ...EMPTY_PURCHASE_LINES_STATE,
      taxState: { choices: {}, exempt: true },
    });
  });

  it("el historial no altera lo que se envía: mismo payload con o sin él", () => {
    const state = run(
      add(cable()),
      { itemId: "line-cable", type: "lineSettled" },
      update("line-cable", { quantity: 8 }),
    );
    const withoutReview = buildPurchaseWebLines({
      getCategoryPct: () => 16,
      items: state.items,
      rateVes: RATE_VES,
      rates,
      taxState: state.taxState,
    });
    const payload = (lines: ReturnType<typeof webLines>) =>
      lines.map((line) => draftToPurchaseItemInput(line.item, RATE_VES));

    expect(webLines(state)[0]?.edited).toBe(true);
    expect(withoutReview[0]?.edited).toBe(false);
    expect(payload(webLines(state))).toEqual(payload(withoutReview));
  });
});

describe("purchaseLinesReducer · líneas repuestas de golpe (COM-09)", () => {
  it("linesRestored sustituye líneas, bloqueos, revisión y alícuotas, y no pide el foco", () => {
    const saved = run(
      add(cable()),
      { itemId: "line-cable", type: "lineSettled" },
      update("line-cable", { quantity: 5 }),
      add(refresco(), true),
      { exempt: true, type: "exemptChanged" },
    );
    const { focus: savedFocus, ...snapshot } = saved;
    const before = run(add(cable({ id: "line-otra", productId: "prod-otro" })));
    const restored = purchaseLinesReducer(before, { state: snapshot, type: "linesRestored" });

    expect(savedFocus).not.toBe(before.focus);
    expect(restored.focus).toBe(before.focus);
    expect(restored.items.map((item) => item.id)).toEqual(saved.items.map((item) => item.id));
    expect(lockedIds(restored)).toEqual(["line-cable"]);
    expect(restored.taxState.exempt).toBe(true);
    expect(summary(restored)).toEqual(summary(saved));
    expect(summary(restored)).toHaveLength(1);
  });
});
