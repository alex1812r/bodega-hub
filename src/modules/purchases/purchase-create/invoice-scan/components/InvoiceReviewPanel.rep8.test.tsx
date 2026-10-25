/**
 * REP8-02 (C8-M1, D39) · las flechas nunca eligen ni marcan sin intención.
 * Secuencias del caos (lab `ex/c8-arrow.json`): L0 caja x6 con aviso de precio, L1 «JABON AZUL
 * 250G» con dos candidatos empatados (6.9) y L2 una dudosa normal. Antes, la flecha sobre
 * «Por unidad» elegía «Por caja», el foco saltaba a L1, la 2.ª flecha marcaba un homónimo y
 * el Enter siguiente lo aceptaba.
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

/** L0: Galleta caja x6 con aviso de precio (6.18). */
const priceLine = () =>
  doubtfulLine(2, 1, {
    read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
    match: {
      entryMode: "pack",
      unitsPerPack: 6,
      candidates: [{ productId: productUuid(2), name: "Galleta", score: 1, reason: "nombre parecido · vinculado" }],
      issues: [PRICE_ISSUE],
    },
  });
/** L1: dos homónimos empatados a 0,73 y sin propuesta (6.9: nunca elige sola). */
const tieLine = () =>
  doubtfulLine(4, 0.73, {
    match: {
      productId: undefined,
      candidates: [
        { productId: productUuid(4), name: "CAOSG Jabon Azul 250g", sku: "CAOSG-004", score: 0.73, reason: "nombre parecido" },
        { productId: productUuid(5), name: "CAOSG Jabon Azul 250g", sku: "CAOSG-005", score: 0.73, reason: "nombre parecido" },
      ],
    },
  });
/** L2: Harina 0,99. */
const flourLine = () => doubtfulLine(6, 0.99);
const c8Arrow = () => makeReviewResponse({ lines: [priceLine(), tieLine(), flourLine()] });

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
  const props: InvoiceReviewPanelProps = {
    context: CONTEXT,
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
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

const option = (index: number, name: string) => within(row(index)).getByRole("button", { name });
const footer = () => screen.getByRole("contentinfo", { name: "Resumen de la revisión" });
const loadButton = () => screen.getByRole("button", { name: "Cargar en la compra" });

type User = ReturnType<typeof userEvent.setup>;

/** D43 (B-r9-1): elegir la opción desviada no reconoce su costo: Tab al botón propio y Enter. */
async function acknowledgeCostByKeyboard(user: User, index = 0) {
  expect(row(index)).toHaveAttribute("data-status", "pending_doubtful");
  await waitFor(() => expect(row(index)).toHaveFocus());
  await user.keyboard("{Tab}");
  expect(within(row(index)).getByRole("button", { name: /^Sí, el costo es/ })).toHaveFocus();
  now += 1000;
  await user.keyboard("{Enter}");
}

/** Pulsaciones (cada una con su keyup) separadas `gap` ms, como `CAOS_STEPS`. */
async function burst(user: User, keys: string[], gap: number) {
  for (const [position, key] of keys.entries()) {
    if (position > 0) {
      now += gap;
    }
    await user.keyboard(key);
  }
}

function expectTieUntouched() {
  expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  for (const chip of within(row(1)).getAllByRole("button", { name: /CAOSG Jabon Azul 250g/ })) {
    expect(chip).toHaveAttribute("aria-pressed", "false");
    // B-p12-1: el marcado por flechas (lo que aceptaría Enter) no es «pulsado»; se lee en `data-marked`.
    expect(chip).not.toHaveAttribute("data-marked");
  }
}

describe("REP8-02 · C8-M1: las flechas sobre las opciones no eligen ni sacan el foco de la fila", () => {
  it.each([
    ["d36-arrow2-enter-slow (450 ms)", ["{Enter}", "{Tab}", "{ArrowRight}", "{ArrowRight}", "{Enter}"], 450],
    ["d36-arrow2-enter (150 ms)", ["{Enter}", "{Tab}", "{ArrowRight}", "{ArrowRight}", "{Enter}"], 150],
    ["d36-arrowRL-enter (450 ms)", ["{Enter}", "{Tab}", "{ArrowRight}", "{ArrowLeft}", "{Enter}"], 450],
    ["d36-arrowRL-enter (150 ms)", ["{Enter}", "{Tab}", "{ArrowRight}", "{ArrowLeft}", "{Enter}"], 150],
  ])("%s: L1 (empate) sigue dudosa sin marcar; L0 queda «Por unidad» con el foco en su fila", async (_, keys, gap) => {
    const user = userEvent.setup();
    renderPanel(c8Arrow());
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;

    await burst(user, keys, gap);

    expectTieUntouched();
    expect(option(0, "Por unidad")).toHaveAttribute("aria-pressed", "true");
    expect(option(0, "Por caja")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(row(0)).toHaveFocus());
    // D43: la ráfaga elige la opción pero no reconoce su costo desviado.
    await acknowledgeCostByKeyboard(user);
    expect(row(0)).toHaveAttribute("data-status", "resolved");
  });

  it("la flecha solo mueve el foco entre las opciones: ninguna queda elegida", async () => {
    const user = userEvent.setup();
    renderPanel(c8Arrow());
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;

    await burst(user, ["{Enter}", "{Tab}", "{ArrowRight}"], 450);
    expect(option(0, "Por caja")).toHaveFocus();
    now += 450;
    await user.keyboard("{ArrowDown}");
    expect(option(0, "Por unidad")).toHaveFocus();

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(option(0, "Por unidad")).toHaveAttribute("aria-pressed", "false");
    expect(option(0, "Por caja")).toHaveAttribute("aria-pressed", "false");
    expect(within(row(0)).queryByRole("radio")).not.toBeInTheDocument();
    expectTieUntouched();
  });

  it.each(["{Enter}", " "])("elegir con %s sobre la opción deja el foco en la fila resuelta (no en la siguiente)", async (key) => {
    const user = userEvent.setup();
    renderPanel(c8Arrow());
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;

    await burst(user, ["{Enter}", "{Tab}", "{ArrowRight}", key], 450);

    expect(option(0, "Por caja")).toHaveAttribute("aria-pressed", "true");
    await acknowledgeCostByKeyboard(user);
    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());
    // Más flechas y Enter sobre la fila resuelta no tocan L1.
    await burst(user, ["{ArrowRight}", "{ArrowRight}", "{Enter}"], 450);
    expectTieUntouched();
  });
});

describe("REP8-02 · D39-7: marcar con flechas exige guarda y acción del usuario en la fila", () => {
  it("foco llevado a la 6.9 por el Enter de la fila anterior: flecha y Enter no la resuelven", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [flourLine(), tieLine()] }));
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;

    await user.keyboard("{Enter}");
    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(1)).toHaveFocus());
    await burst(user, ["{ArrowRight}", "{ArrowRight}", "{Enter}"], 1000);

    expectTieUntouched();
  });

  it("tras actuar en la fila, la flecha dentro de la guarda no marca; pasada la guarda sí", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [flourLine(), tieLine()] }));
    now += 1000;
    // El usuario lleva el foco a L1 (clic en su texto leído).
    await user.click(within(row(1)).getByText("HARINA PAN 1KG"));
    expect(row(1)).toHaveFocus();

    now += 1000;
    await user.keyboard("{Enter}");
    now += 100;
    await user.keyboard("{ArrowRight}");
    expectTieUntouched();

    now += 1000;
    await user.keyboard("{ArrowRight}");
    const marked = within(row(1))
      .getAllByRole("button", { name: /CAOSG Jabon Azul 250g/ })
      .map((chip) => chip.getAttribute("data-marked"));
    expect(marked).toContain("true");
    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });
});

describe("REP8-02 · 6.17 solo con teclado sigue posible", () => {
  it("Enter, Tab a «Por unidad», Enter la elige (foco en la fila), Enter avanza, Enter acepta, Tab a Cargar, Enter", async () => {
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [priceLine(), flourLine()] }));
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;

    await burst(user, ["{Enter}", "{Tab}", "{Enter}"], 1000);
    await acknowledgeCostByKeyboard(user);
    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());

    now += 1000;
    await user.keyboard("{Enter}");
    await waitFor(() => expect(row(1)).toHaveFocus());
    now += 1000;
    await user.keyboard("{Enter}");
    expect(row(1)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(footer()).toHaveFocus());

    now += 1000;
    await user.keyboard("{Tab}");
    expect(loadButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });
});
