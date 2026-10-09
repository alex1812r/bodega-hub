/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import type { PurchaseListRow } from "../hooks/usePurchases";
import { buildPurchasesExportWorkbook } from "./buildPurchasesExportWorkbook";

const sampleRow: PurchaseListRow = {
  createdAt: "2026-05-20T14:30:00.000Z",
  discountRef: 0,
  id: "purchase-1",
  itemsCount: 2,
  paidVes: 0,
  purchaseNumber: "C-1001",
  refRateVes: 36.5,
  status: "recibido",
  subtotalRef: 120.5,
  supplier: {
    address: "Caracas",
    email: "proveedor@example.com",
    id: "supplier-1",
    isActive: true,
    name: "Distribuidora ACME",
    phone: "04120000000",
    taxId: "J-12345678",
    type: "proveedor",
  },
  supplierId: "supplier-1",
  taxRef: 0,
  totalRef: 120.5,
  totalVes: 4398.25,
  userId: "user-1",
};

describe("buildPurchasesExportWorkbook", () => {
  it("creates a single Compras worksheet with headers and data rows", async () => {
    const buffer = await buildPurchasesExportWorkbook([sampleRow], {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: {
        from: "2026-05-01",
        search: "ACME",
        status: "recibido",
        to: "2026-05-18",
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.getWorksheet("Compras")?.getCell("A1").value).toBe(
      "Periodo: 2026-05-01 a 2026-05-18",
    );
    expect(workbook.getWorksheet("Compras")?.getCell("A2").value).toBe("Busqueda: ACME");
    expect(workbook.getWorksheet("Compras")?.getCell("A3").value).toBe("Estado: recibido");
    expect(workbook.getWorksheet("Compras")?.getCell("A5").value).toBe("N° Compra");
    expect(workbook.getWorksheet("Compras")?.getCell("A6").value).toBe("#C-1001");
    expect(workbook.getWorksheet("Compras")?.getCell("C6").value).toBe("Distribuidora ACME");
    expect(workbook.getWorksheet("Compras")?.getCell("E6").value).toBe("ref 120.50");
  });

  // COM-08: la exportación lleva lo pagado y el saldo, y dice si solo hay compras con saldo.
  it("adds the paid and balance columns and notes the pending balance filter", async () => {
    const buffer = await buildPurchasesExportWorkbook(
      [
        { ...sampleRow, paidRef: 20.5 },
        { ...sampleRow, id: "purchase-2", paidRef: 10, status: "cancelado" },
      ],
      {
        exportedAt: "2026-05-20T12:00:00.000Z",
        filters: { pendingBalance: "1" },
      },
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Compras");

    expect(sheet?.getCell("A2").value).toBe("Solo compras con saldo pendiente");
    expect(sheet?.getCell("F4").value).toBe("Pagado (REF)");
    expect(sheet?.getCell("G4").value).toBe("Saldo (REF)");
    expect(sheet?.getCell("F5").value).toBe("ref 20.50");
    expect(sheet?.getCell("G5").value).toBe("ref 100.00");
    // Una compra cancelada no se debe: sin saldo.
    expect(sheet?.getCell("F6").value).toBe("ref 10.00");
    expect(sheet?.getCell("G6").value).toBeFalsy();
  });
});
