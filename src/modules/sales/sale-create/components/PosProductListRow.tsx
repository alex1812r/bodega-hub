"use client";

import { AlertTriangle } from "lucide-react";

import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { formatRef, formatVes, refToVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import { PosProductImage } from "./PosProductImage";

type PosProductListRowProps = {
  isSelected?: boolean;
  onAdd: (product: ProductWithCategory) => void;
  product: ProductWithCategory;
  rateVes: number;
};

export function PosProductListRow({
  isSelected = false,
  onAdd,
  product,
  rateVes,
}: PosProductListRowProps) {
  const isOutOfStock = product.currentStock === 0;
  const isLowStock =
    product.currentStock > 0 && product.currentStock <= product.minStock;
  const priceVes = rateVes > 0 ? refToVes(product.salePriceRef, rateVes) : 0;

  return (
    <li>
      <button
        aria-pressed={isSelected}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-surface-container-lowest p-2.5 text-left shadow-sm transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isSelected
            ? "pos-product-card--selected border-2"
            : "border border-border active:bg-surface-container-low dark:border-slate-800",
        )}
        disabled={isOutOfStock}
        onClick={() => onAdd(product)}
        type="button"
      >
        <div className="size-12 shrink-0 overflow-hidden rounded bg-surface-container">
          <PosProductImage
            alt={product.name}
            compact
            imageUrl={product.imageUrl ?? undefined}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
          <p className="mt-0.5 text-xs font-bold text-primary">
            {formatRef(product.salePriceRef)}
            {rateVes > 0 ? (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {formatVes(priceVes)}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Stock: {product.currentStock}
            {isLowStock ? (
              <span className="ml-2 inline-flex items-center gap-0.5 font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle aria-hidden className="size-3" />
                Bajo
              </span>
            ) : null}
            {isOutOfStock ? (
              <span className="ml-2 font-medium text-destructive">Sin stock</span>
            ) : null}
          </p>
        </div>
      </button>
    </li>
  );
}
