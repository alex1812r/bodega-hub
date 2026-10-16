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
    expect(draft.costCurrency).toBe("ref");
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
      /Total leído Bs\. 1\.000,00\s*·\s*Total calculado Bs\. 232,00/,
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
    expect(screen.getByText("Los totales cuadran")).toBeInTheDocument();
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
});
