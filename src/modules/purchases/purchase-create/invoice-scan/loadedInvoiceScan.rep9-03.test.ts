/**
 * REP9-03 · B9-1 (caos p9): sin tasa del día, la tasa escrita a mano se rotulaba «Tasa de la
 * factura … (sin tasa del día)» aunque la factura no traía tasa. Solo el rótulo.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";

import { describeLoadedInvoiceRate } from "./loadedInvoiceScan";
import { makeLoadedReviewDraft } from "./reviewFixtures";

/** La extracción de la revisión cargada con `printedRate` (o sin tasa impresa). */
const extraction = (printedRate?: number): InvoiceExtraction => ({
  ...makeLoadedReviewDraft().body.invoiceScanExtraction,
  printedRate,
});

describe("REP9-03 · describeLoadedInvoiceRate distingue la tasa de la factura de la escrita a mano", () => {
  it("factura sin tasa y sin tasa del día: «Tasa escrita a mano 900,00 (sin tasa del día)»", () => {
    expect(describeLoadedInvoiceRate({ extraction: extraction(), invoiceRateVes: 900 }, undefined)).toBe(
      "Tasa escrita a mano 900,00 (sin tasa del día)",
    );
  });

  it("factura con otra tasa impresa y tasa del día: la escrita a mano no pasa por la de la factura", () => {
    expect(describeLoadedInvoiceRate({ extraction: extraction(856.3), invoiceRateVes: 870 }, 900)).toBe(
      "Tasa escrita a mano 870,00 (hoy 900,00)",
    );
  });

  it("la tasa impresa elegida sigue siendo «Tasa de la factura»", () => {
    expect(describeLoadedInvoiceRate({ extraction: extraction(856.3), invoiceRateVes: 856.3 }, undefined)).toBe(
      "Tasa de la factura 856,30 (sin tasa del día)",
    );
    expect(describeLoadedInvoiceRate({ extraction: extraction(875.65), invoiceRateVes: 875.65 }, 900)).toBe(
      "Tasa de la factura 875,65 (hoy 900,00)",
    );
  });
});
