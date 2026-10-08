import type { PurchaseDraftItem } from "@bodega/core/purchases";

import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";
import type { TaxRate } from "@/shared/hooks/useTaxRates";

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
  /** Porcentaje de IVA de la categoría del producto. */
  taxRate: number;
};

/**
 * Alícuota de IVA de una línea (COM-11). `PurchaseDraftItem` (core) solo conoce
 * el porcentaje; el código de la alícuota es estado de la web.
 *
 * Se GUARDA lo mínimo (`PurchaseTaxState`) y la alícuota efectiva de cada línea
 * se DERIVA con `resolvePurchaseLineTax` (`utils/purchaseLineTax.ts`): así una
 * línea agregada antes de que cargue el catálogo de alícuotas se resuelve sola
 * al llegar, sin efectos de sincronización.
 */
export type PurchaseTaxState = {
  /**
   * Alícuota elegida a mano por línea: `item.id` -> `code`. Sin entrada, la
   * línea usa su alícuota por defecto (la de su categoría, o Exento con
   * "Compra exenta").
   */
  choices: Record<string, string>;
  /** Toggle "Compra exenta": la alícuota por defecto de TODAS las líneas es Exento. */
  exempt: boolean;
};

/** Alícuota efectiva de una línea; nunca se guarda, siempre se deriva. */
export type PurchaseLineTax = {
  /** Alícuota ACTIVA de la categoría del producto; `null` si ninguna tiene su porcentaje. */
  categoryCode: string | null;
  /** `null` = sin alícuota válida: la línea pide "Elige una alícuota" y la compra no se confirma. */
  code: string | null;
  /** Nombre de la alícuota ("General"); `null` sin alícuota válida. */
  label: string | null;
  /** Elegida a mano y distinta de la que la línea tendría por defecto. */
  manual: boolean;
  /** Porcentaje con el que calcula la línea (el mismo que lleva `item.taxRate`). */
  rate: number;
};

/**
 * Línea tal como la pinta y la envía la web: el borrador de core, con
 * `item.taxRate` ya igualado al porcentaje de `tax`, más el estado que solo
 * existe en la web. Lo arma `buildPurchaseWebLines`; la tabla, el resumen y el
 * payload leen de aquí y nunca del `taxRate` del borrador guardado.
 */
export type PurchaseWebLine = {
  item: PurchaseDraftItem;
  tax: PurchaseLineTax;
};

/** Catálogo de alícuotas de `useTaxRates({ activeOnly: false })` para los chips de línea. */
export type PurchaseTaxCatalog = {
  error: Error | null;
  isLoading: boolean;
  rates: TaxRate[];
  refetch: () => void;
};

/** Una fila del desglose de IVA del resumen: base e impuesto de una alícuota. */
export type PurchaseTaxBreakdownRow = {
  baseRef: number;
  baseVes: number;
  /** `code` de la alícuota; las líneas sin alícuota válida se agrupan por porcentaje. */
  key: string;
  /** "General 16 %". */
  label: string;
  rate: number;
  taxRef: number;
  taxVes: number;
};
