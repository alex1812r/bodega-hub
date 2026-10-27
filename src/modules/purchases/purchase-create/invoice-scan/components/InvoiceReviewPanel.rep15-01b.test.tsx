import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceDuplicateMatch, InvoiceDuplicateQuery } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

/**
 * REP15-01b · B-p16Q-1: el aviso de duplicado dice el criterio con que casó la consulta, la de los valores EFECTIVOS de
 * la cabecera (número tecleado), no los leídos. D65(a): el aviso va tras las líneas (aparecer o irse no mueve la
 * cabecera ni las filas) y el de tasa, mientras la del día no llega, reserva el alto de cuando llegue con cajas cuyo
 * texto no es del documento.
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

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

/** Sin número leído: la consulta inicial va por proveedor, fecha y total. */
function noNumberResponse() {
  return makeReviewResponse({
    lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
    extraction: { number: undefined, date: "2026-09-03", total: 1750 },
  });
}

const MATCH: InvoiceDuplicateMatch = {
  date: "2026-09-03",
  number: "00362952",
  purchaseId: null,
  scanId: "00000000-0000-4000-8000-0000000000d1",
};

function renderPanel(overrides: Partial<InvoiceReviewPanelProps> = {}) {
  const props: InvoiceReviewPanelProps = {
    context: CONTEXT,
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response: noNumberResponse(),
    ...overrides,
  };
  return render(<InvoiceReviewPanel {...props} />);
}

describe("REP15-01b · aviso de duplicado y sitios reservados", () => {
  it("B-p16Q-1: con el número tecleado (sin número leído) el aviso dice «mismo proveedor y número igual o casi igual»", async () => {
    const user = userEvent.setup();
    const duplicateFetcher = jest.fn(async (query: InvoiceDuplicateQuery) => (query.number ? [MATCH] : []));
    renderPanel({ duplicateFetcher });

    await user.type(screen.getByRole("textbox", { name: "Número de factura" }), "00362952");

    expect(
      await screen.findByText(/Esta factura \(mismo proveedor y número igual o casi igual\) ya se escaneó antes/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mismo proveedor, fecha y total/)).not.toBeInTheDocument();
  });

  it("D65(a): el aviso de duplicado va tras las líneas, fuera de la cabecera", async () => {
    const duplicateFetcher = jest.fn(async () => [MATCH]);
    renderPanel({ duplicateFetcher });

    const notice = await screen.findByText(/ya se escaneó antes en la tienda/);
    const lines = screen.getByRole("region", { name: "Líneas de la factura" });
    expect(screen.getByRole("region", { name: "Datos de la factura" })).not.toContainElement(notice);
    expect(lines.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lines).not.toContainElement(notice);
  });

  it("D65(a): sin tasa del día, el aviso de tasa reserva también el alto de cuando llegue", () => {
    const response = makeReviewResponse({
      extraction: { printedRate: 895 },
      lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
    });
    const { container, rerender } = renderPanel({
      context: { taxRates: REVIEW_TAX_RATES },
      duplicateFetcher: jest.fn(async () => []),
      response,
    });
    const reserves = () => [...container.querySelectorAll('[data-layout-notice] > [data-layout-reserve]')].filter(
      (reserve) => !reserve.closest('section[aria-label="Datos de la factura"]'),
    );

    expect(reserves().length).toBeGreaterThan(0);
    expect(reserves().every((reserve) => reserve.textContent === "")).toBe(true);
    expect(screen.getByText(/No hay tasa del día/)).toBeInTheDocument();

    rerender(
      <InvoiceReviewPanel
        context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }}
        duplicateFetcher={jest.fn(async () => [])}
        onDiscard={jest.fn()}
        onLoad={jest.fn()}
        onRescan={jest.fn()}
        response={response}
      />,
    );

    // Llegada (a < 2 % de la impresa): nada que elegir; el sitio, aún reservado, dice que llegó.
    expect(screen.getByText(/Llegó la tasa del día/)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Tasa para convertir los costos" })).not.toBeInTheDocument();
    expect(reserves().length).toBeGreaterThan(0);
  });
});
