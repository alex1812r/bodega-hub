import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import type { InvoiceDuplicateMatch, InvoiceDuplicateQuery } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

/**
 * REP19-03 · B-p20B-1 (D77(f)): el aviso de duplicado dice qué casó. Con número en la cabecera, si el escaneo previo no
 * tenía ningún número (`match.number` nulo: el efectivo cae al leído, así que nulo es «ni leído ni confirmado»), casó por
 * fecha y total (REP14-01), no por número. La reserva del aviso (REP17-01) cubre el texto de los dos criterios.
 */

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({ data: id ? { id, name: "Farmatodo" } : undefined, error: null, isPending: false }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanImages", () => ({
  useInvoiceScanImages: () => ({ error: null, isLoading: false, refetch: jest.fn(), urls: ["https://s/1.jpg"] }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: () => ({ purchaseId: null }),
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

const NUMBER_TEXT = "Esta factura (mismo proveedor y número igual o casi igual) ya se escaneó antes en la tienda.";
const DATE_TOTAL_TEXT = "Esta factura (mismo proveedor, fecha y total) ya se escaneó antes en la tienda.";

function noNumberResponse() {
  return makeReviewResponse({
    lines: [{ read: { quantity: 1, unitPrice: 1350, lineTotal: 1350 }, match: { taxRateCode: "exento" } }],
    extraction: { number: undefined, date: "2026-10-10", total: 1350 },
  });
}

const MATCH_WITHOUT_NUMBER: InvoiceDuplicateMatch = {
  date: "2026-10-10",
  number: null,
  purchaseId: null,
  scanId: "c54f23d3-7e73-4701-be32-540ea9fb4151",
};

const MATCH_WITH_NUMBER: InvoiceDuplicateMatch = { ...MATCH_WITHOUT_NUMBER, number: "CG20T-1793586648" };

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function typeNumberWith(matches: InvoiceDuplicateMatch[]) {
  const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
  const duplicateFetcher = jest.fn(async (query: InvoiceDuplicateQuery) => (query.number ? matches : []));
  const props: InvoiceReviewPanelProps = {
    context: CONTEXT,
    duplicateFetcher,
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response: noNumberResponse(),
  };
  const view = render(<InvoiceReviewPanel {...props} />);
  await user.type(screen.getByRole("textbox", { name: "Número de factura" }), "CG20T-1793586649");
  await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);
  return view;
}

/** Texto del aviso visible (no las cajas reservadas, cuyo texto lo pinta CSS). */
function noticeText(container: HTMLElement): string {
  return container.querySelector("[data-layout-notice] [role='status']")?.textContent ?? "";
}

describe("REP19-03 · B-p20B-1: el aviso de duplicado dice qué casó", () => {
  it("número tecleado y previo SIN número (misma fecha y total): dice «mismo proveedor, fecha y total»", async () => {
    const { container } = await typeNumberWith([MATCH_WITHOUT_NUMBER]);

    expect(noticeText(container)).toContain(DATE_TOTAL_TEXT);
    expect(noticeText(container)).not.toContain("número igual o casi igual");
  });

  it("número tecleado y previo con número a un carácter: sigue diciendo «número igual o casi igual»", async () => {
    const { container } = await typeNumberWith([MATCH_WITH_NUMBER]);

    expect(noticeText(container)).toContain(NUMBER_TEXT);
    expect(noticeText(container)).not.toContain("fecha y total");
  });

  it("REP17-01: con número en la cabecera la reserva del aviso lleva el texto de los dos criterios", async () => {
    const { container } = await typeNumberWith([MATCH_WITHOUT_NUMBER]);

    const reserved = Array.from(container.querySelectorAll("[data-layout-notice] [data-reserve]")).map((node) =>
      node.getAttribute("data-reserve"),
    );
    expect(reserved).toEqual(expect.arrayContaining([expect.stringContaining(NUMBER_TEXT), expect.stringContaining(DATE_TOTAL_TEXT)]));
  });
});
