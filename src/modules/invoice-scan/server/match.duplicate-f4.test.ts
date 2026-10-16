/**
 * SCN-11-F4 · Hallazgos del caos 5.4 (duplicados): posible duplicado por
 * proveedor + fecha + total cuando el número falta o difiere en un carácter;
 * prefijos y "sin número" en `normalizeInvoiceNumber`; letra de tipo del RIF.
 */
import { buildContext, buildExtraction, SUPPLIER_CHEVERE, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import { findDuplicateScan } from "./match/duplicate";
import { normalizeInvoiceNumber, sameTaxId } from "./match/text";

const previous = {
  scanId: "scan-f02",
  supplierId: SUPPLIER_POLAR,
  supplierTaxId: "J-00041312-3",
  number: "00003570",
  date: "2026-09-08",
  total: 33150.15,
};

describe("SCN-11-F4 · posible duplicado (número ausente o con un carácter distinto)", () => {
  it.each([
    ["sin número", undefined],
    ["un dígito mal leído", "00003576"],
    ["un dígito omitido", "0000357"],
    ["prefijo N°", "N° 00003570"],
    ["prefijo FACT", "FACT 00003570"],
    ["prefijo FACTURA Nº", "FACTURA Nº 00003570"],
    ["prefijo No.", "No. 00003570"],
  ])("%s + mismo proveedor, fecha y total: duplicateOfScanId", (_label, number) => {
    const result = matchInvoice(
      buildExtraction({ number, date: "2026-09-08", total: 33150.16 }),
      buildContext({ previousScans: [previous] }),
    );

    expect(result.duplicateOfScanId).toBe("scan-f02");
  });

  it("sin número ni fecha (3.1-flash-lite en f03), mismo proveedor y total: duplicateOfScanId", () => {
    const result = matchInvoice(
      buildExtraction({ number: undefined, date: undefined, total: 33150.15 }),
      buildContext({ previousScans: [previous] }),
    );

    expect(result.duplicateOfScanId).toBe("scan-f02");
  });

  it.each([
    ["otra fecha", { date: "2026-09-09", total: 33150.15 }],
    ["total fuera de ±0,01", { date: "2026-09-08", total: 33150.17 }],
    ["sin total", { date: "2026-09-08", total: undefined }],
  ])("%s: no es duplicado", (_label, fields) => {
    const result = matchInvoice(
      buildExtraction({ number: undefined, ...fields }),
      buildContext({ previousScans: [previous] }),
    );

    expect(result.duplicateOfScanId).toBeUndefined();
  });

  it("número con dos caracteres distintos: no es duplicado aunque coincidan fecha y total", () => {
    const result = matchInvoice(
      buildExtraction({ number: "00003596", date: "2026-09-08", total: 33150.15 }),
      buildContext({ previousScans: [previous] }),
    );

    expect(result.duplicateOfScanId).toBeUndefined();
  });

  it("con número leído pero sin fecha: el número aproximado no basta", () => {
    const result = matchInvoice(
      buildExtraction({ number: "00003576", date: undefined, total: 33150.15 }),
      buildContext({ previousScans: [previous] }),
    );

    expect(result.duplicateOfScanId).toBeUndefined();
  });

  it("otro proveedor (f14 vs f11): no es duplicado ni por número ni por fecha/total", () => {
    const result = matchInvoice(
      buildExtraction({ number: "00003570", date: "2026-09-08", total: 33150.15 }),
      buildContext({ previousScans: [{ ...previous, supplierId: SUPPLIER_CHEVERE, supplierTaxId: "J-40123456-7" }] }),
    );

    expect(result.duplicateOfScanId).toBeUndefined();
  });

  it("sin proveedor resuelto ni RIF: no hay posible duplicado", () => {
    expect(
      findDuplicateScan({
        number: undefined,
        date: "2026-09-08",
        total: 33150.15,
        contactId: undefined,
        taxId: undefined,
        previousScans: [{ ...previous, supplierId: null, supplierTaxId: null }],
      }),
    ).toBeUndefined();
  });

  it("el número exacto gana al posible duplicado", () => {
    const result = matchInvoice(
      buildExtraction({ number: "00003570", date: "2026-09-08", total: 33150.15 }),
      buildContext({ previousScans: [{ ...previous, scanId: "scan-fuzzy", number: "3571" }, { ...previous, date: undefined, total: undefined }] }),
    );

    expect(result.duplicateOfScanId).toBe("scan-f02");
  });
});

describe("SCN-11-F4 · normalizeInvoiceNumber", () => {
  it.each([
    ["N° 00003570", "3570"],
    ["Nº00003570", "3570"],
    ["No. 00003570", "3570"],
    ["NRO 00003570", "3570"],
    ["FACT 00003570", "3570"],
    ["FACTURA N° 00003570", "3570"],
    ["Factura: 00-003570", "3570"],
    ["FAC12321", "FAC12321"],
    ["QA-55555", "QA55555"],
    ["NOV-12", "NOV12"],
  ])("%p -> %p", (raw, expected) => {
    expect(normalizeInvoiceNumber(raw)).toBe(expected);
  });

  it.each(["S/N", "s/n", "0", "000", "N° 0", "FACTURA", "--"])("%p es sin número", (raw) => {
    expect(normalizeInvoiceNumber(raw)).toBe("");
  });

  it('"S/N" en dos notas del mismo proveedor no es duplicado', () => {
    const result = matchInvoice(
      buildExtraction({ number: "S/N" }),
      buildContext({ previousScans: [{ scanId: "sn", supplierId: SUPPLIER_POLAR, number: "S/N" }] }),
    );
    expect(result.duplicateOfScanId).toBeUndefined();
  });

  it('"0" vs "000" no es duplicado', () => {
    const result = matchInvoice(
      buildExtraction({ number: "0" }),
      buildContext({ previousScans: [{ scanId: "cero", supplierId: SUPPLIER_POLAR, number: "000" }] }),
    );
    expect(result.duplicateOfScanId).toBeUndefined();
  });
});

describe("SCN-11-F4 · letra de tipo del RIF", () => {
  it.each([
    ["J-508357612", "J508357612", true],
    ["508357612", "J-50835761-2", true],
    ["V-508357612", "508357612", true],
    ["V-508357612", "J-508357612", false],
    ["", "", false],
  ])("sameTaxId(%p, %p) = %p", (a, b, expected) => {
    expect(sameTaxId(a, b)).toBe(expected);
  });

  it("cédula V vs RIF J con los mismos dígitos (sin contacto previo): no es duplicado", () => {
    expect(
      findDuplicateScan({
        number: "00003570",
        contactId: undefined,
        taxId: "V-508357612",
        previousScans: [{ scanId: "rif-j", supplierId: null, supplierTaxId: "J-508357612", number: "00003570" }],
      }),
    ).toBeUndefined();
  });
});
