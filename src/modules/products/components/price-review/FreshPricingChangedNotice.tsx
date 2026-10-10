import { formatRefUsd } from "@/shared/utils/currency";

import type { FreshProductPricing } from "./freshPricing";

type FreshPricingChangedNoticeProps = {
  /** Lo recién leído del servidor. */
  fresh: FreshProductPricing;
  /** Lo que la pantalla mostraba al abrir la confirmación. */
  shown: FreshProductPricing;
  /** Desde cuándo: "mientras editabas", "desde que se cargó este aviso"… */
  since: string;
};

/**
 * Aviso de una confirmación de precio cuando el precio o el costo releídos ya no son
 * los que la pantalla mostraba (CAOS-04). Sin cambios no pinta nada.
 */
export function FreshPricingChangedNotice({ fresh, shown, since }: FreshPricingChangedNoticeProps) {
  const priceChanged = fresh.currentPriceRef !== shown.currentPriceRef;
  const costChanged = fresh.currentCostRef !== shown.currentCostRef;

  if (!priceChanged && !costChanged) {
    return null;
  }

  return (
    <div className="space-y-1 font-medium text-foreground" role="status">
      {priceChanged ? (
        <p>
          El precio cambió {since}: ahora es {formatRefUsd(fresh.currentPriceRef)}.
        </p>
      ) : null}
      {costChanged ? (
        <p>
          El costo cambió {since}: ahora es {formatRefUsd(fresh.currentCostRef)}.
        </p>
      ) : null}
    </div>
  );
}
