/**
 * REP7-06 · QA REP7-03/REP7-05.
 * F1 (B8 a 390 px): Enter sobre una fila con aviso la enfoca, pero la fila es más alta que la
 * franja visible y el aviso resaltado (al final de la fila) quedaba bajo el pie fijo.
 * F2 (patrón C5-M1, D31/D33): una acción que desmonta el control y lleva el foco a otra fila
 * («Sí, la factura está en dólares», proveedor sugerido, chip, Enter en la fila) no armaba la
 * guarda: el 2.º Enter de un rebote confirmaba la línea siguiente sin que el usuario la viera.
 * Obs-2: el aviso de precio del servidor se calculó con lo leído; tras convertir o elegir, se
 * recalcula con lo que deja la línea y se retira si ya no se aparta del último costo.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

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
const PRICE_ISSUE = "¿Precio por caja o por unidad? Sale a 0,51 REF por unidad y el último costo fue 0,05 REF.";

const singleCandidate = (seed: number) => [
  { productId: productUuid(seed), name: `Producto ${seed}`, score: 1, reason: "nombre parecido" },
];
/** 6.18: caja x6 con aviso de coherencia de precio. */
const priceLine = (seed = 2) =>
  doubtfulLine(seed, 1, {
    read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
    match: { entryMode: "pack", unitsPerPack: 6, candidates: singleCandidate(seed), issues: [PRICE_ISSUE] },
  });
/** 6.16: dudosa «nombre parecido» con un único candidato de 1,00. */
const nameLine = (seed: number) => doubtfulLine(seed, 1, { match: { candidates: singleCandidate(seed) } });

let now = 1_000_000;
let dateNow: jest.SpyInstance;

beforeEach(() => {
  now = 1_000_000;
  dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  dateNow.mockRestore();
});

function renderPanel(response: InvoiceScanResponse, overrides: Partial<InvoiceReviewPanelProps> = {}) {
  const props: InvoiceReviewPanelProps = {
    context: CONTEXT,
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
    ...overrides,
  };
  render(<InvoiceReviewPanel {...props} />);
  return props;
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

const notices = (index: number) => within(row(index)).getByTestId("invoice-review-line-notices");

describe("REP7-06 · F1: el aviso resaltado queda por encima del pie fijo", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalScrollBy = window.scrollBy;
  const originalInnerHeight = window.innerHeight;
  const scrollIntoView = jest.fn();
  let rect: jest.SpyInstance;

  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.scrollBy = jest.fn() as unknown as typeof window.scrollBy;
    // 390 × 844: pie de 113 px en y=731; el resto, como si ya estuviera en su sitio.
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this.tagName === "FOOTER" ? { top: 731, bottom: 844, height: 113 } : { top: 0, bottom: 0 }) as DOMRect;
    });
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.scrollBy = originalScrollBy;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    rect.mockRestore();
  });

  it("Enter en la fila 6.18: el foco sigue en la fila y lo último que se desplaza a la vista es su lista de avisos, con el margen del pie", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [nameLine(1), priceLine()] }));
    now += 1000;
    row(1).focus();
    scrollIntoView.mockClear();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(notices(1)).toHaveAttribute("data-highlighted", "true"));
    expect(row(1)).toHaveFocus();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(notices(1));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    // innerHeight 844 − top del pie 731 + 8.
    expect(notices(1).style.scrollMarginBottom).toBe("121px");
  });

  it("sin aviso que resaltar, se desplaza la fila (como antes)", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [nameLine(1), nameLine(2)] }));
    now += 1000;
    row(0).focus();
    scrollIntoView.mockClear();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(row(1)).toHaveFocus());
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(row(1));
  });
});

describe("REP7-06 · F2: un rebote tras mover el foco a otra fila no confirma esa línea", () => {
  it("«Sí, la factura está en dólares» + Enter a 90 ms: la dudosa sigue pendiente; una pulsación nueva pasados 400 ms sí acepta", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [nameLine(1)], extraction: { currency: "USD" } }));
    screen.getByRole("button", { name: "Sí, la factura está en dólares" }).focus();
    now += 1000;

    await user.keyboard("{Enter}");
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 90;
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(row(0)).toHaveFocus();

    now += 500;
    await user.keyboard("{Enter}");
    expect(row(0)).toHaveAttribute("data-status", "resolved");
  });

  it("proveedor sugerido + Enter a 90 ms: la dudosa sigue pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [nameLine(1)],
        matched: {
          supplier: {
            candidates: [{ contactId: productUuid(77), name: "Mercaseu C.A.", score: 0.8, reason: "nombre parecido" }],
          },
        },
      }),
    );
    screen.getByRole("button", { name: /Mercaseu C\.A\./ }).focus();
    now += 1000;

    await user.keyboard("{Enter}");
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 90;
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
  });

  // D41-c (B-p9-1): el chip deja el foco en su fila resuelta; el rebote no avanza ni resuelve otra.
  it("Enter en el chip que resuelve la línea + Enter a 90 ms: el foco sigue en su fila y la siguiente sigue pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [nameLine(1), nameLine(2)] }));
    within(row(0)).getByRole("button", { name: /Producto 1/ }).focus();
    now += 1000;

    await user.keyboard("{Enter}");
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 90;
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(row(0)).toHaveFocus();
    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });

  it("Enter en la fila que la resuelve + Enter a 90 ms: la siguiente sigue pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [nameLine(1), nameLine(2)] }));
    now += 1000;
    row(0).focus();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(row(1)).toHaveFocus());
    now += 90;
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });

  it("Cargar no se activa con el rebote de «Sí, en dólares» que resolvió lo último: exige una pulsación nueva", async () => {
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [{}], extraction: { currency: "USD" } }));
    now += 1000;
    await user.click(within(row(0)).getByRole("button", { name: /Propuesto por el emparejamiento/ }));
    now += 1000;

    await user.click(screen.getByRole("button", { name: "Sí, la factura está en dólares" }));
    await user.click(screen.getByRole("button", { name: "Cargar en la compra" }));
    expect(props.onLoad).not.toHaveBeenCalled();

    now += 500;
    await user.click(screen.getByRole("button", { name: "Cargar en la compra" }));
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });
});

/** Ketchup de f04: 0,50 caja a 41.474,74 Bs; con tasa 900 sale a 46,08 REF/u (último 3,91). */
const F04_PRICE_ISSUE = "¿Precio por caja o por unidad? Sale a 46,08 REF por unidad y el último costo fue 3,91 REF.";
const ketchupLine = () =>
  doubtfulLine(5, 1, {
    read: { description: "PAMPERO KETCHUP 397GR", quantity: 0.5, unitPrice: 41474.74, lineTotal: 20737.37 },
    match: {
      candidates: singleCandidate(5),
      issues: ["Cantidad con decimales en la factura: la compra solo admite enteros, revísala.", F04_PRICE_ISSUE],
    },
  });

/** f05: 6 cajas x6 a 523,36; el servidor lo comparó con 6 por caja (0,10 frente a 0,59). */
const F05_PRICE_ISSUE = "¿Precio por caja o por unidad? Sale a 0,10 REF por unidad y el último costo fue 0,59 REF.";
const glupLine = () =>
  doubtfulLine(2, 1, {
    read: { unit: "caja", quantity: 6, unitPrice: 523.36, lineTotal: 3140.16, unitsPerPack: 6 },
    match: { entryMode: "pack", unitsPerPack: 6, candidates: singleCandidate(2), issues: [F05_PRICE_ISSUE] },
  });

describe("REP7-06 · Obs-2: el aviso de precio sigue a la línea tras convertir o elegir", () => {
  it("f04: «Cargar como 6 unidades» deja la línea en 3,84 REF/u y retira el aviso de 46,08", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [ketchupLine()] }));
    expect(notices(0)).toHaveTextContent("Sale a 46,08 REF por unidad");
    now += 1000;
    await user.click(within(row(0)).getByRole("button", { name: "Por bulto" }));
    await user.type(within(row(0)).getByLabelText("Unidades por bulto"), "12");
    now += 1000;

    await user.click(within(row(0)).getByRole("button", { name: "Cargar como 6 unidades" }));

    expect(within(row(0)).getByRole("button", { name: "Por unidad" })).toHaveAccessibleDescription("6 u · 3,84 REF/u");
    expect(row(0)).not.toHaveTextContent(/Sale a 46,08/);
    expect(row(0)).not.toHaveTextContent(/¿Precio por/);
  });

  it("f05: con «Por caja» elegida y 12 por caja, el aviso dice lo que deja ahora (0,05), no lo leído (0,10)", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [glupLine()] }));
    now += 1000;
    await user.click(within(row(0)).getByRole("button", { name: "Por caja" }));
    const units = within(row(0)).getByLabelText("Unidades por caja");

    await user.clear(units);
    await user.type(units, "12");

    // REP9-02 (D42): 12 por caja cambia el costo reconocido y sigue desviado: la fila lo dice con lo
    // que deja ahora, sin repetir el aviso del servidor, y pide confirmarlo (D43: con su botón).
    expect(notices(0)).toHaveTextContent(
      "El costo sale a 0,05 REF por unidad y el último fue 0,59 REF (se aparta más del 40 %): si es correcto, confírmalo con «Sí, el costo es…».",
    );
    expect(notices(0)).not.toHaveTextContent(/¿Precio por/);
  });

  it("f05: al elegir «Por unidad» (0,58 frente a 0,59) el aviso de precio se retira", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [glupLine()] }));
    now += 1000;

    await user.click(within(row(0)).getByRole("button", { name: "Por unidad" }));

    expect(row(0)).not.toHaveTextContent(/¿Precio por/);
  });

  it("sin elegir aún, el aviso es el del servidor (con la palabra del empaque)", () => {
    renderPanel(makeReviewResponse({ lines: [glupLine()] }));

    expect(notices(0)).toHaveTextContent(F05_PRICE_ISSUE);
  });
});
