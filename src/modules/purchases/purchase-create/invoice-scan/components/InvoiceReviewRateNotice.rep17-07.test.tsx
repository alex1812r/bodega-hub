import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewDraft } from "../reviewDraft";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";
import { COMPACTION_GUARD_MS } from "./useLayoutHold";

/**
 * REP17-07 · B-r17Q-1: escrita la tasa (950) y llegada la del día (900), al elegir otra opción el aviso decía nada (caja
 * ámbar vacía sobre las opciones). Debe decir con qué tasa se convierten los costos, en su zona de texto ya reservada
 * (el texto no es más largo que el de la reserva de esa zona: no la agranda ni mueve las opciones), y «Escribir la
 * tasa» sigue devolviendo la escrita.
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

const LINE = { read: { quantity: 1, unitPrice: 1900, lineTotal: 1900 }, match: { taxRateCode: "exento" } };
const RATE_LABEL = "Tasa Bs por REF";

const noPrinted = () => makeReviewResponse({ lines: [LINE], extraction: { total: 1900 } });
const printed = () => makeReviewResponse({ lines: [LINE], extraction: { printedRate: 895, total: 1900 } });

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

function props(response: InvoiceScanResponse) {
  return {
    context: { taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: jest.fn(async () => []),
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
  } satisfies InvoiceReviewPanelProps;
}

function radio(name: RegExp) {
  return screen.getByRole("radio", { name });
}

/** Escribe 950, llega la del día (900) y, pasada la guarda D49, se elige la opción `choice`. */
async function typedThenChoose(response: InvoiceScanResponse, choice: RegExp) {
  const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
  const base = props(response);
  const view = render(<InvoiceReviewPanel {...base} />);
  if (response.extraction.printedRate !== undefined) {
    await user.click(radio(/Escribir la tasa/));
  }
  await user.type(screen.getByLabelText(RATE_LABEL), "950");
  await user.tab();
  await advance(INVOICE_DUPLICATES_DEBOUNCE_MS + COMPACTION_GUARD_MS);
  view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);
  await advance(COMPACTION_GUARD_MS);
  await user.click(radio(choice));
  expect(radio(choice)).toHaveAttribute("aria-checked", "true");
  return { base, user, view };
}

/** Aviso de tasa de verdad (no las reservas) y el texto de su zona de párrafos. */
function rateNotice(container: HTMLElement) {
  const box = container.querySelector<HTMLElement>("[data-layout-notice] > [role]");
  if (!box) {
    throw new Error("sin aviso de tasa");
  }
  const paragraphs = [...box.querySelectorAll("p")].map((p) => p.textContent ?? "");
  return { box, paragraphs };
}

/** Lo más largo que reserva la zona de párrafos (las reservas pintan su texto con `data-reserve`). */
function longestReservedParagraph(container: HTMLElement) {
  return Math.max(
    ...[...container.querySelectorAll("[data-layout-notice] [data-layout-reserve] p [data-reserve]")].map(
      (span) => (span.getAttribute("data-reserve") ?? "").length,
    ),
  );
}

describe("REP17-07 · B-r17Q-1 · elegida otra tasa tras escribirla, el aviso dice cuál se usa", () => {
  it("«Tasa de hoy»: dice que los costos se convierten con la del día (900), en la zona de texto, y no más largo que su reserva", async () => {
    const { view } = await typedThenChoose(noPrinted(), /Tasa de hoy \(900,00\)/);

    const { box, paragraphs } = rateNotice(view.container);
    expect(box).toHaveTextContent(/tasa del día \(Bs\. 900,00\)/);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toMatch(/tasa del día \(Bs\. 900,00\)/);
    expect(paragraphs[0].length).toBeLessThanOrEqual(longestReservedParagraph(view.container));
  });

  it("y «Escribir la tasa» sigue devolviendo 950 (y se carga con ella)", async () => {
    const { base, user } = await typedThenChoose(noPrinted(), /Tasa de hoy \(900,00\)/);
    await advance(COMPACTION_GUARD_MS);

    await user.click(radio(/Escribir la tasa/));

    expect(screen.getByLabelText(RATE_LABEL)).toHaveValue("950");
    await user.click(screen.getByRole("button", { name: "Cargar en la compra" }));
    expect((base.onLoad as jest.Mock).mock.calls[0][0] as InvoiceReviewDraft).toMatchObject({ rateVes: 950 });
  });

  it("con impresa, «Tasa de la factura»: dice que se usa la de la factura (895), no más largo que su reserva", async () => {
    const { view } = await typedThenChoose(printed(), /Tasa de la factura \(895,00\)/);

    const { paragraphs } = rateNotice(view.container);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toMatch(/tasa de la factura \(Bs\. 895,00\)/);
    expect(paragraphs[0].length).toBeLessThanOrEqual(longestReservedParagraph(view.container));
  });
});
