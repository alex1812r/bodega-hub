/**
 * REP12-05 · M-qa-rep12-1 (D49, D52, D54): f19d a 390 táctil. Al elegir «Farmatodo» aparece el aviso
 * de factura duplicada y empuja la cabecera; el siguiente toque en el campo Proveedor caía en la
 * ETIQUETA de su casilla, la marcaba y habilitaba Cargar. La casilla del aviso queda como la de la
 * diferencia del pie: el texto no es su etiqueta, solo cambia con su propio control y una pulsación
 * nueva, y el aviso entra en la guarda de 1 s de useLayoutHold. B-qa-rep12-2: si la consulta de
 * duplicados falla, el pie lo dice (no bloquea, D52).
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceDuplicateMatch, InvoiceDuplicateQuery } from "@/modules/invoice-scan/contracts";
import type { ContactEntityOption } from "@/shared/components/EntityAutocomplete";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

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

// jsdom no trae `PointerEvent`: sin él los eventos de puntero llegan sin `pointerType` ni coordenadas.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const FARMATODO = "00000000-0000-4000-8000-0000000000f1";
const PURCHASE_ID = "00000000-0000-4000-8000-0000000000c8";
/** Puntos del repro a 390 × 844: la opción «Farmatodo» y el campo Proveedor antes del aviso. */
const OPTION = { clientX: 195, clientY: 501 };
const SUPPLIER_FIELD = { clientX: 195, clientY: 454 };
const CHECKBOX = { clientX: 40, clientY: 454 };

const farmatodo: ContactEntityOption = {
  id: FARMATODO,
  isActive: true,
  label: "Farmatodo",
  phone: "",
  taxId: "J-00030426-5",
  type: "proveedor",
};

/** f19d: «FARMACIA OPALO», sin RIF ni proveedor reconocido; la línea ya está resuelta. */
function f19Response() {
  return makeReviewResponse({
    lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
    extraction: { supplier: { name: "FARMACIA OPALO" }, number: "00362952", date: "2026-09-03", total: 1750 },
    matched: { supplier: {} },
  });
}

const MATCHES: InvoiceDuplicateMatch[] = [
  { scanId: "scan-previo", purchaseId: PURCHASE_ID, number: "00362952", date: "2026-09-03" },
];

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.scrollBy = jest.fn();
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  Reflect.deleteProperty(Element.prototype, "scrollBy");
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function renderPanel(overrides: Partial<InvoiceReviewPanelProps> = {}) {
  const props: InvoiceReviewPanelProps = {
    context: CONTEXT,
    duplicateFetcher: jest.fn(async (query: InvoiceDuplicateQuery) => (query.supplierId === FARMATODO ? MATCHES : [])),
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

const pointer = (point: { clientX: number; clientY: number }) => ({ ...point, pointerId: 1, pointerType: "touch" });

/** Toque real: pointerdown, pointerup y clic con su punto (`detail` 1). */
function tap(element: Element, point: { clientX: number; clientY: number }) {
  fireEvent.pointerDown(element, pointer(point));
  fireEvent.pointerUp(element, pointer(point));
  fireEvent.click(element, { ...point, detail: 1 });
}

/** Escribe «Farma» y toca «Farmatodo»; a los 300 ms responde la consulta de duplicados (aviso a la vista). */
async function chooseFarmatodoByTouch() {
  const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
  await user.type(screen.getByRole("combobox", { name: /proveedor/i }), "Farma");
  const option = await screen.findByRole("option", { name: /farmatodo/i });
  tap(option, OPTION);
  await advance(300);
}

const duplicateCheckbox = () => screen.getByRole("checkbox", { name: /cargarla igual/i });
const loadButton = () => screen.getByRole("button", { name: "Cargar en la compra" });

describe("REP12-05 · M-qa-rep12-1: el toque tras elegir el proveedor no reconoce el duplicado", () => {
  it.each([400, 700, 1500])("tocar el texto del aviso recién aparecido a los %i ms no marca la casilla", async (at) => {
    renderPanel();
    await chooseFarmatodoByTouch();
    expect(screen.getByText(/ya se registró en una compra/)).toBeInTheDocument();
    expect(loadButton()).toBeDisabled();

    await advance(at - 300);
    tap(screen.getByText(/No es la misma compra, o quiero cargarla igual/), SUPPLIER_FIELD);

    expect(duplicateCheckbox()).not.toBeChecked();
    expect(loadButton()).toBeDisabled();
  });

  it("el texto no es la etiqueta de la casilla (aria-labelledby)", async () => {
    renderPanel();
    await chooseFarmatodoByTouch();

    expect(duplicateCheckbox().closest("label")).toBeNull();
    expect(duplicateCheckbox()).toHaveAttribute("aria-labelledby");
  });

  it("un toque en la propia casilla antes de 1 s desde que apareció no la marca; pasado 1 s, sí", async () => {
    renderPanel();
    await chooseFarmatodoByTouch();

    await advance(400);
    tap(duplicateCheckbox(), CHECKBOX);
    expect(duplicateCheckbox()).not.toBeChecked();

    await advance(700);
    tap(duplicateCheckbox(), CHECKBOX);
    expect(duplicateCheckbox()).toBeChecked();
    expect(loadButton()).toBeEnabled();
  });

  it("una pulsación que empezó antes de que apareciera la casilla no cuenta", async () => {
    let resolve: (matches: InvoiceDuplicateMatch[]) => void = () => undefined;
    renderPanel({
      duplicateFetcher: jest.fn(
        (query: InvoiceDuplicateQuery) =>
          new Promise<InvoiceDuplicateMatch[]>((done) => {
            resolve = query.supplierId === FARMATODO ? done : () => undefined;
            if (query.supplierId !== FARMATODO) {
              done([]);
            }
          }),
      ),
    });
    const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
    await user.type(screen.getByRole("combobox", { name: /proveedor/i }), "Farma");
    tap(await screen.findByRole("option", { name: /farmatodo/i }), OPTION);
    await advance(2000);
    // El dedo baja; la respuesta llega y el aviso aparece bajo él; el dedo sube. Pasada la guarda de
    // 1 s, ese clic sigue sin contar: la pulsación empezó antes de que existiera la casilla.
    const field = screen.getByRole("combobox", { name: /proveedor/i });
    fireEvent.pointerDown(field, pointer(CHECKBOX));
    await act(async () => resolve(MATCHES));
    await advance(1100);
    fireEvent.pointerUp(duplicateCheckbox(), pointer(CHECKBOX));
    fireEvent.click(duplicateCheckbox(), { ...CHECKBOX, detail: 1 });
    expect(duplicateCheckbox()).not.toBeChecked();

    tap(duplicateCheckbox(), CHECKBOX);
    expect(duplicateCheckbox()).toBeChecked();
  });

  it("con el teclado (Espacio, clic sin puntero) sí se marca", async () => {
    renderPanel();
    await chooseFarmatodoByTouch();

    fireEvent.click(duplicateCheckbox(), { detail: 0 });

    expect(duplicateCheckbox()).toBeChecked();
    expect(loadButton()).toBeEnabled();
  });
});

describe("REP12-05 · B-qa-rep12-2: si la consulta de duplicados falla, el pie lo dice", () => {
  it("no bloquea (D52) pero avisa que no se pudo comprobar", async () => {
    renderPanel({
      duplicateFetcher: jest.fn(async (query: InvoiceDuplicateQuery) => {
        if (query.supplierId === FARMATODO) {
          throw new Error("500");
        }
        return [];
      }),
    });
    expect(screen.queryByText(/No se pudo comprobar si la factura ya se cargó/)).not.toBeInTheDocument();

    await chooseFarmatodoByTouch();

    expect(loadButton()).toBeEnabled();
    expect(
      within(screen.getByRole("contentinfo", { name: "Resumen de la revisión" })).getByText(
        "No se pudo comprobar si la factura ya se cargó.",
      ),
    ).toBeInTheDocument();
  });
});
