/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import { buildMovementsExportWorkbook } from "./buildMovementsExportWorkbook";
import type { MovementExportRow } from "../utils/movementExportColumns";

const sampleRows: MovementExportRow[] = [
  {
    createdAt: "2026-05-17T16:00:00.000Z",
    documentKind: "compra",
    documentNumber: "C-0007",
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
  {
    conversionId: "conv-1",
    createdAt: "2026-05-18T15:00:00.000Z",
    documentKind: "conversion",
    product: "Refresco unidad",
    quantity: 24,
    stockAfter: 24,
    type: "conversion_entrada",
  },
  {
    createdAt: "2026-05-18T16:00:00.000Z",
    documentKind: null,
    documentNumber: null,
    product: "Taladro",
    quantity: -5,
    reason: "Conteo físico",
    stockAfter: -1,
    type: "ajuste_salida",
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
      "Saldo",
      "Documento",
      "Motivo",
      "Referencia",
    ]);
    expect(workbook.getWorksheet("Movimientos")?.getRow(4).getCell(2).value).toBe(
      "Cable HDMI",
    );
    expect(workbook.getWorksheet("Movimientos")?.getRow(5).getCell(5).value).toBe("-1");
  });

  it("fills the document column: number, document type, pack conversion or 'Ajuste manual'", async () => {
    const buffer = await buildMovementsExportWorkbook(sampleRows, {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: { document: "C-00", documentKind: "compra" },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Movimientos");

    expect(sheet?.getCell("A1").value).toBe(
      "Sin filtro de periodo | Tipo de documento: Compra | Documento: C-00",
    );
    expect([4, 5, 6, 7].map((row) => sheet?.getRow(row).getCell(7).value)).toEqual([
      "C-0007",
      "Venta",
      "Conversión de empaque",
      "Ajuste manual",
    ]);
    // El saldo negativo histórico se exporta tal cual.
    expect(sheet?.getRow(7).getCell(6).value).toBe(-1);
  });
});
