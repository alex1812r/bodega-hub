/**
 * REP10-01 · D46 (C10B-M1, C10B-M2): ninguna acción con el puntero deja otro control de decisión
 * bajo el dedo.
 * (a) Tras la acción, las filas conservan su caja y su orden (y el foco no desplaza) hasta que el
 *     usuario desplace, use el teclado o pasen 1,5 s sin puntero sobre esa zona.
 * (b) Guarda espacial: durante 1 s, otra activación con puntero a < 32 px del punto anterior sobre
 *     un control distinto se ignora. El teclado nunca la sufre.
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

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const HARINA = productUuid(1);
const ROW_HEIGHT = 200;
/** Punto del 1.er toque (390 px); el 2.º cae en el mismo sitio. */
const POINT = { clientX: 180, clientY: 360 };

/** c10-move L2/L3: «CAOSG Harina Maiz 1kg» por nombre a 4.500 Bs (desviada) o a 450 Bs (coherente). */
function harinaByName(unitPrice: number): ReviewFixtureLine {
  return {
    read: {
      rawText: `CAOSG Harina Maiz 1kg P3 1 ${unitPrice},00 ${unitPrice},00`,
      description: "CAOSG Harina Maiz 1kg",
      unit: "unidad",
      quantity: 1,
      unitPrice,
      lineTotal: unitPrice,
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

/** c9-sku-caja L0: galleta confirmada por SKU, caja x6 a 270 Bs (0,05 REF/u, último 0,05). */
function galletaConfirmada(): ReviewFixtureLine {
  return {
    read: {
      rawText: "CG-GALLETA GALLETA MARIA CAJA X6 1 270,00 270,00",
      description: "GALLETA MARIA CAJA X6",
      unit: "caja",
      unitsPerPack: 6,
      quantity: 1,
      unitPrice: 270,
      lineTotal: 270,
    },
    match: {
      status: "confirmed",
      productId: productUuid(2),
      entryMode: "pack",
      unitsPerPack: 6,
      taxRateCode: "exento",
      candidates: [{ productId: productUuid(2), name: "Galleta María", score: 1, reason: "SKU del proveedor", lastUnitCostRef: 0.05 }],
      lastUnitCostRef: 0.05,
    },
  };
}

let scrollIntoView: jest.Mock;
let rect: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  scrollIntoView = jest.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  // jsdom no maqueta: cada fila mide ROW_HEIGHT para ver si conserva su caja.
  rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const height = this.matches("li[data-line-index]") ? ROW_HEIGHT : 0;
    return { bottom: height, height, left: 0, right: 390, top: 0, width: 390, x: 0, y: 0, toJSON: () => ({}) };
  });
});

afterEach(() => {
  rect.mockRestore();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  jest.useRealTimers();
});

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

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** Toque real: pointerdown, pointerup y clic con su punto (`detail` 1). */
function tap(element: Element, point: { clientX: number; clientY: number } = POINT) {
  const pointer = { ...point, pointerId: 1, pointerType: "touch" };
  fireEvent.pointerDown(element, pointer);
  fireEvent.pointerUp(element, pointer);
  fireEvent.click(element, { ...point, detail: 1 });
}

const discardButton = (index: number) => within(row(index)).getByRole("button", { name: /Descartar línea/ });
const harinaChip = (index: number) => within(row(index)).getByRole("button", { name: /^CAOSG Harina Maiz 1kg/ });
const option = (index: number, name: RegExp) => within(row(index)).getByRole("button", { name });
const ackButton = (index: number) => within(row(index)).getByRole("button", { name: /^Sí, el costo es/ });
const reviewList = () => screen.getByRole("list", { name: "Líneas por revisar" });
const confirmedList = () => screen.getByRole("list", { name: "Líneas confirmadas" });

function renderDiscardRepro() {
  renderPanel(makeReviewResponse({ lines: [harinaByName(4500), harinaByName(450)] }));
  advance(1000);
}

/** c9-sku-caja: abre «1 línea confirmada · ver» y pulsa «Por unidad» de la galleta (sale de confirmadas). */
function renderConfirmedUnitRepro() {
  renderPanel(makeReviewResponse({ lines: [galletaConfirmada(), harinaByName(450)] }));
  advance(1000);
  tap(screen.getByRole("button", { name: /1 línea confirmada · ver/ }), { clientX: 200, clientY: 700 });
  advance(1000);
  tap(option(0, /^Por unidad/));
  expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
}

describe("REP10-01 · C10B-M1: tras «Descartar línea» nada sube bajo el dedo", () => {
  it("repro: el 2.º toque a 600 ms en el mismo punto no acepta el chip de la línea siguiente", () => {
    renderDiscardRepro();
    tap(discardButton(0));
    expect(row(0)).toHaveAttribute("data-status", "discarded");

    advance(600);
    tap(harinaChip(1));

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });

  it("la fila descartada conserva su caja y el foco va a la siguiente sin desplazar la página", () => {
    renderDiscardRepro();
    scrollIntoView.mockClear();
    tap(discardButton(0));
    advance(0);

    expect(row(0)).toHaveStyle({ minHeight: `${ROW_HEIGHT}px` });
    expect(row(1)).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("la fila colapsa al desplazar la página", () => {
    renderDiscardRepro();
    tap(discardButton(0));

    fireEvent.scroll(window);

    expect(row(0)).not.toHaveStyle({ minHeight: `${ROW_HEIGHT}px` });
  });

  it("la fila colapsa a los 1,5 s sin puntero sobre ella (táctil)", () => {
    renderDiscardRepro();
    tap(discardButton(0));

    advance(1400);
    expect(row(0)).toHaveStyle({ minHeight: `${ROW_HEIGHT}px` });
    advance(100);
    expect(row(0)).not.toHaveStyle({ minHeight: `${ROW_HEIGHT}px` });
  });
});

describe("REP10-01 · C10B-M1 repro 3: la confirmada que sale de su grupo no se mueve bajo el dedo", () => {
  it("sigue en «Líneas confirmadas» y el 2.º toque a 600 ms no acepta la línea de debajo", () => {
    renderConfirmedUnitRepro();

    expect(confirmedList()).toContainElement(row(0));
    advance(600);
    tap(harinaChip(1));

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });

  it("al usar el teclado toma su lista (por revisar)", () => {
    renderConfirmedUnitRepro();

    fireEvent.keyDown(row(0), { key: "Shift" });

    expect(reviewList()).toContainElement(row(0));
  });

  it("a los 1,5 s sin puntero toma su lista y el foco sigue en su fila (nunca en BODY)", () => {
    renderConfirmedUnitRepro();
    advance(0);
    expect(row(0)).toHaveFocus();

    advance(1500);

    expect(reviewList()).toContainElement(row(0));
    expect(row(0)).toHaveFocus();
  });
});

describe("REP10-01 · C10B-M2: tras «Sí, el costo es…» un 2.º toque no elige «Por caja»", () => {
  it("repro: 2.º toque a 600 ms en el mismo punto; la línea queda resuelta por unidad y el foco en su fila", () => {
    renderConfirmedUnitRepro();
    advance(1000);
    const ackPoint = { clientX: 182, clientY: 226 };
    tap(ackButton(0), ackPoint);
    expect(row(0)).toHaveAttribute("data-status", "resolved");

    advance(600);
    tap(option(0, /^Por caja/), ackPoint);
    advance(0);

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(option(0, /^Por unidad/)).toHaveAttribute("aria-pressed", "true");
    expect(row(0)).toHaveFocus();
  });
});

describe("REP10-01 · guarda espacial (D46-b)", () => {
  it("a 32 px o más del toque anterior, el otro control sí actúa", () => {
    renderDiscardRepro();
    tap(discardButton(0));

    advance(600);
    tap(harinaChip(1), { clientX: POINT.clientX + 40, clientY: POINT.clientY });

    expect(row(1)).toHaveAttribute("data-status", "resolved");
  });

  it("pasado 1 s, el otro control en el mismo punto sí actúa", () => {
    renderDiscardRepro();
    tap(discardButton(0));

    advance(1000);
    tap(harinaChip(1));

    expect(row(1)).toHaveAttribute("data-status", "resolved");
  });

  it("6.17: el teclado no sufre la guarda espacial", () => {
    renderDiscardRepro();
    tap(discardButton(0));
    advance(500);

    fireEvent.keyDown(row(1), { key: "Enter" });
    fireEvent.keyUp(row(1), { key: "Enter" });

    expect(row(1)).toHaveAttribute("data-status", "resolved");
  });
});
