import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import type { InvoiceDuplicateMatch } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

/**
 * REP20-04 · B-p21Q-1 (D78(f)): mientras la consulta de duplicados está en vuelo, el aviso no afirma qué casó (antes
 * decía «número igual o casi igual» con el número recién tecleado y el aviso del escaneo, que casó sin número): dice
 * un texto neutro en la misma caja, sin cambiar el alto de su celda.
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

function noticeText(container: HTMLElement): string {
  return container.querySelector("[data-layout-notice] [role='status']")?.textContent ?? "";
}

function reserved(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll("[data-layout-notice] [data-reserve]")).map((node) =>
    node.getAttribute("data-reserve"),
  );
}

describe("REP20-04 · B-p21Q-1: aviso de duplicado con la consulta en vuelo", () => {
  it("con el número recién tecleado y la consulta en vuelo dice un texto neutro, no «número igual»; con la respuesta, lo que casó", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
    let answer: (matches: InvoiceDuplicateMatch[]) => void = () => undefined;
    const duplicateFetcher = jest.fn(
      () =>
        new Promise<InvoiceDuplicateMatch[]>((resolve) => {
          answer = resolve;
        }),
    );
    const { container } = render(
      <InvoiceReviewPanel
        context={CONTEXT}
        duplicateFetcher={duplicateFetcher}
        onDiscard={jest.fn()}
        onLoad={jest.fn()}
        onRescan={jest.fn()}
        response={makeReviewResponse({
          lines: [{ read: { quantity: 1, unitPrice: 1350, lineTotal: 1350 }, match: { taxRateCode: "exento" } }],
          extraction: { number: undefined, date: "2026-10-10", total: 1350 },
          matched: { duplicateOfScanId: "scan-anterior" },
        })}
      />,
    );
    const reservedBefore = reserved(container);

    await user.type(screen.getByRole("textbox", { name: "Número de factura" }), "CG20T-1793586649");
    await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);
    expect(duplicateFetcher).toHaveBeenCalled();

    expect(noticeText(container)).not.toContain("número igual");
    expect(noticeText(container)).toContain("Comprobando si la factura ya se registró…");
    // Misma caja: la celda conserva las reservas de los textos que la respuesta puede traer.
    expect(reserved(container)).toEqual(expect.arrayContaining(reservedBefore));

    await act(async () => {
      answer([{ date: "2026-10-10", number: null, purchaseId: null, scanId: "scan-anterior" }]);
    });
    expect(noticeText(container)).toContain("Esta factura (mismo proveedor, fecha y total) ya se escaneó antes");
    expect(noticeText(container)).not.toContain("Comprobando");
  });
});
