/**
 * SCN-UI-C2 · caos UI M2: el aviso de duplicado apunta al escaneo CONFIRMADO con
 * compra más reciente, no al último escaneo abandonado en `extracted`. Si no hay
 * confirmado, el más reciente no descartado ni fallido (orden de `previousScans`).
 */
import { findDuplicateScan } from "./match/duplicate";

const SUPPLIER = "contact-polar";
const base = { supplierId: SUPPLIER, supplierTaxId: "J-00041312-3", number: "00003570", date: "2026-09-08", total: 100 };
// `previousScans` llega del más reciente al más antiguo.
const abandoned = { ...base, scanId: "scan-abandonado", purchaseId: null };
const confirmedNew = { ...base, scanId: "scan-confirmado-nuevo", purchaseId: "purchase-2" };
const confirmedOld = { ...base, scanId: "scan-confirmado-viejo", purchaseId: "purchase-1" };

describe("findDuplicateScan · prefiere el escaneo confirmado con compra (SCN-UI-C2)", () => {
  it("mismo número: el confirmado más reciente aunque haya un abandonado más nuevo", () => {
    expect(
      findDuplicateScan({
        number: "0000-3570",
        contactId: SUPPLIER,
        taxId: undefined,
        previousScans: [abandoned, confirmedNew, confirmedOld],
      }),
    ).toBe("scan-confirmado-nuevo");
  });

  it("posible duplicado (sin número, misma fecha y total): también prefiere el confirmado", () => {
    expect(
      findDuplicateScan({
        number: undefined,
        date: "2026-09-08",
        total: 100,
        contactId: SUPPLIER,
        taxId: undefined,
        previousScans: [abandoned, confirmedOld],
      }),
    ).toBe("scan-confirmado-viejo");
  });

  it("sin confirmados: el más reciente", () => {
    expect(
      findDuplicateScan({
        number: "00003570",
        contactId: SUPPLIER,
        taxId: undefined,
        previousScans: [abandoned, { ...abandoned, scanId: "scan-abandonado-viejo" }],
      }),
    ).toBe("scan-abandonado");
  });

  it("el confirmado de OTRO proveedor no gana al abandonado del mismo", () => {
    expect(
      findDuplicateScan({
        number: "00003570",
        contactId: SUPPLIER,
        taxId: undefined,
        previousScans: [abandoned, { ...confirmedNew, supplierId: "contact-otro", supplierTaxId: "J-99999999-9" }],
      }),
    ).toBe("scan-abandonado");
  });
});
