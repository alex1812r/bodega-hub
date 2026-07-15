import { Tags } from "lucide-react";

import { PosProductImage } from "@/modules/sales/sale-create/components/PosProductImage";
import { ProductsStatusBadge } from "@/modules/products/products-list/components/ProductsStatusBadge";
import { formatRefUsd } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { ProductDetailSectionCard } from "./ProductDetailSectionCard";

const PLACEHOLDER_DESCRIPTION =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Presentación estándar para venta en abarrotes e inventario continuo.";

type ProductDetailInfoCardProps = {
  categoryName: string;
  costRef: number;
  description?: string;
  imageUrl?: string | null;
  isActive: boolean;
  salePriceRef: number;
};

export function ProductDetailInfoCard({
  categoryName,
  costRef,
  description,
  imageUrl,
  isActive,
  salePriceRef,
}: ProductDetailInfoCardProps) {
  const displayDescription = description?.trim() || PLACEHOLDER_DESCRIPTION;

  return (
    <ProductDetailSectionCard
      accent
      headerAction={<ProductsStatusBadge isActive={isActive} />}
      title="Información general"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-xl border border-border bg-surface-container">
            <PosProductImage alt="Imagen del producto" imageUrl={imageUrl ?? undefined} />
          </div>
          <p className="max-w-2xl text-sm text-on-surface-variant">{displayDescription}</p>
        </div>

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
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-outline">
              Margen (REF)
            </span>
            <span className="text-sm text-foreground">
              {formatRefUsd(Math.max(0, salePriceRef - costRef))}
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
        </div>
      </div>
    </ProductDetailSectionCard>
  );
}
