/**
 * REP12-02 · D54(a) (C12B-M1, B-p12B-1): al descartar la última línea pendiente aparece la casilla de
 * la diferencia en el pie. (1) El pie reserva su sitio y la casilla nunca cae donde estaba «Cargar»
 * (eso lo mide la story `C12BM1Pie*`, jsdom no maqueta); (2) el pie entra en useLayoutHold: durante
 * 1 s desde que cambia, un control del pie que apareció o se movió no acepta el puntero; (3) la casilla
 * solo cambia tocando su propio control (no el texto) con una pulsación que empezó después del cambio.
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
/** Puntos del repro a 390 × 844: «Descartar línea» de L1 y «Cargar» antes de descartar. */
const DISCARD_L1 = { clientX: 277, clientY: 311 };
const LOAD_BEFORE = { clientX: 275, clientY: 792 };
const CHECKBOX = { clientX: 24, clientY: 760 };

/** c12-foot L0: «CG-HARINA» 1 × 450, confirmada por SKU (coherente con el último costo 0,50 REF). */
const harinaConfirmada: ReviewFixtureLine = {
  read: {
    rawText: "CG-HARINA HARINA MAIZ 1KG 1 450,00 450,00",
    description: "HARINA MAIZ 1KG",
    supplierSku: "CG-HARINA",
    unit: "unidad",
    quantity: 1,
    unitPrice: 450,
    lineTotal: 450,
  },
  match: {
    status: "confirmed",
    productId: HARINA,
    taxRateCode: "exento",
    candidates: [{ productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "SKU del proveedor", lastUnitCostRef: 0.5 }],
    lastUnitCostRef: 0.5,
  },
};

/** c12-foot L1: «FLETE Y TRANSPORTE» 1 × 900, sin emparejar. */
const flete: ReviewFixtureLine = {
  read: {
    rawText: "FLETE Y TRANSPORTE 1 900,00 900,00",
    description: "FLETE Y TRANSPORTE",
    unit: "otro",
    quantity: 1,
    unitPrice: 900,
    lineTotal: 900,
  },
  match: { status: "unmatched", productId: undefined, candidates: undefined, taxRateCode: "exento" },
};

/** c11-three L1: harina por nombre a 450 Bs, coherente: el chip la resuelve sin más. */
const harinaDudosa: ReviewFixtureLine = {
  read: { ...harinaConfirmada.read, supplierSku: undefined, rawText: "CAOSG Harina Maiz 1kg P3 1 450,00 450,00" },
  match: {
    status: "doubtful",
    productId: undefined,
    taxRateCode: "exento",
    candidates: [{ productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00", lastUnitCostRef: 0.5 }],
    lastUnitCostRef: 0.5,
    issues: [],
  },
};

const footResponse = () =>
  makeReviewResponse({ extraction: { subtotal: 1350, total: 1350 }, lines: [harinaConfirmada, flete] });
/** Todas confirmadas y el total leído no cuadra: la casilla está desde el principio. */
const differenceResponse = () => makeReviewResponse({ extraction: { total: 1350 }, lines: [harinaConfirmada] });
/** L1 pendiente; al resolverla cuadra y «Cargar» se habilita. */
const resolveLastResponse = () =>
  makeReviewResponse({ extraction: { total: 900 }, lines: [harinaConfirmada, harinaDudosa] });

/**
 * jsdom no maqueta: `layout.shift` desplaza lo que haya en el pie (sticky abajo) para simular que el
 * pie cambió de alto; `layout.loadMoves` sube «Cargar» cuando se habilita.
 */
const layout = { shift: 0, loadMoves: false };

function fakeRect(this: Element) {
  let top = 0;
  let height = 0;
  const footer = this.closest("footer");
  if (footer) {
    top = 780 - layout.shift;
    height = 20;
    if (this instanceof HTMLButtonElement && this.hasAttribute("data-load-button")) {
      top = layout.loadMoves && !this.disabled ? 746 : 774;
      height = 36;
    }
  }
  return { bottom: top + height, height, left: 0, right: 390, top, width: 390, x: 0, y: top, toJSON: () => ({}) };
}

let rect: jest.SpyInstance;

beforeEach(() => {
  layout.shift = 0;
  layout.loadMoves = false;
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

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function renderPanel(response: InvoiceScanResponse, onLoad = jest.fn()) {
  const onDiscard = jest.fn();
  const onRescan = jest.fn();
  // Un elemento nuevo cada vez: con el mismo, React no vuelve a pintar.
  const element = () => (
    <InvoiceReviewPanel context={CONTEXT} onDiscard={onDiscard} onLoad={onLoad} onRescan={onRescan} response={response} />
  );
  const view = render(element());
  advance(1500);
  return { ...view, rerenderSame: () => view.rerender(element()) };
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

const pointer = (point: { clientX: number; clientY: number }) => ({ ...point, pointerId: 1, pointerType: "touch" });

/** Toque real: pointerdown, pointerup y clic con su punto (`detail` 1). */
function tap(element: Element, point: { clientX: number; clientY: number }) {
  fireEvent.pointerDown(element, pointer(point));
  fireEvent.pointerUp(element, pointer(point));
  fireEvent.click(element, { ...point, detail: 1 });
}

const checkbox = () => screen.getByRole("checkbox", { name: /Cargar con una diferencia de/ });
const loadButton = () => screen.getByRole("button", { name: "Cargar en la compra" });

describe("REP12-02 · C12B-M1: la casilla de diferencia que aparece al descartar la última pendiente", () => {
  it.each([300, 700])("un toque a los %i ms sobre la casilla recién aparecida no la marca", (at) => {
    renderPanel(footResponse());
    expect(screen.queryByTestId("invoice-review-difference")).not.toBeInTheDocument();

    tap(within(row(1)).getByRole("button", { name: /Descartar línea/ }), DISCARD_L1);
    expect(row(1)).toHaveAttribute("data-status", "discarded");
    advance(at);
    tap(checkbox(), CHECKBOX);

    expect(checkbox()).not.toBeChecked();
    expect(loadButton()).toBeDisabled();
  });

  it("pasado 1 s, tocarla a propósito sí la marca", () => {
    renderPanel(footResponse());
    tap(within(row(1)).getByRole("button", { name: /Descartar línea/ }), DISCARD_L1);

    advance(1000);
    tap(checkbox(), CHECKBOX);

    expect(checkbox()).toBeChecked();
    expect(loadButton()).toBeEnabled();
  });
});

describe("REP12-02 · D54(a)(3): la casilla exige su propio control y una pulsación nueva", () => {
  it("tocar el texto de la casilla (no el control) no la marca", () => {
    renderPanel(differenceResponse());
    const text = screen.getByText(/^Cargar con una diferencia de/);

    tap(text, LOAD_BEFORE);

    expect(checkbox()).not.toBeChecked();
  });

  it("un toque que empezó antes de que la casilla cambiara de sitio no cuenta; uno nuevo, sí", () => {
    const { rerenderSame } = renderPanel(differenceResponse());

    fireEvent.pointerDown(checkbox(), pointer(CHECKBOX));
    layout.shift = 46;
    rerenderSame();
    fireEvent.pointerUp(checkbox(), pointer(CHECKBOX));
    fireEvent.click(checkbox(), { ...CHECKBOX, detail: 1 });
    expect(checkbox()).not.toBeChecked();

    advance(1000);
    tap(checkbox(), CHECKBOX);
    expect(checkbox()).toBeChecked();
  });

  it("con el teclado (Espacio, clic sin puntero) sigue marcándose", () => {
    renderPanel(differenceResponse());

    fireEvent.click(checkbox(), { detail: 0 });

    expect(checkbox()).toBeChecked();
  });
});

describe("REP12-02 · D54(a)(2): el pie entra en la guarda anclada a su cambio", () => {
  it("si «Cargar» se mueve con la acción, el toque en él a los 600 ms no carga; pasado 1 s, sí", () => {
    const onLoad = jest.fn();
    layout.loadMoves = true;
    renderPanel(resolveLastResponse(), onLoad);
    expect(loadButton()).toBeDisabled();

    tap(within(row(1)).getByRole("button", { name: /^CAOSG Harina Maiz 1kg/ }), { clientX: 120, clientY: 300 });
    expect(loadButton()).toBeEnabled();
    // Fuera de la guarda de 400 ms del rebote (D33-a): solo la guarda del pie lo frena.
    advance(600);
    tap(loadButton(), { clientX: 275, clientY: 764 });
    expect(onLoad).not.toHaveBeenCalled();

    advance(500);
    tap(loadButton(), { clientX: 275, clientY: 764 });
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
