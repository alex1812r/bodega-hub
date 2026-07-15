"use client";

import { AlertTriangle } from "lucide-react";

import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { formatRef, formatVes, refToVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { PosProductImage } from "./PosProductImage";

type PosProductCardProps = {
  isSelected?: boolean;
  onAdd: (product: ProductWithCategory) => void;
  product: ProductWithCategory;
  rateVes: number;
};

export function PosProductCard({
  isSelected = false,
  onAdd,
  product,
  rateVes,
}: PosProductCardProps) {
  const isOutOfStock = product.currentStock === 0;
  const isLowStock =
    product.currentStock > 0 && product.currentStock <= product.minStock;
  const priceVes = rateVes ? refToVes(product.salePriceRef, rateVes) : 0;

  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-surface-container-lowest text-left shadow-sm transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        isSelected
          ? "pos-product-card--selected border-2"
          : "border border-border hover:border-primary/40 hover:shadow-md dark:border-slate-800",
      )}
      disabled={isOutOfStock}
      onClick={() => onAdd(product)}
      type="button"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-container">
        <PosProductImage alt={product.name} imageUrl={product.imageUrl ?? undefined} />
        <span className="absolute top-2 right-2 rounded-md bg-surface-container-lowest/90 px-2 py-0.5 text-[11px] font-medium text-on-surface-variant shadow-sm">
          Stock: {product.currentStock}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {product.name}
        </h3>
        <p className="text-sm font-semibold text-foreground">{formatRef(product.salePriceRef)}</p>
        {rateVes > 0 ? (
          <p className="text-xs text-muted-foreground">{formatVes(priceVes)}</p>
        ) : null}
        {isLowStock ? (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle aria-hidden className="size-3.5" />
            Stock bajo
          </p>
        ) : null}
        {isOutOfStock ? (
          <p className="mt-1 text-xs font-medium text-destructive">Sin stock</p>
        ) : null}
      </div>
    </button>
  );
}
