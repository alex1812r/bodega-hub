"use client";

import { Package } from "lucide-react";

import { cn } from "@/shared/utils/cn";

import type {
  PurchaseDraftItem,
  PurchaseLineCatalogMeta,
  PurchaseTaxCatalog,
  PurchaseWebLine,
} from "../types";
import { purchaseLineGridClassName } from "../utils/purchaseCreateStyles";
import { PurchaseLineRow } from "./PurchaseLineRow";

export type PurchaseLineItemMeta = PurchaseLineCatalogMeta;

type PurchaseLineItemsTableProps = {
  getItemMeta: (productId: string) => PurchaseLineItemMeta;
  /** Líneas con su alícuota resuelta (`buildPurchaseWebLines`). */
  lines: PurchaseWebLine[];
  onLineTaxChange: (itemId: string, code: string) => void;
  onRemoveItem: (itemId: string) => void;
  /** El foco salió de la fila de esa línea. */
  onSettleItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
  rateVes: number;
  taxCatalog: PurchaseTaxCatalog;
};

const headerCellClassName = "text-xs font-semibold text-on-surface-variant";

/** Lista de líneas de la compra: una `PurchaseLineRow` por producto. */
export function PurchaseLineItemsTable({
  getItemMeta,
  lines,
  onLineTaxChange,
  onRemoveItem,
  onSettleItem,
  onUpdateItem,
  rateVes,
  taxCatalog,
}: PurchaseLineItemsTableProps) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <Package aria-hidden className="size-10 text-muted-foreground/60" />
        <p className="text-sm font-medium text-foreground">Sin productos agregados</p>
        <p className="text-xs text-on-surface-variant">
          Busca o escanea un producto para agregarlo a la compra.
        </p>
      </div>
    );
  }

  // Todas las líneas comparten la moneda de la compra.
  const currencyLabel = lines[0]?.item.costCurrency === "ref" ? "REF" : "BS";

  return (
    <div className="@container">
      <div
        aria-hidden
        className={cn(
          purchaseLineGridClassName,
          "sticky top-0 z-10 hidden border-b border-border bg-surface-container-low py-2 @xl:grid",
        )}
      >
        <span className={headerCellClassName}>Producto</span>
        <span className={cn(headerCellClassName, "text-center")}>Cantidad</span>
        <span className={cn(headerCellClassName, "text-right")}>Costo {currencyLabel}</span>
        <span className={cn(headerCellClassName, "text-right")}>Total</span>
        <span />
      </div>
      <ul aria-label="Líneas de la compra" className="divide-y divide-border/50">
        {lines.map(({ edited, item, tax }, index) => (
          <PurchaseLineRow
            edited={edited}
            item={item}
            key={item.id}
            meta={getItemMeta(item.productId)}
            onRemove={() => onRemoveItem(item.id)}
            onSettle={() => onSettleItem(item.id)}
            onTaxChange={(code) => onLineTaxChange(item.id, code)}
            onUpdate={(input) => onUpdateItem(item.id, input)}
            rateVes={rateVes}
            striped={index % 2 === 1}
            tax={tax}
            taxCatalog={taxCatalog}
          />
        ))}
      </ul>
    </div>
  );
}
