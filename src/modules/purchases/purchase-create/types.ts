import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";

/**
 * El borrador de compra vive en `@bodega/core/purchases`: el movil calcula los
 * mismos costos. Aqui solo queda lo que depende del catalogo de la web.
 */
export {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseCostCurrency,
  type PurchaseDraftItem,
} from "@bodega/core/purchases";

export type PurchaseLineCatalogMeta = {
  name: string;
  packUnits?: SupplierProductPackUnit[];
  sku: string;
  taxRate: number;
};
