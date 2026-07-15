/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import type { SaleListItem } from "../hooks/useSales";
import { buildSalesExportWorkbook } from "./buildSalesExportWorkbook";

const sampleSale: SaleListItem = {
  createdAt: "2026-05-18T14:30:00.000Z",
  customer: {
    address: "Caracas",
    email: "cliente@example.com",
    id: "cont-customer",
    isActive: true,
    name: "Cliente Demo",
    phone: "04120000000",
    taxId: "J-12345678",
    type: "cliente",
  },
  customerId: "cont-customer",
  discountRef: 0,
  id: "sale-001",
  invoiceNumber: "V-001",
  itemsCount: 2,
  paidVes: 4398.25,
  refRateVes: 36.5,
  status: "pagada",
  subtotalRef: 100,
  taxRef: 16,
  totalRef: 116,
  totalVes: 4398.25,
  userId: "user-admin",
};

describe("buildSalesExportWorkbook", () => {
  it("creates a single Ventas worksheet with headers and data rows", async () => {
    const buffer = await buildSalesExportWorkbook([sampleSale], {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: {
        from: "2026-05-01",
        search: "V-001",
        status: "pagada",
        to: "2026-05-18",
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.getWorksheet("Ventas")?.getCell("A1").value).toBe(
      "Periodo: 2026-05-01 a 2026-05-18",
    );
    expect(workbook.getWorksheet("Ventas")?.getCell("A2").value).toBe("Busqueda: V-001");
    expect(workbook.getWorksheet("Ventas")?.getCell("A3").value).toBe("Estado: pagada");
    expect(workbook.getWorksheet("Ventas")?.getCell("A5").value).toBe("N° Factura");
    expect(workbook.getWorksheet("Ventas")?.getCell("A6").value).toBe("#V-001");
    expect(workbook.getWorksheet("Ventas")?.getCell("C6").value).toBe("Cliente Demo");
    expect(workbook.getWorksheet("Ventas")?.getCell("E6").value).toBe(116);
  });
});
