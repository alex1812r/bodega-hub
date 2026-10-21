import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    const props = renderPanel(makeReviewResponse({ lines: [{}, doubtfulLine(2, 0.99)] }));

    expect(within(row(1)).getByText("Dudosa")).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();
    expect(screen.getByTestId("invoice-review-blockers")).toHaveTextContent("Queda 1 línea por resolver.");

    await user.click(within(row(1)).getByRole("button", { name: /Producto 2/ }));

    expect(within(row(1)).getByText("Resuelta")).toBeInTheDocument();
    expect(loadButton()).toBeEnabled();
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
    const props = renderPanel(makeReviewResponse({ lines }));

    const visited: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await waitFor(() => expect(document.activeElement?.getAttribute("data-status")).toBe("pending_doubtful"));
      visited.push(document.activeElement?.getAttribute("data-line-index") ?? "");
      await user.keyboard("{Enter}");
    }

    expect(visited).toEqual(["15", "16", "17", "18", "19"]);
    await waitFor(() => expect(loadButton()).toHaveFocus());
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

  it("REP3-01: sin ningún total leído no hay casilla, se informa que no hay con qué comparar", () => {
    renderPanel(makeReviewResponse({ lines: [{}], extraction: { tax: 32 } }));

    expect(screen.getByTestId("invoice-review-no-reference")).toHaveTextContent("Sin total leído para comparar");
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
    await user.click(within(mayonesa).getByRole("radio", { name: "Por bulto" }));
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
    await user.keyboard("{Enter}");

    const units = within(row(1)).getByLabelText("Unidades por caja");
    await waitFor(() => expect(units).toHaveFocus());
    expect(row(1)).toHaveAttribute("data-status", "pending_doubtful");

    await user.keyboard("12{Enter}");

    expect(row(1)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(2)).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(loadButton()).toHaveFocus());
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

    it("sin pendientes y Cargar habilitado: el foco va a Cargar", async () => {
      await created(makeReviewResponse({ lines: [unmatchedLine(9, false)] }));

      await waitFor(() => expect(loadButton()).toHaveFocus());
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

      it("el foco va a la casilla de diferencia, no a «Ver detalle del total» oculto en escritorio", async () => {
        desktopLayout();
        await created(mismatched());

        expect(row(0)).toHaveAttribute("data-status", "resolved");
        expect(loadButton()).toBeDisabled();
        await waitFor(() => expect(screen.getByRole("checkbox", { name: /Cargar con una diferencia de/ })).toHaveFocus());
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
