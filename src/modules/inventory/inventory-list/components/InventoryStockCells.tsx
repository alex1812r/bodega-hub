import { cn } from "@/shared/utils/cn";

import type { InventoryOverviewItem } from "../../hooks/useInventory";
import { InventoryReconciliationBadge } from "./InventoryReconciliationBadge";

/** Nombre del producto y, para admin, el aviso de descuadre (tabla, tarjeta y producto seleccionado). */
export function InventoryProductName({
  item,
}: {
  item: Pick<InventoryOverviewItem, "name" | "reconciliationDiff">;
}) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <span className="line-clamp-2 min-w-0 text-sm leading-snug text-foreground" title={item.name}>
        {item.name}
      </span>
      <InventoryReconciliationBadge diff={item.reconciliationDiff} />
    </span>
  );
}

/** Stock actual tal cual: en cero o negativo va con el token de error. */
export function InventoryStockValue({ currentStock }: { currentStock: number }) {
  return (
    <span
      className={cn(currentStock === 0 && "text-error", currentStock < 0 && "font-semibold text-error")}
      data-negative={currentStock < 0 ? "true" : undefined}
      title={currentStock < 0 ? "Stock negativo" : undefined}
    >
      {currentStock}
    </span>
  );
}
