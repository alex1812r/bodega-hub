import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { formatMarkupPct, MarginBadge } from "@/shared/components/MarginBadge";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd } from "@/shared/utils/currency";
import type { MarginThresholds } from "@/shared/utils/pricing";

/**
 * Lo mínimo de un producto en "Por revisar" (PRO-11) para contar qué cambió.
 * `ProductPriceReview` y `ProductPriceReviewItem` lo cumplen tal cual.
 */
export type PriceReviewChange = {
  currentCostRef: number;
  currentMarginPct: number;
  previousCostRef: number;
  previousMarginPct: number;
};

/**
 * La frase completa, para `title`, lectores de pantalla y avisos:
 * "La ganancia bajó de 25 % a 11 % al subir el costo de ref 8.00 a ref 9.00".
 */
export function describePriceReviewChange(change: PriceReviewChange) {
  return `La ganancia bajó de ${formatMarkupPct(change.previousMarginPct)} a ${formatMarkupPct(
    change.currentMarginPct,
  )} al subir el costo de ${formatRefUsd(change.previousCostRef)} a ${formatRefUsd(
    change.currentCostRef,
  )}`;
}

type PriceReviewChangeSummaryProps = {
  change: PriceReviewChange;
  className?: string;
  /**
   * Pinta el % anterior y el actual con el semáforo (`MarginBadge`) en vez de
   * en texto. Ocupa más ancho: no usarlo dentro de una celda de tabla.
   */
  showBands?: boolean;
  /** Cortes del semáforo de la tienda para `showBands`; sin ellos, los por defecto. */
  thresholds?: MarginThresholds;
};

function Step({ after, before, label }: { after: ReactNode; before: ReactNode; label: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className="text-on-surface-variant">{label}</span>
      {before}
      <ArrowRight aria-hidden className="size-3 shrink-0 text-outline" />
      {after}
    </span>
  );
}

function BeforeText({ children }: { children: string }) {
  return <span className="tabular-nums text-on-surface-variant">{children}</span>;
}

function AfterText({ children }: { children: string }) {
  return <span className="font-medium tabular-nums text-foreground">{children}</span>;
}

/**
 * Fila compacta "Costo ref 8.00 → ref 9.00 · Ganancia 25 % → 11 %" de un
 * producto cuya ganancia bajó de banda. Solo presenta: no pide datos ni decide
 * colores (el semáforo es de `MarginBadge`). Las flechas son decorativas; el
 * lector de pantalla recibe la frase de `describePriceReviewChange`.
 *
 * @example
 * <PriceReviewChangeSummary change={product.priceReview} />
 * <PriceReviewChangeSummary change={item} showBands thresholds={thresholds} />
 */
export function PriceReviewChangeSummary({
  change,
  className,
  showBands = false,
  thresholds,
}: PriceReviewChangeSummaryProps) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
      <span className="sr-only">{describePriceReviewChange(change)}</span>
      <span aria-hidden className="contents">
        <Step
          after={<AfterText>{formatRefUsd(change.currentCostRef)}</AfterText>}
          before={<BeforeText>{formatRefUsd(change.previousCostRef)}</BeforeText>}
          label="Costo"
        />
        {showBands ? (
          <Step
            after={<MarginBadge pct={change.currentMarginPct} thresholds={thresholds} />}
            before={<MarginBadge pct={change.previousMarginPct} thresholds={thresholds} />}
            label="Ganancia"
          />
        ) : (
          <Step
            after={<AfterText>{formatMarkupPct(change.currentMarginPct)}</AfterText>}
            before={<BeforeText>{formatMarkupPct(change.previousMarginPct)}</BeforeText>}
            label="Ganancia"
          />
        )}
      </span>
    </p>
  );
}
