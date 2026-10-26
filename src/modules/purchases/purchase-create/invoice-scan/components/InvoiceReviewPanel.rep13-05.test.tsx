/**
 * REP13-05 · B20 (caos p5): «IVA leído como 16 (la alícuota)». Una línea de 104,40 con IVA 16 %, subtotal 90
 * e IVA 16 leídos (106). La hipótesis «incluye IVA» cuadra con tolerancia, no exacta: el aviso dice cuánto
 * da la suma y que se acerca a la cifra leída, en vez de afirmar que la da.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({ data: id ? { id, name: "Distribuidora Caos Global" } : undefined, error: null, isPending: false }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanImages", () => ({
  useInvoiceScanImages: () => ({ error: null, isLoading: false, refetch: jest.fn(), urls: ["https://s/1.jpg"] }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: () => ({ purchaseId: null }),
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

describe("REP13-05 · el motivo del aviso de IVA es veraz cuando el cuadre no es exacto (B20)", () => {
  it("dice cuánto da la suma de las líneas y que se acerca al subtotal más el IVA leídos", () => {
    render(
      <InvoiceReviewPanel
        context={CONTEXT}
        duplicateFetcher={jest.fn(async () => [])}
        onDiscard={jest.fn()}
        onLoad={jest.fn()}
        onRescan={jest.fn()}
        response={makeReviewResponse({
          lines: [{ read: { quantity: 1, unitPrice: 104.4, lineTotal: 104.4 }, match: { taxRateCode: "general" } }],
          extraction: { subtotal: 90, tax: 16, total: undefined },
        })}
      />,
    );

    const notice = screen.getByTestId("invoice-review-tax-notice");
    expect(notice).not.toHaveTextContent(/la suma de las líneas da/);
    expect(notice).toHaveTextContent(
      "Los precios de esta factura parecen incluir IVA: la suma de las líneas (Bs. 104,40) se acerca al subtotal más el IVA leídos (Bs. 106,00), no al subtotal (Bs. 90,00).",
    );
  });
});
