/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import type { PaymentListItem } from "../hooks/usePayments";
import { buildPaymentsExportWorkbook } from "./buildPaymentsExportWorkbook";

const samplePayment: PaymentListItem = {
  amount: 7650,
  amountRef: 15,
  amountVes: 7650,
  contact: {
    address: "Caracas",
    email: "cliente@example.com",
    id: "cont-customer",
    isActive: true,
    name: "Cliente Demo",
    phone: "04141234567",
    taxId: "J-12345678-9",
    type: "cliente",
  },
  contactId: "cont-customer",
  createdAt: "2026-05-18T14:35:00.000Z",
  direction: "entrada",
  id: "pay-001",
  method: "punto_venta",
  referenceCode: "778899",
  refRateVes: 510,
  saleId: "sale-001",
};

describe("buildPaymentsExportWorkbook", () => {
  it("creates a single worksheet with list columns and filter context", async () => {
    const buffer = await buildPaymentsExportWorkbook([samplePayment], {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: {
        contactId: "cont-customer",
        direction: "entrada",
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.getWorksheet("Pagos")?.getCell("A1").value).toBe(
      "Listado de pagos | Contacto: cont-customer | Tipo: Entrada",
    );
    expect(workbook.getWorksheet("Pagos")?.getRow(3).values).toEqual([
      ,
      "ID Pago",
      "Contacto",
      "Referencia",
      "Fecha",
      "Método",
      "Moneda",
      "Monto REF",
      "Monto VES",
      "Tipo",
    ]);
    expect(workbook.getWorksheet("Pagos")?.getRow(4).getCell(1).value).toBe("pay-001");
    expect(workbook.getWorksheet("Pagos")?.getRow(4).getCell(2).value).toBe(
      "Cliente Demo (J-12345678-9)",
    );
    expect(workbook.getWorksheet("Pagos")?.getRow(4).getCell(9).value).toBe("Entrada");
  });
});
