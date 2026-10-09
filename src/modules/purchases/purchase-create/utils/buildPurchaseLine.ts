import { roundMoney } from "@/shared/utils/currency";

import type { PurchaseCatalogProduct } from "../components/PurchaseProductPickerCard";
import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseCostCurrency,
  type PurchaseDraftItem,
} from "../types";
import { netCostRef } from "./buildPurchaseCatalog";

let lineSequence = 0;

/** Id de línea único aunque se agreguen dos en el mismo milisegundo (lector rápido). */
export function nextPurchaseLineId() {
  lineSequence += 1;

  return `purchase-item-${Date.now()}-${lineSequence}`;
}

/**
 * Línea con la que un producto entra a la compra: en modo empaque si el
 * proveedor tiene uno por defecto, por unidad si no.
 */
export function buildPurchaseLine(
  product: PurchaseCatalogProduct,
  input: { costCurrency: PurchaseCostCurrency; id: string; rateVes: number },
): PurchaseDraftItem {
  const defaultPack = product.defaultPackUnit ?? product.packUnits[0];

  if (defaultPack) {
    // Con compra previa, el último unitario neto por las unidades del bulto. Sin ella, del
    // costo con IVA del bulto y no del unitario ya redondeado: evita arrastrar centimos.
    const packCostRef =
      product.lastPurchaseUnitCostRef === undefined
        ? netCostRef(product.costWithTaxRef * defaultPack.unitsPerPack, product.taxRate)
        : roundMoney(product.lastPurchaseUnitCostRef * defaultPack.unitsPerPack);

    return createPackDraftItem({
      costCurrency: input.costCurrency,
      id: input.id,
      packCostRef,
      packLabel: defaultPack.label,
      packUnitId: defaultPack.id,
      productId: product.productId,
      rateVes: input.rateVes,
      taxRate: product.taxRate,
      unitCostRef: product.unitCostRef,
      unitsPerPack: defaultPack.unitsPerPack,
    });
  }

  return createUnitDraftItem({
    costCurrency: input.costCurrency,
    id: input.id,
    productId: product.productId,
    rateVes: input.rateVes,
    taxRate: product.taxRate,
    unitCostRef: product.unitCostRef,
  });
}
