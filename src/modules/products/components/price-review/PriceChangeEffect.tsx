import { ArrowRight, OctagonAlert } from "lucide-react";

import { MarginBadge } from "@/shared/components/MarginBadge";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs, refToVes } from "@/shared/utils/currency";
import type { MarginThresholds } from "@/shared/utils/pricing";

/** Un cambio de precio: el costo (REF, ya con IVA) y el precio de venta antes y después. */
export type PriceChange = {
  costRef: number;
  fromPriceRef: number;
  toPriceRef: number;
};

export type PriceChangeDirection = "down" | "same" | "up";

export type PriceChangeSummary = {
  belowCost: number;
  down: number;
  same: number;
  up: number;
};

export function getPriceChangeDirection(
  change: Pick<PriceChange, "fromPriceRef" | "toPriceRef">,
): PriceChangeDirection {
  if (change.toPriceRef === change.fromPriceRef) {
    return "same";
  }

  return change.toPriceRef > change.fromPriceRef ? "up" : "down";
}

/** Vender por debajo del costo es vender a pérdida. Sin costo no hay con qué comparar. */
export function isPriceBelowCost(costRef: number, priceRef: number) {
  return costRef > 0 && priceRef < costRef;
}

/** Cuántos precios suben, bajan, no cambian y cuántos quedan por debajo de su costo. */
export function summarizePriceChanges(changes: readonly PriceChange[]): PriceChangeSummary {
  const summary: PriceChangeSummary = { belowCost: 0, down: 0, same: 0, up: 0 };

  for (const change of changes) {
    summary[getPriceChangeDirection(change)] += 1;

    if (isPriceBelowCost(change.costRef, change.toPriceRef)) {
      summary.belowCost += 1;
    }
  }

  return summary;
}

const DIRECTION_LABEL: Record<PriceChangeDirection, string> = {
  down: "Baja",
  same: "Sin cambio",
  up: "Sube",
};

const arrowClassName = "size-3.5 shrink-0 text-outline";

/** Aviso destacado: el texto se muestra tal cual, con icono además del color. */
export function PriceBelowCostWarning({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300",
        className,
      )}
      data-tone="danger"
      role="note"
    >
      <OctagonAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

type PriceChangeEffectProps = {
  change: PriceChange;
  className?: string;
  /** Nombre del producto, cuando el efecto es una fila de una lista. */
  name?: string;
  /** Tasa vigente (Bs por REF). Sin tasa (0, cargando o error) no se pinta la línea en Bs. */
  rateVes?: number | null;
  /** Motivo que quedará en el historial de precios. */
  reason?: string | null;
  /** Cortes del semáforo de la tienda; sin ellos, los por defecto. */
  thresholds?: MarginThresholds;
};

/**
 * Efecto de un cambio de precio (CNF-07), común al detalle del producto, al
 * reprecio desde una compra y al reprecio masivo: precio anterior → nuevo en REF
 * y en Bs a la tasa vigente, % de ganancia anterior → nuevo con semáforo, motivo
 * y aviso si el precio nuevo queda por debajo del costo.
 *
 * No calcula nada propio: el % es el de `MarginBadge` (`markupPct` de
 * `@bodega/core`, sobre el costo ya con IVA) y el Bs es solo presentación (el
 * precio se guarda en REF).
 */
export function PriceChangeEffect({
  change,
  className,
  name,
  rateVes,
  reason,
  thresholds,
}: PriceChangeEffectProps) {
  const { costRef, fromPriceRef, toPriceRef } = change;
  const direction = getPriceChangeDirection(change);
  const hasRate = typeof rateVes === "number" && Number.isFinite(rateVes) && rateVes > 0;
  const trimmedReason = reason?.trim() ?? "";

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5 py-2 text-sm", className)}
      data-direction={direction}
      data-testid="price-change-effect"
    >
      {name ? (
        <p className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">{name}</p>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums">
        <span className="text-on-surface-variant">Precio</span>
        <span className="text-muted-foreground">{formatRefUsd(fromPriceRef)}</span>
        <ArrowRight aria-hidden className={arrowClassName} />
        <span className="sr-only">pasa a</span>
        <span className="font-semibold text-foreground">{formatRefUsd(toPriceRef)}</span>
        <span className="text-on-surface-variant">· {DIRECTION_LABEL[direction]}</span>
      </p>

      {hasRate ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums text-on-surface-variant">
          <span>En Bs a la tasa de hoy</span>
          <span>{formatVesBs(refToVes(fromPriceRef, rateVes))}</span>
          <ArrowRight aria-hidden className={arrowClassName} />
          <span className="sr-only">pasa a</span>
          <span className="font-medium text-foreground">
            {formatVesBs(refToVes(toPriceRef, rateVes))}
          </span>
        </p>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="text-on-surface-variant">Ganancia</span>
        <MarginBadge cost={costRef} price={fromPriceRef} thresholds={thresholds} />
        <ArrowRight aria-hidden className={arrowClassName} />
        <span className="sr-only">pasa a</span>
        <MarginBadge cost={costRef} price={toPriceRef} thresholds={thresholds} />
      </p>

      {trimmedReason ? (
        <p className="text-on-surface-variant [overflow-wrap:anywhere]">
          Motivo: <span className="text-foreground">{trimmedReason}</span>
        </p>
      ) : null}

      {isPriceBelowCost(costRef, toPriceRef) ? (
        <PriceBelowCostWarning>
          El precio nuevo queda por debajo del costo ({formatRefUsd(costRef)}): cada venta sería a
          pérdida.
        </PriceBelowCostWarning>
      ) : null}
    </div>
  );
}
