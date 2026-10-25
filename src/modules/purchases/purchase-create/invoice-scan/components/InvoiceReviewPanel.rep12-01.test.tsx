import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceDuplicateMatch, InvoiceDuplicateQuery } from "@/modules/invoice-scan/contracts";
import type { ContactEntityOption } from "@/shared/components/EntityAutocomplete";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_SCAN_ID, REVIEW_SUPPLIER_ID, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

/**
 * REP12-01 (M-p12-1, D52): al elegir el proveedor a mano en la revisión se consulta el
 * duplicado con ese proveedor (`POST /api/purchases/invoice-scan/duplicates`) y se avisa con
 * «Ver». No bloquea, pero Cargar exige reconocerlo con una casilla, como la diferencia.
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

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const FARMATODO = "00000000-0000-4000-8000-0000000000f1";
const PURCHASE_ID = "00000000-0000-4000-8000-0000000000c8";

const farmatodo: ContactEntityOption = {
  id: FARMATODO,
  isActive: true,
  label: "Farmatodo",
  phone: "",
  taxId: "J-00030426-5",
  type: "proveedor",
};

/** f19: el modelo leyó «FARMACIA OPALO», sin RIF ni proveedor reconocido. */
function f19Response() {
  return makeReviewResponse({
    // Exenta: 1 × 1.750 cuadra con el total leído (sin casilla de diferencia).
    lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
    extraction: { supplier: { name: "FARMACIA OPALO" }, number: "00362952", date: "2026-09-03", total: 1750 },
    matched: { supplier: {} },
  });
}

function renderPanel(overrides: Partial<InvoiceReviewPanelProps> = {}) {
  const props: InvoiceReviewPanelProps = {
    context: CONTEXT,
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response: f19Response(),
    supplierFetcher: jest.fn(async () => [farmatodo]),
    ...overrides,
  };
  render(<InvoiceReviewPanel {...props} />);
  return props;
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

async function chooseFarmatodo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("combobox", { name: /proveedor/i }), "Farma");
  await user.click(await screen.findByRole("option", { name: /farmatodo/i }));
}

describe("InvoiceReviewPanel · duplicado con el proveedor elegido a mano (REP12-01, M-p12-1)", () => {
  it("f19: al elegir Farmatodo consulta con ese proveedor, avisa con «Ver» y Cargar pide reconocerlo", async () => {
    const user = userEvent.setup();
    const matches: InvoiceDuplicateMatch[] = [
      { scanId: "scan-previo", purchaseId: PURCHASE_ID, number: "00362952", date: "2026-09-03" },
    ];
    const duplicateFetcher = jest.fn(async (query: InvoiceDuplicateQuery) =>
      query.supplierId === FARMATODO ? matches : [],
    );
    const props = renderPanel({ duplicateFetcher });

    // Sin proveedor todavía: no hay con qué consultar.
    expect(screen.queryByText(/Esta factura \(/)).not.toBeInTheDocument();
    expect(duplicateFetcher).not.toHaveBeenCalled();

    await chooseFarmatodo(user);

    await waitFor(() => expect(screen.getByText(/ya se registró en una compra/)).toBeInTheDocument());
    expect(duplicateFetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scanId: REVIEW_SCAN_ID,
        supplierId: FARMATODO,
        number: "00362952",
        date: "2026-09-03",
        total: 1750,
      }),
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("link", { name: "Ver" })).toHaveAttribute("href", `/purchases/${PURCHASE_ID}`);
    expect(loadButton()).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /cargarla igual/i }));
    expect(loadButton()).toBeEnabled();
    await user.click(loadButton());
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });

  it("el aviso del escaneo (proveedor leído) también exige reconocerlo antes de Cargar", async () => {
    const user = userEvent.setup();
    renderPanel({
      duplicateFetcher: jest.fn(async () => [{ scanId: "scan-anterior", purchaseId: null, number: "000123", date: null }]),
      response: makeReviewResponse({ lines: [{}], matched: { duplicateOfScanId: "scan-anterior" } }),
    });

    expect(screen.getByText(/ya se escaneó antes/)).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /cargarla igual/i }));
    expect(loadButton()).toBeEnabled();
  });

  it("si el proveedor elegido no tiene duplicados, el aviso desaparece y Cargar no pide nada", async () => {
    const duplicateFetcher = jest.fn(async () => []);
    renderPanel({
      duplicateFetcher,
      response: makeReviewResponse({ lines: [{}], matched: { supplier: { contactId: REVIEW_SUPPLIER_ID } } }),
    });

    await waitFor(() => expect(duplicateFetcher).toHaveBeenCalled());
    expect(screen.queryByText(/Esta factura \(/)).not.toBeInTheDocument();
    expect(loadButton()).toBeEnabled();
  });

  it("cancela la consulta obsoleta al cambiar de proveedor", async () => {
    const user = userEvent.setup();
    const signals: AbortSignal[] = [];
    const duplicateFetcher = jest.fn(
      (_query: InvoiceDuplicateQuery, signal: AbortSignal) =>
        new Promise<InvoiceDuplicateMatch[]>(() => {
          signals.push(signal);
        }),
    );
    renderPanel({
      duplicateFetcher,
      response: makeReviewResponse({ lines: [{}], matched: { supplier: { contactId: REVIEW_SUPPLIER_ID } } }),
    });

    await waitFor(() => expect(duplicateFetcher).toHaveBeenCalledTimes(1));
    await chooseFarmatodo(user);
    await waitFor(() => expect(duplicateFetcher).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
