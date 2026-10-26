import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

/**
 * REP13-06 (QA REP13-05): pie compacto de la revisión en móvil (detalle plegado).
 * - B-qa05-1: con la fecha inválida, el pie compacto dice por qué Cargar está deshabilitado
 *   (a 1280 se ve en el detalle; a 390 solo quedaba arriba, junto al campo, fuera de la vista).
 * - B-qa05-2: al marcar la casilla del duplicado, el alto reservado de la línea del total no
 *   cambia (Cargar subía 32 px).
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
// Exenta: 1 × 1.750 cuadra con el total leído (sin casilla de diferencia).
const EXEMPT_LINE = { read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } };

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

describe("InvoiceReviewPanel · pie compacto (REP13-06)", () => {
  it("B-qa05-1: con la fecha 0026-10-17, el pie compacto nombra la fecha entre los motivos (REP13-06b)", async () => {
    render(
      <InvoiceReviewPanel
        context={CONTEXT}
        duplicateFetcher={jest.fn(async () => [])}
        onDiscard={jest.fn()}
        onLoad={jest.fn()}
        onRescan={jest.fn()}
        response={makeReviewResponse({ lines: [EXEMPT_LINE], extraction: { date: "2026-10-17", total: 1750 } })}
      />,
    );
    const compact = screen.getByTestId("invoice-review-compact-blockers");
    await waitFor(() => expect(loadButton()).toBeEnabled());
    expect(compact).not.toHaveTextContent(/fecha/);

    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "0026-10-17" } });

    await waitFor(() => expect(loadButton()).toBeDisabled());
    expect(compact).toHaveTextContent("Falta: fecha");
    expect(compact).toHaveClass("sm:hidden");

    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-10-17" } });
    await waitFor(() => expect(compact).not.toHaveTextContent(/fecha/));
  });

  it("B-qa05-2: marcar la casilla del duplicado no cambia el alto reservado de la línea del total (Cargar no se mueve)", async () => {
    const user = userEvent.setup();
    render(
      <InvoiceReviewPanel
        context={CONTEXT}
        duplicateFetcher={jest.fn(async () => [{ scanId: "scan-anterior", purchaseId: null, number: "000123", date: null }])}
        onDiscard={jest.fn()}
        onLoad={jest.fn()}
        onRescan={jest.fn()}
        response={makeReviewResponse({
          lines: [EXEMPT_LINE],
          extraction: { total: 1750 },
          matched: { duplicateOfScanId: "scan-anterior" },
        })}
      />,
    );
    const compact = screen.getByTestId("invoice-review-totals");
    await waitFor(() => expect(screen.queryByText("Comprobando duplicados…")).not.toBeInTheDocument());
    expect(loadButton()).toBeDisabled();
    const reservedBefore = compact.className;
    const compactBefore = screen.getByTestId("invoice-review-compact-blockers").className;

    await user.click(screen.getByRole("checkbox", { name: /cargarla igual/i }));

    expect(loadButton()).toBeEnabled();
    expect(compact.className).toBe(reservedBefore);
    expect(screen.getByTestId("invoice-review-compact-blockers").className).toBe(compactBefore);
  });
});
