import { DATE_FORMATS, formatDate } from "@/shared/utils/date";

import { getMovementTypeLabel } from "../inventory-movements/utils/movementTypeLabels";
import {
  getInventoryStockStatus,
  inventoryStockStatusLabels,
} from "../utils/inventoryStockStatus";
import type { InventoryOverviewItem } from "./inventoryOverview";

export type InventoryExportColumn = {
  header: string;
  value: (row: InventoryOverviewItem) => string | number;
};

/**
 * Columnas alineadas con la tabla de inventario en UI. El descuadre
 * (`reconciliationDiff`) no se exporta.
 */
export const inventoryExportColumns: InventoryExportColumn[] = [
  { header: "SKU", value: (row) => row.sku },
  { header: "Producto", value: (row) => row.name },
  {
    header: "Categoría",
    value: (row) => row.category?.name ?? "Sin categoría",
  },
  { header: "Stock actual", value: (row) => row.currentStock },
  { header: "Stock mínimo", value: (row) => row.minStock },
  { header: "Entradas 30 d", value: (row) => row.entries30d },
  { header: "Salidas 30 d", value: (row) => row.exits30d },
  {
    header: "Último movimiento",
    value: (row) =>
      row.lastMovementAt && row.lastMovementType
        ? `${formatDate(row.lastMovementAt, DATE_FORMATS.dateTime)} · ${getMovementTypeLabel(row.lastMovementType)}`
        : "Sin movimientos",
  },
  {
    header: "Estado",
    value: (row) =>
      inventoryStockStatusLabels[getInventoryStockStatus(row)],
  },
];
