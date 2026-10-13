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
  /** Qué cambió respecto a como quedó la línea al asentarse; vacío si no cambió. */
  changes: PurchaseLineChange[];
  /**
   * `changes.length > 0`: la línea se editó DESPUÉS de haber sido agregada (COM-13).
   * Es lo que cuenta el resumen ("N líneas editadas tras ser agregadas") y NO se
   * apaga al bloquear: la revisión final las lista todas.
   */
  edited: boolean;
  /**
   * Punto "Línea editada" de la fila. A diferencia de `edited`, se apaga al
   * bloquear la línea (el usuario ya la dio por revisada) y vuelve a encenderse
   * si se desbloquea y se cambia otra vez.
   */
  editedMark: boolean;
  /**
   * «Desarmar al recibir» (COM-14). `undefined`: el producto no es un empaque con
   * receta activa y la fila no ofrece el chip. `true` / `false`: marcado o no.
   * Lo añade `withPurchaseLineDisassemble`.
   */
  disassemble?: boolean;
  item: PurchaseDraftItem;
  /** Línea bloqueada (COM-12): fila de solo lectura, sin campos en el DOM. */
  locked: boolean;
  tax: PurchaseLineTax;
};

/**
 * Lo que el usuario eligió en el chip «Desarmar al recibir» (COM-14): `item.id` ->
 * `true` (marcada) / `false` (desmarcada a mano). Una línea sin entrada no se ha
 * tocado: nace marcada solo si la receta de su empaque tiene la preferencia
 * «Desarmar siempre al recibir compras». Estado de la web: al payload solo llega
 * como `disassembleOnReceive` de cada línea marcada.
 */
export type PurchaseLineDisassembleState = Record<string, boolean>;

/** Foto de una línea: lo que se compara para saber si se editó. */
export type PurchaseLineSnapshot = {
  item: PurchaseDraftItem;
  /** Alícuota elegida a mano en ese momento (`PurchaseTaxState.choices`); `null` = la por defecto. */
  taxChoice: string | null;
};

/**
 * Historial de edición de las líneas (COM-13). Solo existe en la web: no viaja
 * en el payload de la compra.
 *
 * Regla de "editada": una línea nace SIN entrada en `baselines` (recién nacida)
 * y lo que se le cambie entonces es su primera captura, no una edición. Se
 * ASIENTA (se guarda su foto) la primera vez que el foco sale de su fila, cuando
 * se agrega otro producto a la compra (también el mismo: el +1 ya cuenta como
 * edición) o cuando se bloquea. Desde ahí, "editada" = la línea es distinta de su foto; si se
 * deshace el cambio deja de estarlo.
 */
export type PurchaseLineReviewState = {
  /** `item.id` -> foto de la línea al asentarse. */
  baselines: Record<string, PurchaseLineSnapshot>;
  /**
   * `item.id` -> foto de la línea la última vez que se bloqueó. Solo decide el
   * punto de la fila (`PurchaseWebLine.editedMark`); el resumen sigue comparando
   * contra `baselines`.
   */
  reviewed: Record<string, PurchaseLineSnapshot>;
};

/**
 * Líneas bloqueadas (COM-12). Solo existe en la web: no viaja en el payload.
 * Una línea bloqueada no admite cambios, alícuota ni quitarla: hay que
 * desbloquearla. La moneda de la compra y "Compra exenta" sí le aplican, porque
 * son decisiones de toda la compra.
 */
export type PurchaseLineLockState = {
  /** `item.id` -> `true`. Sin entrada, la línea está desbloqueada. */
  locked: Record<string, true>;
};

/** Petición de foco en el campo de cantidad de una línea; `token` cambia en cada petición. */
export type PurchaseLineFocusRequest = {
  itemId: string;
  token: number;
};

/** Lo que la tabla necesita para bloquear y desbloquear líneas. */
export type PurchaseLineLockControls = {
  /** Preferencia "Bloquear al agregar". */
  lockOnAdd: boolean;
  onLockAll: () => void;
  onLockOnAddChange: (lockOnAdd: boolean) => void;
  onToggleLine: (itemId: string, locked: boolean) => void;
  onUnlockAll: () => void;
};

export type PurchaseLineChangeField =
  | "pack"
  | "packCost"
  | "packCount"
  | "quantity"
  | "tax"
  | "unitCost";

/** Un cambio de una línea editada: "Cantidad 5 → 8". */
export type PurchaseLineChange = {
  field: PurchaseLineChangeField;
  from: string;
  /** "Cantidad", "Costo", "Empaques", "Costo por empaque", "Empaque", "IVA". */
  label: string;
  to: string;
};

/** Una línea editada tal como la lista el resumen antes de confirmar (`getEditedLinesSummary`). */
export type PurchaseEditedLineSummary = {
  changes: PurchaseLineChange[];
  itemId: string;
  name: string;
  productId: string;
  /** Los cambios ya redactados: "Cantidad 5 → 8 · Costo Bs. 1.020,00 → Bs. 1.100,00". */
  text: string;
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
