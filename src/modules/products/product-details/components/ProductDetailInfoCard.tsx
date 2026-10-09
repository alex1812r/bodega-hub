import { Tags } from "lucide-react";

import { ProductsStatusBadge } from "@/modules/products/products-list/components/ProductsStatusBadge";
import { MarginBadge } from "@/shared/components/MarginBadge";
import { formatRefUsd, roundMoney } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";
import type { MarginThresholds } from "@/shared/utils/pricing";

import { ProductDetailSectionCard } from "./ProductDetailSectionCard";

const NO_DESCRIPTION_TEXT = "Sin descripción";

type ProductDetailInfoCardProps = {
  categoryName: string;
  costRef: number;
  /** Descripción del producto; sin ella se muestra "Sin descripción". */
  description?: string | null;
  isActive: boolean;
  salePriceRef: number;
  /** Cortes del semáforo de la tienda; sin ellos, los por defecto. */
  thresholds?: MarginThresholds;
  /** El producto está en "Por revisar" (PRO-11): el semáforo lo dice. */
  underReview?: boolean;
};

export function ProductDetailInfoCard({
  categoryName,
  costRef,
  description,
  isActive,
  salePriceRef,
  thresholds,
  underReview = false,
}: ProductDetailInfoCardProps) {
  const displayDescription = description?.trim() || NO_DESCRIPTION_TEXT;
  const gainRef = roundMoney(salePriceRef - costRef);

  return (
    <ProductDetailSectionCard
      accent
      headerAction={<ProductsStatusBadge isActive={isActive} />}
      title="Información general"
    >
      <div className="flex flex-col gap-4 p-5">
        <p className="min-w-0 max-w-2xl whitespace-pre-line text-sm text-on-surface-variant [overflow-wrap:anywhere]">
          {displayDescription}
        </p>

        <div className="grid grid-cols-2 gap-4 border-t border-border/50 pt-4 md:grid-cols-4 dark:border-slate-800">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-outline">
              Categoría
            </span>
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Tags aria-hidden className="size-4 text-primary" />
              {categoryName}
            </span>
          </div>
          <div
            className={cn(
              "flex flex-col gap-1 rounded-lg border border-border/30 bg-surface-container-low p-2 dark:border-slate-800",
            )}
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-outline">
              Costo (REF)
            </span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {formatRefUsd(costRef)}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-primary/20 bg-primary/5 p-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              Precio venta (REF)
            </span>
            <span className="text-lg font-bold tabular-nums text-primary">
              {formatRefUsd(salePriceRef)}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-1 p-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-outline">
              Ganancia
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <MarginBadge
                // "Por revisar · 11,11 %" no cabe en la columna: parte en dos líneas en vez de salirse.
                className="max-w-full flex-wrap whitespace-normal rounded-2xl"
                cost={costRef}
                price={salePriceRef}
                review={underReview}
                size="md"
                thresholds={thresholds}
              />
              {/* Sin costo no hay ganancia que mostrar: el precio entero no es ganancia. */}
              {costRef > 0 ? (
                <span
                  className={cn(
                    "text-sm tabular-nums",
                    // Pérdida: mismo aviso que el badge rojo, no un importe neutro.
                    gainRef < 0 ? "font-medium text-destructive" : "text-on-surface-variant",
                  )}
                >
                  {formatRefUsd(gainRef)}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </ProductDetailSectionCard>
  );
}
