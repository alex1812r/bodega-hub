import type { InventoryItem } from "../hooks/useInventory";
import {
  getInventoryStockStatus,
  inventoryStockStatusLabels,
} from "../utils/inventoryStockStatus";

export type InventoryExportColumn = {
  header: string;
  value: (row: InventoryItem) => string | number;
};

/** Columnas alineadas con la tabla de inventario en UI. */
export const inventoryExportColumns: InventoryExportColumn[] = [
  { header: "SKU", value: (row) => row.sku },
  { header: "Producto", value: (row) => row.name },
  {
    header: "Categoria",
    value: (row) => row.category?.name ?? "Sin categoria",
  },
  { header: "Stock actual", value: (row) => row.currentStock },
  { header: "Stock minimo", value: (row) => row.minStock },
  {
    header: "Estado",
    value: (row) =>
      inventoryStockStatusLabels[getInventoryStockStatus(row)],
  },
];
