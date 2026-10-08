"use client";

import { Lock, LockOpen, Package } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

import type {
  PurchaseDraftItem,
  PurchaseLineCatalogMeta,
  PurchaseLineFocusRequest,
  PurchaseLineLockControls,
  PurchaseTaxCatalog,
  PurchaseWebLine,
} from "../types";
import { purchaseLineGridClassName } from "../utils/purchaseCreateStyles";
import { PurchaseLineRow } from "./PurchaseLineRow";
import { PurchaseToggleSwitch } from "./PurchaseToggleSwitch";

export type PurchaseLineItemMeta = PurchaseLineCatalogMeta;

type PurchaseLineItemsTableProps = {
  /** Línea que pide el foco en su cantidad (la recién agregada). */
  focusRequest?: PurchaseLineFocusRequest | null;
  getItemMeta: (productId: string) => PurchaseLineItemMeta;
  /** Líneas con su alícuota resuelta (`buildPurchaseWebLines`). */
  lines: PurchaseWebLine[];
  lockControls: PurchaseLineLockControls;
  onLineTaxChange: (itemId: string, code: string) => void;
  onRemoveItem: (itemId: string) => void;
  /** El foco salió de la fila de esa línea. */
  onSettleItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
  rateVes: number;
  taxCatalog: PurchaseTaxCatalog;
};

const headerCellClassName = "text-xs font-semibold text-on-surface-variant";
const lockAllButtonClassName = "h-8 gap-1.5 px-2 text-xs";

/**
 * Lista de líneas de la compra: una `PurchaseLineRow` por producto. La cabecera
 * trae la preferencia "Bloquear al agregar" y los botones para bloquear o
 * desbloquear todas las líneas.
 */
export function PurchaseLineItemsTable({
  focusRequest = null,
  getItemMeta,
  lines,
  lockControls,
  onLineTaxChange,
  onRemoveItem,
  onSettleItem,
  onUpdateItem,
  rateVes,
  taxCatalog,
}: PurchaseLineItemsTableProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const focusItemId = focusRequest?.itemId;
  const focusToken = focusRequest?.token;

  // La línea recién agregada (o la que recibió el +1) toma el foco en su cantidad.
  useEffect(() => {
    if (!focusItemId) {
      return;
    }

    const row = Array.from(listRef.current?.children ?? []).find(
      (child) => child.getAttribute("data-line-id") === focusItemId,
    );

    row?.querySelector<HTMLInputElement>("[data-line-focus]")?.focus();
  }, [focusItemId, focusToken]);

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
  const lockedCount = lines.filter((line) => line.locked).length;

  return (
    <div className="@container">
      <div
        aria-label="Bloqueo de líneas"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2"
        role="group"
      >
        <PurchaseToggleSwitch
          checked={lockControls.lockOnAdd}
          label="Bloquear al agregar"
          onChange={lockControls.onLockOnAddChange}
        />
        <div className="flex items-center gap-1">
          <Button
            className={lockAllButtonClassName}
            disabled={lockedCount === lines.length}
            onClick={lockControls.onLockAll}
            variant="ghost"
          >
            <Lock aria-hidden className="size-3.5" />
            Bloquear todas
          </Button>
          <Button
            className={lockAllButtonClassName}
            disabled={lockedCount === 0}
            onClick={lockControls.onUnlockAll}
            variant="ghost"
          >
            <LockOpen aria-hidden className="size-3.5" />
            Desbloquear todas
          </Button>
        </div>
      </div>
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
      <ul aria-label="Líneas de la compra" className="divide-y divide-border/50" ref={listRef}>
        {lines.map(({ editedMark, item, locked, tax }, index) => (
          <PurchaseLineRow
            editedMark={editedMark}
            item={item}
            key={item.id}
            locked={locked}
            meta={getItemMeta(item.productId)}
            onLockChange={(nextLocked) => lockControls.onToggleLine(item.id, nextLocked)}
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
