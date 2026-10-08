"use client";

import { Lock, LockOpen, Package, PackageOpen, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, FocusEvent, KeyboardEvent } from "react";

import { TaxRateChips } from "@/shared/components/TaxRateChips";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import type {
  PurchaseDraftItem,
  PurchaseLineCatalogMeta,
  PurchaseLineTax,
  PurchaseTaxCatalog,
} from "../types";
import { getDraftLineTotals, syncLineCostFields } from "../utils/normalizePurchaseLine";
import {
  purchaseLineFieldLabelClassName,
  purchaseLineGridClassName,
  purchaseLineInputClassName,
  purchaseLineMetaRowClassName,
  purchaseLineProductCellClassName,
} from "../utils/purchaseCreateStyles";
import { applyPackPreset, getDefaultPackUnit, toUnitLine } from "../utils/purchaseLinePack";
import type { PurchaseLineScan } from "../utils/purchaseLineScan";
import { PURCHASE_LINE_TAX_REQUIRED_MESSAGE } from "../utils/purchaseLineTax";
import { PurchaseLineNumberCell } from "./PurchaseLineNumberCell";
import { PurchaseLinePackFields } from "./PurchaseLinePackFields";
import { PurchaseLockedLineCells } from "./PurchaseLockedLineCells";

export type PurchaseLineRowProps = {
  /**
   * «Desarmar al recibir» (COM-14): `undefined` = el producto no tiene receta de
   * apertura y la fila no muestra el chip; `true` / `false` = marcado o no.
   */
  disassemble?: boolean;
  /** Punto "Línea editada" (`PurchaseWebLine.editedMark`); una línea bloqueada no lo muestra. */
  editedMark?: boolean;
  item: PurchaseDraftItem;
  /** Fila compacta de solo lectura: sin campos, selectores ni chips en el DOM. */
  locked?: boolean;
  meta: PurchaseLineCatalogMeta;
  /** Chip «Desarmar al recibir»; solo se usa si `disassemble` no es `undefined`. */
  onDisassembleChange?: (disassemble: boolean) => void;
  /** Candado de la fila, o doble clic sobre la fila bloqueada. */
  onLockChange: (locked: boolean) => void;
  onRemove: () => void;
  /** Un lector escribió su código en Cantidad o Empaques: se resuelve como en el buscador. */
  onScanCode?: (scan: PurchaseLineScan) => void;
  /** El foco salió de la fila: la línea deja de ser recién nacida. */
  onSettle: () => void;
  /**
   * Solo en la última fila: Tab desde su candado, estando bloqueada, no sigue hacia el
   * resto de la página; quien la pinta se lleva el foco (al buscador de productos).
   */
  onTabPastLock?: () => void;
  /** Alícuota elegida en los chips (`code` del catálogo). */
  onTaxChange: (code: string) => void;
  /** Cambios sobre la línea; la página los fusiona y resincroniza los costos. */
  onUpdate: (input: Partial<PurchaseDraftItem>) => void;
  rateVes: number;
  /** Fondo alterno de las filas pares. */
  striped?: boolean;
  /** Alícuota efectiva de la línea; `item.taxRate` ya trae su porcentaje. */
  tax: PurchaseLineTax;
  taxCatalog: PurchaseTaxCatalog;
};

const stackedLabelClassName = cn(purchaseLineFieldLabelClassName, "mb-0.5 block @xl:hidden");
const readOnlyValueClassName =
  "flex h-10 items-center text-sm tabular-nums text-foreground @xl:h-8";
const rowActionClassName = cn(
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-outline transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

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
 * compra) y total. El chip de IVA abre las alícuotas del catálogo (no se teclea un
 * porcentaje) y el chip "Empaque" despliega la fila secundaria. Si el producto es un
 * empaque con receta de apertura, el chip "Desarmar al recibir" (COM-14) marca la línea
 * para que la recepción abra sus empaques en los componentes de la receta.
 *
 * Bloqueada (COM-12) es una fila compacta de solo lectura: lo mismo como texto y, como
 * único elemento enfocable, el candado. Se desbloquea con el candado (que conserva el
 * foco) o con doble clic (el foco pasa a la Cantidad, o a los Empaques si la línea es por
 * empaque), y no se puede quitar sin desbloquearla.
 */
export function PurchaseLineRow({
  disassemble,
  editedMark = false,
  item,
  locked = false,
  meta,
  onDisassembleChange,
  onLockChange,
  onRemove,
  onScanCode,
  onSettle,
  onTabPastLock,
  onTaxChange,
  onUpdate,
  rateVes,
  striped = false,
  tax,
  taxCatalog,
}: PurchaseLineRowProps) {
  const normalized = syncLineCostFields(item, rateVes);
  const totals = getDraftLineTotals(normalized, rateVes);
  const isPack = item.entryMode === "pack";
  const isVes = item.costCurrency === "ves";
  const currencyLabel = isVes ? "BS" : "REF";
  const needsTaxRate = tax.code === null && !taxCatalog.isLoading && !taxCatalog.error;
  const totalRefText = formatRefUsd(totals.totalRef);
  const totalVesText = formatVesBs(totals.totalVes);
  const rowRef = useRef<HTMLLIElement>(null);
  const focusAfterUnlockRef = useRef(false);

  // El doble clic no deja el foco en nada de la fila: al abrirse, lo toma su cantidad.
  useEffect(() => {
    if (!focusAfterUnlockRef.current) {
      return;
    }

    focusAfterUnlockRef.current = false;

    if (!locked) {
      rowRef.current?.querySelector<HTMLElement>("[data-line-focus]")?.focus();
    }
  });

  function handlePackToggle() {
    onUpdate(
      isPack
        ? toUnitLine(item, rateVes)
        : applyPackPreset(item, getDefaultPackUnit(meta.packUnits), rateVes),
    );
  }

  function handleBlur(event: FocusEvent<HTMLLIElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onSettle();
    }
  }

  function handleDoubleClick() {
    focusAfterUnlockRef.current = true;
    onLockChange(false);
  }

  function handleLockKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Tab" || event.shiftKey || !locked || !onTabPastLock) {
      return;
    }

    event.preventDefault();
    onTabPastLock();
  }

  // El candado conserva su sitio (y el foco) al bloquear y desbloquear: mismo `key`.
  const actions = (
    <div
      className="col-start-3 row-start-1 flex items-center justify-end gap-1 justify-self-end @xl:col-start-auto @xl:row-start-auto"
      key="actions"
    >
      <button
        aria-label={locked ? `Desbloquear ${meta.name}` : `Bloquear ${meta.name}`}
        aria-pressed={locked}
        className={cn(
          rowActionClassName,
          locked
            ? "text-primary hover:bg-primary/10"
            : "hover:bg-surface-container hover:text-foreground",
        )}
        onClick={() => onLockChange(!locked)}
        onKeyDown={handleLockKeyDown}
        title={locked ? "Línea bloqueada: clic para desbloquear" : "Bloquear línea"}
        type="button"
      >
        {locked ? (
          <Lock aria-hidden className="size-[1.125rem]" />
        ) : (
          <LockOpen aria-hidden className="size-[1.125rem]" />
        )}
      </button>
      {locked ? null : (
        <button
          aria-label={`Quitar ${meta.name}`}
          className={cn(rowActionClassName, "hover:bg-destructive/10 hover:text-destructive")}
          onClick={onRemove}
          type="button"
        >
          <Trash2 aria-hidden className="size-[1.125rem]" />
        </button>
      )}
    </div>
  );

  if (locked) {
    return (
      <li
        className={cn(purchaseLineGridClassName, "bg-surface-container-low py-1.5")}
        data-line-id={item.id}
        data-locked="true"
        onBlur={handleBlur}
        onDoubleClick={handleDoubleClick}
        ref={rowRef}
      >
        <PurchaseLockedLineCells
          disassemble={disassemble === true}
          item={normalized}
          key="locked"
          meta={meta}
          tax={tax}
          totalRefText={totalRefText}
          totalVesText={totalVesText}
        />
        {actions}
      </li>
    );
  }

  return (
    <li
      className={cn(
        purchaseLineGridClassName,
        "py-3 transition-colors hover:bg-surface-container-low/50 motion-reduce:transition-none",
        striped && "bg-surface-bright/50",
      )}
      data-line-id={item.id}
      onBlur={handleBlur}
      ref={rowRef}
    >
      <div className={purchaseLineProductCellClassName} key="product">
        <div className="flex min-w-0 items-center gap-1.5">
          {editedMark ? (
            <span
              aria-label="Línea editada"
              className="size-2 shrink-0 rounded-full bg-primary"
              role="img"
              title="Línea editada"
            />
          ) : null}
          <p
            className="min-w-0 text-sm font-medium break-words text-foreground @xl:truncate"
            title={meta.name}
          >
            {meta.name}
          </p>
        </div>
        <div className={purchaseLineMetaRowClassName}>
          <span className="min-w-0 truncate text-xs text-on-surface-variant" title={meta.sku}>
            {meta.sku}
          </span>
          <TaxRateChips
            categoryDefaultCode={tax.categoryCode}
            className="shrink-0"
            error={taxCatalog.error}
            isLoading={taxCatalog.isLoading}
            label={`IVA de ${meta.name}`}
            onChange={onTaxChange}
            onRetry={taxCatalog.refetch}
            rates={taxCatalog.rates}
            value={tax.code}
          />
          {needsTaxRate ? (
            <span className="shrink-0 text-xs font-medium text-destructive" role="alert">
              {PURCHASE_LINE_TAX_REQUIRED_MESSAGE}
            </span>
          ) : null}
          <LineChip
            active={isPack}
            aria-label={`Empaque de ${meta.name}`}
            aria-pressed={isPack}
            onClick={handlePackToggle}
          >
            <Package aria-hidden className="size-3" />
            Empaque
          </LineChip>
          {disassemble === undefined ? null : (
            <LineChip
              active={disassemble}
              aria-label={`Desarmar al recibir ${meta.name}`}
              aria-pressed={disassemble}
              onClick={() => onDisassembleChange?.(!disassemble)}
              title="Al recibir la compra, sus empaques se abren en los productos de su receta"
            >
              <PackageOpen aria-hidden className="size-3" />
              Desarmar al recibir
            </LineChip>
          )}
        </div>
      </div>

      <div className="min-w-0" key="quantity">
        <span className={stackedLabelClassName}>Cantidad</span>
        {isPack ? (
          <p className={cn(readOnlyValueClassName, "@xl:justify-center")}>
            {normalized.quantity} u
          </p>
        ) : (
          <PurchaseLineNumberCell
            aria-label={`Cantidad de ${meta.name}`}
            className={cn(purchaseLineInputClassName, "@xl:text-center")}
            focusTarget
            integer
            onChange={(quantity) => onUpdate({ quantity })}
            onScan={onScanCode}
            value={item.quantity}
          />
        )}
      </div>

      <div className="min-w-0" key="cost">
        <span className={stackedLabelClassName}>Costo {currencyLabel}</span>
        {isPack ? (
          <p className={cn(readOnlyValueClassName, "@xl:justify-end")}>
            {isVes ? formatVesBs(normalized.unitCostVes) : formatRefUsd(normalized.unitCostRef)}
          </p>
        ) : (
          <PurchaseLineNumberCell
            aria-label={`Costo unitario ${currencyLabel} de ${meta.name}`}
            className={cn(purchaseLineInputClassName, "@xl:text-right")}
            onChange={(value) => onUpdate(isVes ? { unitCostVes: value } : { unitCostRef: value })}
            onScan={onScanCode}
            value={isVes ? item.unitCostVes : item.unitCostRef}
          />
        )}
      </div>

      <div className="min-w-0 text-right" key="total">
        <span className={stackedLabelClassName}>Total</span>
        <p className="truncate text-sm leading-tight font-medium tabular-nums text-foreground">
          {isVes ? totalVesText : totalRefText}
        </p>
        <p className="truncate text-xs leading-tight tabular-nums text-on-surface-variant">
          {isVes ? totalRefText : totalVesText}
        </p>
      </div>

      {actions}

      {isPack ? (
        <PurchaseLinePackFields
          className="col-span-full min-w-0 pt-1"
          item={item}
          key="pack"
          meta={meta}
          onScanCode={onScanCode}
          onUpdate={onUpdate}
          rateVes={rateVes}
        />
      ) : null}
    </li>
  );
}
