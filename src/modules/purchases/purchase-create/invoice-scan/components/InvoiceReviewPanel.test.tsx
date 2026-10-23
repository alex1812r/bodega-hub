import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import type { InvoiceReviewDraft } from "../reviewDraft";
import type { InvoiceReviewContext } from "../reviewModel";
import {
  doubtfulLine,
  makeReviewResponse,
  productUuid,
  REVIEW_SCAN_ID,
  REVIEW_SUPPLIER_ID,
  REVIEW_TAX_RATES,
  unmatchedLine,
} from "../reviewFixtures";
import f01 from "../__fixtures__/scan-f01.json";
import f04 from "../__fixtures__/scan-f04.json";
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

let mockDuplicatePurchaseId: string | null = null;
const mockUseInvoiceScanPurchase = jest.fn((scanId?: string | null) => ({
  purchaseId: scanId ? mockDuplicatePurchaseId : null,
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: (scanId?: string | null) => mockUseInvoiceScanPurchase(scanId),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type FakeModalProps = {
  initialValues?: { name?: string; currentCostRef?: number };
  onCreated: (product: { id: string; name: string }) => void;
  open: boolean;
};

jest.mock("../../components/PurchaseNewProductModal", () => ({
  PurchaseNewProductModal: ({ initialValues, onCreated, open }: FakeModalProps) =>
    open ? (
      <div aria-label="Alta de producto" role="dialog">
        <pre data-testid="new-product-prefill">{JSON.stringify(initialValues)}</pre>
        <button
          onClick={() =>
            onCreated({ id: "00000000-0000-4000-8000-000000000050", name: initialValues?.name ?? "" })
          }
          type="button"
        >
          Crear producto
        </button>
      </div>
    ) : null,
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };

/**
 * REP7-06 (C5-M1, D31/D33): todo cambio de foco programático arma la guarda de 400 ms; la
 * pulsación deliberada sobre el nuevo destino (la fila siguiente, Cargar) llega después. Los
 * tests que encadenan acciones avanzan este reloj entre ellas, como un usuario real.
 */
let clockSpy: jest.SpyInstance | undefined;
function manualClock() {
  let now = 1_000_000;
  clockSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  return (ms = 1000) => {
    now += ms;
  };
}

afterEach(() => {
  clockSpy?.mockRestore();
  clockSpy = undefined;
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

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

/** D36: sin pendientes el foco va al pie (contenedor), nunca a Cargar; Tab llega a Cargar. */
function reviewFooter() {
  return screen.getByRole("contentinfo", { name: "Resumen de la revisión" });
}

function productOption(id: string, label: string): ProductEntityOption {
  return {
    barcode: null,
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 3,
    id,
    isActive: true,
    label,
    salePriceRef: 2,
    sku: "SKU-1",
  };
}

describe("InvoiceReviewPanel", () => {
  it("ordena por urgencia y colapsa las confirmadas", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [
          { read: { description: "Arroz" } },
          unmatchedLine(2, true, { read: { description: "Queso" } }),
          doubtfulLine(3, 0.72, { read: { description: "Leche" } }),
          { read: { description: "Azúcar" } },
        ],
      }),
    );

    const review = screen.getByRole("list", { name: "Líneas por revisar" });
    const items = within(review).getAllByRole("group", { name: /^Línea \d+:/ });
    expect(items.map((item) => item.getAttribute("data-line-index"))).toEqual(["1", "2"]);
    expect(within(items[0]).getByText("Sin emparejar")).toBeInTheDocument();
    expect(within(items[1]).getByText("Dudosa")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Líneas confirmadas" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2 líneas confirmadas · ver" }));
    const confirmed = screen.getByRole("list", { name: "Líneas confirmadas" });
    expect(within(confirmed).getAllByText("Confirmada")).toHaveLength(2);
    expect(row(0)).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("button", { name: "2 líneas confirmadas · ocultar" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("muestra los candidatos de una dudosa con su motivo y score, y el texto leído en gris", () => {
    renderPanel(
      makeReviewResponse({ lines: [doubtfulLine(2, 0.72, { read: { rawText: "LECHE COMPLETA 1L" } })] }),
    );

    const chips = within(row(0)).getByRole("group", { name: "Candidatos" });
    expect(within(chips).getByRole("button", { name: /Producto 2/ })).toHaveTextContent(
      "nombre parecido 0.72 · 0,72",
    );
    expect(within(chips).getByRole("button", { name: /Otro 2/ })).toHaveTextContent("nombre parecido 0,50 · 0,50");
    expect(within(row(0)).getByText("LECHE COMPLETA 1L")).toHaveClass("text-on-surface-variant");
  });

  it("un candidato de 0,99 no se acepta solo: Cargar sigue deshabilitado hasta el clic", async () => {
    const user = userEvent.setup();
    const advance = manualClock();
    const props = renderPanel(makeReviewResponse({ lines: [{}, doubtfulLine(2, 0.99)] }));

    expect(within(row(1)).getByText("Dudosa")).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
    expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent("Queda 1 línea por resolver.");

    await user.click(within(row(1)).getByRole("button", { name: /Producto 2/ }));

    expect(within(row(1)).getByText("Resuelta")).toBeInTheDocument();
    expect(loadButton()).toBeEnabled();
    advance();
    await user.click(loadButton());

    const draft = (props.onLoad as jest.Mock).mock.calls[0][0] as InvoiceReviewDraft;
    expect(draft.supplier.contactId).toBe(REVIEW_SUPPLIER_ID);
    expect(draft.lines.map((line) => line.productId)).toEqual([productUuid(1), productUuid(2)]);
    expect(draft.body.invoiceScanId).toBe(REVIEW_SCAN_ID);
  });

  it("resuelve 20 líneas (15 confirmadas) solo con el teclado sin pasar por las confirmadas", async () => {
    const user = userEvent.setup();
    const lines = [
      ...Array.from({ length: 15 }, () => ({})),
      ...Array.from({ length: 5 }, (_, position) => doubtfulLine(16 + position)),
    ];
    const advance = manualClock();
    const props = renderPanel(makeReviewResponse({ lines }));

    const visited: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await waitFor(() => expect(document.activeElement?.getAttribute("data-status")).toBe("pending_doubtful"));
      visited.push(document.activeElement?.getAttribute("data-line-index") ?? "");
      advance();
      await user.keyboard("{Enter}");
    }

    expect(visited).toEqual(["15", "16", "17", "18", "19"]);
    await waitFor(() => expect(reviewFooter()).toHaveFocus());
    advance();
    await user.keyboard("{Tab}");
    expect(loadButton()).toHaveFocus();
    await user.keyboard("{Enter}");

    const draft = (props.onLoad as jest.Mock).mock.calls[0][0] as InvoiceReviewDraft;
    expect(draft.lines).toHaveLength(20);
    expect(screen.queryByRole("list", { name: "Líneas confirmadas" })).not.toBeInTheDocument();
  });

  it("Esc deja la línea sin emparejar y pasa a la siguiente pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [doubtfulLine(1), doubtfulLine(2)] }));

    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.keyboard("{Escape}");

    expect(within(row(0)).getByText("Sin emparejar")).toBeInTheDocument();
    expect(within(row(0)).getByText("Sin producto")).toBeInTheDocument();
    await waitFor(() => expect(row(1)).toHaveFocus());
  });

  it("Tab abre el buscador con el texto leído y los candidatos arriba", async () => {
    const user = userEvent.setup();
    const fetcher = jest.fn(async () => [productOption("prod-x", "Harina PAN 1 kg (otra)")]);
    renderPanel(
      makeReviewResponse({ lines: [unmatchedLine(1, true, { read: { description: "Harina PAN 1kg" } })] }),
      { productFetcher: fetcher },
    );

    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.tab();

    const input = await screen.findByRole("combobox", { name: "Producto de la línea 1" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Harina PAN 1kg");

    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("Producto 1");
    expect(options[0]).toHaveTextContent("Sugerido · nombre parecido 0,41 · 0,41");
    expect(options[1]).toHaveTextContent("Harina PAN 1 kg (otra)");
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ query: "Harina PAN 1kg" }));

    await user.click(options[1]);
    expect(within(row(0)).getByText("Resuelta")).toBeInTheDocument();
    expect(within(row(0)).getByText("Harina PAN 1 kg (otra)")).toBeInTheDocument();
  });

  it("con línea de empaque sin tamaño, Enter deja el foco en Unidades por bulto", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [doubtfulLine(1, 0.8, { read: { unit: "bulto" }, match: { entryMode: "pack", unitsPerPack: undefined } })],
      }),
    );

    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.keyboard("{Enter}");

    const units = within(row(0)).getByLabelText("Unidades por bulto");
    await waitFor(() => expect(units).toHaveFocus());
    expect(within(row(0)).getByText("Indica cuántas unidades trae cada bulto.")).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();

    await user.type(units, "12");
    expect(within(row(0)).getByText("Resuelta")).toBeInTheDocument();
  });

  it.each(["0", "-3"])("SCN-UI-C1 (6.19): %s en Unidades por bulto no se corrige ni resuelve la línea", async (typed) => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [
          doubtfulLine(1, 0.8, { read: { unit: "bulto" }, match: { entryMode: "pack", unitsPerPack: undefined } }),
          doubtfulLine(2),
        ],
      }),
    );

    // Enter en la fila acepta el producto marcado y lleva el foco a las unidades.
    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.keyboard("{Enter}");
    const units = within(row(0)).getByLabelText("Unidades por bulto");
    await waitFor(() => expect(units).toHaveFocus());
    await user.keyboard(typed);
    await user.tab();

    expect(units).toHaveValue(typed);
    expect(row(0)).not.toHaveAttribute("data-status", "resolved");
    expect(within(row(0)).getByText("Debe ser un entero mayor que 0.")).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
  });

  it("SCN-UI-C3 (N4): más unidades por bulto de las que acepta el servidor deja la línea pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [
          doubtfulLine(1, 0.8, { read: { unit: "bulto" }, match: { entryMode: "pack", unitsPerPack: undefined } }),
          doubtfulLine(2),
        ],
      }),
    );

    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.keyboard("{Enter}");
    const units = within(row(0)).getByLabelText("Unidades por bulto");
    await waitFor(() => expect(units).toHaveFocus());
    await user.keyboard("1000000000");
    await user.tab();

    expect(row(0)).not.toHaveAttribute("data-status", "resolved");
    expect(within(row(0)).getByText("Máximo 100.000 unidades por empaque.")).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
  });

  it("aviso de tasa impresa: se elige entre la de hoy y la de la factura", async () => {
    const user = userEvent.setup();
    const props = renderPanel(makeReviewResponse({ lines: [{}], extraction: { printedRate: 875.65 } }));

    expect(screen.getByText("La factura trae tasa Bs. 875,65; hoy es Bs. 900,00.")).toBeInTheDocument();
    const today = screen.getByRole("radio", { name: "Tasa de hoy (900,00)" });
    const printed = screen.getByRole("radio", { name: "Tasa de la factura (875,65)" });
    expect(today).toHaveAttribute("aria-checked", "true");

    await user.click(printed);
    expect(printed).toHaveAttribute("aria-checked", "true");
    expect(today).toHaveAttribute("aria-checked", "false");

    await user.click(loadButton());
    const draft = (props.onLoad as jest.Mock).mock.calls[0][0] as InvoiceReviewDraft;
    // SCN-UI-C1: la elegida es la tasa de la compra, que va en los Bs de la factura.
    expect(draft).toMatchObject({ costCurrency: "ves", invoiceRateVes: 875.65, rateVes: 875.65 });
  });

  it("sin tasa del día ni impresa pide la tasa con NumberInput", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [{}] }), { context: { taxRates: REVIEW_TAX_RATES } });

    expect(
      screen.getByText("No hay tasa del día ni tasa impresa en la factura: escribe la tasa para convertir los costos."),
    ).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
    expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent(
      "Escribe la tasa para convertir los costos a REF.",
    );

    await user.type(screen.getByLabelText("Tasa Bs por REF"), "900");
    expect(loadButton()).toBeEnabled();
  });

  it("factura en dólares: hay que aceptarla explícitamente", async () => {
    const user = userEvent.setup();
    const advance = manualClock();
    const props = renderPanel(makeReviewResponse({ lines: [{}], extraction: { currency: "USD" } }));

    expect(screen.getByRole("alert")).toHaveTextContent("La factura parece estar en dólares");
    expect(within(row(0)).getByText("Dudosa")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent(
      "Confirma que la factura está en dólares para cargar los costos como REF.",
    );

    await user.click(within(row(0)).getByRole("button", { name: /Propuesto por el emparejamiento/ }));
    expect(loadButton()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Sí, la factura está en dólares" }));
    expect(screen.getByText(/Factura en dólares aceptada/)).toBeInTheDocument();
    expect(loadButton()).toBeEnabled();

    // Aceptar los dólares lleva el foco al pie: Cargar exige una pulsación nueva (D31/D33).
    advance();
    await user.click(loadButton());
    const draft = (props.onLoad as jest.Mock).mock.calls[0][0] as InvoiceReviewDraft;
    expect(draft.costCurrency).toBe("ref");
  });

  it("total con diferencia en rojo y línea que no cuadra resaltada", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [{ read: { lineTotal: 300 } }],
        extraction: { total: 1000 },
      }),
    );

    const difference = screen.getByTestId("invoice-review-difference");
    expect(difference).toHaveTextContent("Diferencia Bs. 768,00");
    expect(difference).toHaveClass("text-red-700");
    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent(
      /Total a registrar Bs\. 232,00\s*·\s*Leído Bs\. 1\.000,00/,
    );
    // La confirmada que no cuadra sigue colapsada, pero el botón lo avisa.
    const toggle = screen.getByRole("button", { name: /1 línea confirmada · ver/ });
    expect(toggle).toHaveTextContent("1 con total distinto al leído");
    await user.click(toggle);
    expect(screen.getByTestId("line-mismatch-0")).toHaveTextContent("La factura dice Bs. 300,00");
    expect(screen.getByTestId("line-mismatch-0")).toHaveClass("text-red-700");
  });

  it("totales que cuadran llevan ✓", () => {
    renderPanel(makeReviewResponse({ lines: [{}], extraction: { total: 232 } }));

    expect(screen.queryByTestId("invoice-review-difference")).not.toBeInTheDocument();
    expect(screen.getByText("Cuadra con el total leído")).toBeInTheDocument();
  });

  it("SCN-UI-Q1 / D27 (f01 real, IVA 0,00): se pregunta sin preselección; la elección es visible y reversible; el pie da lo que se registra", async () => {
    const user = userEvent.setup();
    renderPanel(f01 as unknown as InvoiceScanResponse, {
      context: { systemRateVes: 880.1159, taxRates: REVIEW_TAX_RATES },
    });

    expect(screen.getByTestId("invoice-review-tax-notice")).toHaveTextContent(
      "La factura no trae IVA y la suma de las líneas ya da el total leído",
    );
    const included = screen.getByRole("radio", { name: "Los precios incluyen IVA (cargar sin IVA)" });
    const excluded = screen.getByRole("radio", { name: "Los precios no incluyen IVA" });
    expect(included).toHaveAttribute("aria-checked", "false");
    expect(excluded).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("invoice-review-difference")).toHaveTextContent("Diferencia Bs. -6.482,61");

    await user.click(included);
    expect(included).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent(/Total a registrar Bs\. 40\.516,3\d/);
    expect(screen.queryByTestId("invoice-review-difference")).not.toBeInTheDocument();
    expect(within(row(0)).getByLabelText("Costo (Bs, con IVA)")).toBeInTheDocument();

    await user.click(excluded);
    expect(excluded).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent("Total a registrar Bs. 46.998,93");
    expect(screen.getByTestId("invoice-review-difference")).toHaveTextContent("Diferencia Bs. -6.482,61");
  });

  it("M3 / D25-a (números de f18): IVA desglosado con la línea con IVA preselecciona «incluyen IVA»; revertir bloquea Cargar hasta confirmar la diferencia", async () => {
    const user = userEvent.setup();
    const props = renderPanel(
      makeReviewResponse({
        lines: [{ read: { quantity: 1, unitPrice: 2412.02, lineTotal: 2412.02 } }],
        extraction: { subtotal: 2079.33, tax: 332.69, total: 2412.02 },
      }),
    );

    expect(screen.getByTestId("invoice-review-tax-notice")).toHaveTextContent(
      "Los precios de esta factura parecen incluir IVA: la suma de las líneas da el total leído (Bs. 2.412,02), no el subtotal (Bs. 2.079,33).",
    );
    expect(screen.getByRole("radio", { name: "Los precios incluyen IVA (cargar sin IVA)" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent("Total a registrar Bs. 2.412,02");
    expect(screen.queryByTestId("invoice-review-confirm-difference")).not.toBeInTheDocument();
    expect(loadButton()).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Los precios no incluyen IVA" }));
    expect(screen.getByTestId("invoice-review-difference")).toHaveTextContent("Diferencia Bs. -385,92");
    expect(loadButton()).toBeDisabled();
    expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent(
      "El total a registrar no cuadra con el leído: corrige las líneas o confirma la diferencia.",
    );

    const confirm = screen.getByRole("checkbox", {
      name: "Cargar con una diferencia de Bs. -385,92 frente al total leído",
    });
    await user.click(confirm);
    expect(confirm).toBeChecked();
    expect(loadButton()).toBeEnabled();
    await user.click(loadButton());
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });

  it("REP3-01 (C3-M1): sin total leído, subtotal + IVA es la referencia; revertir el IVA incluido pide confirmar", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [{ read: { quantity: 1, unitPrice: 104.4, lineTotal: 104.4 } }],
        extraction: { subtotal: 90, tax: 14.4 },
      }),
    );

    expect(screen.getByTestId("invoice-review-tax-notice")).toHaveTextContent(
      "la suma de las líneas da el subtotal más el IVA leídos (Bs. 104,40), no el subtotal (Bs. 90,00)",
    );
    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent(
      /Total a registrar Bs\. 104,40\s*·\s*Subtotal \+ IVA leídos Bs\. 104,40/,
    );
    expect(loadButton()).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Los precios no incluyen IVA" }));
    expect(screen.getByTestId("invoice-review-difference")).toHaveTextContent("Diferencia Bs. -16,70");
    expect(
      screen.getByRole("checkbox", {
        name: "Cargar con una diferencia de Bs. -16,70 frente al subtotal + IVA leídos",
      }),
    ).not.toBeChecked();
    expect(loadButton()).toBeDisabled();
  });

  it("REP4-01 (C4-M1 u7): solo subtotal leído, el IVA incluido cuadra la base; revertirlo pide confirmar", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [{ read: { quantity: 1, unitPrice: 104.4, lineTotal: 104.4 } }],
        extraction: { subtotal: 90 },
      }),
    );

    expect(screen.getByTestId("invoice-review-tax-notice")).toHaveTextContent(
      "quitándoselo, las líneas dan el subtotal leído (Bs. 90,00)",
    );
    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent(
      /Total a registrar Bs\. 104,40\s*·\s*Base a registrar Bs\. 90,00 · Subtotal leído Bs\. 90,00/,
    );
    expect(loadButton()).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Los precios no incluyen IVA" }));
    expect(screen.getByTestId("invoice-review-difference")).toHaveTextContent("Diferencia Bs. -14,40");
    const confirm = screen.getByRole("checkbox", {
      name: "Cargar con una diferencia de Bs. -14,40 frente al subtotal leído (base sin IVA)",
    });
    expect(loadButton()).toBeDisabled();
    await user.click(confirm);
    expect(loadButton()).toBeEnabled();
  });

  it("REP4-01 (C4-M1 u8): solo IVA leído, el IVA incluido cuadra el leído; revertirlo pide confirmar", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [{ read: { quantity: 1, unitPrice: 104.4, lineTotal: 104.4 } }],
        extraction: { tax: 14.4 },
      }),
    );

    expect(screen.getByTestId("invoice-review-tax-notice")).toHaveTextContent(
      "el IVA que llevan dentro las líneas da el IVA leído (Bs. 14,40)",
    );
    expect(screen.getByTestId("invoice-review-totals")).toHaveTextContent(
      /Total a registrar Bs\. 104,40\s*·\s*IVA a registrar Bs\. 14,40 · IVA leído Bs\. 14,40/,
    );
    expect(loadButton()).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Los precios no incluyen IVA" }));
    expect(
      screen.getByRole("checkbox", { name: "Cargar con una diferencia de Bs. -2,30 frente al IVA leído" }),
    ).not.toBeChecked();
    expect(loadButton()).toBeDisabled();
  });

  it("REP3-01: sin ninguna cifra leída no hay casilla, se informa que no hay con qué comparar", () => {
    renderPanel(makeReviewResponse({ lines: [{}], extraction: {} }));

    expect(screen.getByTestId("invoice-review-no-reference")).toHaveTextContent(
      "Sin total, subtotal ni IVA leídos para comparar",
    );
    expect(screen.queryByTestId("invoice-review-confirm-difference")).not.toBeInTheDocument();
    expect(loadButton()).toBeEnabled();
  });

  it("SCN-UI-Q1 (f04 real): la tasa 86,75 no se ofrece y la media caja se carga como unidades", async () => {
    const user = userEvent.setup();
    renderPanel(f04 as unknown as InvoiceScanResponse, {
      context: { systemRateVes: 880.1159, taxRates: REVIEW_TAX_RATES },
    });

    expect(screen.getByTestId("invoice-review-rate-ignored")).toHaveTextContent(
      "La tasa leída (86,75) no parece una tasa Bs/USD; se ignora.",
    );
    expect(screen.queryByRole("radio", { name: /Tasa de la factura/ })).not.toBeInTheDocument();

    const mayonesa = row(0);
    expect(within(mayonesa).getByText(/elige «Por bulto» e indica las unidades/)).toBeInTheDocument();
    await user.click(within(mayonesa).getByRole("button", { name: "Por bulto" }));
    await user.type(within(mayonesa).getByLabelText("Unidades por bulto"), "12");
    await user.click(within(mayonesa).getByRole("button", { name: "Cargar como 6 unidades" }));

    expect(within(mayonesa).getByLabelText("Cantidad")).toHaveValue("6");
    expect(within(mayonesa).queryByText(/solo admite cantidades enteras/)).not.toBeInTheDocument();
    // BAJO-N2 (CIE-03a): el aviso del servidor de cantidad con decimales también se va.
    expect(within(mayonesa).queryByText(/Cantidad con decimales en la factura/)).not.toBeInTheDocument();
  });

  it("Nuevo producto se abre precargado con nombre y costo leídos y elige el creado", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [
          unmatchedLine(9, false, {
            read: { description: "Queso blanco", lineTotal: 1800, quantity: 2, unitPrice: 900 },
          }),
        ],
      }),
      { canCreateProduct: true },
    );

    await user.click(within(row(0)).getByRole("button", { name: "Nuevo producto" }));

    expect(JSON.parse(screen.getByTestId("new-product-prefill").textContent ?? "{}")).toEqual({
      currentCostRef: 1.16,
      name: "Queso blanco",
    });

    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    expect(within(row(0)).getByText("Resuelta")).toBeInTheDocument();
    expect(within(row(0)).getByText("Queso blanco", { selector: "span" })).toBeInTheDocument();
  });

  it("descarta y restaura una línea, y avisa de factura duplicada y lectura dudosa", async () => {
    const user = userEvent.setup();
    const props = renderPanel(
      makeReviewResponse({
        lines: [{}, unmatchedLine(2, false)],
        extraction: { confidence: 0.4, warnings: ["La foto está borrosa."] },
        matched: { duplicateOfScanId: "scan-anterior" },
      }),
    );

    expect(screen.getByText(/ya se escaneó antes/)).toBeInTheDocument();
    expect(screen.getByText(/confianza baja \(40 %\)/)).toBeInTheDocument();
    expect(screen.getByText("La foto está borrosa.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Repetir foto" }));
    expect(props.onRescan).toHaveBeenCalled();

    await user.click(within(row(1)).getByRole("button", { name: "Descartar línea" }));
    expect(within(row(1)).getByText("Descartada")).toBeInTheDocument();
    expect(loadButton()).toBeEnabled();

    await user.click(within(row(1)).getByRole("button", { name: "Restaurar" }));
    expect(within(row(1)).getByText("Sin emparejar")).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Descartar escaneo" }));
    expect(props.onDiscard).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar escaneo" }));
    expect(props.onDiscard).toHaveBeenCalled();
  });

  it("sin proveedor confirmado ofrece los candidatos y bloquea la carga", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [{}],
        matched: {
          supplier: {
            candidates: [{ contactId: "contact-9", name: "Chevere Depot C.A.", reason: "RIF parecido", score: 0.8 }],
          },
        },
      }),
    );

    expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent("Elige el proveedor.");
    await user.click(screen.getByRole("button", { name: /Chevere Depot C\.A\./ }));
    expect(loadButton()).toBeEnabled();
  });

  it("SCN-08-F1 (6.17): la siguiente dudosa con empaque recibe el foco en la fila; Enter acepta, luego unidades y Enter salta", async () => {
    const user = userEvent.setup();
    const advance = manualClock();
    const props = renderPanel(
      makeReviewResponse({
        lines: [
          doubtfulLine(1),
          doubtfulLine(2, 0.8, { read: { unit: "caja" }, match: { entryMode: "pack", unitsPerPack: undefined } }),
          doubtfulLine(3),
        ],
      }),
    );

    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.keyboard("{Enter}");

    // Antes de aceptar el producto el foco va a la fila, no al campo de unidades.
    await waitFor(() => expect(row(1)).toHaveFocus());
    advance();
    await user.keyboard("{Enter}");

    const units = within(row(1)).getByLabelText("Unidades por caja");
    await waitFor(() => expect(units).toHaveFocus());
    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");

    await user.keyboard("12{Enter}");

    expect(row(1)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(2)).toHaveFocus());
    advance();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(reviewFooter()).toHaveFocus());
    advance();
    await user.keyboard("{Tab}");
    expect(loadButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.onLoad).toHaveBeenCalledTimes(1);
  });

  it("SCN-UI-C1 (6.17): en una sin emparejar, Tab hacia delante desde el buscador llega a «Descartar línea»", async () => {
    const user = userEvent.setup();
    const props = renderPanel(
      makeReviewResponse({ lines: [unmatchedLine(1, false), doubtfulLine(2)] }),
      { productFetcher: jest.fn(async () => []) },
    );

    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.tab();
    await waitFor(() => expect(within(row(0)).getByRole("combobox")).toHaveFocus());

    const discard = within(row(0)).getByRole("button", { name: "Descartar línea" });
    for (let presses = 0; presses < 8 && document.activeElement !== discard; presses += 1) {
      expect(row(0)).toContainElement(document.activeElement as HTMLElement);
      await user.tab();
    }
    expect(discard).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(row(0)).toHaveAttribute("data-status", "discarded");
    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("SCN-08-F1 (6.17): unidades escritas antes de aceptar; Enter en el campo acepta el marcado y salta", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [
          doubtfulLine(1, 0.8, { read: { unit: "caja" }, match: { entryMode: "pack", unitsPerPack: undefined } }),
          doubtfulLine(2),
        ],
      }),
    );

    const units = within(row(0)).getByLabelText("Unidades por caja");
    await user.click(units);
    await user.keyboard("12");
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(within(row(0)).getByText("Producto 1")).toBeInTheDocument();
    await waitFor(() => expect(row(1)).toHaveFocus());
  });

  it("SCN-08-F1: una dudosa del servidor sin producto propuesto se pinta Dudosa; Esc la deja Sin emparejar", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [doubtfulLine(1, 0.6, { match: { productId: undefined } })] }));

    expect(within(row(0)).getByText("Dudosa")).toBeInTheDocument();
    expect(within(row(0)).queryByText("Sin emparejar")).not.toBeInTheDocument();
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

    await waitFor(() => expect(row(0)).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(within(row(0)).getByText("Sin emparejar")).toBeInTheDocument();
  });

  it("SCN-08-F1: factura duplicada ya registrada en una compra enlaza «Ver» a esa compra, sin bloquear", async () => {
    mockDuplicatePurchaseId = "00000000-0000-4000-8000-0000000000aa";
    try {
      renderPanel(makeReviewResponse({ lines: [{}], matched: { duplicateOfScanId: "scan-anterior" } }));

      expect(mockUseInvoiceScanPurchase).toHaveBeenCalledWith("scan-anterior");
      expect(screen.getByText(/ya se registró en una compra/)).toBeInTheDocument();
      expect(screen.queryByText(/ya se escaneó antes/)).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ver" })).toHaveAttribute(
        "href",
        "/purchases/00000000-0000-4000-8000-0000000000aa",
      );
      expect(loadButton()).toBeEnabled();
    } finally {
      mockDuplicatePurchaseId = null;
    }
  });

  describe("REP3-03a (B6): el aviso de duplicado dice el criterio que lo disparó", () => {
    const duplicateNotice = () => screen.getByText(/Esta factura \(/);

    it("sin número leído: mismo proveedor, fecha y total (no «número»)", () => {
      mockDuplicatePurchaseId = "00000000-0000-4000-8000-0000000000aa";
      try {
        renderPanel(
          makeReviewResponse({
            lines: [{}],
            extraction: { number: undefined, total: 2412.02 },
            matched: { duplicateOfScanId: "scan-anterior" },
          }),
        );

        expect(duplicateNotice()).toHaveTextContent("Esta factura (mismo proveedor, fecha y total) ya se registró");
        expect(duplicateNotice()).not.toHaveTextContent("número");
      } finally {
        mockDuplicatePurchaseId = null;
      }
    });

    it("sin número ni fecha: mismo proveedor y total", () => {
      renderPanel(
        makeReviewResponse({
          lines: [{}],
          extraction: { date: undefined, number: "000", total: 50 },
          matched: { duplicateOfScanId: "scan-anterior" },
        }),
      );

      expect(duplicateNotice()).toHaveTextContent("Esta factura (mismo proveedor y total) ya se escaneó antes");
    });

    it("con número leído: mismo proveedor y número igual o casi igual", () => {
      renderPanel(makeReviewResponse({ lines: [{}], matched: { duplicateOfScanId: "scan-anterior" } }));

      expect(duplicateNotice()).toHaveTextContent("Esta factura (mismo proveedor y número igual o casi igual) ya se escaneó antes");
    });
  });

  describe("REP4-02c (B8, D29): tras «Descartar línea» o «Restaurar» el foco no se pierde", () => {
    const discardButton = (index: number) => within(row(index)).getByRole("button", { name: "Descartar línea" });
    const restoreButton = (index: number) => within(row(index)).getByRole("button", { name: "Restaurar" });
    type Activate = (user: ReturnType<typeof userEvent.setup>, button: HTMLElement) => Promise<void>;
    const activations: [string, Activate][] = [
      ["clic", (user, button) => user.click(button)],
      [
        "Enter",
        async (user, button) => {
          button.focus();
          await user.keyboard("{Enter}");
        },
      ],
      [
        "Espacio",
        async (user, button) => {
          button.focus();
          await user.keyboard(" ");
        },
      ],
    ];

    it.each(activations)("con otra pendiente (%s): Descartar lleva el foco a la siguiente pendiente", async (_, activate) => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), doubtfulLine(2)] }));
      await waitFor(() => expect(row(0)).toHaveFocus());

      await activate(user, discardButton(0));

      expect(row(0)).toHaveAttribute("data-status", "discarded");
      await waitFor(() => expect(row(1)).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    });

    // D31 (REP5-01) sustituye el destino de D29: el contenedor de la fila, no un botón de acción.
    it.each(activations)("sin más pendientes (%s): Descartar lleva el foco a la fila descartada", async (_, activate) => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [{}, unmatchedLine(2, false)] }));

      await activate(user, discardButton(1));

      expect(row(1)).toHaveAttribute("data-status", "discarded");
      await waitFor(() => expect(row(1)).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    });

    it.each(activations)("Restaurar (%s) lleva el foco a la fila restaurada", async (_, activate) => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), doubtfulLine(2)] }));
      await user.click(discardButton(0));
      await user.click(discardButton(1));
      await waitFor(() => expect(row(1)).toHaveFocus());

      await activate(user, restoreButton(0));

      expect(row(0)).toHaveAttribute("data-status", "pending_unmatched");
      await waitFor(() => expect(row(0)).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    });

    it("una confirmada que se descarta con la lista plegada: el foco va al pie (D36: no a Cargar), no a BODY", async () => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [{}, {}] }));
      await user.click(screen.getByRole("button", { name: "2 líneas confirmadas · ver" }));
      await user.clear(within(row(0)).getByLabelText("Cantidad"));
      expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
      await user.click(screen.getByRole("button", { name: "1 línea confirmada · ocultar" }));

      await user.click(discardButton(0));

      expect(document.querySelector('[data-line-index="0"]')).toBeNull();

      await waitFor(() => expect(reviewFooter()).toHaveFocus());
    });

    describe("REP4-02c-F1: el control que recibe el foco queda por encima del pie fijo", () => {
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      const originalScrollBy = window.scrollBy;
      const originalInnerHeight = window.innerHeight;
      const scrollIntoView = jest.fn();
      const scrollBy = jest.fn();
      let rect: jest.SpyInstance;
      // Viewport de 800 px y pie de 120 px; `footerBottomGap` = distancia del pie al borde
      // inferior del viewport (padding-bottom de `main`); `elementBottom` = borde inferior del
      // control enfocado tras scrollIntoView.
      let footerBottomGap = 0;
      let elementBottom = 0;

      beforeEach(() => {
        footerBottomGap = 0;
        elementBottom = 0;
        scrollIntoView.mockReset();
        scrollBy.mockReset();
        Element.prototype.scrollIntoView = scrollIntoView;
        window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
        rect = jest
          .spyOn(Element.prototype, "getBoundingClientRect")
          .mockImplementation(function (this: Element) {
            if (this.tagName === "FOOTER") {
              const top = 800 - footerBottomGap - 120;
              return { top, bottom: top + 120, height: 120 } as DOMRect;
            }
            return { top: elementBottom - 36, bottom: elementBottom } as DOMRect;
          });
      });

      afterEach(() => {
        Element.prototype.scrollIntoView = originalScrollIntoView;
        window.scrollBy = originalScrollBy;
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: originalInnerHeight,
        });
        rect.mockRestore();
      });

      const lastScrolled = () => scrollIntoView.mock.contexts.at(-1) as HTMLElement | undefined;

      it("Restaurar con teclado y el buscador abierto: la fila restaurada se desplaza fuera del pie", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), unmatchedLine(2, false)] }));
        await waitFor(() => expect(row(0)).toHaveFocus());
        await user.keyboard("{Tab}");
        await user.click(discardButton(1));
        await user.click(discardButton(0));
        await waitFor(() => expect(row(0)).toHaveFocus());
        restoreButton(0).focus();
        scrollIntoView.mockClear();

        await user.keyboard(" ");

        await waitFor(() => expect(row(0)).toHaveFocus());
        expect(lastScrolled()).toBe(row(0));
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
        // innerHeight 800 − top del pie 680 + 8.
        expect(row(0).style.scrollMarginBottom).toBe("128px");
        expect(scrollBy).not.toHaveBeenCalled();
      });

      it("Enter en la fila (recorrido): la siguiente pendiente se desplaza fuera del pie", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [doubtfulLine(1), doubtfulLine(2)] }));
        await waitFor(() => expect(row(0)).toHaveFocus());
        scrollIntoView.mockClear();

        await user.keyboard("{Enter}");

        await waitFor(() => expect(row(1)).toHaveFocus());
        expect(lastScrolled()).toBe(row(1));
        expect(row(1).style.scrollMarginBottom).toBe("128px");
      });

      it("pie 24 px por encima del borde del viewport: el margen cubre también ese hueco", async () => {
        footerBottomGap = 24;
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [doubtfulLine(1), doubtfulLine(2)] }));
        await waitFor(() => expect(row(0)).toHaveFocus());

        await user.keyboard("{Enter}");

        await waitFor(() => expect(row(1)).toHaveFocus());
        // innerHeight 800 − top del pie 656 + 8 (offsetHeight + 8 daría 128 y lo taparía 16 px).
        expect(row(1).style.scrollMarginBottom).toBe("152px");
      });

      it("si tras scrollIntoView el control sigue bajo el pie, desplaza la ventana la diferencia", async () => {
        footerBottomGap = 24;
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [doubtfulLine(1), doubtfulLine(2)] }));
        await waitFor(() => expect(row(0)).toHaveFocus());
        scrollBy.mockClear();
        elementBottom = 759;

        await user.keyboard("{Enter}");

        await waitFor(() => expect(row(1)).toHaveFocus());
        // 759 − (656 − 8) = 111.
        expect(scrollBy).toHaveBeenLastCalledWith(0, 111);
      });
    });
  });

  describe("REP5-01 (C5-M1, D31): una doble pulsación en «Descartar línea» no resuelve la siguiente dudosa", () => {
    const PRICE_ISSUE = "¿Precio por caja o por unidad? Sale a 0,51 REF por unidad y el último costo fue 0,05 REF.";
    const singleCandidate = (seed: number) => [
      { productId: productUuid(seed), name: `Producto ${seed}`, score: 1, reason: "nombre parecido · vinculado" },
    ];
    // 6.16: dudosa con un único candidato de 1,00 (foco2).
    const nameLine = () => doubtfulLine(2, 1, { match: { candidates: singleCandidate(2) } });
    // 6.18: caja x6 con aviso de coherencia de precio (foco4).
    const priceLine = () =>
      doubtfulLine(2, 1, {
        read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
        match: { entryMode: "pack", unitsPerPack: 6, candidates: singleCandidate(2), issues: [PRICE_ISSUE] },
      });
    const discardButton = (index: number) => within(row(index)).getByRole("button", { name: "Descartar línea" });
    let now = 1_000_000;
    let dateNow: jest.SpyInstance;

    beforeEach(() => {
      now = 1_000_000;
      dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
    });

    afterEach(() => {
      dateNow.mockRestore();
    });

    it.each([
      ["6.16 nombre parecido", nameLine],
      ["6.18 precio por caja", priceLine],
    ])("Enter ×2 sobre «Descartar línea» (%s): la siguiente queda dudosa y con el foco en su fila", async (_, line) => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), line()] }));
      await waitFor(() => expect(row(0)).toHaveFocus());
      discardButton(0).focus();

      await user.keyboard("{Enter}");
      await waitFor(() => expect(row(1)).toHaveFocus());
      now += 30;
      await user.keyboard("{Enter}");

      expect(row(0)).toHaveAttribute("data-status", "discarded");
      expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
      expect(loadButton()).toBeDisabled();
    });

    it.each([
      ["6.16 nombre parecido", nameLine],
      ["6.18 precio por caja", priceLine],
    ])("el 2.º clic cae sobre el chip de la siguiente (%s): no la acepta", async (_, line) => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), line()] }));

      await user.click(discardButton(0));
      now += 40;
      await user.click(within(row(1)).getByRole("button", { name: /Producto 2/ }));

      expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
      expect(loadButton()).toBeDisabled();
    });

    it("pasados los 400 ms, Enter en la fila sí acepta el marcado (6.17)", async () => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));
      discardButton(0).focus();

      await user.keyboard("{Enter}");
      await waitFor(() => expect(row(1)).toHaveFocus());
      now += 450;
      await user.keyboard("{Enter}");

      expect(row(1)).toHaveAttribute("data-status", "resolved");
    });

    // D41-c (B-p9-1): el chip que resuelve sigue D39-6; el foco queda en su fila.
    it("clic en el chip que resuelve la línea: el foco queda en su fila, no en BODY ni en la siguiente", async () => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [nameLine(), doubtfulLine(3)] }));

      await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));

      expect(row(0)).toHaveAttribute("data-status", "resolved");
      await waitFor(() => expect(row(0)).toHaveFocus());
    });

    it("clic en el chip que resuelve la última pendiente: el foco queda en su fila (D36: no a Cargar), no en BODY", async () => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [{}, nameLine()] }));

      await user.click(within(row(1)).getByRole("button", { name: /Producto 2/ }));

      expect(row(1)).toHaveAttribute("data-status", "resolved");
      await waitFor(() => expect(row(1)).toHaveFocus());
    });

    it("pasados los 400 ms, un clic en el chip sí lo acepta", async () => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));

      await user.click(discardButton(0));
      now += 450;
      await user.click(within(row(1)).getByRole("button", { name: /Producto 2/ }));

      expect(row(1)).toHaveAttribute("data-status", "resolved");
    });

    it("6.18: Enter en la fila no la resuelve a ciegas; el foco sigue en la fila, Tab lleva a la opción y, elegida, resuelve", async () => {
      const user = userEvent.setup();
      renderPanel(makeReviewResponse({ lines: [priceLine(), doubtfulLine(3)] }));
      await waitFor(() => expect(row(0)).toHaveFocus());

      await user.keyboard("{Enter}");

      expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
      // D36: el foco no va solo a la opción; el usuario llega con Tab (sin marcarla).
      const perUnit = within(row(0)).getByRole("button", { name: "Por unidad" });
      expect(row(0)).toHaveFocus();
      await user.keyboard("{Tab}");
      expect(perUnit).toHaveFocus();

      // La guarda de tiempo sigue como defensa adicional: un Enter enseguida no elige.
      now += 30;
      await user.keyboard("{Enter}");
      expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
      expect(perUnit).toHaveFocus();

      now += 450;
      await user.keyboard("{Enter}");
      expect(row(0)).toHaveAttribute("data-status", "resolved");
      // D39-6: el foco queda en la fila resuelta.
      await waitFor(() => expect(row(0)).toHaveFocus());
    });

    const PACK_ISSUE = "No hay empaque registrado de 6 unidades para este proveedor: confirma las unidades por empaque.";
    const packLine = () =>
      doubtfulLine(2, 1, {
        read: { unit: "caja", quantity: 1, unitPrice: 2700, lineTotal: 2700, unitsPerPack: 6 },
        match: { entryMode: "pack", unitsPerPack: 6, candidates: singleCandidate(2), issues: [PACK_ISSUE] },
      });
    const chipActivations: [string, (user: ReturnType<typeof userEvent.setup>, chip: HTMLElement) => Promise<void>][] = [
      ["clic", (user, chip) => user.click(chip)],
      [
        "Enter en el chip",
        async (user, chip) => {
          chip.focus();
          await user.keyboard("{Enter}");
        },
      ],
    ];

    describe.each([
      ["6.18 precio", priceLine, PRICE_ISSUE],
      ["tamaño de empaque", packLine, PACK_ISSUE],
    ])("aceptación deliberada del candidato con aviso de %s", (_, line, issue) => {
      it.each(chipActivations)(
        "%s: elige el producto pero no la resuelve; foco en la fila (D36), aviso visible; elegida, resuelve",
        async (__, activate) => {
          const user = userEvent.setup();
          renderPanel(makeReviewResponse({ lines: [line(), doubtfulLine(3)] }));

          await activate(user, within(row(0)).getByRole("button", { name: /Producto 2/ }));

          expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
          expect(within(row(0)).getByText(issue)).toBeInTheDocument();
          // D36: el foco va a la fila con el aviso resaltado, no a la opción; el usuario elige «Por caja».
          const perPack = within(row(0)).getByRole("button", { name: "Por caja" });
          await waitFor(() => expect(row(0)).toHaveFocus());
          expect(within(row(0)).getByTestId("invoice-review-line-notices")).toHaveAttribute("data-highlighted", "true");
          expect(loadButton()).toBeDisabled();

          now += 450;
          await user.click(perPack);

          expect(row(0)).toHaveAttribute("data-status", "resolved");
          // D39-6: el foco queda en la fila resuelta, no avanza solo.
          await waitFor(() => expect(row(0)).toHaveFocus());
        },
      );
    });

    it("6.18 por unidad: la línea leída por unidad con aviso de precio ofrece «Por unidad / Por bulto» sin marcar", () => {
      renderPanel(
        makeReviewResponse({
          lines: [doubtfulLine(2, 1, { match: { candidates: singleCandidate(2), issues: [PRICE_ISSUE] } })],
        }),
      );

      expect(within(row(0)).getByRole("button", { name: "Por unidad" })).toHaveAttribute("aria-pressed", "false");
      expect(within(row(0)).getByRole("button", { name: "Por bulto" })).toHaveAttribute("aria-pressed", "false");
    });

    describe("REP6-01 (C6-M1, D33-a): ni la autorrepetición ni un doble clic lento resuelven ni cargan", () => {
      /** Repetición del SO sobre el control enfocado; si nadie la cancela, un botón se activa (como el navegador). */
      const holdEnter = () => {
        const target = document.activeElement;
        if (!(target instanceof HTMLElement)) {
          throw new Error("Sin foco");
        }
        const unprevented = fireEvent.keyDown(target, { key: "Enter", repeat: true });
        if (unprevented && target instanceof HTMLButtonElement) {
          fireEvent.click(target, { detail: 0 });
        }
      };
      const options = (index: number) => Array.from(row(index).querySelectorAll<HTMLElement>("[data-choice]"));

      it.each([
        ["precio", priceLine],
        ["tamaño de empaque", packLine],
      ])("aviso de %s: ninguna opción viene marcada y ambas son botones enfocables (D39-5)", (_, line) => {
        renderPanel(makeReviewResponse({ lines: [line()] }));

        const [perUnit, perPack] = options(0);
        expect(perUnit).toHaveAttribute("aria-pressed", "false");
        expect(perPack).toHaveAttribute("aria-pressed", "false");
        expect(perUnit).not.toHaveAttribute("tabindex");
        expect(perPack).not.toHaveAttribute("tabindex");
      });

      it("Enter mantenido desde «Descartar línea»: no acepta la siguiente, no elige opción y no carga", async () => {
        const user = userEvent.setup();
        const props = renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), priceLine()] }));
        discardButton(0).focus();

        await user.keyboard("{Enter>}");
        await waitFor(() => expect(row(1)).toHaveFocus());
        for (let step = 0; step < 30; step += 1) {
          now += step === 0 ? 500 : 33;
          holdEnter();
        }
        await user.keyboard("{/Enter}");

        expect(row(0)).toHaveAttribute("data-status", "discarded");
        expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
        expect(options(1).map((option) => option.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
        expect(props.onLoad).not.toHaveBeenCalled();
      });

      it("Enter mantenido sin la marca de repetición: tras cambiar de fila exige un keyup nuevo", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));
        discardButton(0).focus();

        await user.keyboard("{Enter>}");
        await waitFor(() => expect(row(1)).toHaveFocus());
        now += 600;
        fireEvent.keyDown(row(1), { key: "Enter" });
        expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");

        await user.keyboard("{/Enter}");
        await user.keyboard("{Enter}");
        expect(row(1)).toHaveAttribute("data-status", "resolved");
      });

      it("Enter repetido sobre el chip, sobre la opción y sobre Cargar se ignora", async () => {
        const user = userEvent.setup();
        const props = renderPanel(makeReviewResponse({ lines: [priceLine()] }));
        now += 1000;

        within(row(0)).getByRole("button", { name: /Producto 2/ }).focus();
        holdEnter();
        expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
        expect(within(row(0)).queryByText("Producto elegido")).not.toBeInTheDocument();

        await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));
        now += 1000;
        const [perUnit] = options(0);
        // D36: el foco no va solo a la opción; aquí la enfoca el usuario.
        perUnit.focus();
        holdEnter();
        expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

        await user.click(options(0)[1]);
        expect(row(0)).toHaveAttribute("data-status", "resolved");
        now += 1000;
        expect(loadButton()).toBeEnabled();
        loadButton().focus();
        holdEnter();
        expect(props.onLoad).not.toHaveBeenCalled();
      });

      it("doble clic lento (2.º clic a 420 ms, detail 2) tras Descartar: no acepta el chip de la siguiente", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));

        await user.click(discardButton(0));
        now += 420;
        fireEvent.click(within(row(1)).getByRole("button", { name: /Producto 2/ }), { detail: 2 });

        expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
      });

      it("clic con detail 2 sobre la opción, Restaurar y Cargar se ignora", async () => {
        const user = userEvent.setup();
        const props = renderPanel(makeReviewResponse({ lines: [priceLine(), {}] }));

        await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));
        now += 1000;
        fireEvent.click(options(0)[1], { detail: 2 });
        expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

        await user.click(options(0)[1]);
        expect(row(0)).toHaveAttribute("data-status", "resolved");
        now += 1000;
        expect(loadButton()).toBeEnabled();
        fireEvent.click(loadButton(), { detail: 2 });
        expect(props.onLoad).not.toHaveBeenCalled();
      });

      it("el 2.º clic de un doble clic en «Descartar línea» no restaura la línea", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));

        await user.click(discardButton(0));
        now += 1000;
        fireEvent.click(within(row(0)).getByRole("button", { name: "Restaurar" }), { detail: 2 });

        expect(row(0)).toHaveAttribute("data-status", "discarded");
      });

      it("6.17 solo teclado: Enter acepta, Tab a la opción, la flecha lleva a «Por caja», Enter la elige y el foco queda en la fila", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [priceLine(), doubtfulLine(3)] }));
        await waitFor(() => expect(row(0)).toHaveFocus());

        await user.keyboard("{Enter}");
        const [perUnit, perPack] = options(0);
        // D36: Enter deja el foco en la fila; Tab lleva a «Por unidad» sin marcarla.
        expect(row(0)).toHaveFocus();
        await user.keyboard("{Tab}");
        expect(perUnit).toHaveFocus();
        expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

        now += 450;
        await user.keyboard("{ArrowRight}");
        // D39-5: la flecha solo mueve el foco.
        expect(perPack).toHaveFocus();
        expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
        now += 450;
        await user.keyboard("{Enter}");

        expect(perPack).toHaveAttribute("aria-pressed", "true");
        expect(row(0)).toHaveAttribute("data-status", "resolved");
        // D39-6: el foco queda en la fila resuelta.
        await waitFor(() => expect(row(0)).toHaveFocus());
      });

      it("6.17 solo teclado: Tab a la opción y Espacio sobre ella (no marcada) la elige", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [priceLine(), doubtfulLine(3)] }));
        await waitFor(() => expect(row(0)).toHaveFocus());

        await user.keyboard("{Enter}");
        const [perUnit] = options(0);
        await user.keyboard("{Tab}");
        expect(perUnit).toHaveFocus();
        now += 450;
        await user.keyboard(" ");

        expect(perUnit).toHaveAttribute("aria-pressed", "true");
        expect(row(0)).toHaveAttribute("data-status", "resolved");
      });

      it("puntero soltado fuera del panel: tras cambiar de fila un Enter normal sí acepta", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));

        // Toque en un chip arrastrado fuera: el pointerup llega a document.body, no al panel.
        fireEvent.pointerDown(within(row(1)).getByRole("button", { name: /Producto 2/ }), { pointerId: 7 });
        fireEvent.pointerUp(document.body, { pointerId: 7 });

        await user.click(discardButton(0));
        await waitFor(() => expect(row(1)).toHaveFocus());
        now += 500;
        await user.keyboard("{Enter}");

        expect(row(1)).toHaveAttribute("data-status", "resolved");
      });

      it("Enter pulsado y la ventana pierde el foco (Alt+Tab): tras cambiar de fila un Enter normal sí acepta", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));

        fireEvent.keyDown(screen.getByTestId("invoice-review-panel"), { key: "Enter" });
        fireEvent.blur(window);

        await user.click(discardButton(0));
        await waitFor(() => expect(row(1)).toHaveFocus());
        now += 500;
        await user.keyboard("{Enter}");

        expect(row(1)).toHaveAttribute("data-status", "resolved");
      });
    });

    describe("REP6-04: bajos de la pasada 6 (B6-1, B6-2, B-p6-1, B-p6-2)", () => {
      // Línea leída por unidad (sin `unit`): su empaque es «Bulto» por defecto.
      const unitPriceLine = (seed = 2) =>
        doubtfulLine(seed, 1, { match: { candidates: singleCandidate(seed), issues: [PRICE_ISSUE] } });
      const unitPackLine = (seed = 2) =>
        doubtfulLine(seed, 1, { match: { candidates: singleCandidate(seed), issues: [PACK_ISSUE] } });
      const options = (index: number) => Array.from(row(index).querySelectorAll<HTMLElement>("[data-choice]"));
      const blockers = () => screen.getByTestId("invoice-review-blockers");

      it("B6-1: tras «Restaurar», Espacio ×5 sobre la fila enfocada no desplaza el panel ni hace nada", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unmatchedLine(1, false), nameLine()] }));
        await user.click(discardButton(0));
        now += 1000;
        await user.click(within(row(0)).getByRole("button", { name: "Restaurar" }));
        await waitFor(() => expect(row(0)).toHaveFocus());

        for (let step = 0; step < 5; step += 1) {
          // `fireEvent` devuelve false si alguien llamó a preventDefault (sin él, el navegador desplaza).
          expect(fireEvent.keyDown(row(0), { key: " " })).toBe(false);
        }

        expect(row(0)).toHaveFocus();
        expect(row(0)).toHaveAttribute("data-status", "pending_unmatched");
        expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
      });

      it("B6-2: «Por unidad» y a 150 ms «Por caja» en la misma línea: se aplica la corrección", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [priceLine(), nameLine()] }));
        await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));
        now += 450;

        const [perUnit, perPack] = options(0);
        await user.click(perUnit);
        expect(perUnit).toHaveAttribute("aria-pressed", "true");
        now += 150;
        await user.click(perPack);

        expect(perPack).toHaveAttribute("aria-pressed", "true");
        expect(perUnit).toHaveAttribute("aria-pressed", "false");
        expect(perPack).toHaveFocus();
        expect(row(0)).toHaveAttribute("data-status", "resolved");
      });

      it("B6-2: la guarda sigue bloqueando otra fila tras elegir la opción", async () => {
        const user = userEvent.setup();
        renderPanel(
          makeReviewResponse({
            lines: [priceLine(), doubtfulLine(3, 1, { match: { candidates: singleCandidate(3) } })],
          }),
        );
        await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));
        now += 450;
        await user.click(options(0)[0]);
        now += 150;
        await user.click(within(row(1)).getByRole("button", { name: /Producto 3/ }));

        expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");
      });

      it("B-p6-1: tras tocar el candidato, la línea y el pie dicen qué falta elegir", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unitPackLine(), {}] }));

        await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));

        expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
        expect(within(row(0)).getByText("Elige cómo viene: Por unidad o Por bulto.")).toBeInTheDocument();
        expect(blockers()).toHaveTextContent("Falta elegir cómo viene en 1 línea.");
        expect(blockers()).not.toHaveTextContent("por resolver");
      });

      it("B-p6-1: con dos líneas así y otra pendiente, el pie dice «en 2 líneas» y cuenta aparte solo la otra", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [unitPackLine(2), unitPriceLine(3), unmatchedLine(4, false)] }));

        await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));
        now += 1000;
        await user.click(within(row(1)).getByRole("button", { name: /Producto 3/ }));

        expect(blockers()).toHaveTextContent("Queda 1 línea por resolver.");
        expect(blockers()).not.toHaveTextContent("Quedan 3");
        expect(blockers()).toHaveTextContent("Falta elegir cómo viene en 2 líneas.");

        now += 1000;
        await user.click(within(row(2)).getByRole("button", { name: "Descartar línea" }));
        expect(blockers()).toHaveTextContent("Falta elegir cómo viene en 2 líneas.");
        expect(blockers()).not.toHaveTextContent("por resolver");
      });

      it("B-p6-1: con una línea así y dos pendientes más, el genérico cuenta solo las otras dos", async () => {
        const user = userEvent.setup();
        renderPanel(
          makeReviewResponse({ lines: [unitPackLine(2), unmatchedLine(3, false), unmatchedLine(4, false)] }),
        );

        await user.click(within(row(0)).getByRole("button", { name: /Producto 2/ }));

        expect(blockers()).toHaveTextContent("Quedan 2 líneas por resolver.");
        expect(blockers()).toHaveTextContent("Falta elegir cómo viene en 1 línea.");
        expect(blockers()).not.toHaveTextContent("Quedan 3");
      });

      it("B-p6-2: el aviso de precio usa la misma palabra que la opción («bulto»)", () => {
        renderPanel(makeReviewResponse({ lines: [unitPriceLine()] }));

        expect(within(row(0)).getByRole("button", { name: "Por bulto" })).toBeInTheDocument();
        expect(
          within(row(0)).getByText(
            "¿Precio por bulto o por unidad? Sale a 0,51 REF por unidad y el último costo fue 0,05 REF.",
          ),
        ).toBeInTheDocument();
        expect(within(row(0)).queryByText(/Precio por caja/)).not.toBeInTheDocument();
      });
    });

    describe("REP6-05: el filtro de activación de REP6-01 en el selector de tasa y en el pie", () => {
      const printedResponse = () => makeReviewResponse({ lines: [nameLine()], extraction: { printedRate: 875.65 } });
      const todayRadio = () => screen.getByRole("radio", { name: "Tasa de hoy (900,00)" });
      const printedRadio = () => screen.getByRole("radio", { name: "Tasa de la factura (875,65)" });
      /** Enter sin la marca de repetición; si nadie lo cancela, un botón se activa (como el navegador). */
      const pressEnterOn = (target: HTMLElement) => {
        const unprevented = fireEvent.keyDown(target, { key: "Enter" });
        if (unprevented && target instanceof HTMLButtonElement) {
          fireEvent.click(target, { detail: 0 });
        }
      };
      /** Enter pulsado sobre la fila: acepta y el foco pasa a otro control con la tecla aún abajo. */
      const acceptWithEnterHeld = async (user: ReturnType<typeof userEvent.setup>) => {
        now += 1000;
        row(0).focus();
        await user.keyboard("{Enter>}");
        await waitFor(() => expect(row(0)).toHaveAttribute("data-status", "resolved"));
        now += 600;
      };

      it("la tasa preseleccionada es la del sistema, no la impresa", () => {
        renderPanel(printedResponse());

        expect(todayRadio()).toHaveAttribute("aria-checked", "true");
        expect(printedRadio()).toHaveAttribute("aria-checked", "false");
      });

      it("Enter mantenido sobre la tasa de la factura (con y sin marca de repetición tras cambiar de foco) no la elige", async () => {
        const user = userEvent.setup();
        renderPanel(printedResponse());
        await acceptWithEnterHeld(user);

        printedRadio().focus();
        const unprevented = fireEvent.keyDown(printedRadio(), { key: "Enter", repeat: true });
        if (unprevented) {
          fireEvent.click(printedRadio(), { detail: 0 });
        }
        pressEnterOn(printedRadio());
        expect(todayRadio()).toHaveAttribute("aria-checked", "true");

        await user.keyboard("{/Enter}");
        await user.keyboard("{Enter}");
        expect(printedRadio()).toHaveAttribute("aria-checked", "true");
      });

      it("doble clic lento (detail 2) sobre la tasa de la factura no la elige; un clic normal sí", async () => {
        const user = userEvent.setup();
        renderPanel(printedResponse());
        now += 1000;

        fireEvent.click(printedRadio(), { detail: 2 });
        expect(todayRadio()).toHaveAttribute("aria-checked", "true");

        await user.click(printedRadio());
        expect(printedRadio()).toHaveAttribute("aria-checked", "true");
        now += 1000;
        fireEvent.click(todayRadio(), { detail: 2 });
        expect(printedRadio()).toHaveAttribute("aria-checked", "true");
      });

      it("«Descartar escaneo»: el 2.º clic de un doble clic y un Enter sin soltar tras cambiar de foco se ignoran", async () => {
        const user = userEvent.setup();
        const props = renderPanel(makeReviewResponse({ lines: [nameLine()] }));
        const discardScan = screen.getByRole("button", { name: "Descartar escaneo" });
        now += 1000;

        fireEvent.click(discardScan, { detail: 2 });
        expect(props.onDiscard).not.toHaveBeenCalled();

        await acceptWithEnterHeld(user);
        discardScan.focus();
        pressEnterOn(discardScan);
        expect(props.onDiscard).not.toHaveBeenCalled();

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await user.keyboard("{/Enter}");
        await user.click(discardScan);
        // D36: el clic deliberado pide confirmación antes de descartar.
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar escaneo" }));
        expect(props.onDiscard).toHaveBeenCalledTimes(1);
      });

      it("«Ver detalle del total»: el 2.º clic de un doble clic no lo vuelve a plegar", async () => {
        const user = userEvent.setup();
        renderPanel(makeReviewResponse({ lines: [nameLine()] }));
        now += 1000;

        await user.click(screen.getByRole("button", { name: "Ver detalle del total" }));
        fireEvent.click(screen.getByRole("button", { name: "Ocultar detalle del total" }), { detail: 2 });

        expect(screen.getByRole("button", { name: "Ocultar detalle del total" })).toHaveAttribute("aria-expanded", "true");
      });

      it("la tasa del día que llega después de abrir la revisión pasa a ser la preseleccionada", () => {
        const props: InvoiceReviewPanelProps = {
          context: { taxRates: REVIEW_TAX_RATES },
          onDiscard: jest.fn(),
          onLoad: jest.fn(),
          onRescan: jest.fn(),
          response: printedResponse(),
        };
        const { rerender } = render(<InvoiceReviewPanel {...props} />);
        expect(screen.getByRole("radio", { name: "Tasa de la factura (875,65)" })).toHaveAttribute("aria-checked", "true");

        rerender(<InvoiceReviewPanel {...props} context={CONTEXT} />);

        expect(todayRadio()).toHaveAttribute("aria-checked", "true");
        expect(printedRadio()).toHaveAttribute("aria-checked", "false");
      });

      it("con la tasa elegida a mano antes de que llegue la del día, se respeta la elección", async () => {
        const user = userEvent.setup();
        const props: InvoiceReviewPanelProps = {
          context: { taxRates: REVIEW_TAX_RATES },
          onDiscard: jest.fn(),
          onLoad: jest.fn(),
          onRescan: jest.fn(),
          response: printedResponse(),
        };
        const { rerender } = render(<InvoiceReviewPanel {...props} />);
        now += 1000;
        await user.click(screen.getByRole("radio", { name: "Escribir la tasa" }));

        rerender(<InvoiceReviewPanel {...props} context={CONTEXT} />);

        expect(screen.getByRole("radio", { name: "Escribir la tasa" })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByRole("radio", { name: "Tasa de hoy (900,00)" })).not.toBeInTheDocument();
      });
    });
  });

  describe("REP3-03a (B7): tras «Nuevo producto» el foco no se pierde", () => {
    const created = async (response: InvoiceScanResponse) => {
      const user = userEvent.setup();
      renderPanel(response, { canCreateProduct: true });
      await user.click(within(row(0)).getByRole("button", { name: "Nuevo producto" }));
      await user.click(screen.getByRole("button", { name: "Crear producto" }));
    };

    it("con otra línea pendiente: el foco va a esa línea", async () => {
      await created(makeReviewResponse({ lines: [unmatchedLine(9, false), doubtfulLine(2)] }));

      expect(row(0)).toHaveAttribute("data-status", "resolved");
      await waitFor(() => expect(row(1)).toHaveFocus());
    });

    it("sin pendientes y Cargar deshabilitado por falta de proveedor: el foco va al buscador de proveedor", async () => {
      await created(
        makeReviewResponse({ lines: [unmatchedLine(9, false)], matched: { supplier: { candidates: [] } } }),
      );

      expect(row(0)).toHaveAttribute("data-status", "resolved");
      expect(loadButton()).toBeDisabled();
      const supplier = within(screen.getByRole("region", { name: "Datos de la factura" })).getByRole("combobox");
      await waitFor(() => expect(supplier).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    });

    it("sin pendientes y Cargar habilitado: el foco va al pie (D36: no a Cargar)", async () => {
      await created(makeReviewResponse({ lines: [unmatchedLine(9, false)] }));

      await waitFor(() => expect(reviewFooter()).toHaveFocus());
      expect(loadButton()).toBeEnabled();
    });

    describe("REP3-03f: sin pendientes, con proveedor y Cargar bloqueado por la diferencia", () => {
      /** Simula el layout de escritorio: lo que lleva `sm:hidden` (o está dentro) no tiene cajas. */
      const desktopLayout = (allHidden = false) =>
        jest.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
          const hidden = allHidden || this.closest(".sm\\:hidden") !== null;
          return { length: hidden ? 0 : 1 } as unknown as DOMRectList;
        });
      const mismatched = () =>
        makeReviewResponse({ lines: [unmatchedLine(9, false)], extraction: { total: 1000 } });

      afterEach(() => jest.restoreAllMocks());

      it("el foco va al pie (D36: no a la casilla de diferencia), no a «Ver detalle del total» oculto en escritorio", async () => {
        desktopLayout();
        await created(mismatched());

        expect(row(0)).toHaveAttribute("data-status", "resolved");
        expect(loadButton()).toBeDisabled();
        await waitFor(() => expect(reviewFooter()).toHaveFocus());
        expect(screen.getByRole("checkbox", { name: /Cargar con una diferencia de/ })).not.toBeChecked();
      });

      it("si ningún control del pie es visible, el foco va al pie y nunca a BODY", async () => {
        desktopLayout(true);
        await created(mismatched());

        expect(loadButton()).toBeDisabled();
        await waitFor(() => expect(screen.getByRole("contentinfo", { name: "Resumen de la revisión" })).toHaveFocus());
      });
    });
  });

  it("SCN-08-F1: factura duplicada sin compra registrada solo dice que ya se escaneó", () => {
    renderPanel(makeReviewResponse({ lines: [{}], matched: { duplicateOfScanId: "scan-anterior" } }));

    expect(screen.getByText(/ya se escaneó antes/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ver" })).not.toBeInTheDocument();
  });

  it("sin duplicado no consulta ninguna compra", () => {
    mockUseInvoiceScanPurchase.mockClear();
    renderPanel(makeReviewResponse({ lines: [{}] }));

    expect(mockUseInvoiceScanPurchase).not.toHaveBeenCalledWith(expect.any(String));
  });

  describe("REP-01: la misma foto de una factura ya confirmada", () => {
    const PURCHASE_ID = "00000000-0000-4000-8000-0000000000bb";

    it("avisa arriba con enlace a la compra y no deja cargarla otra vez", async () => {
      const user = userEvent.setup();
      const props = renderPanel({
        ...makeReviewResponse({ lines: [{}] }),
        cached: true,
        confirmedPurchase: { id: PURCHASE_ID, purchaseNumber: "C-000123" },
      });

      const notice = screen.getByTestId("invoice-review-confirmed-notice");
      expect(notice).toHaveTextContent("Esta factura ya se registró en la compra C-000123");
      expect(within(notice).getByRole("link", { name: "Ver" })).toHaveAttribute("href", `/purchases/${PURCHASE_ID}`);
      expect(loadButton()).toBeDisabled();
      expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent(
        "Esta factura ya se registró en la compra C-000123.",
      );

      await user.click(loadButton());
      expect(props.onLoad).not.toHaveBeenCalled();
    });

    it("REP-01-F1: con todas las líneas emparejadas no invita a cargar la compra ya registrada", () => {
      renderPanel({
        ...makeReviewResponse({ lines: [{}] }),
        cached: true,
        confirmedPurchase: { id: PURCHASE_ID, purchaseNumber: "C-000123" },
      });

      expect(screen.queryByText(/carga la compra/)).not.toBeInTheDocument();
    });

    it("sin número de compra legible igual avisa, enlaza y bloquea", () => {
      renderPanel({
        ...makeReviewResponse({ lines: [{}] }),
        cached: true,
        confirmedPurchase: { id: PURCHASE_ID, purchaseNumber: null },
      });

      const notice = screen.getByTestId("invoice-review-confirmed-notice");
      expect(notice).toHaveTextContent("Esta factura ya se registró en una compra");
      expect(within(notice).getByRole("link", { name: "Ver" })).toHaveAttribute("href", `/purchases/${PURCHASE_ID}`);
      expect(loadButton()).toBeDisabled();
    });

    it("sin compra ligada no hay aviso y se puede cargar", () => {
      renderPanel(makeReviewResponse({ lines: [{}] }));

      expect(screen.queryByTestId("invoice-review-confirmed-notice")).not.toBeInTheDocument();
      expect(loadButton()).toBeEnabled();
      expect(screen.getByText(/Revisa los totales y carga la compra/)).toBeInTheDocument();
    });
  });
});
