import { Barcode } from "lucide-react";
import { type ReactNode } from "react";

import { PageBackButton } from "@/shared/components/PageBackButton";

type ProductDetailPageHeaderProps = {
  actions?: ReactNode;
  /** Aviso junto al nombre (p. ej. "Por revisar"). */
  badge?: ReactNode;
  barcode?: string | null;
  productName: string;
  sku: string;
};

export function ProductDetailPageHeader({
  actions,
  badge,
  barcode,
  productName,
  sku,
}: ProductDetailPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-primary">Productos</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 text-2xl font-semibold text-foreground [overflow-wrap:anywhere]">
            {productName}
          </h1>
          {badge}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-on-surface-variant">
          <span className="inline-flex items-center gap-2">
            <Barcode aria-hidden className="size-4 shrink-0" />
            SKU: {sku}
          </span>
          {barcode ? (
            <span className="inline-flex items-center gap-2">
              <Barcode aria-hidden className="size-4 shrink-0" />
              Codigo de barras: {barcode}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
        <PageBackButton chained fallbackHref="/products" />
        {actions}
      </div>
    </div>
  );
}
