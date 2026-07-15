/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import type { ContactMock } from "@/shared/mocks/erp-data";

import { buildContactsExportWorkbook } from "./buildContactsExportWorkbook";

const sampleContact: ContactMock = {
  address: "Av. Principal",
  email: "cliente@example.com",
  id: "cont-1",
  isActive: true,
  name: "Ferreteria La Central",
  phone: "0412-0000001",
  taxId: "J-00000001-1",
  type: "cliente",
};

describe("buildContactsExportWorkbook", () => {
  it("creates a contacts worksheet with table columns and filter metadata", async () => {
    const buffer = await buildContactsExportWorkbook([sampleContact], {
      exportedAt: "2026-05-20T12:00:00.000Z",
      filters: {
        isActive: true,
        search: "Ferreteria",
        type: "cliente",
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet("Contactos");
    expect(worksheet).toBeDefined();
    expect(worksheet?.getCell("A1").value).toBe("Exportado: 2026-05-20");
    expect(worksheet?.getCell("A2").value).toBe(
      "Búsqueda: Ferreteria · Tipo: Cliente · Estado: Activo",
    );
    expect(worksheet?.getRow(4).values).toEqual([
      ,
      "Nombre / Razón Social",
      "Tipo",
      "RIF / Cédula",
      "Contacto",
      "Estado",
    ]);
    expect(worksheet?.getRow(5).values).toEqual([
      ,
      "Ferreteria La Central",
      "Cliente",
      "J-00000001-1",
      "0412-0000001\ncliente@example.com",
      "Activo",
    ]);
  });
});
