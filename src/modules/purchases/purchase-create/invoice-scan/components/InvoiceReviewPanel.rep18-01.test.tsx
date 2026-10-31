import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import type { InvoiceDuplicateMatch, InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";

import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";
import { FIXTURES, SEARCH_PRODUCTS } from "./InvoiceReviewPanel.rep16-02.fixtures";
import { COMPACTION_GUARD_MS } from "./useLayoutHold";

/**
 * REP18-01 · D75(a)(b) (M-p19B-1): un control que APARECE o SE HABILITA por una llegada asíncrona (sin turno del usuario)
 * ignora durante 1 s las activaciones con el puntero, con un único mecanismo para todo el panel (filas, pie, la lista
 * flotante del buscador); el teclado no se bloquea, y lo que aparece en el turno del usuario es suyo. D75(b): el aviso
 * «Esperando la tasa del día…» no está en el sitio donde aparecerán las opciones.
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

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** Deja pasar el turno de la última acción del usuario y la consulta de duplicados. */
const QUIET_MS = INVOICE_DUPLICATES_DEBOUNCE_MS + COMPACTION_GUARD_MS;

function props(response: InvoiceScanResponse, overrides: Partial<InvoiceReviewPanelProps> = {}) {
  return {
    context: { taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: jest.fn(async () => []),
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
    ...overrides,
  } satisfies InvoiceReviewPanelProps;
}

let touchPoint = 0;

/** Toque real (punto de pantalla y `detail` 1), cada vez en otro punto: solo cuenta la guarda de lo aparecido. */
function touch(element: Element) {
  touchPoint += 1;
  const point = { clientX: 40 + touchPoint * 100, clientY: 60, detail: 1 };
  fireEvent.pointerDown(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseDown(element, point);
  fireEvent.pointerUp(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseUp(element, point);
  fireEvent.click(element, point);
}

function row(index: number) {
  const line = document.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!line) {
    throw new Error(`Sin la fila ${index}`);
  }
  return line;
}

function perUnit(index: number) {
  return within(row(index)).getByRole("button", { name: /Por unidad/ });
}

/** `tasa3` (M-p19B-1): L1 reserva sus opciones con «Esperando la tasa del día…»; llega la del día y se desvía. */
async function rateArrives() {
  const base = props(FIXTURES.tasa3.response);
  const view = render(<InvoiceReviewPanel {...base} />);
  await advance(QUIET_MS);
  view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);
  return { base, view };
}

describe("REP18-01 · D75(a) · lo que aparece por una llegada no actúa con el puntero durante 1 s", () => {
  it("fila: «Por unidad» que aparece al llegar la tasa no se elige con el toque; pasado 1 s, sí", async () => {
    await rateArrives();

    touch(perUnit(1));
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "false");

    await advance(COMPACTION_GUARD_MS);
    touch(perUnit(1));
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "true");
  });

  it("fila: el teclado no se bloquea (Enter sobre la opción recién aparecida la elige)", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
    await rateArrives();

    act(() => perUnit(1).focus());
    await user.keyboard("{Enter}");
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "true");
  });

  it("en el turno del usuario lo que aparece es suyo: no se guarda", async () => {
    const base = props(FIXTURES.tasa3.response);
    const view = render(<InvoiceReviewPanel {...base} />);
    await advance(QUIET_MS);

    // Una tecla abre el turno del usuario (USER_TURN_MS): lo que cambie en él no es una llegada.
    fireEvent.keyDown(row(1), { key: "Shift" });
    view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);

    touch(perUnit(1));
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "true");
  });

  it("pie: «Cargar en la compra» que se habilita al acabar la consulta de duplicados no carga con el toque; pasado 1 s, sí", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
    let answer: (matches: InvoiceDuplicateMatch[]) => void = () => undefined;
    const duplicateFetcher = jest.fn(
      () =>
        new Promise<InvoiceDuplicateMatch[]>((resolve) => {
          answer = resolve;
        }),
    );
    const base = props(makeReviewResponse({ lines: [{ match: { taxRateCode: "exento" } }], extraction: { total: 200 } }), {
      context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
      duplicateFetcher,
    });
    render(<InvoiceReviewPanel {...base} />);
    // Otro número: la consulta de duplicados de la lectura ya está respondida; la del número nuevo, no.
    await user.type(screen.getByLabelText("Número de factura"), "4");
    await advance(QUIET_MS);
    const load = screen.getByRole("button", { name: "Cargar en la compra" });
    expect(load).toBeDisabled();

    await act(async () => answer([]));
    expect(load).toBeEnabled();
    touch(load);
    expect(base.onLoad).not.toHaveBeenCalled();

    await advance(COMPACTION_GUARD_MS);
    touch(load);
    expect(base.onLoad).toHaveBeenCalledTimes(1);
  });

  it("lista flotante: la opción del buscador que llega sobre «Buscando...» no se elige con el toque", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
    // Cada consulta del buscador (la del texto leído y las de sus palabras) espera a que llegue la respuesta.
    let answer: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const productFetcher: EntityFetcher<"product"> = async () => {
      await arrived;
      return SEARCH_PRODUCTS;
    };
    render(
      <InvoiceReviewPanel
        {...props(FIXTURES.estados.response, { context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES }, productFetcher })}
      />,
    );
    await advance(QUIET_MS);
    await user.click(within(row(3)).getByRole("button", { name: /Buscar producto/ }));
    await advance(QUIET_MS);
    expect(screen.getByText("Buscando...")).toBeInTheDocument();

    await act(async () => answer());
    const option = screen.getByRole("option", { name: /Arroz Mary 1kg/ });
    touch(option);

    expect(screen.getByRole("option", { name: /Arroz Mary 1kg/ })).toBeInTheDocument();
    expect(row(3)).toHaveAttribute("data-status", "pending_unmatched");
  });
});

/** Selector con que `useLayoutHold` comprueba si cada control es accionable: cuenta los controles medidos. */
const ACTIONABLE_PROBE = "[inert], [aria-hidden='true']";

/** Cuántos controles mide la guarda de llegadas mientras corre `body`. */
async function measuredDuring(body: () => Promise<void> | void) {
  const closest = jest.spyOn(Element.prototype, "closest");
  try {
    await body();
    return closest.mock.calls.filter(([selector]) => selector === ACTIONABLE_PROBE).length;
  } finally {
    closest.mockRestore();
  }
}

describe("REP18-01b · la guarda de llegadas solo mide lo que puede traer un control, fuera del turno del usuario", () => {
  it("al teclear no mide en cada tecla; al acabar el turno mide la base y la tasa que llega después se guarda", async () => {
    const base = props(FIXTURES.tasa3.response);
    const view = render(<InvoiceReviewPanel {...base} />);
    await advance(QUIET_MS);
    const field = screen.getByLabelText<HTMLInputElement>("Número de factura");

    const typing = await measuredDuring(() => {
      // Cada tecla escrita (el evento `change` de React) abre o alarga el turno del usuario.
      for (const digit of "4567") {
        fireEvent.change(field, { target: { value: `${field.value}${digit}` } });
      }
    });
    expect(typing).toBe(0);
    expect(await measuredDuring(() => advance(QUIET_MS))).toBeGreaterThan(0);

    // La llegada se mide en su microtarea (en el navegador, antes del siguiente evento).
    await act(async () => {
      view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);
    });
    touch(perUnit(1));
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "false");
  });

  it("no mide por cambios fuera del panel y de sus listas flotantes, ni por atributos que no traen un control", async () => {
    render(
      <div>
        <button type="button">Fuera del panel</button>
        <InvoiceReviewPanel {...props(FIXTURES.tasa3.response)} />
      </div>,
    );
    await advance(QUIET_MS);
    const outside = screen.getByRole("button", { name: "Fuera del panel" });

    const unrelated = await measuredDuring(() =>
      act(async () => {
        outside.setAttribute("disabled", "");
        outside.className = "otra";
        row(1).setAttribute("data-rep18-01b", "1");
        row(1).setAttribute("aria-busy", "true");
      }),
    );
    expect(unrelated).toBe(0);
    const inPanel = await measuredDuring(() =>
      act(async () => {
        row(1).classList.add("rep18-01b");
      }),
    );
    expect(inPanel).toBeGreaterThan(0);
  });
});

describe("REP18-01 · D75(b) · el aviso de la tasa pendiente no está donde aparecerán las opciones", () => {
  it("«Esperando la tasa del día…» va fuera de la reserva de opciones, en la franja de avisos de la fila", async () => {
    render(<InvoiceReviewPanel {...props(FIXTURES.tasa3.response)} />);
    await advance(QUIET_MS);

    const reserve = within(row(1)).getByTestId("invoice-review-options-reserve");
    expect(reserve).not.toHaveTextContent("Esperando la tasa del día…");
    expect(within(row(1)).getByTestId("invoice-review-line-notices")).toHaveTextContent("Esperando la tasa del día…");
  });
});
