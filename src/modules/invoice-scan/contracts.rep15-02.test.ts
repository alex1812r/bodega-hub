/**
 * REP15-02 · fecha de la factura.
 * - B-p16-1: `getInvoiceDateIssue` ignora todo espacio Unicode y tabulador (como `invoiceDateKey`).
 * - B-p16B-3: el motivo de la fecha usa el formato del campo de la revisión (DD/MM/AAAA), no
 *   «AAAA-MM-DD».
 */
import {
  getInvoiceDateIssue,
  INVOICE_DATE_FORMAT_MESSAGE,
  INVOICE_DATE_MESSAGES,
  INVOICE_IMPOSSIBLE_DATE_MESSAGE,
} from "./contracts";

describe("getInvoiceDateIssue · REP15-02 (B-p16-1)", () => {
  it.each(["05/06/2025\u00a0", "05/06/2025\t", "\u300005-06-2025", "\ufeff2025-06-05\u2003", "05/ 06 /2025"])(
    "%j vale",
    (value) => {
      expect(getInvoiceDateIssue(value)).toBeUndefined();
    },
  );

  it("una fecha imposible con blancos sigue siendo imposible", () => {
    expect(getInvoiceDateIssue("31/02/2026\u00a0")).toBe("calendar");
  });
});

describe("motivos de la fecha · REP15-02 (B-p16B-3)", () => {
  it("se dan en DD/MM/AAAA, el formato del campo", () => {
    for (const message of Object.values(INVOICE_DATE_MESSAGES)) {
      expect(message).not.toContain("AAAA-MM-DD");
    }
    expect(INVOICE_IMPOSSIBLE_DATE_MESSAGE).toContain("DD/MM/AAAA");
    expect(INVOICE_DATE_FORMAT_MESSAGE).toContain("DD/MM/AAAA");
  });
});
