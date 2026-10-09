import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";

import type {
  PurchaseCostCurrency,
  PurchaseDraftItem,
  PurchaseEditedLineSummary,
  PurchaseLineChange,
  PurchaseLineReviewState,
  PurchaseLineSnapshot,
  PurchaseTaxState,
  PurchaseWebLine,
} from "../types";
import { switchCostCurrency } from "./normalizePurchaseLine";

export const EMPTY_PURCHASE_REVIEW_STATE: PurchaseLineReviewState = {
  baselines: {},
  reviewed: {},
};

export function snapshotPurchaseLine(
  item: PurchaseDraftItem,
  taxState: PurchaseTaxState,
): PurchaseLineSnapshot {
  return { item, taxChoice: taxState.choices[item.id] ?? null };
}

/**
 * Asienta las líneas que aún estaban recién nacidas: guarda su foto. Una línea
 * ya asentada conserva la suya (es contra la que se compara).
 */
export function settlePurchaseLines(
  state: PurchaseLineReviewState,
  items: PurchaseDraftItem[],
  taxState: PurchaseTaxState,
): PurchaseLineReviewState {
  const pending = items.filter((item) => !(item.id in state.baselines));

  if (pending.length === 0) {
    return state;
  }

  const baselines = { ...state.baselines };
  for (const item of pending) {
    baselines[item.id] = snapshotPurchaseLine(item, taxState);
  }

  return { ...state, baselines };
}

/**
 * Las líneas se bloquearon: se dan por revisadas tal como están. Su punto
 * "Línea editada" se apaga; en el resumen siguen contando si cambiaron respecto
 * a su foto de `baselines`.
 */
export function markPurchaseLinesReviewed(
  state: PurchaseLineReviewState,
  items: PurchaseDraftItem[],
  taxState: PurchaseTaxState,
): PurchaseLineReviewState {
  if (items.length === 0) {
    return state;
  }

  const reviewed = { ...state.reviewed };
  for (const item of items) {
    reviewed[item.id] = snapshotPurchaseLine(item, taxState);
  }

  return { ...state, reviewed };
}

function mapSnapshots(
  snapshots: Record<string, PurchaseLineSnapshot>,
  map: (snapshot: PurchaseLineSnapshot) => PurchaseLineSnapshot,
) {
  return Object.fromEntries(Object.entries(snapshots).map(([id, snapshot]) => [id, map(snapshot)]));
}

/** La línea se quitó de la compra: su historial no debe sobrevivirle. */
export function dropPurchaseLineReview(
  state: PurchaseLineReviewState,
  itemId: string,
): PurchaseLineReviewState {
  if (!(itemId in state.baselines) && !(itemId in state.reviewed)) {
    return state;
  }

  const baselines = { ...state.baselines };
  const reviewed = { ...state.reviewed };
  delete baselines[itemId];
  delete reviewed[itemId];

  return { baselines, reviewed };
}

/**
 * "Compra exenta" cambió y descartó las alícuotas elegidas a mano de TODA la
 * compra: es una decisión de la compra, no una edición de cada línea, así que
 * las fotos también las olvidan.
 */
export function clearPurchaseReviewTaxChoices(
  state: PurchaseLineReviewState,
): PurchaseLineReviewState {
  const clear = (snapshot: PurchaseLineSnapshot) => ({ ...snapshot, taxChoice: null });

  return {
    baselines: mapSnapshots(state.baselines, clear),
    reviewed: mapSnapshots(state.reviewed, clear),
  };
}

/**
 * La moneda de costo de la compra cambió: las fotos pasan a la misma moneda con
 * la misma conversión que las líneas, para que el cambio no cuente como edición.
 */
export function switchPurchaseReviewCostCurrency(
  state: PurchaseLineReviewState,
  currency: PurchaseCostCurrency,
  rateVes: number,
): PurchaseLineReviewState {
  const convert = (snapshot: PurchaseLineSnapshot) => ({
    ...snapshot,
    item: switchCostCurrency(snapshot.item, currency, rateVes),
  });

  return {
    baselines: mapSnapshots(state.baselines, convert),
    reviewed: mapSnapshots(state.reviewed, convert),
  };
}

function formatCost(item: PurchaseDraftItem, ref: number, ves: number) {
  return item.costCurrency === "ves" ? formatVesBs(ves) : formatRefUsd(ref);
}

/** Costo tecleado: se compara en la moneda de la compra, que es la fuente de verdad. */
function costChanged(item: PurchaseDraftItem, before: [number, number], after: [number, number]) {
  const index = item.costCurrency === "ves" ? 1 : 0;

  return roundMoney(before[index]) !== roundMoney(after[index]);
}

function describePack(item: PurchaseDraftItem) {
  return item.entryMode === "pack"
    ? `${item.packLabel.trim() || "Empaque"} × ${item.unitsPerPack} u`
    : "Por unidad";
}

/**
 * Cambios de cantidad, costo y empaque entre la foto de una línea (`before`) y
 * su estado actual. Ambas deben venir de `syncLineCostFields` con la misma tasa.
 * La alícuota la compara `buildPurchaseWebLines`, que es quien la resuelve.
 */
export function getPurchaseLineItemChanges(
  before: PurchaseDraftItem,
  after: PurchaseDraftItem,
): PurchaseLineChange[] {
  const changes: PurchaseLineChange[] = [];

  if (describePack(before) !== describePack(after)) {
    changes.push({
      field: "pack",
      from: describePack(before),
      label: "Empaque",
      to: describePack(after),
    });
  }

  const bothPack = before.entryMode === "pack" && after.entryMode === "pack";

  if (bothPack && before.packCount !== after.packCount) {
    changes.push({
      field: "packCount",
      from: String(before.packCount),
      label: "Empaques",
      to: String(after.packCount),
    });
  }

  // Sin empaque en alguno de los dos lados se comparan las unidades totales.
  if (!bothPack && before.quantity !== after.quantity) {
    changes.push({
      field: "quantity",
      from: String(before.quantity),
      label: "Cantidad",
      to: String(after.quantity),
    });
  }

  if (
    bothPack &&
    costChanged(
      after,
      [before.packCostRef, before.packCostVes],
      [after.packCostRef, after.packCostVes],
    )
  ) {
    changes.push({
      field: "packCost",
      from: formatCost(after, before.packCostRef, before.packCostVes),
      label: "Costo por empaque",
      to: formatCost(after, after.packCostRef, after.packCostVes),
    });
  }

  if (
    !bothPack &&
    costChanged(
      after,
      [before.unitCostRef, before.unitCostVes],
      [after.unitCostRef, after.unitCostVes],
    )
  ) {
    changes.push({
      field: "unitCost",
      from: formatCost(after, before.unitCostRef, before.unitCostVes),
      label: "Costo",
      to: formatCost(after, after.unitCostRef, after.unitCostVes),
    });
  }

  return changes;
}

export function formatPurchaseLineChange(change: PurchaseLineChange) {
  return `${change.label} ${change.from} → ${change.to}`;
}

/** "1 línea editada tras ser agregada" / "3 líneas editadas tras ser agregadas". */
export function formatEditedLinesCount(count: number) {
  return count === 1
    ? "1 línea editada tras ser agregada"
    : `${count} líneas editadas tras ser agregadas`;
}

/**
 * Líneas editadas después de haber sido agregadas, con lo que cambió en cada
 * una ("Cantidad 5 → 8"), en el orden de la tabla. Es la lista de revisión del
 * resumen antes de confirmar; la consume también la confirmación (CNF-01).
 */
export function getEditedLinesSummary(
  lines: PurchaseWebLine[],
  getProductName: (productId: string) => string,
): PurchaseEditedLineSummary[] {
  return lines
    .filter((line) => line.edited)
    .map((line) => ({
      changes: line.changes,
      itemId: line.item.id,
      name: getProductName(line.item.productId),
      productId: line.item.productId,
      text: line.changes.map(formatPurchaseLineChange).join(" · "),
    }));
}
