/**
 * REP3-03a (QA pasada 3 · B6): un escaneo cuya compra está anulada (`cancelado`)
 * no es un duplicado: la factura no quedó registrada. La compra `devuelto` sí
 * cuenta (D26: es una compra real).
 */
import { findDuplicateScan } from "./match/duplicate";

const SUPPLIER = "contact-polar";
const base = { supplierId: SUPPLIER, supplierTaxId: null, number: null, date: "2026-10-18", total: 2412.02 };

describe("findDuplicateScan · compras anuladas (REP3-03a)", () => {
  const input = { number: undefined, date: "2026-10-18", total: 2412.02, contactId: SUPPLIER, taxId: undefined };

  it("sin número: el escaneo confirmado en una compra cancelada no dispara el aviso", () => {
    expect(
      findDuplicateScan({
        ...input,
        previousScans: [{ ...base, scanId: "scan-anulada", purchaseId: "purchase-1", purchaseStatus: "cancelado" }],
      }),
    ).toBeUndefined();
  });

  it("con número: tampoco", () => {
    expect(
      findDuplicateScan({
        ...input,
        number: "0001234",
        previousScans: [
          { ...base, number: "0001234", scanId: "scan-anulada", purchaseId: "purchase-1", purchaseStatus: "cancelado" },
        ],
      }),
    ).toBeUndefined();
  });

  it("la anulada no tapa a otro escaneo vivo de la misma factura", () => {
    expect(
      findDuplicateScan({
        ...input,
        previousScans: [
          { ...base, scanId: "scan-anulada", purchaseId: "purchase-1", purchaseStatus: "cancelado" },
          { ...base, scanId: "scan-abandonado", purchaseId: null },
        ],
      }),
    ).toBe("scan-abandonado");
  });

  it("la compra devuelta sigue contando (D26)", () => {
    expect(
      findDuplicateScan({
        ...input,
        previousScans: [{ ...base, scanId: "scan-devuelta", purchaseId: "purchase-1", purchaseStatus: "devuelto" }],
      }),
    ).toBe("scan-devuelta");
  });
});
