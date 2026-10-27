/**
 * REP15-02 · claves de comparación del duplicado.
 * - B-p16-1 (auditoría p16): la fecha se compara sin NINGÚN espacio Unicode ni tabulador (NBSP
 *   U+00A0, U+2003, U+3000, U+FEFF, \t, \n…), en los extremos o en medio. El número ya lo hacía
 *   (los blancos caen en `trim` o en `[^A-Z0-9]`): se fija para que no regrese.
 * - B-p16Q-2 (QA p16): un RIF de relleno (todo ceros tras normalizar, «J-00000000-0») no identifica
 *   a ningún proveedor.
 */
import { invoiceDateKey, normalizeInvoiceNumber, normalizeTaxId, sameTaxId } from "./text";

describe("invoiceDateKey · REP15-02 (B-p16-1)", () => {
  it.each([
    ["NBSP al final", "05/06/2025\u00a0"],
    ["tabulador al final", "05/06/2025\t"],
    ["salto de línea", "\n05/06/2025\r\n"],
    ["EM SPACE U+2003", "\u200305/06/2025"],
    ["espacio ideográfico U+3000", "05/06/2025\u3000"],
    ["BOM U+FEFF", "\ufeff05/06/2025"],
    ["espacios en medio", "05 /\u00a006/\t2025"],
  ])("%s: es 2025-06-05", (_label, value) => {
    expect(invoiceDateKey(value)).toBe("2025-06-05");
  });

  it("ISO con blancos Unicode queda ISO limpia; solo blancos es sin fecha", () => {
    expect(invoiceDateKey("\u00a02025-06-05\u3000")).toBe("2025-06-05");
    expect(invoiceDateKey("\u00a0\t\u3000")).toBe("");
  });
});

describe("normalizeInvoiceNumber · REP15-02 (B-p16-1)", () => {
  it("ya era insensible a la clase de blanco: cualquier espacio Unicode o tab cae en trim o en [^A-Z0-9]", () => {
    expect(normalizeInvoiceNumber("FACTURA\u00a0N°\u300000003570")).toBe("3570");
    expect(normalizeInvoiceNumber("\ufeff0001\u3000234\n")).toBe("1234");
    expect(normalizeInvoiceNumber("N°\t00001234\u2003")).toBe("1234");
  });
});

describe("normalizeTaxId / sameTaxId · REP15-02 (B-p16Q-2)", () => {
  it.each(["J-00000000-0", "V-0", "000000000", "J 0000.0000-0"])("RIF de relleno %s: sin RIF", (taxId) => {
    expect(normalizeTaxId(taxId)).toBe("");
    expect(sameTaxId(taxId, "J-00000000-0")).toBe(false);
  });

  it("un RIF real con ceros sigue valiendo", () => {
    expect(normalizeTaxId("J-00012345-0")).toBe("000123450");
    expect(sameTaxId("J-00012345-0", "J000123450")).toBe(true);
  });
});
