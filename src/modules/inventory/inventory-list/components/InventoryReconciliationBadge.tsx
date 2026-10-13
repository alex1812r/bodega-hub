import { AlertTriangle } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export const INVENTORY_RECONCILIATION_HELP = "El stock no coincide con la suma de movimientos";

/** Diferencia con signo: `+3` sobra stock respecto al libro, `−2` falta. */
export function formatReconciliationDiff(diff: number) {
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`;
}

type InventoryReconciliationBadgeProps = {
  className?: string;
  /** `stock_reconciliation.diff`. Solo llega para admin; `null`, `undefined` o 0 = cuadra, no se pinta nada. */
  diff: number | null | undefined;
};

export function InventoryReconciliationBadge({ className, diff }: InventoryReconciliationBadgeProps) {
  if (diff === null || diff === undefined || diff === 0) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full bg-[var(--error-container)] px-2 py-0.5 text-xs font-semibold text-[var(--on-error-container)]",
        className,
      )}
      data-testid="inventory-reconciliation-badge"
      title={INVENTORY_RECONCILIATION_HELP}
    >
      <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
      Descuadre <span className="tabular-nums">{formatReconciliationDiff(diff)}</span>
      <span className="sr-only">. {INVENTORY_RECONCILIATION_HELP}.</span>
    </span>
  );
}
