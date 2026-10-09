import type { InventoryMovement } from "../../hooks/useInventory";
import type { MovementExportRow } from "../utils/movementExportColumns";
import { buildMovementsExportFilename } from "../utils/movementExportFilename";
import { buildMovementsExportWorkbook } from "./buildMovementsExportWorkbook";
import {
  describeMovementsExportLimit,
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
    conversionId: movement.conversionId,
    createdAt: movement.createdAt,
    documentKind: movement.documentKind,
    documentNumber: movement.documentNumber,
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

/**
 * Descarga el Excel de los movimientos filtrados. Devuelve el aviso para el
 * usuario si la lista superó el tope de filas (`null` si salió entera).
 */
export async function exportMovementsToExcel(
  filters: MovementsExportFilters,
): Promise<string | null> {
  const exportedAt = new Date().toISOString();
  const movements = await fetchMovementsForExport(filters);
  const rows = movements.rows.map(toMovementExportRow);
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

  return describeMovementsExportLimit(movements);
}
