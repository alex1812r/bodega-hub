/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import { reportCatalog } from "../reports-list/config/reportCatalog";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import type { ReportsExportDataset } from "./fetchReportsForExport";

const emptyDataset: ReportsExportDataset = {
  customerPurchases: [],
  dailySales: [],
  grossProfit: [],
  lowStock: [],
  productProfitability: [],
  purchases: [],
  stockCard: [],
  stockCardNote: "Indique productId en filtros globales para exportar el kardex.",
  supplierPurchases: [],
  topCustomers: [],
  topProducts: [],
};

describe("buildReportsExportWorkbook", () => {
  it("creates one worksheet per report category", async () => {
    const buffer = await buildReportsExportWorkbook(emptyDataset, {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: {
        dateFilters: { from: "2026-05-01", to: "2026-05-18" },
        purchasesFilters: {},
        stockCardFilters: {},
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets).toHaveLength(reportCatalog.length);
    expect(workbook.getWorksheet("Ventas diarias")?.getCell("A1").value).toBe(
      "Periodo: 2026-05-01 a 2026-05-18",
    );
    expect(workbook.getWorksheet("Kardex de producto")?.getCell("A2").value).toBe(
      emptyDataset.stockCardNote,
    );
  });
});
