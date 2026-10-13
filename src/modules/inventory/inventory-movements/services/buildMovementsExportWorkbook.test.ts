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

  // INV-F5 · M3: un motivo histórico enorme no puede pasar del límite de celda de Excel (32.767).
  it("trims a reason that does not fit in an Excel cell and marks the cut", async () => {
    const buffer = await buildMovementsExportWorkbook(
      [{ ...sampleRows[0], reason: "m".repeat(1_000_000) }, sampleRows[3]],
      { exportedAt: "2026-05-20T12:00:00.000Z", filters: {} },
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Movimientos");
    const longReason = String(sheet?.getRow(4).getCell(8).value);

    expect(longReason).toHaveLength(32_000);
    expect(longReason.endsWith("m…")).toBe(true);
    expect(sheet?.getRow(5).getCell(8).value).toBe("Conteo físico");
  });

  // INV-L4: con filtro de producto la cabecera lleva su nombre, no el uuid.
  it("heads a product-filtered export with the product name taken from its rows", async () => {
    const productId = "d4c8d016-0000-4000-8000-000000000000";
    const filtered = await buildMovementsExportWorkbook([sampleRows[1], sampleRows[3]], {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: { productId },
    });
    const empty = await buildMovementsExportWorkbook([], {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: { productId },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(filtered);
    expect(workbook.getWorksheet("Movimientos")?.getCell("A1").value).toBe(
      "Sin filtro de periodo | Producto: Taladro",
    );

    const emptyWorkbook = new ExcelJS.Workbook();
    await emptyWorkbook.xlsx.load(empty);
    expect(emptyWorkbook.getWorksheet("Movimientos")?.getCell("A1").value).toBe(
      `Sin filtro de periodo | Producto: ${productId}`,
    );
  });
});
