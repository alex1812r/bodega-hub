import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceDuplicateMatch } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

/**
 * REP13-06b: en móvil (detalle plegado) el pie compacto nombra, en una línea breve, TODOS los
 * motivos que bloquean Cargar (líneas pendientes, proveedor, tasa, dólares, fecha, duplicado,
 * diferencia) y su sitio está reservado: no cambia de alto al aparecer o resolverse un motivo.
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
const EXEMPT_LINE = { read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } };
const DUPLICATE: InvoiceDuplicateMatch = { scanId: "scan-anterior", purchaseId: null, number: "000123", date: null };

function renderPanel(overrides: Partial<InvoiceReviewPanelProps>) {
  render(
    <InvoiceReviewPanel
      context={CONTEXT}
      duplicateFetcher={jest.fn(async () => [])}
      onDiscard={jest.fn()}
      onLoad={jest.fn()}
      onRescan={jest.fn()}
      response={makeReviewResponse({ lines: [EXEMPT_LINE], extraction: { total: 1750 } })}
      {...overrides}
    />,
  );
}

function compact() {
  return screen.getByTestId("invoice-review-compact-blockers");
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

async function duplicatesChecked() {
  await waitFor(() => expect(screen.queryByText("Comprobando duplicados…")).not.toBeInTheDocument());
}

describe("InvoiceReviewPanel · el pie compacto nombra todos los motivos de bloqueo (REP13-06b)", () => {
  it("líneas pendientes, proveedor y tasa", async () => {
    renderPanel({
      context: { taxRates: REVIEW_TAX_RATES },
      response: makeReviewResponse({
        lines: [{ match: { candidates: undefined, productId: undefined, status: "unmatched" } }],
        matched: { supplier: {} },
      }),
    });
    await duplicatesChecked();

    expect(loadButton()).toBeDisabled();
    expect(compact()).toHaveClass("sm:hidden");
    expect(compact()).toHaveTextContent("Falta: 1 pendiente · proveedor · tasa");
  });

  it("dólares", async () => {
    renderPanel({ response: makeReviewResponse({ lines: [EXEMPT_LINE], extraction: { currency: "USD", total: 1750 } }) });
    await duplicatesChecked();

    expect(compact()).toHaveTextContent(/dólares/);
  });

  it("fecha, duplicado y diferencia; el duplicado lleva a su casilla", async () => {
    const user = userEvent.setup();
    renderPanel({
      duplicateFetcher: jest.fn(async () => [DUPLICATE]),
      response: makeReviewResponse({
        lines: [EXEMPT_LINE],
        extraction: { date: "2026-10-17", total: 2000 },
        matched: { duplicateOfScanId: "scan-anterior" },
      }),
    });
    await duplicatesChecked();
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "0026-10-17" } });
    await duplicatesChecked();

    expect(compact()).toHaveTextContent("Falta: fecha · duplicado · diferencia");
    await user.click(within(compact()).getByRole("button", { name: /Marca el aviso de factura duplicada/ }));
    expect(screen.getByRole("checkbox", { name: /cargarla igual/i })).toHaveFocus();
  });

  it("alto reservado: resolver los motivos no cambia la línea compacta ni la del total (Cargar no se mueve)", async () => {
    const user = userEvent.setup();
    renderPanel({
      duplicateFetcher: jest.fn(async () => [DUPLICATE]),
      response: makeReviewResponse({
        lines: [EXEMPT_LINE],
        extraction: { total: 2000 },
        matched: { duplicateOfScanId: "scan-anterior" },
      }),
    });
    await duplicatesChecked();
    const totals = screen.getByTestId("invoice-review-totals");
    const before = { compact: compact().className, totals: totals.className };
    expect(before.compact).toMatch(/\bh-8\b/);

    await user.click(screen.getByRole("checkbox", { name: /cargarla igual/i }));
    expect(compact()).toHaveTextContent("Falta: diferencia");
    await user.click(screen.getByRole("checkbox", { name: /Cargar con una diferencia/ }));

    expect(loadButton()).toBeEnabled();
    expect(compact()).toHaveTextContent("Lista para cargar.");
    expect({ compact: compact().className, totals: totals.className }).toEqual(before);
  });

  it("con el detalle abierto los motivos se dicen una vez, en el detalle", async () => {
    const user = userEvent.setup();
    renderPanel({ response: makeReviewResponse({ lines: [{}] }) });
    await duplicatesChecked();

    await user.click(screen.getByRole("button", { name: "Ver detalle del total" }));
    expect(screen.queryByTestId("invoice-review-compact-blockers")).not.toBeInTheDocument();
  });
});
