import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";

import {
  createInvoiceReviewState,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "../reviewModel";
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";
import { InvoiceReviewTaxNotice } from "./InvoiceReviewTaxNotice";
import { useLayoutHold } from "./useLayoutHold";

/**
 * REP15-01c · D65: residuos de REP15-01b.
 * (a) Con la tasa escrita antes de que llegue la del día, el aviso de tasa ya reserva el alto de cuando llegue (las
 *     opciones con la de hoy, «La factura trae…» y el campo); la reserva sigue tras la llegada.
 * (b) useLayoutHold: si cambia el ancho del panel, un aviso que cambió de alto no guarda los controles de debajo.
 * (c) El aviso de IVA no cambia con lo que llega tarde (tasa del día, último costo): no necesita reserva.
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

const response = makeReviewResponse({
  extraction: { printedRate: 895 },
  lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
});

function panel(systemRateVes?: number) {
  const props: InvoiceReviewPanelProps = {
    context: { taxRates: REVIEW_TAX_RATES, ...(systemRateVes !== undefined ? { systemRateVes } : {}) },
    duplicateFetcher: async () => [],
    onDiscard: () => undefined,
    onLoad: () => undefined,
    onRescan: () => undefined,
    response,
  };
  return <InvoiceReviewPanel {...props} />;
}

/** Cajas de reserva del aviso de tasa (fuera de «Datos de la factura»). */
function rateReserves(container: Element) {
  return [...container.querySelectorAll("[data-layout-notice] > [data-layout-reserve]")].filter(
    (reserve) => !reserve.closest('section[aria-label="Datos de la factura"]'),
  );
}

/** Hay una caja reservada con las opciones de la tasa de hoy, «La factura trae…» y el campo de la tasa escrita. */
function reservesArrivalWithManual(container: Element) {
  return rateReserves(container).some(
    (reserve) =>
      reserve.querySelector('[data-reserve^="Tasa de hoy"]') !== null &&
      reserve.querySelector('[data-reserve^="La factura trae tasa"]') !== null &&
      reserve.querySelector('[data-reserve="Tasa Bs por REF"]') !== null &&
      reserve.querySelector('[data-reserve^="Ya hay tasa del día"]') !== null,
  );
}

describe("REP15-01c (a) · la tasa escrita antes de que llegue la del día", () => {
  it("el aviso reserva desde antes de la llegada el alto que tendrá con las opciones y lo conserva tras ella", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(panel());

    await user.click(screen.getByRole("radio", { name: "Escribir la tasa" }));
    await user.type(screen.getByLabelText("Tasa Bs por REF"), "950");

    expect(screen.queryByRole("radio", { name: /Tasa de hoy/ })).not.toBeInTheDocument();
    expect(reservesArrivalWithManual(container)).toBe(true);

    rerender(panel(1000));

    expect(screen.getByText(/La factura trae tasa/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Tasa de hoy/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Tasa Bs por REF")).toBeInTheDocument();
    expect(reservesArrivalWithManual(container)).toBe(true);
    expect(rateReserves(container).every((reserve) => reserve.textContent === "")).toBe(true);
  });
});

/** Geometría simulada: ancho del panel, alto del aviso y punto de pantalla de las filas. */
const geometry = { width: 390, notice: 40, anchorTop: 100 };

function fakeRect(this: Element) {
  const area = this.closest<HTMLElement>("[data-geo]")?.dataset.geo;
  let top = 0;
  let height = 0;
  if (area === "notice") {
    height = geometry.notice;
  } else if (area === "anchor") {
    top = geometry.anchorTop;
    height = 50;
  } else if (area === "root") {
    height = 1000;
  }
  const width = geometry.width;
  return { bottom: top + height, height, left: 0, right: width, top, width, x: 0, y: top, toJSON: () => ({}) };
}

let movedByCompaction: (control: Element) => boolean = () => false;

function Harness({ tick }: { tick: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hold = useLayoutHold<string[]>(rootRef, () => undefined);
  useEffect(() => {
    movedByCompaction = hold.movedByCompaction;
  }, [hold.movedByCompaction]);
  return (
    <div data-geo="root" data-tick={tick} ref={rootRef}>
      <div data-geo="notice" data-layout-notice />
      <section data-geo="anchor" data-layout-notice-anchor>
        <button type="button">Fila</button>
      </section>
    </div>
  );
}

describe("REP15-01c (b) · useLayoutHold con otro ancho", () => {
  let rect: jest.SpyInstance;

  beforeEach(() => {
    geometry.width = 390;
    geometry.notice = 40;
    geometry.anchorTop = 100;
    Element.prototype.scrollBy = jest.fn();
    rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
  });

  afterEach(() => {
    rect.mockRestore();
    Reflect.deleteProperty(Element.prototype, "scrollBy");
  });

  it("si el aviso cambia de alto con el mismo ancho, el control de debajo queda guardado", () => {
    const { rerender } = render(<Harness tick={0} />);
    geometry.notice = 70;
    geometry.anchorTop = 130;
    rerender(<Harness tick={1} />);

    expect(movedByCompaction(screen.getByRole("button", { name: "Fila" }))).toBe(true);
  });

  it("si cambia el ancho (giro, ventana), el aviso que cambió de alto no guarda el control de debajo", () => {
    const { rerender } = render(<Harness tick={0} />);
    geometry.width = 768;
    geometry.notice = 70;
    geometry.anchorTop = 130;
    rerender(<Harness tick={1} />);

    expect(movedByCompaction(screen.getByRole("button", { name: "Fila" }))).toBe(false);
  });
});

describe("REP15-01c (c) · el aviso de IVA y lo que llega tarde", () => {
  it("la tasa del día y el último costo no cambian el aviso de IVA", () => {
    const taxResponse = makeReviewResponse({
      lines: [
        { read: { quantity: 1, unitPrice: 104.4, lineTotal: 104.4 }, match: { taxRateCode: "general" } },
      ],
      extraction: { printedRate: 895, subtotal: 90, tax: 16, total: undefined },
    });
    const opened = createInvoiceReviewState(taxResponse, { taxRates: REVIEW_TAX_RATES });
    // Acción del usuario: elegir un producto en el buscador lanza la consulta del último costo.
    const chosen = reviewReducer(opened, {
      type: "chooseProduct",
      index: 0,
      product: { name: "Otra harina", productId: productUuid(77) },
    });
    const arrivals: InvoiceReviewAction[] = [
      { type: "adoptSystemRate", systemRateVes: 1000 },
      { type: "setLastUnitCost", index: 0, productId: productUuid(77), result: 50 },
    ];
    const html = (state: InvoiceReviewState) => {
      const { container, unmount } = render(<InvoiceReviewTaxNotice onAction={() => undefined} state={state} />);
      const markup = container.innerHTML;
      unmount();
      return markup;
    };

    const before = html(chosen);
    expect(before).toContain("invoice-review-tax-notice");
    let state = chosen;
    for (const action of arrivals) {
      const next = reviewReducer(state, action);
      expect(next).not.toBe(state);
      expect(html(next)).toBe(before);
      state = next;
    }
  });
});
