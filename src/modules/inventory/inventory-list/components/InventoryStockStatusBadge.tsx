import { cn } from "@/shared/utils/cn";

import {
  getInventoryStockStatus,
  inventoryStockStatusLines,
  type InventoryStockStatus,
} from "../../utils/inventoryStockStatus";

/**
 * Chips de estado — Stitch Inventario - BodegaSync.
 * Fondo semántico + texto en dos líneas; evita utilidades `bg-*-container` que no siempre se generan en Tailwind v4.
 */
const statusStyles: Record<
  InventoryStockStatus,
  { border: string; className: string }
> = {
  low: {
    border: "color-mix(in srgb, var(--tertiary-fixed-dim) 50%, transparent)",
    className:
      "bg-[var(--tertiary-fixed)] text-[var(--on-tertiary-fixed)]",
  },
  ok: {
    border: "color-mix(in srgb, var(--secondary-container) 50%, transparent)",
    className:
      "bg-[var(--secondary-container)] text-[var(--on-secondary-container)]",
  },
  out: {
    border: "color-mix(in srgb, var(--destructive) 20%, transparent)",
    className:
      "bg-[var(--error-container)] text-[var(--on-error-container)]",
  },
};

type InventoryStockStatusBadgeProps = {
  className?: string;
  currentStock: number;
  minStock: number;
};

export function InventoryStockStatusBadge({
  className,
  currentStock,
  minStock,
}: InventoryStockStatusBadgeProps) {
  const status = getInventoryStockStatus({ currentStock, minStock });
  const [lineOne, lineTwo] = inventoryStockStatusLines[status];
  const style = statusStyles[status];

  return (
    <span
      className={cn(
        "inline-flex min-w-[4.5rem] flex-col items-center justify-center rounded-xl border px-2 py-1 text-center text-[11px] font-semibold leading-[1.15] tracking-wide",
        style.className,
        className,
      )}
      style={{ borderColor: style.border }}
    >
      <span className="block">{lineOne}</span>
      <span className="block">{lineTwo}</span>
    </span>
  );
}
