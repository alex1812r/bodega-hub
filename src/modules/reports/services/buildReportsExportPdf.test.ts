/**
 * @jest-environment node
 */

import { reportCatalog } from "../reports-list/config/reportCatalog";
import { buildReportsExportPdf } from "./buildReportsExportPdf";
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

describe("buildReportsExportPdf", () => {
  it("generates one page per report section", () => {
    const pdf = buildReportsExportPdf(emptyDataset, {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: {
        dateFilters: { from: "2026-05-01", to: "2026-05-18" },
        purchasesFilters: {},
        stockCardFilters: {},
      },
    });

    const output = pdf.output("arraybuffer");
    const header = String.fromCharCode(...new Uint8Array(output).slice(0, 4));

    expect(header).toBe("%PDF");
    expect(pdf.getNumberOfPages()).toBe(reportCatalog.length);
  });
});
