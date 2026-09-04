/**
 * Cuentas del borrador de compra.
 *
 * Las reglas de redondeo son delicadas: convertir el subtotal completo en vez
 * de multiplicar un costo unitario ya redondeado evita perder hasta un 10 % en
 * un bulto de cien unidades. Por eso vive aqui y no duplicada en cada cliente.
 */
import { refToVes, roundMoney, vesToRef } from "../currency";

import type {
  PurchaseCostCurrency,
  PurchaseDraftItem,
  PurchaseItemInput,
} from "./types";

export type PurchaseDraftLineTotals = {
  subtotalRef: number;
  subtotalVes: number;
  taxRef: number;
  taxVes: number;
  totalRef: number;
  totalVes: number;
};

export type PurchaseDraftTotals = {
  subtotalRef: number;
  subtotalVes: number;
  taxRef: number;
  taxVes: number;
};

export function draftToPurchaseItemInput(
  item: PurchaseDraftItem,
  rateVes = 0,
): PurchaseItemInput {
  const { subtotalRef, subtotalVes, taxRef, taxVes } = getDraftLineTotals(item, rateVes);

  if (item.entryMode === "pack") {
    return {
      costCurrency: item.costCurrency,
      entryMode: "pack",
      packCostRef: item.packCostRef,
      packCostVes: item.packCostVes,
      packCount: item.packCount,
      packLabel: item.packLabel,
      productId: item.productId,
      subtotalRef,
      subtotalVes,
      taxRate: item.taxRate,
      taxRef,
      taxVes,
      unitCostRef: item.unitCostRef,
      unitCostVes: item.unitCostVes,
      unitsPerPack: item.unitsPerPack,
    };
  }

  return {
    costCurrency: item.costCurrency,
    entryMode: "unit",
    productId: item.productId,
    quantity: item.quantity,
    subtotalRef,
    subtotalVes,
    taxRate: item.taxRate,
    taxRef,
    taxVes,
    unitCostRef: item.unitCostRef,
    unitCostVes: item.unitCostVes,
  };
}

/** Magnitud REF "cruda": cantidad x costo REF ya redondeado a 2 decimales. */
function rawSubtotalRef(item: PurchaseDraftItem) {
  if (item.entryMode === "pack") {
    return item.packCount * item.packCostRef;
  }

  return item.quantity * item.unitCostRef;
}

/** Magnitud Bs "cruda": cantidad x costo Bs ya redondeado a 2 decimales. */
function rawSubtotalVes(item: PurchaseDraftItem) {
  if (item.entryMode === "pack") {
    return item.packCount * item.packCostVes;
  }

  return item.quantity * item.unitCostVes;
}

/**
 * Subtotal REF de la linea.
 *
 * Si la captura es en Bs, el REF exacto sale de convertir el monto en Bs de la
 * linea completa. Multiplicar el costo unitario/por bulto ya redondeado a 2
 * decimales arrastra el error a toda la cantidad: un bulto de 100 u a 0.0220
 * REF/u queda como 0.02 REF/u y la linea pierde ~10%.
 */
export function getDraftSubtotalRef(item: PurchaseDraftItem, rateVes = 0) {
  if (item.costCurrency === "ves" && rateVes > 0) {
    return roundMoney(vesToRef(rawSubtotalVes(item), rateVes));
  }

  return roundMoney(rawSubtotalRef(item));
}

/** Subtotal Bs de la linea; simetrico a getDraftSubtotalRef cuando se captura en REF. */
export function getDraftSubtotalVes(item: PurchaseDraftItem, rateVes = 0) {
  if (item.costCurrency === "ref" && rateVes > 0) {
    return roundMoney(refToVes(rawSubtotalRef(item), rateVes));
  }

  return roundMoney(rawSubtotalVes(item));
}

export function getDraftTaxAmount(baseAmount: number, taxRate: number) {
  return roundMoney(baseAmount * (Math.max(0, taxRate) / 100));
}

export function getDraftTotalWithTax(baseAmount: number, taxRate: number) {
  return roundMoney(baseAmount + getDraftTaxAmount(baseAmount, taxRate));
}

/**
 * Unica fuente de verdad de los montos de una linea: la tabla, el resumen y el
 * payload que viaja al RPC leen de aqui para que no puedan desalinearse.
 */
export function getDraftLineTotals(
  item: PurchaseDraftItem,
  rateVes = 0,
): PurchaseDraftLineTotals {
  const subtotalRef = getDraftSubtotalRef(item, rateVes);
  const subtotalVes = getDraftSubtotalVes(item, rateVes);
  const taxRef = getDraftTaxAmount(subtotalRef, item.taxRate);
  const taxVes = getDraftTaxAmount(subtotalVes, item.taxRate);

  return {
    subtotalRef,
    subtotalVes,
    taxRef,
    taxVes,
    totalRef: roundMoney(subtotalRef + taxRef),
    totalVes: roundMoney(subtotalVes + taxVes),
  };
}

/** Suma de lineas ya redondeadas: el encabezado siempre cuadra con lo que se ve item por item. */
export function sumDraftPurchaseTotals(
  items: PurchaseDraftItem[],
  rateVes = 0,
): PurchaseDraftTotals {
  return items.reduce<PurchaseDraftTotals>(
    (totals, item) => {
      const line = getDraftLineTotals(item, rateVes);

      return {
        subtotalRef: roundMoney(totals.subtotalRef + line.subtotalRef),
        subtotalVes: roundMoney(totals.subtotalVes + line.subtotalVes),
        taxRef: roundMoney(totals.taxRef + line.taxRef),
        taxVes: roundMoney(totals.taxVes + line.taxVes),
      };
    },
    { subtotalRef: 0, subtotalVes: 0, taxRef: 0, taxVes: 0 },
  );
}

/**
 * Keep pack↔unit and REF↔VES in sync.
 * `costCurrency` is the editable source of truth for the primary magnitude.
 */
export function syncLineCostFields(
  item: PurchaseDraftItem,
  rateVes: number,
): PurchaseDraftItem {
  if (item.entryMode !== "pack") {
    if (item.costCurrency === "ves") {
      const unitCostVes = Math.max(0, item.unitCostVes);
      const unitCostRef = roundMoney(vesToRef(unitCostVes, rateVes));
      return {
        ...item,
        packCostRef: 0,
        packCostVes: 0,
        unitCostRef,
        unitCostVes,
      };
    }

    const unitCostRef = Math.max(0, item.unitCostRef);
    const unitCostVes = roundMoney(refToVes(unitCostRef, rateVes));
    return {
      ...item,
      packCostRef: 0,
      packCostVes: 0,
      unitCostRef,
      unitCostVes,
    };
  }

  const unitsPerPack = Math.max(1, item.unitsPerPack);
  const packCount = Math.max(1, item.packCount);
  const quantity = packCount * unitsPerPack;

  if (item.costCurrency === "ves") {
    const packCostVes = Math.max(0, item.packCostVes);
    const unitCostVes = roundMoney(packCostVes / unitsPerPack);
    const packCostRef = roundMoney(vesToRef(packCostVes, rateVes));
    // Deriva el unitario REF del costo Bs del bulto (no del unitario Bs ya
    // redondeado) para no acumular dos redondeos seguidos.
    const unitCostRef = roundMoney(vesToRef(packCostVes / unitsPerPack, rateVes));

    return {
      ...item,
      packCostRef,
      packCostVes,
      packCount,
      quantity,
      unitCostRef,
      unitCostVes,
      unitsPerPack,
    };
  }

  const packCostRef = Math.max(0, item.packCostRef);
  const unitCostRef = roundMoney(packCostRef / unitsPerPack);
  const packCostVes = roundMoney(refToVes(packCostRef, rateVes));
  const unitCostVes = roundMoney(refToVes(packCostRef / unitsPerPack, rateVes));

  return {
    ...item,
    packCostRef,
    packCostVes,
    packCount,
    quantity,
    unitCostRef,
    unitCostVes,
    unitsPerPack,
  };
}

/** @deprecated Prefer syncLineCostFields(item, rateVes) */
export function syncPackDerivedFields(
  item: PurchaseDraftItem,
  rateVes = 0,
): PurchaseDraftItem {
  if (rateVes > 0) {
    return syncLineCostFields(item, rateVes);
  }

  if (item.entryMode !== "pack") {
    return item;
  }

  const quantity = item.packCount * item.unitsPerPack;
  const unitCostRef =
    item.unitsPerPack > 0 ? roundMoney(item.packCostRef / item.unitsPerPack) : 0;
  const unitCostVes =
    item.unitsPerPack > 0 ? roundMoney(item.packCostVes / item.unitsPerPack) : 0;

  return {
    ...item,
    quantity,
    unitCostRef,
    unitCostVes,
  };
}

export function switchCostCurrency(
  item: PurchaseDraftItem,
  nextCurrency: PurchaseCostCurrency,
  rateVes: number,
): PurchaseDraftItem {
  if (item.costCurrency === nextCurrency) {
    return syncLineCostFields(item, rateVes);
  }

  // Refresh mirrors from the current editable currency, then flip.
  // The next edit will treat `nextCurrency` as source of truth.
  const synced = syncLineCostFields(item, rateVes);
  return syncLineCostFields({ ...synced, costCurrency: nextCurrency }, rateVes);
}
