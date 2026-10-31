import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";
import { COMPACTION_GUARD_MS } from "./useLayoutHold";

/**
 * REP17-17 (D72(b)): «Compactar lista» es el único gesto que recupera el espacio retenido (además del cambio de ancho).
 * Va tras las filas en un sitio reservado desde el primer render (su aparición no mueve nada), solo se ofrece con algo
 * retenido, tiene nombre accesible y se acciona con el teclado; tras pulsarlo, el foco no se pierde en BODY.
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

/** Línea dudosa (por revisar): se puede descartar. */
const LINE = {
  read: { description: "CAOSG Harina Maiz 1kg", quantity: 2, unitPrice: 950, lineTotal: 1900 },
  match: {
    status: "doubtful" as const,
    productId: undefined,
    taxRateCode: "exento",
    candidates: [{ productId: productUuid(9), name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00" }],
    issues: [],
  },
};

function props(): InvoiceReviewPanelProps {
  return {
    context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: async () => [],
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response: makeReviewResponse({ lines: [LINE, LINE, LINE], extraction: { total: 5700 } }),
  };
}

/**
 * Geometría simulada: cada caja mide 8 px por elemento que contiene (la fila descartada, con menos contenido, encoge) o
 * su alto mínimo en línea si es mayor; todo empieza arriba.
 */
function fakeRect(this: Element) {
  if (this instanceof HTMLElement && this.style.display === "none") {
    return new DOMRect(0, 0, 0, 0);
  }
  const natural = this.querySelectorAll("*").length * 8 + 8;
  const floor = this instanceof HTMLElement ? Number.parseFloat(this.style.minHeight) || 0 : 0;
  return new DOMRect(0, 0, 360, Math.max(natural, floor));
}

function row(index: number) {
  return screen.getByRole("group", { name: new RegExp(`^Línea ${index + 1}:`) });
}

function slot() {
  const element = document.querySelector("[data-testid='invoice-review-compact-slot']");
  if (!element) {
    throw new Error("Sin sitio reservado para «Compactar lista»");
  }
  return element as HTMLElement;
}

function compactButton() {
  return within(slot()).queryByRole("button", { name: "Compactar lista" });
}

/** Toque real sobre «Descartar línea» de la fila `index`. */
function tapDiscard(index: number) {
  const discard = within(row(index)).getByRole("button", { name: "Descartar línea" });
  const point = { clientX: 40, clientY: 300, detail: 1 };
  fireEvent.pointerDown(discard, { ...point, pointerId: 7, pointerType: "touch" });
  fireEvent.mouseDown(discard, point);
  fireEvent.pointerUp(discard, { ...point, pointerId: 7, pointerType: "touch" });
  fireEvent.mouseUp(discard, point);
  fireEvent.click(discard, point);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("REP17-17 · «Compactar lista»", () => {
  it("su sitio existe desde el primer render, tras las filas, y sin nada retenido no ofrece el botón", () => {
    render(<InvoiceReviewPanel {...props()} />);
    const lines = screen.getByRole("region", { name: "Líneas de la factura" });

    expect(lines.compareDocumentPosition(slot()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lines.contains(slot())).toBe(false);
    expect(compactButton()).toBeNull();
  });

  it("al descartar una línea, la fila conserva su caja y se ofrece el botón, que ni el teclado ni desplazar ni el tiempo quitan", () => {
    render(<InvoiceReviewPanel {...props()} />);
    const heightBefore = row(0).getBoundingClientRect().height;

    tapDiscard(0);

    expect(row(0).style.minHeight).toBe(`${heightBefore}px`);
    expect(compactButton()).toBeInTheDocument();
    fireEvent.keyDown(row(1), { key: "ArrowDown" });
    fireEvent.scroll(window);
    fireEvent.wheel(window, { deltaY: 120 });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(row(0).style.minHeight).toBe(`${heightBefore}px`);
    expect(compactButton()).toBeInTheDocument();
  });

  it("con el teclado: Enter compacta (la fila toma su alto), el botón se va y el foco pasa al pie, no a BODY", () => {
    render(<InvoiceReviewPanel {...props()} />);
    tapDiscard(0);
    act(() => {
      jest.advanceTimersByTime(COMPACTION_GUARD_MS);
    });
    const button = compactButton();
    if (!button) {
      throw new Error("Sin «Compactar lista»");
    }

    button.focus();
    act(() => {
      // Un botón nativo acciona su clic con Enter (`detail` 0: sin punto de pantalla).
      fireEvent.click(button, { detail: 0 });
    });

    expect(row(0).style.minHeight).toBe("");
    expect(compactButton()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("contentinfo", { name: "Resumen de la revisión" }));
  });

  it("con el puntero también compacta, y el sitio sigue reservado (vacío) tras compactar", () => {
    render(<InvoiceReviewPanel {...props()} />);
    tapDiscard(1);
    act(() => {
      jest.advanceTimersByTime(COMPACTION_GUARD_MS);
    });
    const button = compactButton();
    if (!button) {
      throw new Error("Sin «Compactar lista»");
    }

    fireEvent.click(button, { clientX: 120, clientY: 500, detail: 1 });

    expect(row(1).style.minHeight).toBe("");
    expect(compactButton()).toBeNull();
    expect(slot()).toBeInTheDocument();
  });
});
