import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import type { PurchaseDraftItem, PurchaseLineCatalogMeta, PurchaseLineTax } from "../types";
import { purchaseLineFieldLabelClassName } from "../utils/purchaseCreateStyles";
import { formatLineTaxLabel } from "../utils/purchaseLineTax";

type PurchaseLockedLineCellsProps = {
  /** La línea está marcada «Desarmar al recibir» (COM-14). */
  disassemble?: boolean;
  /** Línea ya sincronizada (`syncLineCostFields`). */
  item: PurchaseDraftItem;
  meta: PurchaseLineCatalogMeta;
  tax: PurchaseLineTax;
  totalRefText: string;
  totalVesText: string;
};

const stackedLabelClassName = cn(purchaseLineFieldLabelClassName, "block @xl:hidden");
const valueClassName = "truncate text-sm leading-tight tabular-nums text-foreground";
const detailClassName = "truncate text-xs leading-tight tabular-nums text-on-surface-variant";

/**
 * Celdas de una línea bloqueada: producto · cantidad (o empaques × unidades) ·
 * costo · total · alícuota, todo como texto. Nada aquí recibe foco, teclado ni rueda.
 */
export function PurchaseLockedLineCells({
  disassemble = false,
  item,
  meta,
  tax,
  totalRefText,
  totalVesText,
}: PurchaseLockedLineCellsProps) {
  const isPack = item.entryMode === "pack";
  const isVes = item.costCurrency === "ves";
  const packLabel = item.packLabel.trim() || "Empaque";
  const unitCostText = isVes ? formatVesBs(item.unitCostVes) : formatRefUsd(item.unitCostRef);
  const packCostText = isVes ? formatVesBs(item.packCostVes) : formatRefUsd(item.packCostRef);

  return (
    <>
      <div className="col-span-2 min-w-0 @xl:col-span-1">
        <p className="text-sm font-medium break-words text-foreground @xl:truncate" title={meta.name}>
          {meta.name}
        </p>
        {/* El SKU cede el ancho; la alícuota nunca se recorta. */}
        <p className="flex min-w-0 items-baseline gap-1 text-xs text-on-surface-variant">
          <span className="min-w-0 truncate" title={meta.sku}>
            {meta.sku}
          </span>{" "}
          <span className="shrink-0 whitespace-nowrap">· IVA {formatLineTaxLabel(tax)}</span>
        </p>
        {disassemble ? (
          <p className="text-xs text-on-surface-variant">Se desarma al recibir</p>
        ) : null}
      </div>

      <div className="min-w-0 @xl:text-center">
        <span className={stackedLabelClassName}>Cantidad</span>
        <p className={valueClassName}>
          {isPack ? `${item.packCount} × ${item.unitsPerPack} u` : `${item.quantity} u`}
        </p>
        {isPack ? (
          <p className={detailClassName}>
            {packLabel} · {item.quantity} u
          </p>
        ) : null}
      </div>

      <div className="min-w-0 @xl:text-right">
        <span className={stackedLabelClassName}>Costo {isVes ? "BS" : "REF"}</span>
        <p className={valueClassName}>{isPack ? packCostText : unitCostText}</p>
        {isPack ? <p className={detailClassName}>por {packLabel.toLowerCase()}</p> : null}
      </div>

      <div className="min-w-0 text-right">
        <span className={stackedLabelClassName}>Total</span>
        <p className={cn(valueClassName, "font-medium")}>{isVes ? totalVesText : totalRefText}</p>
        <p className={detailClassName}>{isVes ? totalRefText : totalVesText}</p>
      </div>
    </>
  );
}
