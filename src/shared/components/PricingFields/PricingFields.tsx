"use client";

import { AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { formatMarkupPct, MarginBadge } from "@/shared/components/MarginBadge";
import { NumberInput } from "@/shared/components/NumberInput";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd } from "@/shared/utils/currency";
import {
  DEFAULT_MARKUP_CHIPS,
  type MarginThresholds,
  markupPct,
  priceFromMarkup,
} from "@/shared/utils/pricing";

export type PricingFieldsProps = {
  /** % recomendados. Por defecto 12 / 20 / 30. */
  chips?: readonly number[];
  className?: string;
  /** Costo actual en REF. Ya incluye el IVA: aquí no se aplica ningún impuesto. */
  cost: number;
  /**
   * Cuándo se ve el campo "Ganancia %" (el % libre). `"always"` (por defecto):
   * siempre. `"onDemand"`: lo revela el chip "Otro %", y abre ya revelado si el
   * % del precio inicial no es ninguno de los chips. Una vez a la vista, se queda.
   */
  customPct?: "always" | "onDemand";
  disabled?: boolean;
  /** Error del precio (se muestra tal cual bajo el campo). */
  error?: string;
  /**
   * Oculta la caja de solo lectura "Costo actual" cuando el consumidor ya
   * muestra el costo (p. ej. en su propio campo). El semáforo se mantiene.
   */
  hideCost?: boolean;
  /** % resultante de cada cambio del usuario; `null` si no hay % definible. */
  onMarkupChange?: (pct: number | null) => void;
  /** `null` cuando el usuario vacía el campo de precio. */
  onPriceChange: (price: number | null) => void;
  /** Precio de venta en REF (controlado). */
  price: number | null;
  /** % sugerido (por ejemplo, el de la categoría): primer chip, destacado. */
  suggestedPct?: number | null;
  thresholds?: MarginThresholds;
};

/** % que el usuario eligió o tecleó, válido mientras el costo y el precio sigan siendo los suyos. */
type PctDraft = {
  cost: number;
  pct: number | null;
  price: number | null;
};

const chipClassName =
  "inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";
const chipIdleClassName =
  "border-border bg-surface-container-lowest text-foreground hover:bg-surface-container-low dark:hover:bg-surface-container";
const chipSuggestedClassName =
  "border-transparent bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900";
const chipSelectedClassName = "border-primary bg-primary text-primary-foreground";
const noticeClassName = "flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300";

function roundPct(pct: number) {
  return Math.round(pct * 100) / 100;
}

function isUsablePct(pct: number | null | undefined): pct is number {
  return typeof pct === "number" && Number.isFinite(pct) && pct >= 0;
}

export function PricingFields({
  chips = DEFAULT_MARKUP_CHIPS,
  className,
  cost,
  customPct = "always",
  disabled = false,
  error,
  hideCost = false,
  onMarkupChange,
  onPriceChange,
  price,
  suggestedPct,
  thresholds,
}: PricingFieldsProps) {
  const [draft, setDraft] = useState<PctDraft | null>(null);
  const pctFieldRef = useRef<HTMLInputElement | null>(null);

  const hasCost = Number.isFinite(cost) && cost > 0;
  const actualPct = price === null ? null : markupPct(cost, price);
  // Si el costo o el precio cambiaron por fuera, lo tecleado ya no describe el precio.
  const activeDraft = draft && draft.cost === cost && draft.price === price ? draft : null;
  // Un % negativo solo se muestra en el semáforo: el campo de % no admite signo.
  const derivedPct = actualPct !== null && actualPct >= 0 ? roundPct(actualPct) : null;
  const pctValue = activeDraft ? activeDraft.pct : derivedPct;
  const isBelowCost = actualPct !== null && actualPct < 0;
  const showsNoCostNotice = !hasCost && pctValue !== null;

  const suggested = isUsablePct(suggestedPct) ? suggestedPct : null;
  const chipList = [
    ...(suggested === null ? [] : [{ pct: suggested, suggested: true }]),
    ...chips
      .filter((chip, index) => isUsablePct(chip) && chip !== suggested && chips.indexOf(chip) === index)
      .map((chip) => ({ pct: chip, suggested: false })),
  ];

  // Solo cuenta el estado inicial: teclear el precio no hace aparecer el campo.
  const [pctFieldRevealed, setPctFieldRevealed] = useState(
    () => derivedPct !== null && !chipList.some((chip) => chip.pct === derivedPct),
  );
  const showsPctField = customPct === "always" || pctFieldRevealed;
  const hasBadge = price !== null || !hasCost;

  function revealPctField() {
    flushSync(() => setPctFieldRevealed(true));
    pctFieldRef.current?.focus();
  }

  function applyPct(nextPct: number | null) {
    if (nextPct === null) {
      setDraft({ cost, pct: null, price });
      onMarkupChange?.(null);
      return;
    }

    const nextPrice = priceFromMarkup(cost, nextPct);

    setDraft({ cost, pct: nextPct, price: nextPrice });

    if (nextPrice !== price) {
      onPriceChange(nextPrice);
    }

    onMarkupChange?.(nextPct);
  }

  function handlePctBlur() {
    // Un % vacío no cambió el precio: al salir vuelve a mostrarse el % real.
    if (draft?.pct === null) {
      setDraft(null);
    }
  }

  function handlePriceChange(nextPrice: number | null) {
    setDraft(null);
    onPriceChange(nextPrice);
    onMarkupChange?.(nextPrice === null ? null : markupPct(cost, nextPrice));
  }

  const badge = hasBadge ? (
    <MarginBadge pct={actualPct} size="md" thresholds={thresholds} />
  ) : null;

  const chipsGroup =
    chipList.length > 0 ? (
      <div
        aria-label="Porcentajes de ganancia recomendados"
        // Con "Otro %" al lado, los chips y ese botón comparten una sola fila.
        className={showsPctField ? "flex flex-wrap gap-2" : "contents"}
        role="group"
      >
        {chipList.map((chip) => {
          const isSelected = pctValue === chip.pct;

          return (
            <button
              aria-pressed={isSelected}
              className={cn(
                chipClassName,
                isSelected
                  ? chipSelectedClassName
                  : chip.suggested
                    ? chipSuggestedClassName
                    : chipIdleClassName,
              )}
              disabled={disabled}
              key={chip.pct}
              onClick={() => applyPct(chip.pct)}
              type="button"
            >
              {chip.suggested ? "Sugerido " : null}
              {formatMarkupPct(chip.pct)}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className={cn("space-y-3", className)}>
      {hideCost ? (
        badge ? (
          <div className="flex justify-end">{badge}</div>
        ) : null
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-container-lowest px-3 py-2 dark:bg-slate-900">
          <div>
            <p className="text-xs text-muted-foreground">Costo actual (ya con IVA)</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {hasCost ? formatRefUsd(cost) : "Sin costo"}
            </p>
          </div>
          {badge}
        </div>
      )}

      {showsPctField ? (
        chipsGroup
      ) : (
        <div className="flex flex-wrap gap-2">
          {chipsGroup}
          <button
            aria-expanded={false}
            className={cn(chipClassName, chipIdleClassName)}
            disabled={disabled}
            onClick={revealPctField}
            type="button"
          >
            Otro %
          </button>
        </div>
      )}

      <div className={cn("grid gap-3", showsPctField ? "grid-cols-2" : "grid-cols-1")}>
        {showsPctField ? (
          <NumberInput
            decimals={2}
            disabled={disabled}
            label="Ganancia %"
            onBlur={handlePctBlur}
            onValueChange={applyPct}
            placeholder="0"
            ref={pctFieldRef}
            value={pctValue}
          />
        ) : null}
        <NumberInput
          decimals={2}
          disabled={disabled}
          error={error}
          label="Precio REF"
          onValueChange={handlePriceChange}
          placeholder="0.00"
          value={price}
        />
      </div>

      {showsNoCostNotice ? (
        <p className={noticeClassName} role="status">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Este producto no tiene costo: con un % el precio queda en 0. Escribe el precio
            directamente.
          </span>
        </p>
      ) : null}

      {isBelowCost ? (
        <p className={noticeClassName} role="status">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>El precio está por debajo del costo.</span>
        </p>
      ) : null}
    </div>
  );
}
