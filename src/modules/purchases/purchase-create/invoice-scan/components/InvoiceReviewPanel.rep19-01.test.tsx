import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";

import { INVOICE_DUPLICATES_DEBOUNCE_MS } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import type { InvoiceDuplicateMatch, InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import { makeReviewResponse, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";
import { FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import { COMPACTION_GUARD_MS, useLayoutHold } from "./useLayoutHold";

/**
 * REP19-01 · D77 (M-p20B-1): la guarda de lo que aparece bajo el dedo decide por CAUSA, no por tiempo. Cada llegada
 * asíncrona se declara donde se resuelve; lo que aparece, se habilita o se mueve respecto a la foto previa a ESA llegada
 * queda guardado 1 s para el puntero, esté o no el usuario tecleando (a). Lo que aparece por un gesto, sin llegada, no se
 * guarda (b). Llegada y gesto juntos: solo lo que difiere de la foto previa a la llegada (c). El teclado no se bloquea.
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

/** Deja pasar la consulta de duplicados y cualquier guarda previa. */
const QUIET_MS = INVOICE_DUPLICATES_DEBOUNCE_MS + COMPACTION_GUARD_MS;

function props(response: InvoiceScanResponse, overrides: Partial<InvoiceReviewPanelProps> = {}) {
  return {
    context: { taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: jest.fn(async () => []),
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
    ...overrides,
  } satisfies InvoiceReviewPanelProps;
}

let touchPoint = 0;

/** Toque real (punto de pantalla y `detail` 1), cada vez en otro punto: solo cuenta la guarda de lo aparecido. */
function touch(element: Element) {
  touchPoint += 1;
  const point = { clientX: 40 + touchPoint * 100, clientY: 60, detail: 1 };
  fireEvent.pointerDown(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseDown(element, point);
  fireEvent.pointerUp(element, { ...point, pointerId: 3, pointerType: "touch" });
  fireEvent.mouseUp(element, point);
  fireEvent.click(element, point);
}

function row(index: number) {
  const line = document.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!line) {
    throw new Error(`Sin la fila ${index}`);
  }
  return line;
}

function perUnit(index: number) {
  return within(row(index)).getByRole("button", { name: /Por unidad/ });
}

/** Una tecla real en `field` (keydown, cambio de valor, keyup): el usuario está tecleando ahí. */
function typeKey(field: HTMLInputElement, value: string) {
  fireEvent.keyDown(field, { key: value.at(-1) ?? "Backspace" });
  fireEvent.change(field, { target: { value } });
  fireEvent.keyUp(field, { key: value.at(-1) ?? "Backspace" });
}

describe("REP19-01 · D77(a) · una llegada declarada durante el tecleo en otro campo queda guardada", () => {
  it("tasa: «Por unidad» que aparece mientras se teclea el número de factura no se elige con el toque; pasado 1 s, sí", async () => {
    const base = props(FIXTURES.tasa3.response);
    const view = render(<InvoiceReviewPanel {...base} />);
    await advance(QUIET_MS);
    const field = screen.getByLabelText<HTMLInputElement>("Número de factura");

    typeKey(field, `${field.value}4`);
    await advance(30);
    typeKey(field, `${field.value}5`);
    // La tasa llega entre dos teclas (M-p20B-1: 0,3–0,9 s antes del toque, dentro del «turno» de REP18).
    view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);
    typeKey(field, field.value.slice(0, -1));
    await advance(30);
    typeKey(field, field.value.slice(0, -1));
    await advance(300);

    touch(perUnit(1));
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "false");

    await advance(COMPACTION_GUARD_MS);
    touch(perUnit(1));
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "true");
  });

  it("duplicados: «Cargar» que habilita la respuesta mientras se teclea en otro campo no carga con el toque", async () => {
    let answer: (matches: InvoiceDuplicateMatch[]) => void = () => undefined;
    const duplicateFetcher = jest.fn(
      () =>
        new Promise<InvoiceDuplicateMatch[]>((resolve) => {
          answer = resolve;
        }),
    );
    const base = props(makeReviewResponse({ lines: [{ match: { taxRateCode: "exento" } }], extraction: { total: 200 } }), {
      context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
      duplicateFetcher,
    });
    render(<InvoiceReviewPanel {...base} />);
    const number = screen.getByLabelText<HTMLInputElement>("Número de factura");
    typeKey(number, `${number.value}4`);
    await advance(QUIET_MS);
    const load = screen.getByRole("button", { name: "Cargar en la compra" });
    expect(load).toBeDisabled();

    // Teclas en otro campo (mueven el cursor, no cambian nada) y, entre ellas, la respuesta.
    const date = screen.getByLabelText<HTMLInputElement>(/Fecha/);
    fireEvent.keyDown(date, { key: "ArrowLeft" });
    await act(async () => answer([]));
    fireEvent.keyDown(date, { key: "ArrowRight" });
    await advance(300);

    expect(load).toBeEnabled();
    touch(load);
    expect(base.onLoad).not.toHaveBeenCalled();

    await advance(COMPACTION_GUARD_MS);
    touch(load);
    expect(base.onLoad).toHaveBeenCalledTimes(1);
  });

  it("el teclado no se bloquea: Enter sobre la opción que llegó durante el tecleo la elige", async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) });
    const base = props(FIXTURES.tasa3.response);
    const view = render(<InvoiceReviewPanel {...base} />);
    await advance(QUIET_MS);
    const field = screen.getByLabelText<HTMLInputElement>("Número de factura");
    typeKey(field, `${field.value}4`);
    view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);

    act(() => perUnit(1).focus());
    await user.keyboard("{Enter}");
    expect(perUnit(1)).toHaveAttribute("aria-pressed", "true");
  });
});

/** «Cambiar producto» de la confirmada L0, que aparece (con su fila) al desplegar las confirmadas. */
function changeProduct() {
  const line = document.querySelector<HTMLElement>('li[data-line-index="0"]');
  return line ? within(line).queryByRole("button", { name: /Cambiar producto/ }) : null;
}

function confirmedToggle() {
  const toggle = [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) =>
    /confirmada/.test(button.textContent ?? ""),
  );
  if (!toggle) {
    throw new Error("Sin «1 línea confirmada · ver»");
  }
  return toggle;
}

describe("REP19-01 · D77(b) · lo que aparece por un gesto, sin llegada, no se guarda", () => {
  it("M-q1809-1: «Cambiar producto» tocado 300 ms después de «1 línea confirmada · ver» actúa", async () => {
    render(<InvoiceReviewPanel {...props(FIXTURES.estados.response, { context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES } })} />);
    await advance(QUIET_MS);
    expect(changeProduct()).toBeNull();

    touch(confirmedToggle());
    await advance(300);
    const button = changeProduct();
    if (!button) {
      throw new Error("No aparece «Cambiar producto»");
    }
    touch(button);

    expect(within(row(0)).getByRole("combobox")).toBeInTheDocument();
  });
});

describe("REP19-01 · D77(c) · llegada y gesto en el mismo commit: solo lo que difiere de la foto previa a la llegada", () => {
  it("«Cambiar producto» (del gesto) actúa; «Por unidad» (de la tasa) no", async () => {
    const base = props(FIXTURES.estados.response);
    const view = render(<InvoiceReviewPanel {...base} />);
    await advance(QUIET_MS);

    act(() => {
      touch(confirmedToggle());
      view.rerender(<InvoiceReviewPanel {...base} context={{ systemRateVes: 900, taxRates: REVIEW_TAX_RATES }} />);
    });
    await advance(300);

    touch(perUnit(4));
    expect(perUnit(4)).toHaveAttribute("aria-pressed", "false");
    const button = changeProduct();
    if (!button) {
      throw new Error("No aparece «Cambiar producto»");
    }
    touch(button);
    expect(within(row(0)).getByRole("combobox")).toBeInTheDocument();
  });
});

/**
 * D76(a) sobre el mecanismo: una lista flotante que pasa de no tener opciones a tenerlas es del usuario; la llegada que
 * pone otra opción en una lista que ya las tenía (un refresco, resultados tardíos), guardada.
 */
function ListHarness({ onPick }: { onPick: (label: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hold = useLayoutHold<null>(rootRef, () => undefined);
  const [options, setOptions] = useState<string[]>([]);
  return (
    <div ref={rootRef}>
      <button onClick={() => hold.arrival.arrive(() => setOptions(["Arroz"]))} type="button">
        Primer listado
      </button>
      <button onClick={() => hold.arrival.arrive(() => setOptions(["Otra", "Arroz"]))} type="button">
        Refresco
      </button>
      <ul role="listbox">
        {options.map((label) => (
          <li
            key={label}
            onClick={(event) => {
              if (!hold.movedByCompaction(event.currentTarget)) {
                onPick(label);
              }
            }}
            role="option"
            aria-selected={false}
          >
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

describe("REP19-01 · D76(a) con D77 · primer listado tocable; refresco que pone otra opción bajo el dedo, guardado", () => {
  it("las opciones del primer listado se eligen antes de 1 s; las de un refresco, no", async () => {
    const onPick = jest.fn();
    render(<ListHarness onPick={onPick} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Primer listado" }), { detail: 0 }));
    touch(screen.getByRole("option", { name: "Arroz" }));
    expect(onPick).toHaveBeenLastCalledWith("Arroz");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresco" }), { detail: 0 }));
    touch(screen.getByRole("option", { name: "Otra" }));
    expect(onPick).toHaveBeenCalledTimes(1);

    await advance(COMPACTION_GUARD_MS);
    touch(screen.getByRole("option", { name: "Otra" }));
    expect(onPick).toHaveBeenLastCalledWith("Otra");
  });
});
