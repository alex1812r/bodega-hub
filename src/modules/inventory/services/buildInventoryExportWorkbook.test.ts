/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import type { InventoryItem } from "../hooks/useInventory";
import { buildInventoryExportWorkbook } from "./buildInventoryExportWorkbook";

const sampleItem: InventoryItem = {
  category: { id: "cat-1", isActive: true, name: "Cables" },
  categoryId: "cat-1",
  currentCostRef: 10,
  currentStock: 3,
  id: "prod-1",
  isActive: true,
  minStock: 5,
  name: "Cable HDMI",
  salePriceRef: 15,
  sku: "SKU-001",
};

describe("buildInventoryExportWorkbook", () => {
  it("creates a single inventory worksheet with table columns", async () => {
    const buffer = await buildInventoryExportWorkbook([sampleItem], {
      exportedAt: "2026-05-20T12:00:00.000Z",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.getWorksheet("Inventario")?.getCell("A1").value).toBe("Inventario");
    expect(workbook.getWorksheet("Inventario")?.getCell("A3").value).toBe("SKU");
    expect(workbook.getWorksheet("Inventario")?.getCell("F3").value).toBe("Estado");
    expect(workbook.getWorksheet("Inventario")?.getCell("A4").value).toBe("SKU-001");
    expect(workbook.getWorksheet("Inventario")?.getCell("F4").value).toBe("Stock Bajo");
  });
});
