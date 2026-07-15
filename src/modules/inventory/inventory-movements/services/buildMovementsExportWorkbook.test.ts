/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import { buildMovementsExportWorkbook } from "./buildMovementsExportWorkbook";
import type { MovementExportRow } from "../utils/movementExportColumns";

const sampleRows: MovementExportRow[] = [
  {
    createdAt: "2026-05-17T16:00:00.000Z",
    product: "Cable HDMI",
    productSku: "CBL-001",
    purchaseId: "purchase-001",
    quantity: 10,
    reason: "Recepcion de compra",
    stockAfter: 15,
    type: "compra",
  },
  {
    createdAt: "2026-05-18T14:30:00.000Z",
    product: "Taladro",
    productSku: "TLD-002",
    quantity: -1,
    saleId: "sale-001",
    stockAfter: 4,
    type: "venta",
  },
];

describe("buildMovementsExportWorkbook", () => {
  it("creates a single worksheet with table columns and period label", async () => {
    const buffer = await buildMovementsExportWorkbook(sampleRows, {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: { from: "2026-05-01", to: "2026-05-18" },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.getWorksheet("Movimientos")?.getCell("A1").value).toBe(
      "Periodo: 2026-05-01 a 2026-05-18",
    );
    expect(workbook.getWorksheet("Movimientos")?.getRow(3).values).toEqual([
      ,
      "Fecha",
      "Producto",
      "SKU",
      "Tipo",
      "Cant.",
      "Stock final",
      "Motivo",
      "Referencia",
    ]);
    expect(workbook.getWorksheet("Movimientos")?.getRow(4).getCell(2).value).toBe(
      "Cable HDMI",
    );
    expect(workbook.getWorksheet("Movimientos")?.getRow(5).getCell(5).value).toBe("-1");
  });
});
