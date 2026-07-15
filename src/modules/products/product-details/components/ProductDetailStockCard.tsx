import { Package } from "lucide-react";
import Link from "next/link";

import {
  getStockLevelBarClassName,
  getStockLevelBarPercent,
  getStockLevelLabel,
} from "../utils/productDetailLabels";
import { cn } from "@/shared/utils/cn";

type ProductDetailStockCardProps = {
  currentStock: number;
  minStock: number;
};

export function ProductDetailStockCard({
  currentStock,
  minStock,
}: ProductDetailStockCardProps) {
  const stock = { currentStock, minStock };
  const levelLabel = getStockLevelLabel(stock);
  const barPercent = getStockLevelBarPercent(stock);
  const barClassName = getStockLevelBarClassName(stock);
  const isLow = currentStock > 0 && currentStock <= minStock;
  const isOut = currentStock === 0;

  return (
    <section className="flex h-full flex-col justify-between rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800">
      <div>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <Package aria-hidden className="size-5 text-on-surface-variant" />
          Stock actual
        </h2>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-5xl font-bold tracking-tighter tabular-nums",
              isOut && "text-destructive",
              isLow && "text-[var(--tertiary-fixed-dim)]",
            )}
          >
            {currentStock}
          </span>
          <span className="text-sm text-on-surface-variant">unidades</span>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <div className="flex justify-between text-xs font-medium text-outline">
            <span>Nivel de stock</span>
            <span>{levelLabel}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
            <div
              className={cn("h-full rounded-full transition-all", barClassName)}
              style={{ width: `${barPercent}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between rounded-lg border border-border/50 bg-surface-container-low p-3 dark:border-slate-800">
        <span className="text-sm text-on-surface-variant">Punto de reorden</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {minStock} un
        </span>
      </div>
      <Link
        className="mt-3 text-center text-xs font-medium text-primary hover:underline"
        href="/inventory/movements"
      >
        Ver movimientos de inventario
      </Link>
    </section>
  );
}
