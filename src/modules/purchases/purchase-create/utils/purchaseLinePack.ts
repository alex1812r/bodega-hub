import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";
import { refToVes, roundMoney, vesToRef } from "@/shared/utils/currency";

import type { PurchaseDraftItem } from "../types";
import { syncLineCostFields } from "./normalizePurchaseLine";

/** Tipos de empaque que se pueden elegir cuando el proveedor no tiene uno guardado. */
export const STANDARD_PACK_LABELS = ["Bulto", "Paquete", "Caja", "Manga"] as const;

export type StandardPackLabel = (typeof STANDARD_PACK_LABELS)[number];

export function normalizeStandardPackLabel(label: string): StandardPackLabel {
  const match = STANDARD_PACK_LABELS.find(
    (option) => option.toLowerCase() === label.trim().toLowerCase(),
  );

  return match ?? "Bulto";
}

/** Línea por empaque sin empaque guardado del proveedor: tipo y unidades se teclean. */
export function isCustomPackLine(item: PurchaseDraftItem) {
  return item.entryMode === "pack" && !item.packUnitId;
}

/** Empaque con el que una línea pasa a modo empaque: el por defecto del proveedor, si tiene. */
export function getDefaultPackUnit(packUnits: SupplierProductPackUnit[] | undefined) {
  return packUnits?.find((packUnit) => packUnit.isDefault) ?? packUnits?.[0] ?? null;
}

function resolvePackCostFromItem(item: PurchaseDraftItem, unitsPerPack: number, rateVes: number) {
  if (item.costCurrency === "ves") {
    if (item.entryMode === "pack" && item.packCostVes > 0) {
      return {
        packCostRef: roundMoney(vesToRef(item.packCostVes, rateVes)),
        packCostVes: item.packCostVes,
      };
    }
    if (item.unitCostVes > 0) {
      const packCostVes = roundMoney(item.unitCostVes * unitsPerPack);
      return { packCostRef: roundMoney(vesToRef(packCostVes, rateVes)), packCostVes };
    }
  }

  if (item.entryMode === "pack" && item.packCostRef > 0) {
    return {
      packCostRef: item.packCostRef,
      packCostVes: roundMoney(refToVes(item.packCostRef, rateVes)),
    };
  }

  if (item.unitCostRef > 0) {
    const packCostRef = roundMoney(item.unitCostRef * unitsPerPack);
    return {
      packCostRef,
      packCostVes: roundMoney(refToVes(packCostRef, rateVes)),
    };
  }

  return {
    packCostRef: Math.max(0, item.packCostRef),
    packCostVes: Math.max(0, item.packCostVes),
  };
}

/**
 * Pasa la línea a modo empaque. Con `packUnit` usa el empaque guardado del proveedor;
 * con `null`, uno personalizado que conserva las unidades por empaque de la línea.
 */
export function applyPackPreset(
  item: PurchaseDraftItem,
  packUnit: SupplierProductPackUnit | null,
  rateVes: number,
): PurchaseDraftItem {
  if (!packUnit) {
    const unitsPerPack = Math.max(1, item.unitsPerPack || 1);
    const costs = resolvePackCostFromItem(item, unitsPerPack, rateVes);
    return syncLineCostFields(
      {
        ...item,
        entryMode: "pack",
        packCostRef: costs.packCostRef,
        packCostVes: costs.packCostVes,
        packCount: Math.max(1, item.packCount || 1),
        packLabel: normalizeStandardPackLabel(item.packLabel || "Bulto"),
        packUnitId: undefined,
        unitsPerPack,
      },
      rateVes,
    );
  }

  const costs = resolvePackCostFromItem(item, packUnit.unitsPerPack, rateVes);
  return syncLineCostFields(
    {
      ...item,
      entryMode: "pack",
      packCostRef: costs.packCostRef,
      packCostVes: costs.packCostVes,
      packCount: Math.max(1, item.packCount || 1),
      packLabel: packUnit.label,
      packUnitId: packUnit.id,
      unitsPerPack: packUnit.unitsPerPack,
    },
    rateVes,
  );
}

/** Empaque personalizado de un tipo estándar (Bulto, Caja…), sin empaque guardado. */
export function applyCustomPackLabel(
  item: PurchaseDraftItem,
  label: StandardPackLabel,
  rateVes: number,
): PurchaseDraftItem {
  return syncLineCostFields({ ...applyPackPreset(item, null, rateVes), packLabel: label }, rateVes);
}

/** Vuelve a captura por unidad conservando las unidades totales y el costo unitario del empaque. */
export function toUnitLine(item: PurchaseDraftItem, rateVes: number): PurchaseDraftItem {
  const normalized = syncLineCostFields(item, rateVes);

  return syncLineCostFields(
    {
      ...item,
      entryMode: "unit",
      quantity: Math.max(1, normalized.quantity || 1),
      unitCostRef: normalized.unitCostRef,
      unitCostVes: normalized.unitCostVes,
    },
    rateVes,
  );
}
