/**
 * REP8-03 · bajos de la QA p8.
 * B-p8-1: con ratón/toque, elegir la opción (o «Cargar como N unidades») antes de tocar el chip
 * deja la línea «Dudosa» sin decir qué falta. La fila y el pie lo dicen; el producto no se acepta solo.
 * B-p8-2: el aviso «El precio unitario no cuadra…» del servidor se recalcula con lo editado.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import { UNIT_PRICE_MISMATCH_ISSUE } from "@/modules/invoice-scan/server/match/money";

import { createInvoiceReviewState, reviewReducer, type InvoiceReviewContext } from "../reviewModel";
import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { getDisplayedLineIssues } from "./invoiceReviewView";

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

/** 6.18: Galleta caja x6 con aviso de precio, propuesta por el emparejamiento sin aceptar. */
const priceLine = () =>
  doubtfulLine(2, 0.9, {
    read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
    match: {
      entryMode: "pack",
      unitsPerPack: 6,
      candidates: [{ productId: productUuid(2), name: "Galleta", score: 0.9, reason: "nombre parecido" }],
      issues: [PRICE_ISSUE],
    },
  });

/** f04: 0,50 caja de 12 Ketchup sin aviso de elección; solo falta convertir y confirmar el producto. */
const halfBoxLine = () =>
  doubtfulLine(3, 0.9, {
    read: { unit: "caja", quantity: 0.5, unitPrice: 41474.74, lineTotal: 20737.37, unitsPerPack: 12 },
    match: {
      entryMode: "pack",
      unitsPerPack: 12,
      candidates: [{ productId: productUuid(3), name: "Ketchup", score: 0.9, reason: "nombre parecido" }],
    },
  });

let now = 1_000_000;
let dateNow: jest.SpyInstance;

beforeEach(() => {
  now = 1_000_000;
  dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  dateNow.mockRestore();
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

const notices = (index: number) => within(row(index)).getByTestId("invoice-review-line-notices");
const footer = () => screen.getByRole("contentinfo", { name: "Resumen de la revisión" });

describe("REP8-03 · B-p8-1: elegida la opción antes que el producto, la fila y el pie dicen qué falta", () => {
  it("clic en «Por caja» sin tocar el chip: sigue dudosa, la fila pide confirmar «Galleta» y el pie lo cuenta", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [priceLine()] }));

    await user.click(within(row(0)).getByRole("button", { name: "Por caja" }));

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(notices(0)).toHaveTextContent("Falta confirmar el producto: toca «Galleta» o pulsa Enter.");
    expect(footer()).toHaveTextContent("Falta confirmar el producto en 1 línea.");
    expect(footer()).not.toHaveTextContent("por resolver");
  });

  it("«Cargar como 6 unidades» sin tocar el chip: igual, y tocar el chip la resuelve", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [halfBoxLine()] }));

    await user.click(within(row(0)).getByRole("button", { name: "Cargar como 6 unidades" }));

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(notices(0)).toHaveTextContent("Falta confirmar el producto: toca «Ketchup» o pulsa Enter.");
    expect(footer()).toHaveTextContent("Falta confirmar el producto en 1 línea.");

    // Un toque deliberado, pasada la guarda de activación (400 ms) del cambio de foco anterior.
    now += 500;
    await user.click(within(row(0)).getByRole("button", { name: /Ketchup/ }));

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(footer()).not.toHaveTextContent("Falta confirmar el producto");
  });
});

describe("REP8-03 · B-p8-2: el aviso de precio unitario del servidor sigue a los valores editados", () => {
  /** f04: «0,50 X 1,474.74 … 20737.3», caja de 12. */
  const misread = () =>
    createInvoiceReviewState(
      makeReviewResponse({
        lines: [
          doubtfulLine(3, 0.9, {
            read: { unit: "caja", quantity: 0.5, unitPrice: 1474.74, lineTotal: 20737.3, unitsPerPack: 12 },
            match: { entryMode: "pack", unitsPerPack: 12, issues: [UNIT_PRICE_MISMATCH_ISSUE] },
          }),
        ],
      }),
      CONTEXT,
    );
  const shown = (state: ReturnType<typeof misread>) =>
    getDisplayedLineIssues(state, state.lines[0]).map((issue) => issue.text);

  it("corregido el costo a 41474,74 y convertido a 6 u, el aviso desaparece; reaparece si deja de cuadrar", () => {
    let state = misread();
    expect(shown(state)).toContain(UNIT_PRICE_MISMATCH_ISSUE);

    state = reviewReducer(state, { type: "editUnitPrice", index: 0, unitPrice: 41474.74 });
    expect(shown(state)).not.toContain(UNIT_PRICE_MISMATCH_ISSUE);

    state = reviewReducer(state, { type: "convertPackToUnits", index: 0 });
    expect(state.lines[0]).toMatchObject({ entryMode: "unit", quantity: 6 });
    expect(shown(state)).not.toContain(UNIT_PRICE_MISMATCH_ISSUE);

    state = reviewReducer(state, { type: "editUnitPrice", index: 0, unitPrice: 4000 });
    expect(shown(state)).toContain(UNIT_PRICE_MISMATCH_ISSUE);
  });
});
