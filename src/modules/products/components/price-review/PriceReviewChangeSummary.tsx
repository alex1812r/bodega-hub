import { ArrowRight } from "lucide-react";

import { formatMarkupPct } from "@/shared/components/MarginBadge";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd } from "@/shared/utils/currency";

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
};

function Step({ after, before, label }: { after: string; before: string; label: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="text-on-surface-variant">{label}</span>
      <span className="tabular-nums text-on-surface-variant">{before}</span>
      <ArrowRight aria-hidden className="size-3 shrink-0 text-outline" />
      <span className="font-medium tabular-nums text-foreground">{after}</span>
    </span>
  );
}

/**
 * Fila compacta "Costo ref 8.00 → ref 9.00 · Ganancia 25 % → 11 %" de un
 * producto cuya ganancia bajó de banda. Solo presenta: no pide datos ni decide
 * colores (el semáforo es de `MarginBadge`). Las flechas son decorativas; el
 * lector de pantalla recibe la frase de `describePriceReviewChange`.
 *
 * @example
 * <PriceReviewChangeSummary change={product.priceReview} />
 */
export function PriceReviewChangeSummary({ change, className }: PriceReviewChangeSummaryProps) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
      <span className="sr-only">{describePriceReviewChange(change)}</span>
      <span aria-hidden className="contents">
        <Step
          after={formatRefUsd(change.currentCostRef)}
          before={formatRefUsd(change.previousCostRef)}
          label="Costo"
        />
        <Step
          after={formatMarkupPct(change.currentMarginPct)}
          before={formatMarkupPct(change.previousMarginPct)}
          label="Ganancia"
        />
      </span>
    </p>
  );
}
