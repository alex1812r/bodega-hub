/**
 * REP12-04 · B-p13-1 (auditoría p13): el aviso «La cantidad N no es entera» redondeaba la cantidad
 * a 3 decimales y podía citar un entero (2,9999 → «3»). Se cita sin redondear, en formato es-VE.
 */
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
import { createInvoiceReviewState } from "../reviewModel";
import { lineNeedMessages } from "./invoiceReviewView";

function needsFor(quantity: number, extra: { entryMode?: "unit" | "pack"; unitsPerPack?: number } = {}): string {
  const state = createInvoiceReviewState(
    makeReviewResponse({
      lines: [
        {
          read: { quantity, unitPrice: 10, lineTotal: 10 },
          match: {
            status: "confirmed",
            productId: productUuid(1),
            candidates: [{ productId: productUuid(1), name: "CAOSG Harina", reason: "nombre", score: 0.95 }],
            entryMode: extra.entryMode ?? "unit",
            unitsPerPack: extra.unitsPerPack,
            taxRateCode: "exento",
            issues: [],
          },
        },
      ],
    }),
    { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
  );
  return lineNeedMessages(state, state.lines[0]).join(" ");
}

describe("REP12-04 · B-p13-1: la cantidad no entera se cita sin redondear", () => {
  it.each([
    [2.9999, "2,9999"],
    [1.0001, "1,0001"],
    [0.0001, "0,0001"],
    [1e-9, "0,000000001"],
    [1234.56789, "1.234,56789"],
  ])("%p → «La cantidad %s no es entera»", (quantity, text) => {
    expect(needsFor(quantity)).toContain(`La cantidad ${text} no es entera`);
  });

  it("por empaque sin unidades, también sin redondear", () => {
    expect(needsFor(2.9999, { entryMode: "pack" })).toContain("para cargar 2,9999 ");
  });

  it("el producto por las unidades no arrastra ruido de coma flotante", () => {
    expect(needsFor(0.1, { entryMode: "pack", unitsPerPack: 3 })).toContain("0,1 × 3 = 0,3 unidades");
  });
});
