import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import type { InvoiceDuplicateMatch, InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewDraft } from "../reviewDraft";
import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";
import { COMPACTION_GUARD_MS } from "./useLayoutHold";

/**
 * REP17-01 · D70(a)(d): la clase de layout asíncrono en la cabecera y tras las filas (M-p18B-1, B-p18B-1).
 * - Con la tasa escrita a mano, la del día que llega no se aplica sola, el campo sigue antes (encima) de la opción
 *   «Tasa de hoy», que va en su sitio reservado DEBAJO, y la elección es reversible (se vuelve a la tasa escrita).
 * - Con la impresa (abierta sin tasa del día), «Tasa de la factura» sigue primera en su fila y «Tasa de hoy» va debajo.
 * - Guarda D49 en la cabecera: un toque a una opción que acaba de aparecer sin acción del usuario no la elige.
 * - El aviso de posible duplicado reserva su sitio desde el primer render mientras haya consulta (su respuesta puede
 *   llegar, también tras cambiar proveedor, número o fecha): lo que aparece tras las filas no baja el pie.
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

const LINE = { read: { quantity: 1, unitPrice: 1900, lineTotal: 1900 }, match: { taxRateCode: "exento" } };
const RATE_LABEL = "Tasa Bs por REF";

/** Sin tasa impresa: sin tasa del día se pide escribirla. */
const noPrinted = () => makeReviewResponse({ lines: [LINE], extraction: { total: 1900 } });
const printed = () => makeReviewResponse({ lines: [LINE], extraction: { printedRate: 895, total: 1900 } });

const MATCH: InvoiceDuplicateMatch = {
  date: "2026-10-14",
  number: "000123",
  purchaseId: null,
  scanId: "00000000-0000-4000-8000-0000000000d1",
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function props(response: InvoiceScanResponse, systemRateVes?: number, overrides: Partial<InvoiceReviewPanelProps> = {}) {
  return {
    context: { taxRates: REVIEW_TAX_RATES, ...(systemRateVes !== undefined ? { systemRateVes } : {}) },
    duplicateFetcher: jest.fn(async () => []),
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
    ...overrides,
  } satisfies InvoiceReviewPanelProps;
}

function follows(first: Element, second: Element) {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function radio(name: RegExp) {
  return screen.getByRole("radio", { name });
}

/** Toque real (con punto de pantalla y `detail` 1): pasa por la guarda espacial del panel. */
function touch(element: Element) {
  const point = { clientX: 40, clientY: 60, detail: 1 };
  fireEvent.pointerDown(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseDown(element, point);
  fireEvent.pointerUp(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseUp(element, point);
  fireEvent.click(element, point);
}

/** Escribe 950 a mano, sale del campo y deja pasar el turno del usuario; luego llega la tasa del día (900). */
async function typedRateThenSystem(response: InvoiceScanResponse) {
  const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
  const base = props(response);
  const view = render(<InvoiceReviewPanel {...base} />);
  if (response.extraction.printedRate !== undefined) {
    await user.click(radio(/Escribir la tasa/));
  }
  await user.type(screen.getByLabelText(RATE_LABEL), "950");
  await user.tab();
  await advance(INVOICE_DUPLICATES_DEBOUNCE_MS + COMPACTION_GUARD_MS);
  view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);
  return { base, user, view };
}

describe("REP17-01 · M-p18B-1 · tasa escrita a mano y luego llega la del día", () => {
  it("no se sustituye: el campo sigue con 950 y antes de «Tasa de hoy», que se ofrece debajo sin elegirse", async () => {
    await typedRateThenSystem(noPrinted());

    const field = screen.getByLabelText(RATE_LABEL);
    const today = radio(/Tasa de hoy \(900,00\)/);
    expect(field).toHaveValue("950");
    expect(today).toHaveAttribute("aria-checked", "false");
    expect(radio(/Escribir la tasa/)).toHaveAttribute("aria-checked", "true");
    // Nunca encima del campo: lo que llega va después en el documento (debajo o al lado).
    expect(follows(field, today)).toBe(true);
    expect(screen.getByText(/se usa la tasa escrita \(Bs\. 950,00\)/)).toBeInTheDocument();
  });

  it("es reversible: elegida «Tasa de hoy», se vuelve a la tasa escrita con su valor", async () => {
    const { base, user } = await typedRateThenSystem(noPrinted());
    await advance(COMPACTION_GUARD_MS);

    await user.click(radio(/Tasa de hoy/));
    expect(radio(/Tasa de hoy/)).toHaveAttribute("aria-checked", "true");

    await advance(COMPACTION_GUARD_MS);
    await user.click(radio(/Escribir la tasa/));

    expect(radio(/Escribir la tasa/)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(RATE_LABEL)).toHaveValue("950");
    await user.click(screen.getByRole("button", { name: "Cargar en la compra" }));
    expect((base.onLoad as jest.Mock).mock.calls[0][0] as InvoiceReviewDraft).toMatchObject({ rateVes: 950 });
  });

  it("guarda D49 en la cabecera: el toque a «Tasa de hoy» recién aparecida no la elige; pasado 1 s, sí", async () => {
    await typedRateThenSystem(noPrinted());

    touch(radio(/Tasa de hoy/));
    expect(radio(/Tasa de hoy/)).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText(RATE_LABEL)).toHaveValue("950");

    await advance(COMPACTION_GUARD_MS);
    touch(radio(/Tasa de hoy/));
    expect(radio(/Tasa de hoy/)).toHaveAttribute("aria-checked", "true");
  });

  it("con la impresa: escrita a mano, «Tasa de la factura» y «Escribir la tasa» siguen encima y «Tasa de hoy» debajo", async () => {
    await typedRateThenSystem(printed());

    const group = screen.getByRole("radiogroup", { name: "Tasa para convertir los costos" });
    const field = screen.getByLabelText(RATE_LABEL);
    expect(within(group).getByRole("radio", { name: /Tasa de hoy/ })).toHaveAttribute("aria-checked", "false");
    expect(follows(radio(/Tasa de la factura/), field)).toBe(true);
    expect(follows(radio(/Escribir la tasa/), field)).toBe(true);
    expect(follows(field, radio(/Tasa de hoy/))).toBe(true);
  });
});

describe("REP17-01 · «Panel estadosImpresa» · la del día llega con la impresa preseleccionada", () => {
  it("«Tasa de la factura» sigue primera en su fila y «Tasa de hoy» va después", () => {
    const base = props(printed());
    const view = render(<InvoiceReviewPanel {...base} />);
    const printedBefore = radio(/Tasa de la factura/);

    view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 1000, taxRates: REVIEW_TAX_RATES }} />);

    expect(radio(/Tasa de hoy/)).toHaveAttribute("aria-checked", "true");
    expect(radio(/Tasa de la factura/)).toBe(printedBefore);
    expect(follows(radio(/Tasa de la factura/), radio(/Tasa de hoy/))).toBe(true);
  });
});

describe("REP17-01 · B-p18B-1 · el aviso de duplicado tardío", () => {
  it("reserva su sitio tras las líneas desde el primer render, su aviso lo ocupa y sin coincidencia sigue reservado", async () => {
    let answer: (matches: InvoiceDuplicateMatch[]) => void = () => undefined;
    const duplicateFetcher = jest.fn(
      () =>
        new Promise<InvoiceDuplicateMatch[]>((resolve) => {
          answer = resolve;
        }),
    );
    const { container } = render(<InvoiceReviewPanel {...props(noPrinted(), 900, { duplicateFetcher })} />);
    const lines = screen.getByRole("region", { name: "Líneas de la factura" });
    const afterLines = () => {
      const notice = lines.nextElementSibling;
      if (!notice) {
        throw new Error("Sin el sitio del aviso tras las líneas");
      }
      return notice;
    };

    expect(afterLines().querySelector("[data-layout-reserve]")).not.toBeNull();
    expect(afterLines().querySelector("[data-layout-reserve]")?.textContent).toBe("");

    await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);
    await act(async () => answer([MATCH]));

    expect(within(afterLines() as HTMLElement).getByText(/ya se escaneó antes en la tienda/)).toBeInTheDocument();
    expect(afterLines().querySelector("[data-layout-reserve]")).not.toBeNull();
    expect(container.querySelectorAll('[role="status"] input[type="checkbox"]')).toHaveLength(1);
  });

  it("sin coincidencia el sitio sigue reservado (otra respuesta, tras cambiar el número, puede traer el aviso)", async () => {
    render(<InvoiceReviewPanel {...props(noPrinted(), 900)} />);
    const lines = screen.getByRole("region", { name: "Líneas de la factura" });

    await advance(INVOICE_DUPLICATES_DEBOUNCE_MS);

    expect(screen.queryByText(/ya se escaneó antes/)).not.toBeInTheDocument();
    expect(lines.nextElementSibling?.querySelector("[data-layout-reserve]")).not.toBeNull();
  });

  it("sin consulta posible (sin número, fecha ni total) no reserva nada", () => {
    render(
      <InvoiceReviewPanel
        {...props(makeReviewResponse({ lines: [LINE], extraction: { number: undefined, date: undefined, total: undefined } }), 900)}
      />,
    );
    const lines = screen.getByRole("region", { name: "Líneas de la factura" });

    expect(lines.nextElementSibling?.querySelector("[data-layout-reserve]") ?? null).toBeNull();
  });
});
