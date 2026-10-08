/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import { buildInventoryExportWorkbook } from "./buildInventoryExportWorkbook";
import type { InventoryOverviewItem } from "./inventoryOverview";

const sampleItem: InventoryOverviewItem = {
  category: { id: "cat-1", isActive: true, name: "Cables", taxRate: 16 },
  categoryId: "cat-1",
  currentCostRef: 10,
  currentStock: 3,
  entries30d: 12,
  exits30d: 9,
  id: "prod-1",
  isActive: true,
  lastMovementAt: "2026-05-18T16:30:00.000Z",
  lastMovementType: "venta",
  minStock: 5,
  name: "Cable HDMI",
  salePriceRef: 15,
  sku: "SKU-001",
  stockStatus: "low",
};

async function readSheet(items: InventoryOverviewItem[]) {
  const buffer = await buildInventoryExportWorkbook(items, {
    exportedAt: "2026-05-20T12:00:00.000Z",
  });
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet("Inventario");
  const rowValues = (rowNumber: number) => {
    const values: ExcelJS.CellValue[] = [];

    sheet?.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => values.push(cell.value));

    return values;
  };

  return { headers: rowValues(3), row: rowValues(4), sheet, workbook };
}

describe("buildInventoryExportWorkbook", () => {
  it("creates a single inventory worksheet with the table columns, including the 30-day figures and the last movement", async () => {
    const { headers, row, sheet, workbook } = await readSheet([sampleItem]);

    expect(workbook.worksheets).toHaveLength(1);
    expect(sheet?.getCell("A1").value).toBe("Inventario");
    expect(headers).toEqual([
      "SKU",
      "Producto",
      "Categoría",
      "Stock actual",
      "Stock mínimo",
      "Entradas 30 d",
      "Salidas 30 d",
      "Último movimiento",
      "Estado",
    ]);
    expect(row.slice(0, 7)).toEqual(["SKU-001", "Cable HDMI", "Cables", 3, 5, 12, 9]);
    expect(String(row[7])).toMatch(/^\d{2}\/05\/2026 \d{2}:\d{2} · Venta$/);
    expect(row[8]).toBe("Stock Bajo");
  });

  it("writes 'Sin movimientos' without a movement and never exports the reconciliation diff", async () => {
    const { headers, row } = await readSheet([
      { ...sampleItem, lastMovementAt: null, lastMovementType: null, reconciliationDiff: 4 },
    ]);

    expect(row[7]).toBe("Sin movimientos");
    expect(row).toHaveLength(9);
    expect(headers.join(" ")).not.toMatch(/descuadre|diff/i);
  });
});
