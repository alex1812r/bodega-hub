/**
 * REP7-03 (C7-M2, C7-M3, D36) · modelo de foco de la revisión.
 * El foco nunca se mueve solo a un control que decide o destruye (opción «Por unidad /
 * Por caja», casilla de diferencia, «Descartar escaneo», «Cargar»): tras cualquier acción
 * va a la fila o al pie (contenedor). Enter sobre una fila con aviso solo lo resalta.
 * La guarda de 400 ms sigue, pero aquí el reloj avanza más que eso entre pulsaciones:
 * lo que impide la elección es el modelo de foco, no el tiempo.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { doubtfulLine, makeReviewResponse, productUuid, REVIEW_TAX_RATES, unmatchedLine } from "../reviewFixtures";
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
const PACK_ISSUE = "No hay empaque registrado de 6 unidades para este proveedor: confirma las unidades por empaque.";

const singleCandidate = (seed: number) => [
  { productId: productUuid(seed), name: `Producto ${seed}`, score: 1, reason: "nombre parecido · vinculado" },
];
/** 6.18: caja x6 con aviso de coherencia de precio. */
const priceLine = (seed = 2) =>
  doubtfulLine(seed, 1, {
    read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
    match: { entryMode: "pack", unitsPerPack: 6, candidates: singleCandidate(seed), issues: [PRICE_ISSUE] },
  });
const packLine = (seed = 2) =>
  doubtfulLine(seed, 1, {
    read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
    match: { entryMode: "pack", unitsPerPack: 6, candidates: singleCandidate(seed), issues: [PACK_ISSUE] },
  });
/** 6.16: dudosa con un único candidato de 1,00. */
const nameLine = (seed = 2) => doubtfulLine(seed, 1, { match: { candidates: singleCandidate(seed) } });

/** Controles que deciden o destruyen: el foco solo llega a ellos por el usuario. */
const DECIDING_SELECTOR = [
  "[data-choice]",
  "[data-load-button]",
  'input[type="checkbox"]',
  '[data-testid="invoice-review-discard-scan"]',
].join(", ");

let now = 1_000_000;
let dateNow: jest.SpyInstance;
let autoFocused: Element[] = [];
const recordFocus = (event: FocusEvent) => {
  if (event.target instanceof Element && event.target.matches(DECIDING_SELECTOR)) {
    autoFocused.push(event.target);
  }
};

beforeEach(() => {
  now = 1_000_000;
  dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
  autoFocused = [];
  document.addEventListener("focusin", recordFocus);
});

afterEach(() => {
  document.removeEventListener("focusin", recordFocus);
  dateNow.mockRestore();
  jest.restoreAllMocks();
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

const options = (index: number) => Array.from(row(index).querySelectorAll<HTMLElement>("[data-choice]"));
const loadButton = () => screen.getByRole("button", { name: "Cargar en la compra" });
const footer = () => screen.getByRole("contentinfo", { name: "Resumen de la revisión" });
const differenceBox = () => screen.getByRole("checkbox", { name: /Cargar con una diferencia de/ });

/** Escritorio: lo que lleva `sm:hidden` (o está dentro) no tiene cajas; el resto sí (jsdom no mide). */
const desktopLayout = () =>
  jest.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return { length: this.closest(".sm\\:hidden") === null ? 1 : 0 } as unknown as DOMRectList;
  });

type User = ReturnType<typeof userEvent.setup>;

/** Pulsaciones (cada una con su keyup) separadas `gap` ms, como el script de caos. */
async function burst(user: User, keys: string[], gap: number) {
  for (const [position, key] of keys.entries()) {
    if (position > 0) {
      now += gap;
    }
    await user.keyboard(key);
  }
}

describe("REP7-03 · C7-M2: Enter sobre la fila 6.18 no elige «Por unidad»", () => {
  it.each([100, 1000])("tap: 6 Enter distintos a %i ms sobre la fila: sigue dudosa y el foco no sale de la fila", async (gap) => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), priceLine()] }));
    now += 1000;
    row(1).focus();

    await burst(user, Array.from({ length: 6 }, () => "{Enter}"), gap);

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
    expect(options(1).map((option) => option.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(row(1)).toHaveFocus();
    expect(autoFocused).toEqual([]);
  });

  it("kbdburst2: Enter, Espacio ×3, Enter, Enter, Espacio, Enter a 60 ms: sigue dudosa", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), priceLine()] }));
    now += 1000;
    row(1).focus();

    await burst(user, ["{Enter}", " ", " ", " ", "{Enter}", "{Enter}", " ", "{Enter}"], 60);

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
    expect(options(1).map((option) => option.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(autoFocused).toEqual([]);
  });

  it("walk: Enter y a 450 ms otro Enter (y otro a 900 ms): no elige", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), priceLine()] }));
    now += 1000;
    row(1).focus();

    await burst(user, ["{Enter}", "{Enter}", "{Enter}"], 450);

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
    expect(row(1)).toHaveFocus();
    expect(autoFocused).toEqual([]);
  });

  it("holdrow: Enter mantenido sobre la fila 6.18 (50 repeticiones): el foco no va a la opción", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), priceLine()] }));
    now += 1000;
    row(1).focus();

    await user.keyboard("{Enter>}");
    for (let step = 0; step < 50; step += 1) {
      now += 33;
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter", repeat: true });
    }
    await user.keyboard("{/Enter}");

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
    expect(row(1)).toHaveFocus();
    expect(autoFocused).toEqual([]);
  });

  it.each([
    ["precio", priceLine, PRICE_ISSUE],
    ["tamaño de empaque", packLine, PACK_ISSUE],
  ])("Enter sobre la fila con aviso de %s solo resalta y anuncia el aviso", async (_, line, issue) => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [line(), nameLine(3)] }));
    await waitFor(() => expect(row(0)).toHaveFocus());
    const notices = within(row(0)).getByTestId("invoice-review-line-notices");
    expect(notices).not.toHaveAttribute("data-highlighted");
    expect(row(0)).toHaveAttribute("aria-describedby", notices.id);
    expect(notices).toHaveTextContent(issue);

    now += 1000;
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(row(0)).toHaveFocus();
    expect(notices).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByTestId("invoice-review-announcement")).toHaveTextContent(
      "Línea 1: Elige cómo viene: Por unidad o Por caja.",
    );
    expect(autoFocused).toEqual([]);
  });

  it("clic en el chip de una línea con aviso: el producto queda elegido y el foco va a la fila, no a la opción", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [priceLine(), nameLine(3)] }));
    now += 1000;

    await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    await waitFor(() => expect(row(0)).toHaveFocus());
    expect(within(row(0)).getByTestId("invoice-review-line-notices")).toHaveAttribute("data-highlighted", "true");
    expect(autoFocused).toEqual([]);
  });
});

describe("REP7-03 · 6.17 solo con teclado sigue posible", () => {
  it("Enter, Tab a «Por unidad», flecha a «Por caja» (sin elegirla), Enter la elige, Enter avanza, Enter en la siguiente, Tab a Cargar, Enter", async () => {
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [priceLine(), nameLine(3)] }));
    await waitFor(() => expect(row(0)).toHaveFocus());
    const [perUnit, perPack] = options(0);

    now += 1000;
    await user.keyboard("{Enter}");
    expect(row(0)).toHaveFocus();
    now += 1000;
    await user.keyboard("{Tab}");
    expect(perUnit).toHaveFocus();
    expect(perUnit).toHaveAttribute("aria-pressed", "false");
    now += 1000;
    await user.keyboard("{ArrowRight}");
    // D39-5: la flecha solo mueve el foco; Enter sobre la opción la elige.
    expect(perPack).toHaveFocus();
    expect(perPack).toHaveAttribute("aria-pressed", "false");
    now += 1000;
    await user.keyboard("{Enter}");

    expect(perPack).toHaveAttribute("aria-pressed", "true");
    expect(row(0)).toHaveAttribute("data-status", "resolved");
    // D39-6: el foco queda en la fila resuelta; Enter sobre ella avanza a la siguiente.
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;
    await user.keyboard("{Enter}");
    await waitFor(() => expect(row(1)).toHaveFocus());

    now += 1000;
    await user.keyboard("{Enter}");
    expect(row(1)).toHaveAttribute("data-status", "resolved");
    // Sin pendientes: el foco va al pie (contenedor), no a Cargar.
    await waitFor(() => expect(footer()).toHaveFocus());
    expect(loadButton()).toBeEnabled();

    now += 1000;
    await user.keyboard("{Tab}");
    expect(loadButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });

  it.each(["{Enter}", " "])("Tab a «Por unidad» y %s sobre ella la elige", async (key) => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [priceLine(), nameLine(3)] }));
    await waitFor(() => expect(row(0)).toHaveFocus());

    now += 1000;
    await user.keyboard("{Enter}");
    now += 1000;
    await user.keyboard("{Tab}");
    now += 1000;
    await user.keyboard(key);

    expect(options(0)[0]).toHaveAttribute("aria-pressed", "true");
    expect(row(0)).toHaveAttribute("data-status", "resolved");
    // D39-6: el foco no avanza solo a la siguiente fila.
    await waitFor(() => expect(row(0)).toHaveFocus());
  });

  it("20 líneas (15 confirmadas): Enter por fila y, al terminar, Tab lleva a Cargar", async () => {
    const user = userEvent.setup();
    const lines = [...Array.from({ length: 15 }, () => ({})), ...Array.from({ length: 5 }, (_, at) => doubtfulLine(16 + at))];
    const props = renderPanel(makeReviewResponse({ lines }));

    for (let step = 0; step < 5; step += 1) {
      await waitFor(() => expect(document.activeElement?.getAttribute("data-status")).toBe("pending_doubtful"));
      now += 1000;
      await user.keyboard("{Enter}");
    }

    await waitFor(() => expect(footer()).toHaveFocus());
    now += 1000;
    await user.keyboard("{Tab}");
    expect(loadButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.onLoad).toHaveBeenCalledTimes(1);
    expect(autoFocused).toEqual([loadButton()]);
  });

  it("Espacio sobre el pie enfocado no desplaza la página", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [{}, nameLine()] }));
    now += 1000;
    await user.click(within(row(1)).getByRole("button", { name: /Producto 2/ }));
    // D41-c: el chip deja el foco en su fila; Enter sobre la resuelta lleva al pie (D39-6).
    await waitFor(() => expect(row(1)).toHaveFocus());
    now += 1000;
    await user.keyboard("{Enter}");
    await waitFor(() => expect(footer()).toHaveFocus());

    expect(fireEvent.keyDown(footer(), { key: " " })).toBe(false);
  });
});

describe("REP7-03 · C7-M3: un rebote sobre el pie no descarta el escaneo ni marca la diferencia", () => {
  it("discusd-enter2: Enter en la fila (factura en $) y Enter a 90 ms: no descarta; el foco queda en el pie", async () => {
    desktopLayout();
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [{}], extraction: { currency: "USD", total: 232 } }));
    await waitFor(() => expect(row(0)).toHaveFocus());

    now += 1000;
    await burst(user, ["{Enter}", "{Enter}"], 90);
    now += 1000;
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(props.onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(footer()).toHaveFocus();
    expect(autoFocused).toEqual([]);
  });

  it.each([
    ["chipspace2: Espacio en el chip", (user: User) => user.keyboard(" "), true],
    ["enterspace: Enter en la fila", (user: User) => user.keyboard("{Enter}"), false],
  ])("%s y Espacio a 80 ms: la casilla de diferencia sigue sin marcar", async (_, first, onChip) => {
    desktopLayout();
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [nameLine()], extraction: { total: 1000 } }));
    await waitFor(() => expect(row(0)).toHaveFocus());
    if (onChip) {
      within(row(0)).getByRole("button", { name: /Producto 2/ }).focus();
    }

    now += 1000;
    await first(user);
    now += 80;
    await user.keyboard(" ");

    expect(differenceBox()).not.toBeChecked();
    expect(loadButton()).toBeDisabled();
    expect(row(0)).toHaveAttribute("data-status", "resolved");
    // D41-c: el chip deja el foco en su fila (D39-6); Enter en la fila lleva al pie.
    expect(onChip ? row(0) : footer()).toHaveFocus();
    expect(autoFocused).toEqual([]);
  });

  it("la casilla cambia con su propia activación (Tab hasta ella y Espacio)", async () => {
    desktopLayout();
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [nameLine()], extraction: { total: 1000 } }));
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;
    await user.keyboard("{Enter}");
    await waitFor(() => expect(footer()).toHaveFocus());

    // Cargar está deshabilitado: Tab pasa por los botones del pie (jsdom no oculta «Ver detalle»)
    // hasta la casilla, sin cambiarla.
    for (let presses = 0; presses < 4 && document.activeElement !== differenceBox(); presses += 1) {
      await user.keyboard("{Tab}");
    }
    expect(differenceBox()).toHaveFocus();
    expect(differenceBox()).not.toBeChecked();
    now += 1000;
    await user.keyboard(" ");
    expect(differenceBox()).toBeChecked();
    expect(loadButton()).toBeEnabled();
  });

  it("«Descartar escaneo» pide confirmación; al cancelar vuelve el foco al botón y no descarta", async () => {
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [nameLine()] }));
    const discardScan = screen.getByRole("button", { name: "Descartar escaneo" });
    now += 1000;

    await user.click(discardScan);
    const dialog = await screen.findByRole("dialog", { name: "¿Descartar el escaneo?" });
    expect(props.onDiscard).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Seguir revisando" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(discardScan).toHaveFocus());
    expect(props.onDiscard).not.toHaveBeenCalled();

    now += 1000;
    await user.click(discardScan);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar escaneo" }),
    );
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("Enter-Enter sobre «Descartar escaneo»: el 2.º Enter cae en «Seguir revisando», no descarta", async () => {
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [nameLine()] }));
    const discardScan = screen.getByRole("button", { name: "Descartar escaneo" });
    now += 1000;
    discardScan.focus();

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Seguir revisando" })).toHaveFocus());
    now += 90;
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(props.onDiscard).not.toHaveBeenCalled();
  });
});

describe("REP7-03 · regresiones C6-M1 / C5-M1 con el modelo de foco nuevo", () => {
  const discardButton = (index: number) => within(row(index)).getByRole("button", { name: "Descartar línea" });

  it("holddisc: Enter mantenido (50 repeticiones) desde «Descartar línea»: la 6.18 sigue dudosa, el foco en su fila", async () => {
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), priceLine()] }));
    discardButton(0).focus();

    await user.keyboard("{Enter>}");
    await waitFor(() => expect(row(1)).toHaveFocus());
    for (let step = 0; step < 50; step += 1) {
      now += step === 0 ? 500 : 33;
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter", repeat: true });
    }
    await user.keyboard("{/Enter}");

    expect(row(0)).toHaveAttribute("data-status", "discarded");
    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
    expect(row(1)).toHaveFocus();
    expect(props.onLoad).not.toHaveBeenCalled();
    expect(autoFocused).toEqual([]);
  });

  it.each([380, 420, 450, 490])("dbl a %i ms tras «Descartar línea»: el 2.º clic no acepta el chip de la siguiente", async (gap) => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));

    await user.click(discardButton(0));
    now += gap;
    fireEvent.click(within(row(1)).getByRole("button", { name: /Producto 2/ }), { detail: 2 });

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
  });

  it.each([
    ["6.16", nameLine],
    ["6.18", priceLine],
  ])("C5-M1 (%s): Enter ×2 sobre «Descartar línea»: la siguiente queda dudosa con el foco en su fila", async (_, line) => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), line()] }));
    discardButton(0).focus();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(row(1)).toHaveFocus());
    now += 30;
    await user.keyboard("{Enter}");

    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
    expect(row(1)).toHaveFocus();
    expect(autoFocused).toEqual([]);
  });
});
