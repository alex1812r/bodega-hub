"use client";

import { Package, Trash2 } from "lucide-react";
import { type ButtonHTMLAttributes, useState } from "react";

import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import type { PurchaseDraftItem, PurchaseLineCatalogMeta } from "../types";
import { getDraftLineTotals, syncLineCostFields } from "../utils/normalizePurchaseLine";
import {
  purchaseLineFieldLabelClassName,
  purchaseLineGridClassName,
  purchaseLineInputClassName,
} from "../utils/purchaseCreateStyles";
import { applyPackPreset, getDefaultPackUnit, toUnitLine } from "../utils/purchaseLinePack";
import { PurchaseLinePackFields } from "./PurchaseLinePackFields";
import { PurchaseLineTaxField } from "./PurchaseLineTaxField";

export type PurchaseLineRowProps = {
  item: PurchaseDraftItem;
  meta: PurchaseLineCatalogMeta;
  onRemove: () => void;
  /** Cambios sobre la línea; la página los fusiona y resincroniza los costos. */
  onUpdate: (input: Partial<PurchaseDraftItem>) => void;
  rateVes: number;
  /** Fondo alterno de las filas pares. */
  striped?: boolean;
};

const stackedLabelClassName = cn(purchaseLineFieldLabelClassName, "mb-0.5 block @xl:hidden");
const readOnlyValueClassName =
  "flex h-10 items-center text-sm tabular-nums text-foreground @xl:h-8";

function LineChip({
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-[0.6875rem] leading-none font-medium whitespace-nowrap transition-colors @xl:min-h-6",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border text-on-surface-variant hover:bg-surface-container-low",
        className,
      )}
      type="button"
      {...props}
    />
  );
}

/**
 * Una línea de la compra. Fila principal: producto, cantidad, costo (en la moneda de la
 * compra) y total. Los chips "IVA" y "Empaque" despliegan la fila secundaria.
 */
export function PurchaseLineRow({
  item,
  meta,
  onRemove,
  onUpdate,
  rateVes,
  striped = false,
}: PurchaseLineRowProps) {
  const [taxOpen, setTaxOpen] = useState(false);
  const normalized = syncLineCostFields(item, rateVes);
  const totals = getDraftLineTotals(normalized, rateVes);
  const isPack = item.entryMode === "pack";
  const isVes = item.costCurrency === "ves";
  const currencyLabel = isVes ? "BS" : "REF";
  const taxRate = item.taxRate ?? meta.taxRate ?? 0;
  const totalRefText = formatRefUsd(totals.totalRef);
  const totalVesText = formatVesBs(totals.totalVes);

  function handlePackToggle() {
    onUpdate(
      isPack
        ? toUnitLine(item, rateVes)
        : applyPackPreset(item, getDefaultPackUnit(meta.packUnits), rateVes),
    );
  }

  return (
    <li
      className={cn(
        purchaseLineGridClassName,
        "py-3 transition-colors hover:bg-surface-container-low/50",
        striped && "bg-surface-bright/50",
      )}
    >
      <div className="col-span-2 min-w-0 @xl:col-span-1">
        <p className="text-sm font-medium break-words text-foreground @xl:truncate" title={meta.name}>
          {meta.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 @xl:mt-0.5 @xl:flex-nowrap">
          <span className="min-w-0 truncate text-xs text-on-surface-variant">{meta.sku}</span>
          <LineChip
            active={taxOpen}
            aria-expanded={taxOpen}
            aria-label={`IVA ${taxRate} % de ${meta.name}`}
            onClick={() => setTaxOpen((current) => !current)}
          >
            IVA {taxRate} %
          </LineChip>
          <LineChip
            active={isPack}
            aria-label={`Empaque de ${meta.name}`}
            aria-pressed={isPack}
            onClick={handlePackToggle}
          >
            <Package aria-hidden className="size-3" />
            Empaque
          </LineChip>
        </div>
      </div>

      <div className="min-w-0">
        <span className={stackedLabelClassName}>Cantidad</span>
        {isPack ? (
          <p className={cn(readOnlyValueClassName, "@xl:justify-center")}>
            {normalized.quantity} u
          </p>
        ) : (
          <input
            aria-label={`Cantidad de ${meta.name}`}
            className={cn(purchaseLineInputClassName, "@xl:text-center")}
            min={1}
            onChange={(event) =>
              onUpdate({ quantity: Math.max(1, Number(event.target.value) || 1) })
            }
            type="number"
            value={item.quantity}
          />
        )}
      </div>

      <div className="min-w-0">
        <span className={stackedLabelClassName}>Costo {currencyLabel}</span>
        {isPack ? (
          <p className={cn(readOnlyValueClassName, "@xl:justify-end")}>
            {isVes ? formatVesBs(normalized.unitCostVes) : formatRefUsd(normalized.unitCostRef)}
          </p>
        ) : (
          <input
            aria-label={`Costo unitario ${currencyLabel} de ${meta.name}`}
            className={cn(purchaseLineInputClassName, "@xl:text-right")}
            min={0}
            onChange={(event) => {
              const value = Math.max(0, Number(event.target.value) || 0);
              onUpdate(isVes ? { unitCostVes: value } : { unitCostRef: value });
            }}
            step="0.01"
            type="number"
            value={isVes ? item.unitCostVes : item.unitCostRef}
          />
        )}
      </div>

      <div className="min-w-0 text-right">
        <span className={stackedLabelClassName}>Total</span>
        <p className="truncate text-sm leading-tight font-medium tabular-nums text-foreground">
          {isVes ? totalVesText : totalRefText}
        </p>
        <p className="truncate text-xs leading-tight tabular-nums text-on-surface-variant">
          {isVes ? totalRefText : totalVesText}
        </p>
      </div>

      <button
        aria-label={`Quitar ${meta.name}`}
        className={cn(
          "col-start-3 row-start-1 flex size-8 cursor-pointer items-center justify-center justify-self-end rounded-full text-outline transition-colors",
          "hover:bg-destructive/10 hover:text-destructive",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "@xl:col-start-auto @xl:row-start-auto",
        )}
        onClick={onRemove}
        type="button"
      >
        <Trash2 aria-hidden className="size-[1.125rem]" />
      </button>

      {isPack || taxOpen ? (
        <div className="col-span-full flex flex-wrap items-start gap-2 pt-1">
          {isPack ? (
            <PurchaseLinePackFields
              className="min-w-0 basis-full @xl:flex-1 @xl:basis-0"
              item={item}
              meta={meta}
              onUpdate={onUpdate}
              rateVes={rateVes}
            />
          ) : null}
          {taxOpen ? (
            <div className="w-32 shrink-0">
              <PurchaseLineTaxField
                onChange={(nextTaxRate) => onUpdate({ taxRate: nextTaxRate })}
                productName={meta.name}
                taxRate={taxRate}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
