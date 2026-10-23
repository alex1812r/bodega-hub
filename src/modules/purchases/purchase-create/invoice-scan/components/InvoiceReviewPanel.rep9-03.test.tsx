/**
 * REP9-03 · QA pasada 9 (D41 b y c).
 * M-p9-2: tras el clic en el chip del 2.º candidato, el chip resaltado seguía siendo el 1.º y un
 * Enter en la fila cambiaba el producto elegido por ese 1.º (mock m04, «MALTA 1.5L»).
 * B-p9-1: el chip y «Cargar como N unidades» resolvían la línea y llevaban el foco a la siguiente
 * pendiente; D39-6: la acción que resuelve deja el foco en su fila, como elegir la opción.
 */
import "@testing-library/jest-dom";
import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
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
const PRICE_ISSUE = "¿Precio por caja o por unidad? Sale a 0,51 REF por unidad y el último costo fue 0,05 REF.";

/** m04 L1: «MALTA 1.5L» con dos candidatos sin empate (0,75 y 0,65); propone el 1.º. */
const maltaLine = () =>
  doubtfulLine(10, 0.75, {
    read: {
      rawText: "MALTA 1.5L",
      description: "MALTA 1.5L",
      unit: "caja",
      quantity: 1,
      unitPrice: 2700,
      lineTotal: 2700,
      unitsPerPack: 6,
    },
    match: {
      entryMode: "pack",
      unitsPerPack: 6,
      candidates: [
        { productId: productUuid(10), name: "MALTA 1.5", score: 0.75, reason: "nombre parecido" },
        { productId: productUuid(11), name: "Malta Polar 1.5L", score: 0.65, reason: "nombre parecido" },
      ],
      issues: [PRICE_ISSUE],
    },
  });

/** f04: 0,50 caja de 12 Ketchup; se resuelve con el chip y «Cargar como 6 unidades». */
const halfBoxLine = () =>
  doubtfulLine(3, 0.9, {
    read: { unit: "caja", quantity: 0.5, unitPrice: 41474.74, lineTotal: 20737.37, unitsPerPack: 12 },
    match: {
      entryMode: "pack",
      unitsPerPack: 12,
      candidates: [{ productId: productUuid(3), name: "Ketchup", score: 0.9, reason: "nombre parecido" }],
    },
  });

const flourLine = () => doubtfulLine(6, 0.99);

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

const chip = (index: number, name: string) => within(row(index)).getByRole("button", { name: new RegExp(`^${name}`) });
const option = (index: number, name: string) => within(row(index)).getByRole("button", { name });
/** D43 (B-r9-1): el costo desviado de la opción elegida se reconoce con su botón aparte. */
const ackButton = (index: number) => within(row(index)).getByRole("button", { name: /^Sí, el costo es/ });

/** Pasa la guarda de activación (400 ms) del último cambio de foco: pulsación deliberada. */
function later() {
  now += 1000;
}

describe("REP9-03 · M-p9-2: el producto elegido con el chip manda sobre el candidato marcado", () => {
  it("clic en «Malta Polar 1.5L»: ese chip queda resaltado y el 1.º no", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [maltaLine()] }));
    later();

    await user.click(chip(0, "Malta Polar 1.5L"));

    expect(chip(0, "Malta Polar 1.5L")).toHaveAttribute("aria-pressed", "true");
    expect(chip(0, "MALTA 1.5")).toHaveAttribute("aria-pressed", "false");
  });

  it("clic en «Malta Polar 1.5L», Enter en la fila y «Por caja»: la línea queda resuelta con Malta Polar", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [maltaLine()] }));
    later();
    await user.click(chip(0, "Malta Polar 1.5L"));
    await waitFor(() => expect(row(0)).toHaveFocus());

    later();
    await user.keyboard("{Enter}");

    expect(chip(0, "Malta Polar 1.5L")).toHaveAttribute("aria-pressed", "true");
    expect(chip(0, "MALTA 1.5")).toHaveAttribute("aria-pressed", "false");

    later();
    await user.click(option(0, "Por caja"));

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    // D43: la resuelta conserva los candidatos (el elegido, marcado); el título es Malta Polar.
    expect(within(row(0)).getByText("Malta Polar 1.5L", { selector: "span.text-foreground" })).toBeInTheDocument();
    expect(within(row(0)).queryByText("MALTA 1.5", { selector: "span.text-foreground" })).not.toBeInTheDocument();
    expect(chip(0, "Malta Polar 1.5L")).toHaveAttribute("aria-pressed", "true");
    expect(chip(0, "MALTA 1.5")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("REP9-03 · B-p9-1: el chip y «Cargar como N unidades» dejan el foco en la fila resuelta (D39-6)", () => {
  it("6.18: «Por caja» y luego clic en el chip: resuelta y el foco sigue en su fila", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [maltaLine(), flourLine()] }));
    later();
    await user.click(option(0, "Por caja"));
    later();
    await user.click(ackButton(0));

    later();
    await user.click(chip(0, "MALTA 1.5"));

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());
    expect(row(1)).not.toHaveFocus();
  });

  it("6.18: «Por caja» y Enter sobre el chip: igual", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [maltaLine(), flourLine()] }));
    later();
    await user.click(option(0, "Por caja"));
    later();
    await user.click(ackButton(0));

    chip(0, "MALTA 1.5").focus();
    later();
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());
    expect(row(1)).not.toHaveFocus();
  });

  it.each([
    ["clic", "click"],
    ["Enter", "enter"],
  ] as const)("f04: chip y luego %s en «Cargar como 6 unidades»: resuelta y el foco sigue en su fila", async (_, how) => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [halfBoxLine(), flourLine()] }));
    later();
    await user.click(chip(0, "Ketchup"));

    const convert = option(0, "Cargar como 6 unidades");
    later();
    if (how === "click") {
      await user.click(convert);
    } else {
      convert.focus();
      await user.keyboard("{Enter}");
    }

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());
    expect(row(1)).not.toHaveFocus();
  });
});
