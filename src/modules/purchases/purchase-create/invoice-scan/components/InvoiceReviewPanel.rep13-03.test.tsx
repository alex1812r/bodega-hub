/**
 * REP13-03 · B-p14B-1 (D60(c)): p14-ivaedit, 2 × harina a 522 con IVA 16 % (subtotal 900, IVA 144, total
 * 1.044). El aviso sugiere «incluyen IVA»; el usuario lo elige y corrige el costo de L0 a 450. El motivo
 * se recalcula con los costos actuales: ya no afirma que la suma da el total leído (da 972).
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({ data: id ? { id, name: "Distribuidora Caos Global" } : undefined, error: null, isPending: false }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanImages", () => ({
  useInvoiceScanImages: () => ({ error: null, isLoading: false, refetch: jest.fn(), urls: ["https://s/1.jpg"] }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: () => ({ purchaseId: null }),
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

const harina = { read: { quantity: 1, unitPrice: 522, lineTotal: 522 } };

function renderIvaEdit() {
  render(
    <InvoiceReviewPanel
      context={CONTEXT}
      duplicateFetcher={jest.fn(async () => [])}
      onDiscard={jest.fn()}
      onLoad={jest.fn()}
      onRescan={jest.fn()}
      response={makeReviewResponse({ lines: [harina, harina], extraction: { subtotal: 900, tax: 144, total: 1044 } })}
    />,
  );
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila ${index}`);
  }
  return element;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("REP13-03 · motivo del aviso de IVA con los costos actuales (B-p14B-1)", () => {
  it("elegido «incluyen IVA» y corregido un costo, el aviso no afirma un cuadre que ya no existe", async () => {
    const user = userEvent.setup();
    renderIvaEdit();
    await user.click(screen.getByRole("button", { name: /confirmadas · ver/ }));
    const notice = screen.getByTestId("invoice-review-tax-notice");
    expect(notice).toHaveTextContent("la suma de las líneas da el total leído (Bs. 1.044,00), no el subtotal (Bs. 900,00)");

    await user.click(screen.getByRole("radio", { name: "Los precios incluyen IVA (cargar sin IVA)" }));
    const cost = within(row(0)).getByLabelText("Costo (Bs, con IVA)");
    await user.clear(cost);
    await user.type(cost, "450");

    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent("Total a registrar Bs. 972,00");
    expect(notice).not.toHaveTextContent(/la suma de las líneas da/);
    expect(notice).not.toHaveTextContent(/1\.044,00/);
    expect(notice).toHaveTextContent(
      "Indicaste que los precios incluyen IVA. Con los costos actuales la suma de las líneas ya no lo indica: revisa la elección con la factura.",
    );
    expect(screen.getByRole("radio", { name: "Los precios incluyen IVA (cargar sin IVA)" })).toHaveAttribute("aria-checked", "true");
  });

  it("elegido «no incluyen IVA» con la sugerencia ya caída, tampoco dice que los precios parecen incluirlo", async () => {
    const user = userEvent.setup();
    renderIvaEdit();
    await user.click(screen.getByRole("button", { name: /confirmadas · ver/ }));

    await user.click(screen.getByRole("radio", { name: "Los precios no incluyen IVA" }));
    for (const index of [0, 1]) {
      const cost = within(row(index)).getByLabelText("Costo (Bs, sin IVA)");
      await user.clear(cost);
      await user.type(cost, "450");
    }

    const notice = screen.getByTestId("invoice-review-tax-notice");
    expect(notice).not.toHaveTextContent(/parecen incluir IVA/);
    expect(notice).toHaveTextContent(
      "Indicaste que los precios no incluyen IVA. Con los costos actuales la suma de las líneas ya no indica que lo incluyan: revisa la elección con la factura.",
    );
  });
});
