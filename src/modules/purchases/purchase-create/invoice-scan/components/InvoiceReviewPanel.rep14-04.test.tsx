import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewDraft } from "../reviewDraft";
import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

/**
 * REP14-04 · bajos acumulados (D63/D64):
 * - B-p14-1: la × «Limpiar Proveedor» no hacía nada (la cabecera ignoraba el proveedor vacío).
 * - B-p14-2: el diálogo «Descartar escaneo» de un escaneo ya confirmado prometía «cuenta como un
 *   escaneo nuevo».
 * - B-p15B-2: el aviso de tasa seguía diciendo «se usa la tasa impresa» tras escribir la tasa, y
 *   «no hay tasa del día» tras llegar la del día (que además no se ofrecía).
 */

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({ data: id ? { id, name: "Chevere Depot C.A." } : undefined, error: null, isPending: false }),
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
const PURCHASE_ID = "44444444-4444-4444-8444-444444444444";
const LINE = { read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } };

let now = 1_000_000;
let dateNow: jest.SpyInstance;
beforeEach(() => {
  now = 1_000_000;
  dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => dateNow.mockRestore());

function baseProps(response: InvoiceScanResponse, overrides: Partial<InvoiceReviewPanelProps> = {}): InvoiceReviewPanelProps {
  return {
    context: CONTEXT,
    duplicateFetcher: jest.fn(async () => []),
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
    ...overrides,
  };
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

describe("REP14-04 · B-p14-1 · la × «Limpiar Proveedor» de la revisión", () => {
  it("quita el proveedor: el campo queda vacío y Cargar se bloquea pidiendo elegirlo", async () => {
    const user = userEvent.setup();
    render(<InvoiceReviewPanel {...baseProps(makeReviewResponse({ lines: [LINE], extraction: { total: 1750 } }))} />);
    const field = screen.getByRole("combobox", { name: /Proveedor/ });
    expect(field).toHaveValue("Chevere Depot C.A.");
    expect(loadButton()).toBeEnabled();
    now += 1000;

    await user.click(screen.getByRole("button", { name: "Limpiar Proveedor" }));

    expect(screen.getByRole("combobox", { name: /Proveedor/ })).toHaveValue("");
    expect(loadButton()).toBeDisabled();
    expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent("Elige el proveedor.");
  });
});

describe("REP14-04 · B-p14-2 · texto del diálogo «Descartar escaneo»", () => {
  const openDialog = async () => {
    const user = userEvent.setup();
    now += 1000;
    await user.click(screen.getByRole("button", { name: "Descartar escaneo" }));
    return screen.findByRole("dialog");
  };

  it("escaneo ya confirmado: no promete un escaneo nuevo y dice que la compra registrada no cambia", async () => {
    render(
      <InvoiceReviewPanel
        {...baseProps({
          ...makeReviewResponse({ lines: [LINE] }),
          cached: true,
          confirmedPurchase: { id: PURCHASE_ID, purchaseNumber: "C-000123" },
        })}
      />,
    );

    const dialog = await openDialog();

    expect(dialog).not.toHaveTextContent(/escaneo nuevo|escanearla otra vez|se pierde lo que hayas corregido/);
    expect(dialog).toHaveTextContent("Esta factura ya se registró en la compra C-000123");
    expect(dialog).toHaveTextContent("La compra registrada no cambia");
  });

  it("escaneo sin confirmar: sigue avisando que volver a escanear cuenta como un escaneo nuevo", async () => {
    render(<InvoiceReviewPanel {...baseProps(makeReviewResponse({ lines: [LINE] }))} />);

    const dialog = await openDialog();

    expect(dialog).toHaveTextContent("cuenta como un escaneo nuevo");
  });
});

describe("REP14-04 · B-p15B-2 · el aviso de tasa sigue a la tasa en uso", () => {
  const response = () => makeReviewResponse({ lines: [LINE], extraction: { printedRate: 856.3, total: 1750 } });
  const noRate: InvoiceReviewContext = { taxRates: REVIEW_TAX_RATES };

  it("al escribir la tasa deja de decir que se usa la impresa, y al llegar la del día la ofrece sin pisar la escrita", async () => {
    const user = userEvent.setup();
    const props = baseProps(response(), { context: noRate });
    const { rerender } = render(<InvoiceReviewPanel {...props} />);
    expect(screen.getByText(/se usa la tasa impresa en la factura \(Bs\. 856,30\) sin verificar/)).toBeInTheDocument();
    now += 1000;

    await user.click(screen.getByRole("radio", { name: "Escribir la tasa" }));
    await user.type(screen.getByLabelText("Tasa Bs por REF"), "950");
    await user.tab();

    expect(screen.queryByText(/se usa la tasa impresa/)).not.toBeInTheDocument();
    expect(screen.getByText(/se usa la tasa escrita \(Bs\. 950,00\)/)).toBeInTheDocument();

    rerender(<InvoiceReviewPanel {...props} context={CONTEXT} />);

    expect(screen.queryByText(/No hay tasa del día/)).not.toBeInTheDocument();
    expect(screen.queryByText(/se usa la tasa impresa/)).not.toBeInTheDocument();
    expect(screen.getByText(/se usa la tasa escrita \(Bs\. 950,00\)/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Escribir la tasa" })).toHaveAttribute("aria-checked", "true");
    const today = screen.getByRole("radio", { name: "Tasa de hoy (900,00)" });
    expect(today).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Tasa Bs por REF")).toHaveValue("950");

    await user.click(loadButton());
    expect((props.onLoad as jest.Mock).mock.calls[0][0] as InvoiceReviewDraft).toMatchObject({ rateVes: 950 });

    now += 1000;
    await user.click(today);
    expect(today).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/se usa la tasa escrita/)).not.toBeInTheDocument();
    expect(screen.getByText("La factura trae tasa Bs. 856,30; hoy es Bs. 900,00.")).toBeInTheDocument();
  });

  it("elegida la impresa a mano antes de que llegue la del día: el aviso deja de decir que no hay tasa del día", async () => {
    const user = userEvent.setup();
    const props = baseProps(response(), { context: noRate });
    const { rerender } = render(<InvoiceReviewPanel {...props} />);
    now += 1000;
    await user.click(screen.getByRole("radio", { name: "Escribir la tasa" }));
    now += 1000;
    await user.click(screen.getByRole("radio", { name: "Tasa de la factura (856,30)" }));

    rerender(<InvoiceReviewPanel {...props} context={CONTEXT} />);

    expect(screen.queryByText(/No hay tasa del día/)).not.toBeInTheDocument();
    expect(screen.getByText("La factura trae tasa Bs. 856,30; hoy es Bs. 900,00.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tasa de la factura (856,30)" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("radiogroup", { name: "Tasa para convertir los costos" })).getByRole("radio", { name: "Tasa de hoy (900,00)" })).toHaveAttribute("aria-checked", "false");
  });
});
