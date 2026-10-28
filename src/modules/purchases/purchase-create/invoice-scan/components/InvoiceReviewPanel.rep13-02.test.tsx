import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

/**
 * REP13-02 (M-p14B-1, D60(b)): tecleando «17 10 26» en Fecha el campo queda en 0026-10-17. La
 * revisión lo valida con la misma regla que el servidor (`getInvoiceDateIssue`): avisa junto al
 * campo y Cargar no se habilita hasta corregirla o dejarla vacía.
 *
 * REP17-04 (M-p18Q-1, D69(a)): reloj falso; cambiar la fecha repite la consulta de duplicados y su
 * espera se adelanta a mano en vez de confiar en el segundo real de waitFor.
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
const RANGE_MESSAGE = "La fecha de la factura debe ser de un año entre 2000 y 2100. Corrígela o déjala vacía.";

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

function renderPanel() {
  render(
    <InvoiceReviewPanel
      context={CONTEXT}
      // Cambiar la fecha repite la consulta de duplicados: sin coincidencias.
      duplicateFetcher={jest.fn(async () => [])}
      onDiscard={jest.fn()}
      onLoad={jest.fn()}
      onRescan={jest.fn()}
      response={makeReviewResponse({
        // Exenta: 1 × 1.750 cuadra con el total leído (sin casilla de diferencia).
        lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
        extraction: { date: "2026-10-17", total: 1750 },
      })}
    />,
  );
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

async function duplicatesChecked() {
  await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);
  expect(screen.queryByText("Comprobando duplicados…")).not.toBeInTheDocument();
}

describe("InvoiceReviewPanel · fecha con año fuera de rango (REP13-02, M-p14B-1)", () => {
  it("0026-10-17: avisa junto al campo, el pie da el motivo y Cargar queda deshabilitado; al corregirla se habilita", async () => {
    renderPanel();
    const date = screen.getByLabelText("Fecha");
    await waitFor(() => expect(loadButton()).toBeEnabled());

    fireEvent.change(date, { target: { value: "0026-10-17" } });
    await duplicatesChecked();

    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(date).toHaveAccessibleDescription(RANGE_MESSAGE);
    expect(loadButton()).toBeDisabled();
    expect(within(screen.getByTestId("invoice-review-blockers")).getByText("Corrige la fecha de la factura.")).toBeInTheDocument();

    fireEvent.change(date, { target: { value: "2026-10-17" } });

    expect(date).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(RANGE_MESSAGE)).not.toBeInTheDocument();
    await duplicatesChecked();
    expect(loadButton()).toBeEnabled();
  });

  it("vaciarla vale: la fecha es opcional (REP14-03, D64: borrada la leída, se confirma registrar sin ella)", async () => {
    renderPanel();
    const date = screen.getByLabelText("Fecha");

    fireEvent.change(date, { target: { value: "0026-10-17" } });
    fireEvent.change(date, { target: { value: "" } });

    expect(date).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("checkbox", { name: /Registrar sin fecha/ }));
    await duplicatesChecked();
    expect(loadButton()).toBeEnabled();
  });
});
