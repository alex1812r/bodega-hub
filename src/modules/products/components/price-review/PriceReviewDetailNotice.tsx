import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/components/Button";
import { MarginBadge } from "@/shared/components/MarginBadge";
import { formatDate } from "@/shared/utils/date";
import type { MarginBand, MarginThresholds } from "@/shared/utils/pricing";
import { DEFAULT_MARGIN_THRESHOLDS } from "@/shared/utils/pricing";

import type { ProductPriceReview } from "../../services/priceReview";
import { PriceReviewChangeSummary } from "./PriceReviewChangeSummary";

type PriceReviewDetailNoticeProps = {
  /** Sin `products.manage` el aviso se ve, pero sin acciones. */
  canManage: boolean;
  onKeepPrice: () => void;
  /** Lleva a la tarjeta de cambio de precio: aquí no se cambia nada. */
  onReprice: () => void;
  review: ProductPriceReview;
  thresholds?: MarginThresholds;
};

/**
 * % mínimo que devuelve el precio a la banda que tenía (`high` → corte verde,
 * `mid` → corte amarillo). `null` si la banda anterior era la más baja: no hay
 * a dónde volver.
 */
export function getPriceReviewTargetPct(
  previousBand: MarginBand,
  thresholds: MarginThresholds = DEFAULT_MARGIN_THRESHOLDS,
) {
  if (previousBand === "high") {
    return thresholds.high;
  }

  return previousBand === "mid" ? thresholds.low : null;
}

/**
 * Aviso del detalle de un producto en "Por revisar" (PRO-11): banda anterior →
 * actual, costo anterior → actual y la compra que lo causó. Es una alerta, no
 * un bloqueo (regla 10b): ofrece ir a cambiar el precio o mantenerlo.
 */
export function PriceReviewDetailNotice({
  canManage,
  onKeepPrice,
  onReprice,
  review,
  thresholds,
}: PriceReviewDetailNoticeProps) {
  const { purchase } = review;

  return (
    <section
      aria-label="Precio por revisar"
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle
            aria-hidden
            className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
          Por revisar: la ganancia bajó al subir el costo
        </h2>
        <p className="flex flex-wrap items-center gap-2">
          <MarginBadge pct={review.previousMarginPct} thresholds={thresholds} />
          <ArrowRight aria-hidden className="size-4 shrink-0 text-outline" />
          <span className="sr-only">ahora</span>
          <MarginBadge pct={review.currentMarginPct} thresholds={thresholds} />
        </p>
        <PriceReviewChangeSummary change={review} />
        {purchase ? (
          <p className="text-sm text-on-surface-variant [overflow-wrap:anywhere]">
            Por la compra{" "}
            <Link
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={`/purchases/${purchase.id}`}
            >
              {purchase.number}
            </Link>
            {purchase.supplierName ? ` de ${purchase.supplierName}` : ""}, recibida el{" "}
            {formatDate(purchase.receivedAt)}.
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button onClick={onReprice} size="sm" type="button">
            Reprecio
          </Button>
          <Button onClick={onKeepPrice} size="sm" type="button" variant="outline">
            Mantener precio
          </Button>
        </div>
      ) : null}
    </section>
  );
}
