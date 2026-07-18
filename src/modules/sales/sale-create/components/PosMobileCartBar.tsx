"use client";

import { ShoppingCart } from "lucide-react";

import { formatRef, formatVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

type PosMobileCartBarProps = {
  className?: string;
  disabled?: boolean;
  itemsCount: number;
  onOpen: () => void;
  rateVes: number;
  totalRef: number;
  totalVes: number;
};

export function PosMobileCartBar({
  className,
  disabled = false,
  itemsCount,
  onOpen,
  rateVes,
  totalRef,
  totalVes,
}: PosMobileCartBarProps) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-border bg-surface-container-lowest p-3 dark:border-slate-800",
        className,
      )}
    >
      <button
        aria-label={
          itemsCount > 0
            ? `Abrir carrito, ${itemsCount} productos, total ${formatRef(totalRef)}`
            : "Abrir carrito"
        }
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface-container-low px-4 py-3 text-left shadow-sm transition-colors",
          "hover:bg-surface-container dark:border-slate-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "opacity-70",
        )}
        disabled={disabled}
        onClick={onOpen}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">Total</p>
          <p className="truncate text-base font-semibold text-foreground">
            {formatRef(totalRef)}
          </p>
          {rateVes > 0 ? (
            <p className="truncate text-xs text-muted-foreground">{formatVes(totalVes)}</p>
          ) : null}
        </div>

        <span className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--secondary)] text-white">
          <ShoppingCart aria-hidden className="size-5" />
          {itemsCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground shadow-sm">
              {itemsCount > 99 ? "99+" : itemsCount}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}
