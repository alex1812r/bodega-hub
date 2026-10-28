import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

/**
 * REP14-03 (M-p15B-1, D64): el campo date nativo da `value=""` con una fecha imposible (31/02) o a
 * medias (dd/10/2026), con `validity.badInput`. La revisión lo trataba como «vacía = válida»: sin
 * aviso, Cargar habilitado y la compra se registraba sin la fecha leída. Ahora la entrada inválida
 * avisa junto al campo y bloquea Cargar; borrar la fecha leída pide confirmar registrar sin fecha.
 *
 * REP17-04 (M-p18Q-1, D69(a)): reloj falso; tras cambiar la fecha, la espera de la consulta de
 * duplicados se adelanta a mano en vez de confiar en el segundo real de waitFor.
 */

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({ data: id ? { id, name: "Chevere Depot" } : undefined, error: null, isPending: false }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanImages", () => ({
  useInvoiceScanImages: () => ({ error: null, isLoading: false, refetch: jest.fn(), urls: ["https://s/1.jpg"] }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: () => ({ purchaseId: null }),
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const BAD_INPUT_MESSAGE = /La fecha escrita no existe o está incompleta/;
const NO_DATE_CHECKBOX = /Registrar sin fecha/;

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

function renderPanel(date: string | null = "2026-10-17") {
  const onLoad = jest.fn();
  render(
    <InvoiceReviewPanel
      context={CONTEXT}
      duplicateFetcher={jest.fn(async () => [])}
      onDiscard={jest.fn()}
      onLoad={onLoad}
      onRescan={jest.fn()}
      response={makeReviewResponse({
        lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
        // `date: undefined` pisa la fecha por defecto del fixture (sin fecha leída).
        extraction: { date: date ?? undefined, total: 1750 },
      })}
    />,
  );
  return { onLoad };
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

/** Lo que hace Chromium con 31/02/2026 o dd/10/2026: `value=""` y `validity.badInput`. */
function typeBadDate(input: HTMLElement) {
  Object.defineProperty(input, "validity", { configurable: true, value: { badInput: true, valid: false } });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
}

function clearDate(input: HTMLElement) {
  Object.defineProperty(input, "validity", { configurable: true, value: { badInput: false, valid: true } });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
}

describe("InvoiceReviewPanel · fecha imposible o incompleta (REP14-03, M-p15B-1)", () => {
  it("31/02 (badInput): avisa junto al campo, el pie da el motivo y Cargar queda bloqueado", async () => {
    renderPanel();
    const date = screen.getByLabelText("Fecha");
    await waitFor(() => expect(loadButton()).toBeEnabled());

    typeBadDate(date);

    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(date).toHaveAccessibleDescription(BAD_INPUT_MESSAGE);
    expect(loadButton()).toBeDisabled();
    expect(within(screen.getByTestId("invoice-review-blockers")).getByText("Corrige la fecha de la factura.")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-review-compact-blockers")).toHaveTextContent("Falta: fecha");

    // Al corregirla vuelve a valer.
    clearDate(date);
    fireEvent.change(date, { target: { value: "2026-02-28" } });
    expect(date).not.toHaveAttribute("aria-invalid");
    await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);
    expect(loadButton()).toBeEnabled();
  });

  it("badInput sin evento input (de 31/02 a dd/02): se detecta al soltar la tecla o salir", async () => {
    renderPanel();
    const date = screen.getByLabelText("Fecha");
    await waitFor(() => expect(loadButton()).toBeEnabled());

    fireEvent.change(date, { target: { value: "" } });
    Object.defineProperty(date, "validity", { configurable: true, value: { badInput: true, valid: false } });
    fireEvent.keyUp(date, { key: "Backspace" });

    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(loadButton()).toBeDisabled();
  });

  it("borrar la fecha leída pide confirmar registrar sin fecha; marcada, Cargar se habilita", async () => {
    const { onLoad } = renderPanel();
    const date = screen.getByLabelText("Fecha");
    await waitFor(() => expect(loadButton()).toBeEnabled());

    clearDate(date);

    expect(date).not.toHaveAttribute("aria-invalid");
    expect(loadButton()).toBeDisabled();
    expect(
      within(screen.getByTestId("invoice-review-blockers")).getByText("Confirma que registras la factura sin fecha."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invoice-review-compact-blockers")).toHaveTextContent("Falta: fecha");
    const confirm = screen.getByRole("checkbox", { name: NO_DATE_CHECKBOX });
    expect(confirm).toHaveAccessibleName(/17\/10\/2026/);

    fireEvent.click(confirm);
    await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);
    expect(loadButton()).toBeEnabled();
    fireEvent.click(loadButton());
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].body.invoiceScanExtraction.date).toBeUndefined();

    // Volver a escribir una fecha retira la confirmación: si se borra otra vez, se vuelve a pedir.
    fireEvent.change(date, { target: { value: "2026-10-18" } });
    expect(screen.queryByRole("checkbox", { name: NO_DATE_CHECKBOX })).not.toBeInTheDocument();
    clearDate(date);
    expect(screen.getByRole("checkbox", { name: NO_DATE_CHECKBOX })).not.toBeChecked();
    expect(loadButton()).toBeDisabled();
  });

  it("sin fecha leída y el campo vacío no pide nada más", async () => {
    renderPanel(null);
    const date = screen.getByLabelText("Fecha");
    await waitFor(() => expect(loadButton()).toBeEnabled());
    expect(screen.queryByRole("checkbox", { name: NO_DATE_CHECKBOX })).not.toBeInTheDocument();

    fireEvent.change(date, { target: { value: "2026-10-17" } });
    clearDate(date);
    expect(screen.queryByRole("checkbox", { name: NO_DATE_CHECKBOX })).not.toBeInTheDocument();
    await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);
    expect(loadButton()).toBeEnabled();
  });
});
