import "@testing-library/jest-dom";
import { act, fireEvent, render, within } from "@testing-library/react";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import { REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";
import { FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import { COMPACTION_GUARD_MS } from "./useLayoutHold";

/**
 * REP19-05 (M-q1904-1, D77): el montaje no es una llegada. Lo que ya está disponible cuando el panel se monta (la tasa
 * del día, el proveedor y las imágenes en caché) se adopta sin guarda: con la tasa en caché, la adopción en el efecto de
 * layout del montaje tomaba la foto antes del foco inicial (que desplaza la página hasta la primera pendiente) y todo el
 * panel contaba como aparecido 1 s. Una llegada real tras el montaje sigue guardada.
 */

// Proveedor e imágenes ya en caché (React Query) al montar.
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

// Desplazamiento de la página: `scrollIntoView` (el foco inicial a la primera pendiente) sube todo el panel 120 px.
let scrolled = 0;
let rect: jest.SpyInstance;
let windowScroll: jest.SpyInstance;

function fakeRect(this: Element) {
  const top = 200 - scrolled;
  return { bottom: top + 40, height: 40, left: 0, right: 800, top, width: 800, x: 0, y: top, toJSON: () => ({}) };
}

beforeEach(() => {
  jest.useFakeTimers();
  scrolled = 0;
  Element.prototype.scrollIntoView = jest.fn(() => {
    scrolled += 120;
  });
  rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
  windowScroll = jest.spyOn(window, "scrollBy").mockImplementation(() => undefined);
});

afterEach(() => {
  rect.mockRestore();
  windowScroll.mockRestore();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function props(response: InvoiceScanResponse, overrides: Partial<InvoiceReviewPanelProps> = {}) {
  return {
    context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: jest.fn(async () => []),
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
    ...overrides,
  } satisfies InvoiceReviewPanelProps;
}

let touchPoint = 0;

/** Toque real (punto de pantalla y `detail` 1), cada vez en otro punto: solo cuenta la guarda de lo aparecido. */
function touch(element: Element) {
  touchPoint += 1;
  const point = { clientX: 40 + touchPoint * 100, clientY: 60, detail: 1 };
  fireEvent.pointerDown(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseDown(element, point);
  fireEvent.pointerUp(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseUp(element, point);
  fireEvent.click(element, point);
}

function row(index: number) {
  const line = document.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!line) {
    throw new Error(`Sin la fila ${index}`);
  }
  return line;
}

const discard = (index: number) => within(row(index)).getByRole("button", { name: /Descartar línea/ });

describe("REP19-05 · el montaje no es una llegada", () => {
  it("con la tasa, el proveedor y las imágenes en caché al montar, «Descartar línea» tocado a 300 ms descarta", async () => {
    render(<InvoiceReviewPanel {...props(FIXTURES.tasa3.response)} />);
    expect(scrolled).toBeGreaterThan(0);
    await advance(300);

    touch(discard(1));
    expect(row(1)).toHaveAttribute("data-status", "discarded");
  });

  it("remontaje (otro escaneo, `key` nuevo) con la tasa en caché: el toque a 300 ms también actúa", async () => {
    const first = props(FIXTURES.tasa3.response);
    const view = render(<InvoiceReviewPanel key="a" {...first} />);
    await advance(COMPACTION_GUARD_MS);
    view.rerender(<InvoiceReviewPanel key="b" {...first} />);
    await advance(300);

    touch(discard(1));
    expect(row(1)).toHaveAttribute("data-status", "discarded");
  });

  it("control: la tasa que llega tras el montaje sigue guardada («Por unidad» que aparece no se elige a 300 ms)", async () => {
    const base = props(FIXTURES.tasa3.response, { context: { taxRates: REVIEW_TAX_RATES } });
    const view = render(<InvoiceReviewPanel {...base} />);
    await advance(300);
    view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);
    await advance(300);

    const perUnit = within(row(1)).getByRole("button", { name: /Por unidad/ });
    touch(perUnit);
    expect(perUnit).toHaveAttribute("aria-pressed", "false");

    await advance(COMPACTION_GUARD_MS);
    touch(perUnit);
    expect(perUnit).toHaveAttribute("aria-pressed", "true");
  });
});
