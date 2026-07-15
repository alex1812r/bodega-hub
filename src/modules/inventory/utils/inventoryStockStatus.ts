import type { ProductMock } from "@/shared/mocks/erp-data";

export type InventoryStockStatus = "low" | "ok" | "out";

export const inventoryStockStatusLabels: Record<InventoryStockStatus, string> = {
  low: "Stock Bajo",
  ok: "En Stock",
  out: "Sin Stock",
};

/** Texto en dos líneas para chips de la tabla (Stitch Inventario). */
export const inventoryStockStatusLines: Record<
  InventoryStockStatus,
  readonly [string, string]
> = {
  low: ["Stock", "Bajo"],
  ok: ["En", "Stock"],
  out: ["Sin", "Stock"],
};

const stockStatusSet = new Set<InventoryStockStatus>(["ok", "low", "out"]);

export function getInventoryStockStatus(
  item: Pick<ProductMock, "currentStock" | "minStock">,
): InventoryStockStatus {
  if (item.currentStock === 0) {
    return "out";
  }

  if (item.currentStock <= item.minStock) {
    return "low";
  }

  return "ok";
}

export function parseStockStatusFilter(
  value?: string,
): InventoryStockStatus[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const statuses = value
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is InventoryStockStatus =>
      stockStatusSet.has(part as InventoryStockStatus),
    );

  return statuses.length ? statuses : undefined;
}

export function serializeStockStatusFilter(
  statuses: InventoryStockStatus[],
): string | undefined {
  if (statuses.length === 0 || statuses.length === stockStatusSet.size) {
    return undefined;
  }

  return statuses.join(",");
}

export function matchesStockStatusFilter(
  item: Pick<ProductMock, "currentStock" | "minStock">,
  statuses?: InventoryStockStatus[],
) {
  if (!statuses?.length) {
    return true;
  }

  return statuses.includes(getInventoryStockStatus(item));
}
