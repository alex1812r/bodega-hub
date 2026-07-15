"use client";

import { Minus, Plus, X } from "lucide-react";

import { formatRef, formatVes, refToVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import type { PosCartItem } from "../hooks/usePosCart";
import { PosProductImage } from "./PosProductImage";

type PosCartLineProps = {
  item: PosCartItem;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  rateVes: number;
};

export function PosCartLine({ item, onQuantityChange, onRemove, rateVes }: PosCartLineProps) {
  const lineTotalRef = item.unitPriceRef * item.quantity;
  const unitPriceVes = rateVes > 0 ? refToVes(item.unitPriceRef, rateVes) : 0;
  const lineTotalVes = rateVes > 0 ? refToVes(lineTotalRef, rateVes) : 0;
  const showVes = rateVes > 0;

  return (
    <li className="group relative flex items-center gap-2.5 rounded-xl border border-border bg-surface-container-lowest p-2.5 shadow-sm sm:gap-3 sm:p-3 dark:border-slate-800">
      <div className="size-12 shrink-0 overflow-hidden rounded bg-surface-container">
        <PosProductImage alt={item.productName} compact imageUrl={item.imageUrl} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.productName}</p>
        <p className="mt-0.5 text-xs font-bold text-primary">
          {formatRef(item.unitPriceRef)}{" "}
          <span className="font-normal text-muted-foreground">/u</span>
        </p>
        {showVes ? (
          <p className="text-xs text-muted-foreground">
            {formatVes(unitPriceVes)}{" "}
            <span className="font-normal">/u</span>
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-container p-1",
          "dark:border-slate-800",
        )}
      >
        <button
          aria-label="Reducir cantidad"
          className="flex size-8 cursor-pointer items-center justify-center rounded bg-surface-container-lowest text-foreground shadow-sm transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={item.quantity <= 1}
          onClick={() => onQuantityChange(item.productId, item.quantity - 1)}
          type="button"
        >
          <Minus aria-hidden className="size-4" />
        </button>
        <span className="w-7 text-center text-sm font-bold tabular-nums text-foreground sm:w-8">
          {item.quantity}
        </span>
        <button
          aria-label="Aumentar cantidad"
          className="flex size-8 cursor-pointer items-center justify-center rounded bg-surface-container-lowest text-foreground shadow-sm transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={item.quantity >= item.stock}
          onClick={() => onQuantityChange(item.productId, item.quantity + 1)}
          type="button"
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </div>

      <div className="min-w-[4.5rem] shrink-0 text-right sm:min-w-[5.5rem]">
        <p className="text-sm font-bold text-foreground">{formatRef(lineTotalRef)}</p>
        {showVes ? (
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {formatVes(lineTotalVes)}
          </p>
        ) : null}
      </div>

      <button
        aria-label={`Quitar ${item.productName}`}
        className={cn(
          "pos-cart-remove absolute -top-2 -right-2 flex size-7 cursor-pointer items-center justify-center rounded-full shadow-md transition-opacity",
          "opacity-100 lg:opacity-0 lg:group-hover:opacity-100",
        )}
        onClick={() => onRemove(item.productId)}
        style={{ backgroundColor: "#ba1a1a", color: "#ffffff" }}
        type="button"
      >
        <X aria-hidden className="size-4 shrink-0" stroke="#ffffff" strokeWidth={2.5} />
      </button>
    </li>
  );
}
