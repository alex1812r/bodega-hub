/**
 * REP15-03 · D65 (B-p16B-2): en el pie (lista de motivos de 3 renglones), tras desplazar la lista hasta el final y
 * resolver un motivo, los que quedan ocultos POR ARRIBA tienen su indicio «y N más ↑», con la cuenta correcta, que
 * aparece y se va con el desplazamiento y al resolver motivos. Ningún indicio tapa texto de un motivo (tampoco el
 * «y N más ↓», O-qa06b-1). «Cargar» no se mueve y el pie mide lo mismo, en px, antes y después: 1280, 1024×1366
 * y 768 (desplazando la lista); a 390 el pie compacto sigue entero y quieto.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep15-03.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockDate from "mockdate";
import { expect, fn, screen, waitFor } from "storybook/test";

import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";

import {
  doubtfulLine,
  makeReviewResponse,
  REVIEW_SCAN_ID,
  REVIEW_SUPPLIER_ID,
  REVIEW_TAX_RATES,
  unmatchedLine,
} from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

const SUPPLIER_NAME = "Distribuidora Caos Global C.A.";

/** Tres motivos de partida (líneas por resolver, tasa y diferencia), como `PieMuchos*` de REP14-06 y `p16-mot`. */
const response = makeReviewResponse({
  extraction: { date: "2026-10-17", supplier: { name: SUPPLIER_NAME, taxId: "J-50203040-1" }, total: 1800 },
  lines: [
    unmatchedLine(1, false, { read: { lineTotal: 1000, quantity: 1, unitPrice: 1000 } }),
    doubtfulLine(2, 0.72, { match: { taxRateCode: "exento" }, read: { lineTotal: 750, quantity: 1, unitPrice: 750 } }),
  ],
});

const noSuppliers: EntityFetcher<"contact"> = async () => [];

async function loadBrowser() {
  if (!("__vitest_browser__" in globalThis)) {
    return null;
  }
  return import("vitest/browser").catch(() => null);
}


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ABOVE = '[data-testid="invoice-review-blockers-more-above"]';
const BELOW = '[data-testid="invoice-review-blockers-more"]';

function footer() {
  const element = document.querySelector<HTMLElement>('footer[aria-label="Resumen de la revisión"]');
  if (!element) {
    throw new Error("Sin pie");
  }
  return element;
}

function list() {
  const element = document.querySelector<HTMLElement>('[data-testid="invoice-review-blockers"]');
  if (!element) {
    throw new Error("Sin lista de motivos");
  }
  return element;
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

function typeDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Motivos (sin los indicios). */
function reasonItems() {
  return [...list().querySelectorAll<HTMLElement>(":scope > li")].filter(
    (item) => !item.matches(`${ABOVE}, ${BELOW}`),
  );
}

/** Rectángulos del texto de un motivo (cada renglón envuelto por separado). */
function textRects(item: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(item);
  return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
}

function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

type Hint = { text: string | null; visible: boolean; covers: number; width: number };

/** Indicio: texto, si se ve dentro del alto reservado y cuántos renglones visibles de motivos tapa. */
function hint(selector: string): Hint {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return { covers: 0, text: null, visible: false, width: 0 };
  }
  const box = list().getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top >= box.top - 1 &&
    rect.bottom <= box.bottom + 1 &&
    rect.left >= box.left - 1 &&
    rect.right <= box.right + 1;
  const covers = reasonItems()
    .flatMap(textRects)
    .filter((line) => line.bottom > box.top + 1 && line.top < box.bottom - 1 && overlaps(line, rect)).length;
  return { covers, text: element.textContent, visible, width: Math.round(rect.width) };
}

type ListState = { items: number; above: number; below: number; scrollTop: number; up: Hint; down: Hint };

function listState(): ListState {
  const box = list().getBoundingClientRect();
  const items = reasonItems();
  return {
    above: items.filter((item) => item.getBoundingClientRect().top < box.top - 1).length,
    below: items.filter((item) => item.getBoundingClientRect().bottom > box.bottom + 1).length,
    down: hint(BELOW),
    items: items.length,
    scrollTop: Math.round(list().scrollTop),
    up: hint(ABOVE),
  };
}

/** Arriba de «Cargar» y arriba y alto del pie, en px de la ventana. */
function frame() {
  const load = loadButton().getBoundingClientRect();
  const foot = footer().getBoundingClientRect();
  return {
    cargarLeft: Math.round(load.left),
    cargarTop: Math.round(load.top),
    footerHeight: Math.round(foot.height),
    footerTop: Math.round(foot.top),
  };
}

/**
 * Desplaza la lista como el usuario, un renglón cada vez (cada paso con su evento `scroll`), hasta el final o el
 * principio. La rueda de CDP no llega: la historia corre en un iframe del runner con otra escala.
 */
async function scrollList(to: "end" | "start") {
  const element = list();
  const step = parseFloat(getComputedStyle(element).lineHeight);
  const done = () =>
    to === "end" ? element.scrollTop + element.clientHeight >= element.scrollHeight - 1 : element.scrollTop <= 0;
  for (let index = 0; index < 20 && !done(); index += 1) {
    element.scrollBy({ behavior: "instant", top: to === "end" ? step : -step });
    await sleep(120);
  }
  await waitFor(() => expect(done()).toBe(true));
  await sleep(200);
}

/** Lo que falla de un estado de la lista: cuentas de ambos indicios, que se vean y que no tapen motivos. */
function hintFailures(label: string, state: ListState) {
  const failures: string[] = [];
  const pairs: Array<[string, number, Hint]> = [
    ["↑", state.above, state.up],
    ["↓", state.below, state.down],
  ];
  for (const [arrow, hidden, shown] of pairs) {
    if (hidden > 0 && (!shown.visible || shown.text !== `y ${hidden} más ${arrow}`)) {
      failures.push(`${label}: ${hidden} ocultos ${arrow} y el indicio es ${shown.text ?? "ausente"}${shown.visible ? "" : " (no visible)"}`);
    }
    if (hidden === 0 && shown.text !== null) {
      failures.push(`${label}: ningún oculto ${arrow} y sobra el indicio ${shown.text}`);
    }
    if (shown.covers > 0) {
      failures.push(`${label}: el indicio ${arrow} tapa ${shown.covers} renglón(es) de motivos`);
    }
  }
  return failures;
}

async function prepare(width: number, height: number) {
  const browser = await loadBrowser();
  if (!browser) {
    return null;
  }
  await browser.page.viewport(width, height);
  const hideDevtools = document.createElement("style");
  hideDevtools.textContent = ".tsqd-parent-container { display: none !important; }";
  document.head.append(hideDevtools);
  await waitFor(() => expect(document.querySelector('[data-testid="invoice-review-panel"]')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("combobox", { name: /proveedor/i })).toHaveValue(SUPPLIER_NAME));
  await sleep(300);
  return browser;
}

/** Motivos de los pasos: 4 (sin proveedor) y 5 (fecha imposible); `shows(paso)` dice si ya se ven. */
async function addReasons(date: HTMLInputElement, shows: (step: 4 | 5) => boolean) {
  screen.getByRole("button", { name: "Limpiar Proveedor" }).click();
  await waitFor(() => expect(shows(4)).toBe(true));
  typeDate(date, "0026-10-17");
  await waitFor(() => expect(shows(5)).toBe(true));
  await sleep(300);
}

function compactText() {
  return document.querySelector('[data-testid="invoice-review-compact-blockers"]')?.textContent ?? "";
}

function wideStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      await waitFor(() => expect(reasonItems()).toHaveLength(3));
      await sleep(1500);
      const before = frame();
      const date = screen.getByLabelText("Fecha") as HTMLInputElement;
      const failures: string[] = [];
      const lines: string[] = [`inicio ${JSON.stringify(listState())} ${JSON.stringify(before)}`];
      const check = (label: string) => {
        const state = listState();
        const now = frame();
        lines.push(`${label} ${JSON.stringify(state)} ${JSON.stringify(now)}`);
        failures.push(...hintFailures(label, state));
        if (JSON.stringify(now) !== JSON.stringify(before)) {
          failures.push(`${label}: Cargar o el pie cambian (${JSON.stringify(before)} → ${JSON.stringify(now)})`);
        }
        return state;
      };
      check("3 motivos");
      await addReasons(date, (step) => reasonItems().length === step);
      check("5 motivos");
      await scrollList("end");
      const atEnd = check("5 al final");
      if (atEnd.above === 0) {
        failures.push("5 al final: ninguno oculto arriba (¿la lista no se desplaza?)");
      }
      // El caso del reporte: con la lista al final se corrige la fecha.
      typeDate(date, "2026-10-17");
      await waitFor(() => expect(reasonItems()).toHaveLength(4));
      await sleep(400);
      const resolved = check("4 tras corregir la fecha");
      if (resolved.above === 0) {
        failures.push(`4 tras corregir la fecha: ninguno oculto arriba (scrollTop ${resolved.scrollTop})`);
      }
      await scrollList("start");
      check("4 de vuelta arriba");
      const report = `${width}×${height} ${lines.join(" | ")}`;
      console.warn(`[REP15-03 indicio arriba] ${report}`);
      await expect(failures, report).toEqual([]);
    },
  };
}

/** Pie compacto (390): su línea de motivos, el pie y los indicios. */
function compactState() {
  const compact = document.querySelector<HTMLElement>('[data-testid="invoice-review-compact-blockers"]');
  const box = compact?.getBoundingClientRect();
  const foot = footer().getBoundingClientRect();
  return {
    frame: frame(),
    hints: document.querySelectorAll(`${ABOVE}, ${BELOW}`).length,
    line: box ? `${Math.round(box.top)}–${Math.round(box.bottom)}` : null,
    lineInsideFooter: !!box && box.top >= foot.top - 1 && box.bottom <= foot.bottom + 1,
    lineScroll: compact ? `${compact.scrollHeight}/${compact.clientHeight}` : null,
    lineWhole: !!compact && compact.scrollHeight <= compact.clientHeight + 1,
    text: compactText(),
    footerOnScreen: foot.top >= 0 && foot.bottom <= window.innerHeight + 1,
  };
}

function compactFailures(label: string, state: ReturnType<typeof compactState>, before: ReturnType<typeof frame>) {
  const failures: string[] = [];
  if (!state.line || !state.lineInsideFooter || !state.lineWhole) {
    failures.push(`${label}: la línea compacta no está entera dentro del pie`);
  }
  if (!state.footerOnScreen) {
    failures.push(`${label}: el pie no está entero en la pantalla`);
  }
  if (state.hints > 0) {
    failures.push(`${label}: indicios en el pie compacto`);
  }
  if (JSON.stringify(state.frame) !== JSON.stringify(before)) {
    failures.push(`${label}: Cargar o el pie cambian`);
  }
  return failures;
}

/** 390: el pie compacto (sin lista desplazable) sigue entero, sin indicios, y «Cargar» y el pie no se mueven. */
function compactStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      await sleep(1500);
      const before = frame();
      const date = screen.getByLabelText("Fecha") as HTMLInputElement;
      await addReasons(date, (step) => compactText().includes(step === 4 ? "proveedor" : "fecha"));
      const during = compactState();
      typeDate(date, "2026-10-17");
      await waitFor(() => expect(compactText()).not.toContain("fecha"));
      await sleep(400);
      const after = compactState();
      const failures = [...compactFailures("5 motivos", during, before), ...compactFailures("resuelto", after, before)];
      const report = `${width}×${height} antes ${JSON.stringify(before)} · 5 motivos ${JSON.stringify(during)} · resuelto ${JSON.stringify(after)}`;
      console.warn(`[REP15-03 compacto] ${report}`);
      await expect(failures, report).toEqual([]);
    },
  };
}

const meta = {
  args: {
    canCreateProduct: true,
    // Sin tasa del sistema: «Escribe la tasa…» es uno de los motivos de partida.
    context: { taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: async () => [],
    lastUnitCostFetcher: async () => null,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher: async () => [],
    response,
    supplierFetcher: noSuppliers,
  },
  component: InvoiceReviewPanel,
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      queryClient.setQueryData(purchaseSuppliersQueryKeys.detail(REVIEW_SUPPLIER_ID), {
        id: REVIEW_SUPPLIER_ID,
        isActive: true,
        name: SUPPLIER_NAME,
        taxId: "J-50203040-1",
      });
      queryClient.setQueryData(invoiceScanQueryKeys.images(REVIEW_SCAN_ID), []);
      // El marco de AppShell, como REP14-06: menú lateral desde lg y `<main>` con su relleno.
      return (
        <QueryClientProvider client={queryClient}>
          <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div aria-hidden className="app-sidebar fixed inset-y-0 left-0 hidden bg-sidebar lg:block" />
            <div className="app-shell-content flex min-h-0 min-w-0 flex-1 flex-col" data-sidebar-collapsed="false">
              <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-surface px-4 py-6 lg:px-6">
                <div className="space-y-6 pb-8">
                  <Story />
                </div>
              </main>
            </div>
          </div>
        </QueryClientProvider>
      );
    },
  ],
  beforeEach() {
    MockDate.reset();
  },
  parameters: { layout: "fullscreen" },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP15-03 indicio de motivos ocultos arriba",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const IndicioArriba1280 = wideStory(1280, 900);
export const IndicioArriba1024x1366 = wideStory(1024, 1366);
export const IndicioArriba768 = wideStory(768, 1024);
export const PieCompacto390 = compactStory(390, 844);
