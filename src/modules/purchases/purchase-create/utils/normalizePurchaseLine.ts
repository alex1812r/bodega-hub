/**
 * Las cuentas del borrador viven en `@bodega/core/purchases` para que el movil
 * llegue al mismo costo unitario. Aqui solo se reexportan, junto con el
 * normalizador que usa el servidor sobre el payload ya validado con Zod.
 */
export {
  normalizePurchaseLine,
  type NormalizedPurchaseLine,
  type PurchaseItemInput,
} from "@/modules/purchases/schemas/purchaseItem.schema";

export {
  draftToPurchaseItemInput,
  getDraftLineTotals,
  getDraftSubtotalRef,
  getDraftSubtotalVes,
  getDraftTaxAmount,
  getDraftTotalWithTax,
  sumDraftPurchaseTotals,
  switchCostCurrency,
  syncLineCostFields,
  syncPackDerivedFields,
  type PurchaseDraftLineTotals,
  type PurchaseDraftTotals,
} from "@bodega/core/purchases";
