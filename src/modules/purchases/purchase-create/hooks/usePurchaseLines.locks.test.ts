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

const rates = [buildRate("exento", "Exento", 0), buildRate("general", "General", 16)];

function unitLine(id: string, productId: string) {
  return createUnitDraftItem({ id, productId, rateVes: RATE_VES, taxRate: 16, unitCostVes: 1020 });
}

const cable = () => unitLine("line-cable", "prod-cable");
const jugo = () => unitLine("line-jugo", "prod-jugo");

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

function add(line: PurchaseDraftItem, lockOthers = true): PurchaseLinesAction {
  return { line, lockOthers, rateVes: RATE_VES, type: "productAdded" };
}

function lock(itemId: string, locked = true): PurchaseLinesAction {
  return { itemId, locked, type: "lineLockChanged" };
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

function payload(state: PurchaseLinesState) {
  return webLines(state).map((line) => draftToPurchaseItemInput(line.item, RATE_VES));
}

describe("purchaseLinesReducer · líneas bloqueables (COM-12)", () => {
  it("con la preferencia activa, agregar bloquea las anteriores; la nueva nace libre y pide el foco", () => {
    const state = run(add(cable()), add(refresco()));

    expect(lockedIds(state)).toEqual(["line-cable"]);
    expect(state.focus).toEqual({ itemId: "line-refresco", token: 2 });

    const third = purchaseLinesReducer(state, add(jugo()));

    expect(lockedIds(third)).toEqual(["line-refresco", "line-cable"]);
    expect(third.focus).toEqual({ itemId: "line-jugo", token: 3 });
  });

  it("con la preferencia apagada, agregar no bloquea nada pero la nueva sigue pidiendo el foco", () => {
    const state = run(add(cable(), false), add(refresco(), false));

    expect(lockedIds(state)).toEqual([]);
    expect(state.focus).toEqual({ itemId: "line-refresco", token: 2 });
  });

  it("volver a agregar un producto bloqueado lo desbloquea, le suma 1, le da el foco y cuenta como editada", () => {
    const state = run(add(cable()), add(refresco()), add({ ...cable(), id: "line-cable-2" }));

    expect(state.items.map((item) => item.id)).toEqual(["line-cable", "line-refresco"]);
    expect(lockedIds(state)).toEqual(["line-refresco"]);
    expect(state.focus).toEqual({ itemId: "line-cable", token: 3 });
    expect(webLines(state)[0]).toMatchObject({
      edited: true,
      editedMark: true,
      item: { quantity: 2 },
      locked: false,
    });
    expect(summary(state)).toEqual(["prod-cable: Cantidad 1 → 2"]);
  });

  it("bloquear apaga el punto de la fila pero la línea sigue en la revisión del resumen", () => {
    const edited = run(
      add(cable()),
      { itemId: "line-cable", type: "lineSettled" },
      update("line-cable", { quantity: 8 }),
    );

    expect(webLines(edited)[0]).toMatchObject({ edited: true, editedMark: true });

    const locked = purchaseLinesReducer(edited, lock("line-cable"));

    expect(webLines(locked)[0]).toMatchObject({ edited: true, editedMark: false, locked: true });
    expect(summary(locked)).toEqual(["prod-cable: Cantidad 1 → 8"]);

    // Desbloquear no lo enciende; cambiarla otra vez, sí.
    const unlocked = purchaseLinesReducer(locked, lock("line-cable", false));
    expect(webLines(unlocked)[0]).toMatchObject({ editedMark: false, locked: false });

    const again = purchaseLinesReducer(unlocked, update("line-cable", { quantity: 9 }));
    expect(webLines(again)[0]).toMatchObject({ edited: true, editedMark: true });
    expect(summary(again)).toEqual(["prod-cable: Cantidad 1 → 9"]);
  });

  it("bloquear una línea recién nacida la asienta: lo que cambie después es edición", () => {
    const state = run(
      add(cable()),
      update("line-cable", { quantity: 5 }),
      lock("line-cable"),
      lock("line-cable", false),
      update("line-cable", { quantity: 6 }),
    );

    expect(summary(state)).toEqual(["prod-cable: Cantidad 5 → 6"]);
  });

  it("una línea bloqueada no se edita, no cambia de alícuota y no se quita", () => {
    const locked = run(add(cable()), lock("line-cable"));
    const attempts: PurchaseLinesAction[] = [
      update("line-cable", { quantity: 99 }),
      { code: "exento", itemId: "line-cable", type: "lineTaxChosen" },
      { itemId: "line-cable", type: "lineRemoved" },
    ];

    expect(attempts.reduce(purchaseLinesReducer, locked)).toBe(locked);
  });

  it("la moneda de la compra y la compra exenta sí alcanzan a las líneas bloqueadas, sin marcarlas", () => {
    const state = run(
      add(cable()),
      lock("line-cable"),
      { currency: "ref", rateVes: RATE_VES, type: "costCurrencyChanged" },
      { exempt: true, type: "exemptChanged" },
    );

    expect(webLines(state)[0]).toMatchObject({
      edited: false,
      editedMark: false,
      item: { costCurrency: "ref", taxRate: 0 },
      locked: true,
    });
  });

  it("bloquear todas y desbloquear todas; tras bloquear todas, la que se agrega nace libre", () => {
    const all = run(add(cable(), false), add(refresco(), false), { type: "allLinesLocked" });

    expect(lockedIds(all)).toEqual(["line-refresco", "line-cable"]);
    expect(purchaseLinesReducer(all, { type: "allLinesLocked" })).toBe(all);

    const added = purchaseLinesReducer(all, add(jugo(), false));

    expect(lockedIds(added)).toEqual(["line-refresco", "line-cable"]);
    expect(webLines(added)[0]).toMatchObject({ item: { id: "line-jugo" }, locked: false });
    expect(lockedIds(purchaseLinesReducer(added, { type: "allLinesUnlocked" }))).toEqual([]);
  });

  it("quitar una línea ya desbloqueada no deja rastro de su bloqueo ni de su historial", () => {
    const state = run(
      add(cable()),
      lock("line-cable"),
      lock("line-cable", false),
      { itemId: "line-cable", type: "lineRemoved" },
    );

    expect(state).toMatchObject({
      items: [],
      locks: { locked: {} },
      review: { baselines: {}, reviewed: {} },
    });
  });

  it("el bloqueo no altera lo que se envía", () => {
    const state = run(add(cable()), add(refresco()));
    const free = purchaseLinesReducer(state, { type: "allLinesUnlocked" });

    expect(lockedIds(state)).toEqual(["line-cable"]);
    expect(payload(state)).toEqual(payload(free));
    expect(JSON.stringify(payload(state))).not.toMatch(/lock|edited|changes|review/i);
  });
});
