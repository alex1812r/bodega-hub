/**
 * REP10-01 · D46-c: test de navegador genérico del panel de revisión. Cada story hace UNA acción
 * de la revisión con un clic real (Playwright, en el punto de pantalla del control) a 1280 o 390
 * px y mide qué control de decisión queda en ese punto a los 100 y a los 600 ms: el mismo control
 * o ninguno. Luego da un 2.º clic real en el mismo punto y comprueba que ninguna otra línea cambió
 * y que el foco no cayó en BODY.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.layout.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay clics reales y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockDate from "mockdate";
import { expect, fn, screen, waitFor, within } from "storybook/test";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type { EntityFetcher, ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import { makeReviewResponse, productUuid, REVIEW_SCAN_ID, REVIEW_SUPPLIER_ID, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { LAYOUT_SETTLE_MS, POINTER_GUARD_MS } from "./useLayoutHold";

const HARINA = productUuid(1);

/** c10-move: «CAOSG Harina Maiz 1kg» por nombre; a 4.500 Bs se desvía del último costo (0,50 REF). */
function harinaByName(unitPrice: number, taxRateCode = "exento"): ReviewFixtureLine {
  return {
    read: {
      rawText: `CAOSG Harina Maiz 1kg P3 1 ${unitPrice},00 ${unitPrice},00`,
      description: "CAOSG Harina Maiz 1kg",
      unit: "unidad",
      quantity: 1,
      unitPrice,
      lineTotal: unitPrice,
    },
    match: {
      status: "doubtful",
      productId: undefined,
      taxRateCode,
      candidates: [
        { productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00", lastUnitCostRef: 0.5 },
      ],
      lastUnitCostRef: 0.5,
      issues: [],
    },
  };
}

/** c9-sku-caja L0: galleta confirmada por SKU, caja x6 a 270 Bs. */
const galletaConfirmada: ReviewFixtureLine = {
  read: {
    rawText: "CG-GALLETA GALLETA MARIA CAJA X6 1 270,00 270,00",
    description: "GALLETA MARIA CAJA X6",
    unit: "caja",
    unitsPerPack: 6,
    quantity: 1,
    unitPrice: 270,
    lineTotal: 270,
  },
  match: {
    status: "confirmed",
    productId: productUuid(2),
    entryMode: "pack",
    unitsPerPack: 6,
    taxRateCode: "exento",
    candidates: [{ productId: productUuid(2), name: "Galleta María", score: 1, reason: "SKU del proveedor", lastUnitCostRef: 0.05 }],
    lastUnitCostRef: 0.05,
  },
};

/** f04 L0: 0,50 de mayonesa (fraccionaria): «Por bulto» y «Cargar como N unidades». */
const mayonesa: ReviewFixtureLine = {
  read: {
    rawText: "001 MAYONESA MAVESA 445GR 0,50 x40,675.41 (E) #46.50 20337.71",
    description: "MAYONESA MAVESA 445GR",
    unit: "unidad",
    quantity: 0.5,
    unitPrice: 40675.41,
    lineTotal: 20337.71,
  },
  match: {
    status: "doubtful",
    productId: productUuid(46),
    entryMode: "unit",
    taxRateCode: "exento",
    candidates: [{ productId: productUuid(46), name: "Mayonesa Mavesa 445g", score: 0.8, reason: "nombre parecido", lastUnitCostRef: 3.83 }],
    lastUnitCostRef: 3.83,
    issues: ["¿Precio por caja o por unidad? Sale a 45,19 REF por unidad y el último costo fue 3,83 REF."],
  },
};

const queso: ReviewFixtureLine = {
  read: { description: "Queso blanco", rawText: "QUESO BCO DURO KG", quantity: 2, unitPrice: 450, lineTotal: 900 },
  match: { status: "unmatched", productId: undefined, candidates: undefined },
};

/** L0 harina desviada, L1 harina coherente, L2 confirmada, L3 fraccionaria, L4 sin emparejar. */
const linesResponse = makeReviewResponse({
  lines: [harinaByName(4500), harinaByName(450), galletaConfirmada, mayonesa, queso],
});

/** Tasa impresa distinta de la del día (900) e IVA sugerido como incluido. */
const noticesResponse = makeReviewResponse({
  extraction: { printedRate: 856.3, total: 4950 },
  lines: [harinaByName(4500, "general"), harinaByName(450, "general")],
});

/** Todas confirmadas y el total leído no cuadra: casilla «Cargar con una diferencia…». */
const differenceResponse = makeReviewResponse({
  extraction: { total: 9999 },
  lines: [{}, { read: { description: "Arroz Mary 1kg", rawText: "ARROZ MARY 1KG" } }],
});

const products: ProductEntityOption[] = [
  {
    barcode: null,
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 4,
    id: productUuid(600),
    isActive: true,
    label: "Queso blanco duro",
    salePriceRef: 2,
    sku: "SKU-Q",
  },
];

const productFetcher: EntityFetcher<"product"> = async () => products;

/** Clics y viewport reales de Vitest browser (Playwright); `null` fuera de Vitest. */
async function loadBrowser() {
  if (!("__vitest_browser__" in globalThis)) {
    return null;
  }
  return import("vitest/browser").catch(() => null);
}

type Browser = NonNullable<Awaited<ReturnType<typeof loadBrowser>>>;
type Point = { x: number; y: number };

/**
 * Controles que deciden algo de la revisión (los que el panel somete a sus guardas de activación):
 * candidato, opción, reconocer costo, Descartar/Restaurar, Cargar, tasa y botones del pie, IVA,
 * producto del buscador y casilla. «Buscar producto», «Nuevo producto» o un campo solo abren algo.
 */
const DECISION_SELECTOR =
  "[data-candidate], [data-choice], [data-cost-ack], [data-row-action], [data-load-button], [data-guarded-activation], [role='radio'], [role='option'], input[type='checkbox']";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function panel() {
  const element = document.querySelector<HTMLElement>('[data-testid="invoice-review-panel"]');
  if (!element) {
    throw new Error("Sin panel de revisión");
  }
  return element;
}

function row(index: number) {
  const element = panel().querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

/**
 * Control de decisión en `point` (del panel o de su buscador). Un diálogo que abra la acción no es
 * layout de la revisión: su 2.º clic lo frena la guarda espacial (se comprueba con `onDiscard`).
 */
function decisionAt(point: Point) {
  const control = document.elementFromPoint(point.x, point.y)?.closest(DECISION_SELECTOR) ?? null;
  return control?.closest('[role="dialog"]') ? null : control;
}

function describeControl(element: Element | null) {
  if (!element) {
    return "nada";
  }
  const line = element.closest("[data-line-index]")?.getAttribute("data-line-index");
  return `${element.tagName}«${(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60)}»${line ? ` L${line}` : ""}`;
}

function statuses() {
  return Object.fromEntries(
    [...panel().querySelectorAll<HTMLElement>("li[data-line-index]")].map((item) => [
      item.dataset.lineIndex,
      `${item.dataset.status}${item.querySelector('[data-choice][aria-pressed="true"]')?.getAttribute("data-choice") ?? ""}`,
    ]),
  );
}

/** Lo que el usuario ve de la revisión (texto, estados, opciones y casillas), sin estilos. */
function observableState() {
  const marks = [...document.querySelectorAll("[aria-pressed], [aria-checked], input[type='checkbox']")].map((element) =>
    element instanceof HTMLInputElement
      ? String(element.checked)
      : `${element.getAttribute("aria-pressed")}${element.getAttribute("aria-checked")}`,
  );
  return JSON.stringify([document.body.innerText, statuses(), marks]);
}

/** Clic real en un punto de la pantalla: lo recibe lo que esté ahí (no un elemento concreto). */
async function clickAt(browser: Browser, point: Point) {
  const body = document.body.getBoundingClientRect();
  await browser.userEvent.click(document.body, { force: true, position: { x: point.x - body.left, y: point.y - body.top } });
}

/** Paso previo con clic real; después se deja asentar el layout y pasar la guarda. */
async function setupClick(browser: Browser, element: HTMLElement) {
  await browser.userEvent.click(element);
  await sleep(POINTER_GUARD_MS + 100);
  await browser.userEvent.keyboard("{Shift}");
}

/**
 * La medición de D46-c sobre `target`: tras el clic real no queda OTRO control de decisión en el
 * punto, y el 2.º clic en ese punto a 600 ms no cambia ninguna otra línea ni deja el foco en BODY.
 */
async function expectNothingNewUnderPointer(browser: Browser, target: HTMLElement) {
  target.scrollIntoView({ block: "center" });
  await sleep(LAYOUT_SETTLE_MS + 200);
  const box = target.getBoundingClientRect();
  const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  await expect(
    document.elementFromPoint(point.x, point.y)?.closest("button, [role='option'], [role='radio'], input"),
    "el control está en su punto antes de pulsarlo",
  ).toBe(target);
  const line = target.closest("[data-line-index]")?.getAttribute("data-line-index") ?? null;
  const others = () => Object.fromEntries(Object.entries(statuses()).filter(([index]) => index !== line));

  const before = observableState();
  await clickAt(browser, point);
  for (const [wait, at] of [
    [100, 100],
    [500, 600],
  ] as const) {
    await sleep(wait);
    const under = decisionAt(point);
    if (under && under !== target) {
      throw new Error(`a los ${at} ms queda ${describeControl(under)} bajo el puntero tras pulsar ${describeControl(target)}`);
    }
  }
  await expect(observableState(), "la acción tuvo efecto").not.toBe(before);
  await expect(document.activeElement, "tras la acción el foco no cae en BODY").not.toBe(document.body);
  const afterFirst = others();
  // Un clic en espacio vacío deja el foco en BODY (el navegador): el foco se exige tras el 2.º clic
  // solo si cae en el panel.
  const secondInPanel = panel().contains(document.elementFromPoint(point.x, point.y));

  await clickAt(browser, point);
  await sleep(300);
  // Las líneas que siguen en pantalla (plegar confirmadas las quita) no cambiaron.
  const afterSecond = others();
  const shown = Object.keys(afterFirst).filter((index) => index in afterSecond);
  await expect(
    shown.map((index) => [index, afterSecond[index]]),
    "el 2.º clic no cambia otra línea",
  ).toEqual(shown.map((index) => [index, afterFirst[index]]));
  if (secondInPanel) {
    await expect(document.activeElement, "tras el 2.º clic el foco no cae en BODY").not.toBe(document.body);
  }
}

type LayoutCase = {
  setup?: (browser: Browser) => Promise<void>;
  target: () => HTMLElement | Promise<HTMLElement>;
};

const button = (container: HTMLElement, name: RegExp) => within(container).getByRole("button", { name });

const openConfirmed = async (browser: Browser) => setupClick(browser, screen.getByRole("button", { name: /línea confirmada · ver/ }));

const CASES = {
  descartarLinea: { target: () => button(row(0), /Descartar línea/) },
  restaurarLinea: {
    setup: async (browser) => setupClick(browser, button(row(0), /Descartar línea/)),
    target: () => button(row(0), /Restaurar/),
  },
  chipCandidato: { target: () => button(row(0), /^CAOSG Harina Maiz 1kg/) },
  porUnidad: {
    setup: async (browser) => setupClick(browser, button(row(0), /^CAOSG Harina Maiz 1kg/)),
    target: () => button(row(0), /^Por unidad/),
  },
  reconocerCosto: {
    setup: async (browser) => {
      await setupClick(browser, button(row(0), /^CAOSG Harina Maiz 1kg/));
      await setupClick(browser, button(row(0), /^Por unidad/));
    },
    target: () => button(row(0), /^Sí, el costo es/),
  },
  verConfirmadas: { target: () => screen.getByRole("button", { name: /línea confirmada · ver/ }) },
  confirmadaPorUnidad: { setup: openConfirmed, target: () => button(row(2), /^Por unidad/) },
  confirmadaPorCaja: {
    setup: async (browser) => {
      await openConfirmed(browser);
      await setupClick(browser, button(row(2), /^Por unidad/));
    },
    target: () => button(row(2), /^Por caja/),
  },
  cargarComoUnidades: {
    setup: async (browser) => {
      await setupClick(browser, button(row(3), /^Mayonesa Mavesa 445g/));
      await setupClick(browser, button(row(3), /^Por bulto/));
      await browser.userEvent.fill(within(row(3)).getByLabelText(/^Unidades por/), "12");
      await sleep(300);
    },
    target: () => button(row(3), /^Cargar como 6 unidades/),
  },
  buscarProducto: { target: () => button(row(4), /Buscar producto/) },
  elegirDelBuscador: {
    setup: async (browser) => setupClick(browser, button(row(4), /Buscar producto/)),
    target: async () => {
      const option = await screen.findByRole("option", { name: /Queso blanco duro/ });
      return option instanceof HTMLElement ? option : Promise.reject(new Error("opción sin HTMLElement"));
    },
  },
  nuevoProducto: { target: () => button(row(4), /Nuevo producto/) },
  descartarEscaneo: {
    // A 390 px el botón está en el detalle plegado del pie.
    setup: async (browser) => {
      const detail = screen.queryByRole("button", { name: "Ver detalle del total" });
      if (detail?.checkVisibility()) {
        await setupClick(browser, detail);
      }
    },
    target: () => screen.getByTestId("invoice-review-discard-scan"),
  },
} satisfies Record<string, LayoutCase>;

const NOTICE_CASES = {
  tasa: {
    target: () => within(screen.getByRole("radiogroup", { name: "Tasa para convertir los costos" })).getAllByRole("radio")[1],
  },
  iva: {
    target: () => within(screen.getByRole("radiogroup", { name: "IVA en los precios de la factura" })).getAllByRole("radio")[1],
  },
} satisfies Record<string, LayoutCase>;

const DIFFERENCE_CASES = {
  casilla: {
    target: () => within(screen.getByTestId("invoice-review-confirm-difference")).getByRole("checkbox"),
  },
} satisfies Record<string, LayoutCase>;

function layoutStory(layoutCase: LayoutCase, width: number, response: InvoiceScanResponse = linesResponse): Story {
  return {
    args: { response },
    play: async ({ args }) => {
      const browser = await loadBrowser();
      if (!browser) {
        return;
      }
      await browser.page.viewport(width, width < 640 ? 844 : 900);
      // El botón flotante de React Query Devtools (AppProviders) tapa el pie a 390 px.
      const hideDevtools = document.createElement("style");
      hideDevtools.textContent = ".tsqd-parent-container { display: none !important; }";
      document.head.append(hideDevtools);
      await waitFor(() => expect(panel()).toBeInTheDocument());
      await sleep(300);
      await layoutCase.setup?.(browser);
      await expectNothingNewUnderPointer(browser, await layoutCase.target());
      await expect(args.onDiscard).not.toHaveBeenCalled();
    },
  };
}

const meta = {
  args: {
    canCreateProduct: true,
    context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    lastUnitCostFetcher: async () => null,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher,
    response: linesResponse,
    supplierFetcher: async () => [],
  },
  component: InvoiceReviewPanel,
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      queryClient.setQueryData(purchaseSuppliersQueryKeys.detail(REVIEW_SUPPLIER_ID), {
        id: REVIEW_SUPPLIER_ID,
        isActive: true,
        name: "Chevere Depot C.A.",
        taxId: "J-12345678-9",
      });
      queryClient.setQueryData(invoiceScanQueryKeys.images(REVIEW_SCAN_ID), []);
      return (
        <QueryClientProvider client={queryClient}>
          <div className="min-h-screen bg-surface p-4">
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  // Las guardas del panel miden tiempo real: sin el reloj fijo de `preview.tsx`.
  beforeEach() {
    MockDate.reset();
  },
  parameters: { layout: "fullscreen" },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/Layout bajo el puntero",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DescartarLinea1280 = layoutStory(CASES.descartarLinea, 1280);
export const DescartarLinea390 = layoutStory(CASES.descartarLinea, 390);
export const RestaurarLinea1280 = layoutStory(CASES.restaurarLinea, 1280);
export const RestaurarLinea390 = layoutStory(CASES.restaurarLinea, 390);
export const ChipCandidato1280 = layoutStory(CASES.chipCandidato, 1280);
export const ChipCandidato390 = layoutStory(CASES.chipCandidato, 390);
export const PorUnidad1280 = layoutStory(CASES.porUnidad, 1280);
export const PorUnidad390 = layoutStory(CASES.porUnidad, 390);
export const ReconocerCosto1280 = layoutStory(CASES.reconocerCosto, 1280);
export const ReconocerCosto390 = layoutStory(CASES.reconocerCosto, 390);
export const VerConfirmadas1280 = layoutStory(CASES.verConfirmadas, 1280);
export const VerConfirmadas390 = layoutStory(CASES.verConfirmadas, 390);
export const ConfirmadaPorUnidad1280 = layoutStory(CASES.confirmadaPorUnidad, 1280);
export const ConfirmadaPorUnidad390 = layoutStory(CASES.confirmadaPorUnidad, 390);
export const ConfirmadaPorCaja1280 = layoutStory(CASES.confirmadaPorCaja, 1280);
export const ConfirmadaPorCaja390 = layoutStory(CASES.confirmadaPorCaja, 390);
export const CargarComoUnidades1280 = layoutStory(CASES.cargarComoUnidades, 1280);
export const CargarComoUnidades390 = layoutStory(CASES.cargarComoUnidades, 390);
export const BuscarProducto1280 = layoutStory(CASES.buscarProducto, 1280);
export const BuscarProducto390 = layoutStory(CASES.buscarProducto, 390);
export const ElegirDelBuscador1280 = layoutStory(CASES.elegirDelBuscador, 1280);
export const ElegirDelBuscador390 = layoutStory(CASES.elegirDelBuscador, 390);
export const NuevoProducto1280 = layoutStory(CASES.nuevoProducto, 1280);
export const NuevoProducto390 = layoutStory(CASES.nuevoProducto, 390);
export const DescartarEscaneo1280 = layoutStory(CASES.descartarEscaneo, 1280);
export const DescartarEscaneo390 = layoutStory(CASES.descartarEscaneo, 390);
export const Tasa1280 = layoutStory(NOTICE_CASES.tasa, 1280, noticesResponse);
export const Tasa390 = layoutStory(NOTICE_CASES.tasa, 390, noticesResponse);
export const Iva1280 = layoutStory(NOTICE_CASES.iva, 1280, noticesResponse);
export const Iva390 = layoutStory(NOTICE_CASES.iva, 390, noticesResponse);
export const Casilla1280 = layoutStory(DIFFERENCE_CASES.casilla, 1280, differenceResponse);
export const Casilla390 = layoutStory(DIFFERENCE_CASES.casilla, 390, differenceResponse);
