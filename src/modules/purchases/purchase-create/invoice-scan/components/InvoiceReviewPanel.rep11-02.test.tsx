/**
 * REP11-02 · D48(b) + D49 (M-p11-2, C11B-M1, B-p11-1): el layout pendiente nunca se aplica por
 * tiempo. Con ratón, solo al salir el puntero del PANEL completo; con táctil, nunca solo; siempre al
 * desplazar o usar el teclado. Durante 1 s tras aplicarlo se ignoran las activaciones de puntero
 * sobre controles cuya caja se movió. La fila descartada/resuelta retenida muestra un resumen.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

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
const ROW_HEIGHT = 200;
/** Panel de revisión: 390 × 2000 px desde el origen. */
const PANEL = { left: 0, right: 390, top: 0, bottom: 2000 };
const POINT = { clientX: 180, clientY: 360 };
const INSIDE_PANEL = { clientX: 200, clientY: 900 };
const OUTSIDE_PANEL = { clientX: 600, clientY: 900 };

/** c11-three L0/L1: «CAOSG Harina Maiz 1kg» por nombre a 450 Bs (coherente con el último costo). */
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

let scrollIntoView: jest.Mock;
let rect: jest.SpyInstance;

/**
 * jsdom no maqueta. Cada fila mide ROW_HEIGHT; lo que hay dentro de la línea 1 está más abajo
 * mientras la línea 0 conserva su caja (layout pendiente) y sube cuando se aplica el layout.
 */
function fakeRect(this: Element) {
  if (this.matches('[data-testid="invoice-review-panel"]')) {
    return { ...PANEL, height: PANEL.bottom, width: PANEL.right, x: 0, y: 0, toJSON: () => ({}) };
  }
  const height = this.matches("li[data-line-index]") ? ROW_HEIGHT : 0;
  const held = document.querySelector<HTMLElement>('li[data-line-index="0"]')?.style.minHeight;
  const top = this.closest('li[data-line-index="1"]') ? (held ? 400 : 250) : 0;
  return { bottom: top + height, height, left: 0, right: 390, top, width: 390, x: 0, y: top, toJSON: () => ({}) };
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  scrollIntoView = jest.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  // La compensación del layout pendiente desplaza (jsdom no implementa `scrollBy`).
  Element.prototype.scrollBy = jest.fn();
  rect =jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
});

afterEach(() => {
  rect.mockRestore();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  Reflect.deleteProperty(Element.prototype, "scrollBy");
  jest.useRealTimers();
});

function renderPanel(response: InvoiceScanResponse) {
  render(
    <InvoiceReviewPanel context={CONTEXT} onDiscard={jest.fn()} onLoad={jest.fn()} onRescan={jest.fn()} response={response} />,
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

type PointerKind = "mouse" | "touch";

/** Activación real: pointerdown, pointerup y clic con su punto (`detail` 1). */
function press(element: Element, kind: PointerKind, point: { clientX: number; clientY: number } = POINT) {
  const pointer = { ...point, pointerId: 1, pointerType: kind };
  fireEvent.pointerDown(element, pointer);
  fireEvent.pointerUp(element, pointer);
  fireEvent.click(element, { ...point, detail: 1 });
}

function moveMouse(point: { clientX: number; clientY: number }) {
  fireEvent.pointerMove(document.body, { ...point, pointerId: 1, pointerType: "mouse" });
}

const discardButton = (index: number) => within(row(index)).getByRole("button", { name: /Descartar línea/ });
const harinaChip = (index: number) => within(row(index)).getByRole("button", { name: /^CAOSG Harina Maiz 1kg/ });
const held = (index: number) => row(index).style.minHeight === `${ROW_HEIGHT}px`;

const twoHarinas = () => makeReviewResponse({ lines: [harinaByName(1), harinaByName(2)] });

describe("REP11-02 · D49: el layout pendiente no se aplica por tiempo", () => {
  it.each(["touch", "mouse"] as const)("con %s, la fila descartada conserva su caja a los 5 s", (kind) => {
    renderPanel(twoHarinas());
    press(discardButton(0), kind);

    advance(5000);

    expect(held(0)).toBe(true);
  });

  it("M-p11-2: con el ratón moviéndose por el panel (a la fila siguiente) la caja no cambia", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "mouse");
    moveMouse({ clientX: 200, clientY: 450 });

    advance(3000);

    expect(held(0)).toBe(true);
  });

  it("con el ratón, se aplica al salir el puntero del panel completo", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "mouse");
    moveMouse(INSIDE_PANEL);
    expect(held(0)).toBe(true);

    moveMouse(OUTSIDE_PANEL);

    expect(held(0)).toBe(false);
  });

  it("con el ratón, se aplica al salir de la ventana", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "mouse");

    fireEvent.pointerLeave(document.documentElement, { pointerId: 1, pointerType: "mouse" });

    expect(held(0)).toBe(false);
  });

  it("con táctil, salir del panel (fin del toque) no la aplica", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "touch");

    fireEvent.pointerMove(document.body, { ...OUTSIDE_PANEL, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerLeave(document.documentElement, { pointerId: 1, pointerType: "touch" });

    expect(held(0)).toBe(true);
  });

  it("con táctil, se aplica al desplazar o con el teclado", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "touch");
    fireEvent.scroll(window);
    expect(held(0)).toBe(false);

    press(within(row(0)).getByRole("button", { name: /Restaurar/ }), "touch", { clientX: 300, clientY: 40 });
    advance(1000);
    press(discardButton(0), "touch", { clientX: 180, clientY: 120 });
    expect(held(0)).toBe(true);
    fireEvent.keyDown(document.body, { key: "Shift" });
    expect(held(0)).toBe(false);
  });
});

describe("REP11-02 · D49: guarda anclada al momento de aplicar el layout", () => {
  it("C11B-M1: el toque en un control que se movió al aplicarse, antes de 1 s, no actúa", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "touch");
    advance(1500);
    fireEvent.keyDown(document.body, { key: "Shift" });
    expect(held(0)).toBe(false);

    advance(500);
    press(harinaChip(1), "touch", { clientX: 120, clientY: 600 });

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });

  it("con el ratón que vuelve al panel tras salir, el clic sobre lo movido antes de 1 s no actúa", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "mouse");
    advance(1200);
    moveMouse(OUTSIDE_PANEL);
    advance(400);
    moveMouse({ clientX: 120, clientY: 600 });

    press(harinaChip(1), "mouse", { clientX: 120, clientY: 600 });

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });

  it("pasado 1 s desde que se aplicó, el control movido sí actúa", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "touch");
    fireEvent.keyDown(document.body, { key: "Shift" });

    advance(1000);
    press(harinaChip(1), "touch", { clientX: 120, clientY: 600 });

    expect(row(1)).toHaveAttribute("data-status", "resolved");
  });

  it("un control que no se movió al aplicarse sí actúa antes de 1 s", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "touch");
    advance(1200);
    fireEvent.keyDown(document.body, { key: "Shift" });

    press(within(row(0)).getByRole("button", { name: /Restaurar/ }), "touch", { clientX: 300, clientY: 40 });

    expect(row(0)).not.toHaveAttribute("data-status", "discarded");
  });

  it("6.17: el teclado no sufre la guarda tras aplicarse el layout", () => {
    renderPanel(twoHarinas());
    press(discardButton(0), "touch");
    advance(1200);
    fireEvent.keyDown(document.body, { key: "Shift" });

    fireEvent.keyDown(row(1), { key: "Enter" });
    fireEvent.keyUp(row(1), { key: "Enter" });

    expect(row(1)).toHaveAttribute("data-status", "resolved");
  });
});

describe("REP11-02 · B-p11-1: la fila retenida muestra un resumen en vez de un hueco", () => {
  it("descartada: «Línea descartada» con cómo restaurarla, sin controles nuevos", () => {
    renderPanel(twoHarinas());
    const buttonsBefore = within(row(0)).getAllByRole("button").length;
    press(discardButton(0), "touch");

    const summary = within(row(0)).getByTestId("invoice-review-held-summary");
    expect(summary).toHaveTextContent(/Línea descartada · Restaurar/);
    expect(within(summary).queryAllByRole("button")).toHaveLength(0);
    expect(within(row(0)).getAllByRole("button").length).toBeLessThanOrEqual(buttonsBefore);

    fireEvent.scroll(window);
    expect(within(row(0)).queryByTestId("invoice-review-held-summary")).not.toBeInTheDocument();
  });

  it("resuelta: «Resuelta: <producto>»", () => {
    renderPanel(twoHarinas());
    press(harinaChip(0), "touch", { clientX: 120, clientY: 80 });
    expect(row(0)).toHaveAttribute("data-status", "resolved");

    expect(within(row(0)).getByTestId("invoice-review-held-summary")).toHaveTextContent(
      /^Resuelta: CAOSG Harina Maiz 1kg/,
    );
    expect(screen.getAllByTestId("invoice-review-held-summary")).toHaveLength(1);
  });
});
