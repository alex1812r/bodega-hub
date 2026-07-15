import type { ProductMock } from "@/shared/mocks/erp-data";

import { getInventoryStockStatus } from "@/modules/inventory/utils/inventoryStockStatus";

export function getStockLevelLabel(
  stock: Pick<ProductMock, "currentStock" | "minStock">,
) {
  const status = getInventoryStockStatus(stock);

  switch (status) {
    case "out":
      return "Sin stock";
    case "low":
      return "Stock bajo";
    case "ok":
      return "Óptimo";
  }
}

export function getStockLevelBarPercent(
  stock: Pick<ProductMock, "currentStock" | "minStock">,
) {
  if (stock.currentStock <= 0) {
    return 0;
  }

  const target = Math.max(stock.minStock * 2, stock.minStock + 1, 1);
  return Math.min(100, Math.round((stock.currentStock / target) * 100));
}

export function getStockLevelBarClassName(
  stock: Pick<ProductMock, "currentStock" | "minStock">,
) {
  const status = getInventoryStockStatus(stock);

  switch (status) {
    case "out":
      return "bg-destructive";
    case "low":
      return "bg-[var(--tertiary-fixed-dim)]";
    case "ok":
      return "bg-[var(--secondary-container)]";
  }
}
