/**
 * REP-04 · bajos de QA global (B1, B2) y caos B2 en la revisión:
 * - la fecha no se corta a 1280 px: desde lg (columna de datos estrecha) número
 *   y fecha se apilan; lado a lado solo entre sm y lg;
 * - el `rawText` envuelve en vez de truncarse (en táctil no hay `title`);
 * - con candidatos empatados ningún chip sale premarcado y llevan el SKU.
 * jsdom no mide: se comprueban las clases que deciden el layout.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({
    data: id ? { id, name: "Chevere Depot C.A." } : undefined,
    error: null,
    isPending: false,
  }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanImages", () => ({
  useInvoiceScanImages: () => ({ error: null, isLoading: false, refetch: jest.fn(), urls: ["https://s/1.jpg"] }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: () => ({ purchaseId: null }),
}));

jest.mock("../../components/PurchaseNewProductModal", () => ({
  PurchaseNewProductModal: () => null,
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const LONG_RAW = "002 PAMPERO KETCHUP DOYPACK 397GR X 24 UNIDADES PRECIO MAYOR";

function renderPanel(response: InvoiceScanResponse) {
  render(
    <InvoiceReviewPanel context={CONTEXT} onDiscard={jest.fn()} onLoad={jest.fn()} onRescan={jest.fn()} response={response} />,
  );
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

describe("revisión · layout y candidatos (REP-04)", () => {
  it("número y fecha se apilan desde lg (1280 px) para que la fecha no se corte; lado a lado solo en sm..lg", () => {
    renderPanel(makeReviewResponse({ lines: [{}] }));

    const date = screen.getByLabelText("Fecha");
    const fields = date.closest("div.grid");
    expect(fields).not.toBeNull();
    expect(fields).toContainElement(screen.getByLabelText("Número de factura"));
    expect(fields).toHaveClass("grid-cols-1", "sm:grid-cols-2", "lg:grid-cols-1");
  });

  it("el texto leído de la línea envuelve (no trunca) y conserva el title", () => {
    renderPanel(
      makeReviewResponse({
        lines: [{ match: { candidates: undefined, productId: undefined, status: "unmatched" }, read: { rawText: LONG_RAW } }],
      }),
    );

    const raw = within(row(0)).getByText(LONG_RAW);
    expect(raw).not.toHaveClass("truncate");
    expect(raw).toHaveClass("break-words");
    expect(raw).toHaveAttribute("title", LONG_RAW);
  });

  it("dos candidatos empatados: ningún chip premarcado y cada uno muestra su SKU", () => {
    renderPanel(
      makeReviewResponse({
        lines: [
          {
            match: {
              candidates: [
                { name: "CAOSG Jabon Azul 250g", productId: productUuid(1), reason: "nombre parecido 0,73", score: 0.73, sku: "JAB-01" },
                { name: "CAOSG Jabon Azul 250g", productId: productUuid(2), reason: "nombre parecido 0,73", score: 0.73, sku: "JAB-02" },
              ],
              productId: undefined,
              status: "doubtful",
            },
          },
        ],
      }),
    );

    const chips = within(within(row(0)).getByRole("group", { name: "Candidatos" })).getAllByRole("button");
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(chips[0]).toHaveTextContent("SKU JAB-01");
    expect(chips[1]).toHaveTextContent("SKU JAB-02");
  });
});
