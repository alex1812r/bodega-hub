"use client";

import { useId, useState } from "react";

import { Button } from "@/shared/components/Button";
import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { NumberInput } from "@/shared/components/NumberInput";
import { cn } from "@/shared/utils/cn";

import { REPRICE_MAX_MARKUP_PCT, REPRICE_MAX_PRODUCTS } from "../../services/productSchemas";

type PriceReviewBulkBarProps = {
  /** % de ganancia configurados en la tienda (`usePricingSettings`). */
  chips: readonly number[];
  className?: string;
  /** Tope de productos por reprecio; por defecto el del servidor (100). */
  maxSelection?: number;
  /** Abre la confirmación: aquí nunca se cambia un precio. */
  onReprice: (markupPct: number) => void;
  onTogglePage: (selected: boolean) => void;
  /** Productos de la página visible. */
  pageCount: number;
  selectedCount: number;
};

const chipClassName =
  "inline-flex h-9 cursor-pointer items-center rounded-full border border-border bg-surface-container-lowest px-3 text-sm font-medium tabular-nums text-foreground transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-surface-container";

export const priceReviewCheckboxClassName =
  "size-4 shrink-0 cursor-pointer rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function isUsablePct(pct: number | null): pct is number {
  return pct !== null && Number.isFinite(pct) && pct > 0 && pct <= REPRICE_MAX_MARKUP_PCT;
}

/**
 * Barra de la acción masiva de "Por revisar" (PRO-11): "seleccionar página",
 * contador de seleccionados y "Reprecio al X %" con los % de la tienda o uno
 * libre. Solo propone: el cambio se confirma en `RepriceConfirmModal`.
 */
export function PriceReviewBulkBar({
  chips,
  className,
  maxSelection = REPRICE_MAX_PRODUCTS,
  onReprice,
  onTogglePage,
  pageCount,
  selectedCount,
}: PriceReviewBulkBarProps) {
  const selectPageId = useId();
  const [customPct, setCustomPct] = useState<number | null>(null);
  const isOverLimit = selectedCount > maxSelection;
  const canReprice = selectedCount > 0 && !isOverLimit;
  const isPageSelected = pageCount > 0 && selectedCount >= pageCount;

  return (
    <section
      aria-label="Reprecio de los productos seleccionados"
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label
          className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
          htmlFor={selectPageId}
        >
          <input
            checked={isPageSelected}
            className={priceReviewCheckboxClassName}
            disabled={pageCount === 0}
            id={selectPageId}
            onChange={(event) => onTogglePage(event.target.checked)}
            ref={(input) => {
              if (input) {
                input.indeterminate = selectedCount > 0 && !isPageSelected;
              }
            }}
            type="checkbox"
          />
          Seleccionar página
        </label>
        <p aria-live="polite" className="text-sm tabular-nums text-on-surface-variant">
          {selectedCount === 1 ? "1 seleccionado" : `${selectedCount} seleccionados`}
        </p>
      </div>

      {isOverLimit ? (
        <p className="text-sm text-amber-700 dark:text-amber-300" role="alert">
          Puedes cambiar hasta {maxSelection} productos a la vez. Quita{" "}
          {selectedCount - maxSelection} de la selección.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div
          aria-label="Reprecio con un % de la tienda"
          className="flex flex-wrap gap-2"
          role="group"
        >
          {chips.map((chip) => (
            <button
              className={chipClassName}
              disabled={!canReprice}
              key={chip}
              onClick={() => onReprice(chip)}
              type="button"
            >
              Reprecio al {formatMarkupPct(chip)}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();

            if (canReprice && isUsablePct(customPct)) {
              onReprice(customPct);
            }
          }}
        >
          <div className="w-28">
            <NumberInput
              decimals={2}
              label="Otro %"
              max={REPRICE_MAX_MARKUP_PCT}
              onValueChange={setCustomPct}
              placeholder="0"
              value={customPct}
            />
          </div>
          <Button disabled={!canReprice || !isUsablePct(customPct)} size="sm" type="submit">
            {isUsablePct(customPct) ? `Aplicar ${formatMarkupPct(customPct)}` : "Aplicar"}
          </Button>
        </form>
      </div>

      {selectedCount === 0 ? (
        <p className="text-xs text-on-surface-variant">
          Marca los productos a los que quieres cambiar el precio.
        </p>
      ) : null}
    </section>
  );
}
