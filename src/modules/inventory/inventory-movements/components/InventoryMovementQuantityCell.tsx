"use client";

import Link from "next/link";

import { cn } from "@/shared/utils/cn";

type InventoryMovementQuantityCellProps = {
  quantity: number;
};

export function InventoryMovementQuantityCell({
  quantity,
}: InventoryMovementQuantityCellProps) {
  const isPositive = quantity > 0;
  const formatted = isPositive ? `+${quantity}` : String(quantity);

  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        isPositive ? "text-secondary" : "text-error",
      )}
    >
      {formatted}
    </span>
  );
}
