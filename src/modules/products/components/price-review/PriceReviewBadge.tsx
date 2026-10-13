import { AlertTriangle } from "lucide-react";

import { Badge } from "@/shared/components/Badge";
import { cn } from "@/shared/utils/cn";

import { describePriceReviewChange, type PriceReviewChange } from "./PriceReviewChangeSummary";

type PriceReviewBadgeProps = {
  className?: string;
  review: PriceReviewChange;
};

/**
 * Aviso "Por revisar" de un producto cuya ganancia bajó de banda al subir el
 * costo (regla 10b: alerta, no bloqueo). El motivo va en el `title` y, para
 * lectores de pantalla, dentro del propio texto.
 */
export function PriceReviewBadge({ className, review }: PriceReviewBadgeProps) {
  const reason = describePriceReviewChange(review);

  return (
    <Badge
      className={cn("gap-1 whitespace-nowrap", className)}
      data-price-review
      title={reason}
      variant="warning"
    >
      <AlertTriangle aria-hidden className="size-3 shrink-0" />
      <span>Por revisar</span>
      <span className="sr-only">: {reason}</span>
    </Badge>
  );
}
