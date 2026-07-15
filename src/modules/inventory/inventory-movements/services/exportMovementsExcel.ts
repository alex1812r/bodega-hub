import type { InventoryMovement } from "../../hooks/useInventory";
import type { MovementExportRow } from "../utils/movementExportColumns";
import { buildMovementsExportFilename } from "../utils/movementExportFilename";
import { buildMovementsExportWorkbook } from "./buildMovementsExportWorkbook";
import {
  fetchMovementsForExport,
  type MovementsExportFilters,
} from "./fetchMovementsForExport";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function toMovementExportRow(movement: InventoryMovement): MovementExportRow {
  return {
    createdAt: movement.createdAt,
    product: movement.product?.name ?? movement.productId,
    productSku: movement.product?.sku,
    purchaseId: movement.purchaseId,
    quantity: movement.quantityDelta,
    reason: movement.reason,
    saleId: movement.saleId,
    stockAfter: movement.stockAfter,
    type: movement.type,
  };
}

export async function exportMovementsToExcel(filters: MovementsExportFilters) {
  const exportedAt = new Date().toISOString();
  const movements = await fetchMovementsForExport(filters);
  const rows = movements.map(toMovementExportRow);
  const buffer = await buildMovementsExportWorkbook(rows, {
    exportedAt,
    filters,
  });

  const filename = buildMovementsExportFilename({
    from: filters.from,
    to: filters.to,
  });

  triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
}
