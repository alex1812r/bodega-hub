/**
 * REP11-03 · bajos de la pasada 11 (D48-c, D49):
 * - B-p11-2 (QA): con el buscador abierto, el orden de Tab sigue el orden visual (acciones, luego buscador).
 * - B-p11-1 (caos): elegir una opción del buscador (lista en portal) es una activación con el puntero; el
 *   control que queda bajo ese punto al cerrarse la lista no acepta un clic hasta que el puntero se aleje
 *   o pase la guarda.
 * - B-p11-2 (caos): la guarda de compactación también impide que el pointerdown dé el foco a un campo movido.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
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

// jsdom no trae `PointerEvent`: sin él los eventos de puntero llegan sin `pointerType` ni coordenadas.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const HARINA = productUuid(1);
const GALLETA: ProductEntityOption = {
  barcode: null,
  categoryId: "",
  currentCostRef: 0.5,
  currentStock: 3,
  id: productUuid(2),
  isActive: true,
  label: "CAOSG Galleta Maria",
  salePriceRef: 1,
  sku: "GAL",
};
const ROW_HEIGHT = 200;
const PANEL = { left: 0, right: 390, top: 0, bottom: 2000 };
/** Punto de la opción elegida en la lista; al cerrarse, bajo él queda el chip de la misma fila. */
const OPTION_POINT = { clientX: 150, clientY: 220 };

function harinaByName(quantity: number): ReviewFixtureLine {
  return {
    read: {
      rawText: `CAOSG Harina Maiz 1kg P3 ${quantity} 450,00 ${450 * quantity},00`,
      description: "CAOSG Harina Maiz 1kg",
      unit: "unidad",
      quantity,
      unitPrice: 450,
      lineTotal: 450 * quantity,
    },
    match: {
      status: "doubtful",
      productId: undefined,
      taxRateCode: "exento",
      candidates: [
        { productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00", lastUnitCostRef: 0.5 },
      ],
      lastUnitCostRef: 0.5,
      issues: [],
    },
  };
}

let rect: jest.SpyInstance;

/**
 * Como en REP11-02: lo de la línea 1 está más abajo mientras la línea 0 conserva su caja; la descartada mide 80 px salvo su
 * alto retenido.
 */
function fakeRect(this: Element) {
  if (this.matches('[data-testid="invoice-review-panel"]')) {
    return { ...PANEL, height: PANEL.bottom, width: PANEL.right, x: 0, y: 0, toJSON: () => ({}) };
  }
  const natural = this instanceof HTMLElement && this.dataset.status === "discarded" ? 80 : ROW_HEIGHT;
  const floor = this instanceof HTMLElement ? Number.parseFloat(this.style.minHeight) || 0 : 0;
  const height = this.matches("li[data-line-index]") ? Math.max(natural, floor) : 0;
  const held = document.querySelector<HTMLElement>('li[data-line-index="0"]')?.style.minHeight;
  const top = this.closest('li[data-line-index="1"]') ? (held ? 400 : 250) : 0;
  return { bottom: top + height, height, left: 0, right: 390, top, width: 390, x: 0, y: top, toJSON: () => ({}) };
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.scrollBy = jest.fn();
  rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
});

afterEach(() => {
  rect.mockRestore();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  Reflect.deleteProperty(Element.prototype, "scrollBy");
  jest.useRealTimers();
});

const productFetcher = jest.fn(async () => [GALLETA]);

function renderPanel(response: InvoiceScanResponse) {
  render(
    <InvoiceReviewPanel
      context={CONTEXT}
      onDiscard={jest.fn()}
      onLoad={jest.fn()}
      onRescan={jest.fn()}
      productFetcher={productFetcher}
      response={response}
    />,
  );
  advance(1000);
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

async function flush(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

type PointerKind = "mouse" | "touch";

/** Activación real con su punto: pointerdown, mousedown, pointerup, mouseup y clic (`detail` 1). */
function press(element: Element, kind: PointerKind, point: { clientX: number; clientY: number }) {
  const pointer = { ...point, pointerId: 1, pointerType: kind };
  fireEvent.pointerDown(element, pointer);
  fireEvent.mouseDown(element, { ...point, detail: 1 });
  fireEvent.pointerUp(element, pointer);
  fireEvent.mouseUp(element, { ...point, detail: 1 });
  fireEvent.click(element, { ...point, detail: 1 });
}

const harinaChip = (index: number) => within(row(index)).getByRole("button", { name: /^CAOSG Harina Maiz 1kg/ });
const searchButton = (index: number) => within(row(index)).getByRole("button", { name: /Buscar producto|Cambiar producto/ });
const twoHarinas = () => makeReviewResponse({ lines: [harinaByName(1), harinaByName(2)] });

/** Abre el buscador de la línea 0 con el teclado (sin guarda) y elige la Galleta con el puntero. */
async function pickGalleta(kind: PointerKind) {
  fireEvent.click(searchButton(0), { detail: 0 });
  await flush(1000);
  const option = await screen.findByRole("option", { name: /CAOSG Galleta Maria/ });
  press(option, kind, OPTION_POINT);
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(harinaChip(0)).toHaveAttribute("aria-pressed", "false");
}

describe("REP11-03 · B-p11-1 (caos): el chip que queda bajo la opción elegida", () => {
  it.each(["mouse", "touch"] as const)(
    "con %s, un 2.º clic a 1,2 s en el mismo punto no reemplaza la elección",
    async (kind) => {
      renderPanel(twoHarinas());
      await pickGalleta(kind);

      advance(1200);
      press(harinaChip(0), kind, OPTION_POINT);

      expect(harinaChip(0)).toHaveAttribute("aria-pressed", "false");
    },
  );

  it("con el ratón que se aleja del punto y vuelve, el chip sí acepta", async () => {
    renderPanel(twoHarinas());
    await pickGalleta("mouse");

    advance(1000);
    fireEvent.pointerMove(document.body, { clientX: 150, clientY: 300, pointerId: 1, pointerType: "mouse" });
    advance(200);
    fireEvent.pointerMove(document.body, { ...OPTION_POINT, pointerId: 1, pointerType: "mouse" });
    press(harinaChip(0), "mouse", OPTION_POINT);

    expect(harinaChip(0)).toHaveAttribute("aria-pressed", "true");
  });

  it("pasado el tiempo de la guarda, el chip sí acepta en el mismo punto", async () => {
    renderPanel(twoHarinas());
    await pickGalleta("touch");

    advance(2000);
    press(harinaChip(0), "touch", OPTION_POINT);

    expect(harinaChip(0)).toHaveAttribute("aria-pressed", "true");
  });
});

describe("REP11-03 · B-p11-2 (caos): tras compactar, el pointerdown no da el foco a un campo movido", () => {
  it("el mousedown sobre la Cantidad de la fila de abajo, < 1 s tras compactar («Compactar lista»), se cancela", () => {
    renderPanel(twoHarinas());
    press(within(row(0)).getByRole("button", { name: /Descartar línea/ }), "touch", { clientX: 180, clientY: 360 });
    fireEvent.click(screen.getByRole("button", { name: "Compactar lista" }));

    advance(300);
    const quantity = within(row(1)).getAllByRole("textbox")[0];
    fireEvent.pointerDown(quantity, { clientX: 100, clientY: 600, pointerId: 1, pointerType: "touch" });

    expect(fireEvent.mouseDown(quantity, { clientX: 100, clientY: 600, detail: 1 })).toBe(false);
  });

  it("pasado 1 s, el mousedown sobre ese campo no se cancela", () => {
    renderPanel(twoHarinas());
    press(within(row(0)).getByRole("button", { name: /Descartar línea/ }), "touch", { clientX: 180, clientY: 360 });
    fireEvent.click(screen.getByRole("button", { name: "Compactar lista" }));

    advance(1000);
    const quantity = within(row(1)).getAllByRole("textbox")[0];

    expect(fireEvent.mouseDown(quantity, { clientX: 100, clientY: 600, detail: 1 })).toBe(true);
  });
});

describe("REP11-03 · B-p11-2 (QA, D48-c): con el buscador abierto, Tab sigue el orden visual", () => {
  it("las acciones de la fila (pintadas encima) van antes que el buscador; Mayús+Tab desde él llega a «Descartar línea»", async () => {
    renderPanel(twoHarinas());
    fireEvent.click(searchButton(0), { detail: 0 });
    await flush(1000);
    const search = within(row(0)).getByRole("combobox");
    const discard = within(row(0)).getByRole("button", { name: /Descartar línea/ });

    // Visualmente (flex-col) las acciones van encima del buscador; Tab sigue el orden del documento.
    const precedes = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(precedes(searchButton(0), search)).toBe(true);
    expect(precedes(discard, search)).toBe(true);

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    search.focus();
    await user.tab({ shift: true });
    expect(discard).toHaveFocus();
  });
});
