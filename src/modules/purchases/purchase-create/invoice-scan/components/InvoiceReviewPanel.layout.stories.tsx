/**
 * REP10-01 · D46-c: test de navegador genérico del panel de revisión. Cada story hace UNA acción
 * de la revisión con un clic real (Playwright, en el punto de pantalla del control) a 1280 o 390
 * px y mide qué control de decisión queda en ese punto a los 100 y a los 600 ms: el mismo control
 * o ninguno. Luego da un 2.º clic real en el mismo punto y comprueba que ninguna otra línea cambió
 * y que el foco no cayó en BODY.
 * REP11-02 · D49: las variantes `Raton3s` y `Tactil3s` hacen la acción con el ratón o con un toque
 * real (CDP) y miden a los 100, 600, 1000, 1500, 2000 y 3000 ms; la 2.ª activación llega a los 3 s.
 * Al final, las repros de M-p11-2 y C11B-M1 (A y B) y la guarda tras aplicar el layout.
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
import { POINTER_GUARD_MS } from "./useLayoutHold";

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

type Pointer = "mouse" | "touch";

/** Punto del documento de la story en la página de Playwright (el iframe del runner puede escalarse). */
function pagePoint(point: Point): Point {
  let x = point.x;
  let y = point.y;
  // `frameElement` es del documento padre (otro reino): `instanceof HTMLElement` no sirve.
  for (let view: Window = window, frame = view.frameElement; frame; view = view.parent, frame = view.frameElement) {
    const box = frame.getBoundingClientRect();
    const width = frame.clientWidth + 2 * frame.clientLeft;
    const scale = width ? box.width / width : 1;
    x = box.left + (frame.clientLeft + x) * scale;
    y = box.top + (frame.clientTop + y) * scale;
  }
  return { x, y };
}

/** Toque real (CDP `Input.dispatchTouchEvent`): pointerdown/up con `pointerType` touch y su clic. */
async function tapAt(browser: Browser, point: Point) {
  const session = browser.cdp();
  const touch = pagePoint(point);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
}

const activateAt = (browser: Browser, point: Point, pointer: Pointer) =>
  pointer === "touch" ? tapAt(browser, point) : clickAt(browser, point);

function centerOf(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** Paso previo con clic real; el teclado aplica el layout pendiente y se deja pasar la guarda. */
async function setupClick(browser: Browser, element: HTMLElement) {
  await browser.userEvent.click(element);
  await sleep(POINTER_GUARD_MS + 100);
  await browser.userEvent.keyboard("{Shift}");
}

/**
 * La medición de D46-c sobre `target`: tras el clic real no queda OTRO control de decisión en el
 * punto, y el 2.º clic en ese punto a 600 ms no cambia ninguna otra línea ni deja el foco en BODY.
 */
async function expectNothingNewUnderPointer(browser: Browser, target: HTMLElement, timing: Timing) {
  target.scrollIntoView({ block: "center" });
  await sleep(POINTER_GUARD_MS + 200);
  const point = centerOf(target);
  await expect(
    document.elementFromPoint(point.x, point.y)?.closest("button, [role='option'], [role='radio'], input"),
    "el control está en su punto antes de pulsarlo",
  ).toBe(target);
  const line = target.closest("[data-line-index]")?.getAttribute("data-line-index") ?? null;
  const others = () => Object.fromEntries(Object.entries(statuses()).filter(([index]) => index !== line));

  const before = observableState();
  await activateAt(browser, point, timing.pointer);
  const start = performance.now();
  for (const at of timing.probes) {
    await sleep(at - (performance.now() - start));
    const under = decisionAt(point);
    if (under && under !== target) {
      throw new Error(
        `a los ${at} ms (${timing.pointer}) queda ${describeControl(under)} bajo el puntero tras pulsar ${describeControl(target)}`,
      );
    }
  }
  await expect(observableState(), "la acción tuvo efecto").not.toBe(before);
  await expect(document.activeElement, "tras la acción el foco no cae en BODY").not.toBe(document.body);
  const afterFirst = others();
  // Un clic en espacio vacío deja el foco en BODY (el navegador): el foco se exige tras el 2.º clic
  // solo si cae en el panel.
  await sleep(timing.secondAt - (performance.now() - start));
  const secondTarget = document.elementFromPoint(point.x, point.y);
  if (timing.secondAt > POINTER_GUARD_MS && secondTarget?.closest('[role="dialog"]')) {
    // Un diálogo a la vista desde hace segundos no es layout de la revisión: tocarlo es del usuario.
    return;
  }
  const secondInPanel = panel().contains(secondTarget);

  await activateAt(browser, point, timing.pointer);
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

/** Cuándo se mide bajo el punto y cuándo llega la 2.ª activación, con ratón o toque. */
type Timing = { pointer: Pointer; probes: readonly number[]; secondAt: number };

/** REP10 (C10B-M1): 2.º clic a 600 ms. */
const REBOUND_600: Timing = { pointer: "mouse", probes: [100, 600], secondAt: 600 };
/** REP11-02 (D49): sin compactación por tiempo; mide hasta 3 s y la 2.ª activación llega a los 3 s. */
const SERIES = [100, 600, 1000, 1500, 2000, 3000] as const;
const MOUSE_3S: Timing = { pointer: "mouse", probes: SERIES, secondAt: 3000 };
const TOUCH_3S: Timing = { pointer: "touch", probes: SERIES, secondAt: 3000 };

async function prepare(width: number) {
  const browser = await loadBrowser();
  if (!browser) {
    return null;
  }
  await browser.page.viewport(width, width < 640 ? 844 : 900);
  // El botón flotante de React Query Devtools (AppProviders) tapa el pie a 390 px.
  const hideDevtools = document.createElement("style");
  hideDevtools.textContent = ".tsqd-parent-container { display: none !important; }";
  document.head.append(hideDevtools);
  await waitFor(() => expect(panel()).toBeInTheDocument());
  await sleep(300);
  return browser;
}

function layoutStory(
  layoutCase: LayoutCase,
  width: number,
  response: InvoiceScanResponse = linesResponse,
  timing: Timing = REBOUND_600,
): Story {
  return {
    args: { response },
    play: async ({ args }) => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      await layoutCase.setup?.(browser);
      await expectNothingNewUnderPointer(browser, await layoutCase.target(), timing);
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

// REP11-02 · D49: cada acción con ratón y con toque, medida hasta 3 s (2.ª activación a los 3 s).
export const DescartarLinea1280Raton3s = layoutStory(CASES.descartarLinea, 1280, linesResponse, MOUSE_3S);
export const DescartarLinea1280Tactil3s = layoutStory(CASES.descartarLinea, 1280, linesResponse, TOUCH_3S);
export const DescartarLinea390Raton3s = layoutStory(CASES.descartarLinea, 390, linesResponse, MOUSE_3S);
export const DescartarLinea390Tactil3s = layoutStory(CASES.descartarLinea, 390, linesResponse, TOUCH_3S);
export const RestaurarLinea1280Raton3s = layoutStory(CASES.restaurarLinea, 1280, linesResponse, MOUSE_3S);
export const RestaurarLinea1280Tactil3s = layoutStory(CASES.restaurarLinea, 1280, linesResponse, TOUCH_3S);
export const RestaurarLinea390Raton3s = layoutStory(CASES.restaurarLinea, 390, linesResponse, MOUSE_3S);
export const RestaurarLinea390Tactil3s = layoutStory(CASES.restaurarLinea, 390, linesResponse, TOUCH_3S);
export const ChipCandidato1280Raton3s = layoutStory(CASES.chipCandidato, 1280, linesResponse, MOUSE_3S);
export const ChipCandidato1280Tactil3s = layoutStory(CASES.chipCandidato, 1280, linesResponse, TOUCH_3S);
export const ChipCandidato390Raton3s = layoutStory(CASES.chipCandidato, 390, linesResponse, MOUSE_3S);
export const ChipCandidato390Tactil3s = layoutStory(CASES.chipCandidato, 390, linesResponse, TOUCH_3S);
export const PorUnidad1280Raton3s = layoutStory(CASES.porUnidad, 1280, linesResponse, MOUSE_3S);
export const PorUnidad1280Tactil3s = layoutStory(CASES.porUnidad, 1280, linesResponse, TOUCH_3S);
export const PorUnidad390Raton3s = layoutStory(CASES.porUnidad, 390, linesResponse, MOUSE_3S);
export const PorUnidad390Tactil3s = layoutStory(CASES.porUnidad, 390, linesResponse, TOUCH_3S);
export const ReconocerCosto1280Raton3s = layoutStory(CASES.reconocerCosto, 1280, linesResponse, MOUSE_3S);
export const ReconocerCosto1280Tactil3s = layoutStory(CASES.reconocerCosto, 1280, linesResponse, TOUCH_3S);
export const ReconocerCosto390Raton3s = layoutStory(CASES.reconocerCosto, 390, linesResponse, MOUSE_3S);
export const ReconocerCosto390Tactil3s = layoutStory(CASES.reconocerCosto, 390, linesResponse, TOUCH_3S);
export const VerConfirmadas1280Raton3s = layoutStory(CASES.verConfirmadas, 1280, linesResponse, MOUSE_3S);
export const VerConfirmadas1280Tactil3s = layoutStory(CASES.verConfirmadas, 1280, linesResponse, TOUCH_3S);
export const VerConfirmadas390Raton3s = layoutStory(CASES.verConfirmadas, 390, linesResponse, MOUSE_3S);
export const VerConfirmadas390Tactil3s = layoutStory(CASES.verConfirmadas, 390, linesResponse, TOUCH_3S);
export const ConfirmadaPorUnidad1280Raton3s = layoutStory(CASES.confirmadaPorUnidad, 1280, linesResponse, MOUSE_3S);
export const ConfirmadaPorUnidad1280Tactil3s = layoutStory(CASES.confirmadaPorUnidad, 1280, linesResponse, TOUCH_3S);
export const ConfirmadaPorUnidad390Raton3s = layoutStory(CASES.confirmadaPorUnidad, 390, linesResponse, MOUSE_3S);
export const ConfirmadaPorUnidad390Tactil3s = layoutStory(CASES.confirmadaPorUnidad, 390, linesResponse, TOUCH_3S);
export const ConfirmadaPorCaja1280Raton3s = layoutStory(CASES.confirmadaPorCaja, 1280, linesResponse, MOUSE_3S);
export const ConfirmadaPorCaja1280Tactil3s = layoutStory(CASES.confirmadaPorCaja, 1280, linesResponse, TOUCH_3S);
export const ConfirmadaPorCaja390Raton3s = layoutStory(CASES.confirmadaPorCaja, 390, linesResponse, MOUSE_3S);
export const ConfirmadaPorCaja390Tactil3s = layoutStory(CASES.confirmadaPorCaja, 390, linesResponse, TOUCH_3S);
export const CargarComoUnidades1280Raton3s = layoutStory(CASES.cargarComoUnidades, 1280, linesResponse, MOUSE_3S);
export const CargarComoUnidades1280Tactil3s = layoutStory(CASES.cargarComoUnidades, 1280, linesResponse, TOUCH_3S);
export const CargarComoUnidades390Raton3s = layoutStory(CASES.cargarComoUnidades, 390, linesResponse, MOUSE_3S);
export const CargarComoUnidades390Tactil3s = layoutStory(CASES.cargarComoUnidades, 390, linesResponse, TOUCH_3S);
export const BuscarProducto1280Raton3s = layoutStory(CASES.buscarProducto, 1280, linesResponse, MOUSE_3S);
export const BuscarProducto1280Tactil3s = layoutStory(CASES.buscarProducto, 1280, linesResponse, TOUCH_3S);
export const BuscarProducto390Raton3s = layoutStory(CASES.buscarProducto, 390, linesResponse, MOUSE_3S);
export const BuscarProducto390Tactil3s = layoutStory(CASES.buscarProducto, 390, linesResponse, TOUCH_3S);
export const ElegirDelBuscador1280Raton3s = layoutStory(CASES.elegirDelBuscador, 1280, linesResponse, MOUSE_3S);
export const ElegirDelBuscador1280Tactil3s = layoutStory(CASES.elegirDelBuscador, 1280, linesResponse, TOUCH_3S);
export const ElegirDelBuscador390Raton3s = layoutStory(CASES.elegirDelBuscador, 390, linesResponse, MOUSE_3S);
export const ElegirDelBuscador390Tactil3s = layoutStory(CASES.elegirDelBuscador, 390, linesResponse, TOUCH_3S);
export const NuevoProducto1280Raton3s = layoutStory(CASES.nuevoProducto, 1280, linesResponse, MOUSE_3S);
export const NuevoProducto1280Tactil3s = layoutStory(CASES.nuevoProducto, 1280, linesResponse, TOUCH_3S);
export const NuevoProducto390Raton3s = layoutStory(CASES.nuevoProducto, 390, linesResponse, MOUSE_3S);
export const NuevoProducto390Tactil3s = layoutStory(CASES.nuevoProducto, 390, linesResponse, TOUCH_3S);
export const DescartarEscaneo1280Raton3s = layoutStory(CASES.descartarEscaneo, 1280, linesResponse, MOUSE_3S);
export const DescartarEscaneo1280Tactil3s = layoutStory(CASES.descartarEscaneo, 1280, linesResponse, TOUCH_3S);
export const DescartarEscaneo390Raton3s = layoutStory(CASES.descartarEscaneo, 390, linesResponse, MOUSE_3S);
export const DescartarEscaneo390Tactil3s = layoutStory(CASES.descartarEscaneo, 390, linesResponse, TOUCH_3S);
export const Tasa1280Raton3s = layoutStory(NOTICE_CASES.tasa, 1280, noticesResponse, MOUSE_3S);
export const Tasa1280Tactil3s = layoutStory(NOTICE_CASES.tasa, 1280, noticesResponse, TOUCH_3S);
export const Tasa390Raton3s = layoutStory(NOTICE_CASES.tasa, 390, noticesResponse, MOUSE_3S);
export const Tasa390Tactil3s = layoutStory(NOTICE_CASES.tasa, 390, noticesResponse, TOUCH_3S);
export const Iva1280Raton3s = layoutStory(NOTICE_CASES.iva, 1280, noticesResponse, MOUSE_3S);
export const Iva1280Tactil3s = layoutStory(NOTICE_CASES.iva, 1280, noticesResponse, TOUCH_3S);
export const Iva390Raton3s = layoutStory(NOTICE_CASES.iva, 390, noticesResponse, MOUSE_3S);
export const Iva390Tactil3s = layoutStory(NOTICE_CASES.iva, 390, noticesResponse, TOUCH_3S);
export const Casilla1280Raton3s = layoutStory(DIFFERENCE_CASES.casilla, 1280, differenceResponse, MOUSE_3S);
export const Casilla1280Tactil3s = layoutStory(DIFFERENCE_CASES.casilla, 1280, differenceResponse, TOUCH_3S);
export const Casilla390Raton3s = layoutStory(DIFFERENCE_CASES.casilla, 390, differenceResponse, MOUSE_3S);
export const Casilla390Tactil3s = layoutStory(DIFFERENCE_CASES.casilla, 390, differenceResponse, TOUCH_3S);

/** c11-three / c10-lay-homo: «JABON AZUL 250G» con dos homónimos empatados (CAOSG-004/005). */
function jabonHomonyms(): ReviewFixtureLine {
  return {
    read: {
      rawText: "JABON AZUL 250G 1 450,00 450,00",
      description: "JABON AZUL 250G",
      unit: "unidad",
      quantity: 1,
      unitPrice: 450,
      lineTotal: 450,
    },
    match: {
      status: "doubtful",
      productId: undefined,
      taxRateCode: "exento",
      candidates: [4, 5].map((seed) => ({
        productId: productUuid(seed),
        name: "CAOSG Jabon Azul 250g",
        sku: `CAOSG-00${seed}`,
        score: 0.73,
        reason: "nombre parecido 0,73",
        lastUnitCostRef: 0.5,
      })),
      lastUnitCostRef: 0.5,
      issues: [],
    },
  };
}

/** c11-three: L0 y L1 harina por nombre a 450, L2 y L3 jabón con homónimos. */
const c11ThreeResponse = makeReviewResponse({
  lines: [harinaByName(450), harinaByName(450), jabonHomonyms(), jabonHomonyms()],
});
/** c10-lay-homo: L0 harina desviada, L1 jabón con homónimos. */
const homonymsResponse = makeReviewResponse({ lines: [harinaByName(4500), jabonHomonyms()] });

async function sleepUntil(start: number, at: number) {
  await sleep(at - (performance.now() - start));
}

/** La línea `index` muestra su resumen retenido (B-p11-1), no un hueco en blanco. */
async function expectHeldSummary(index: number, text: RegExp) {
  const summary = within(row(index)).getByTestId("invoice-review-held-summary");
  await expect(summary).toHaveTextContent(text);
  // Ocupa el alto que la caja retenida deja libre: se ve (no es un hueco en blanco).
  await expect(summary.getBoundingClientRect().height, "el resumen se ve").toBeGreaterThan(40);
}

/**
 * C11B-M1 repro A (390, toque): descartar L0 y, a ~1,65 s, tocar «Descartar línea» de L1 donde
 * estaba a los 900 ms. Debe descartar L1; L2 (homónimos) sigue pendiente.
 */
export const C11BM1ReproATactil390: Story = {
  args: { response: c11ThreeResponse },
  play: async () => {
    const browser = await prepare(390);
    if (!browser) {
      return;
    }
    row(0).scrollIntoView({ block: "start" });
    await sleep(POINTER_GUARD_MS + 200);
    await tapAt(browser, centerOf(button(row(0), /Descartar línea/)));
    const start = performance.now();
    await sleepUntil(start, 900);
    const l1Discard = button(row(1), /Descartar línea/);
    const aim = centerOf(l1Discard);
    for (const at of [1000, 1500, 1650] as const) {
      await sleepUntil(start, at);
      await expect(describeControl(decisionAt(aim)), `a los ${at} ms`).toBe(describeControl(l1Discard));
    }
    await tapAt(browser, aim);
    await sleep(300);
    await expect(statuses()).toEqual({
      0: "discarded",
      1: "discarded",
      2: "pending_doubtful",
      3: "pending_doubtful",
    });
    await expectHeldSummary(0, /Línea descartada · Restaurar/);
  },
};

/** C11B-M1 repro B (390, toque): 2.º toque en el mismo punto que «Descartar línea» de L0 a `at` ms. */
function reproB(at: number): Story {
  return {
    args: { response: homonymsResponse },
    play: async () => {
      const browser = await prepare(390);
      if (!browser) {
        return;
      }
      row(0).scrollIntoView({ block: "start" });
      await sleep(POINTER_GUARD_MS + 200);
      const point = centerOf(button(row(0), /Descartar línea/));
      await tapAt(browser, point);
      const start = performance.now();
      await sleepUntil(start, 100);
      await expect(row(0).dataset.status, "el 1.er toque descarta L0").toBe("discarded");
      await sleepUntil(start, at);
      // Bajo el dedo sigue la caja retenida de L0 (su resumen), sin ningún control de decisión.
      const under = document.elementFromPoint(point.x, point.y);
      await expect(
        `${under?.closest("[data-line-index]")?.getAttribute("data-line-index")} ${describeControl(decisionAt(point))}`,
        `a los ${at} ms, bajo el dedo: ${describeControl(under?.closest("button, input, label, li") ?? null)}`,
      ).toBe("0 nada");
      await tapAt(browser, point);
      await sleep(300);
      await expect(statuses()).toEqual({ 0: "discarded", 1: "pending_doubtful" });
    },
  };
}

export const C11BM1ReproBTactil390a1600 = reproB(1600);
export const C11BM1ReproBTactil390a1700 = reproB(1700);
export const C11BM1ReproBTactil390a2200 = reproB(2200);
export const C11BM1ReproBTactil390a3000 = reproB(3000);

/**
 * M-p11-2 (ratón): descartar L0, ratón quieto en la fila 3 s, ir a «Buscar producto» de L1 y hacer
 * clic a los 1,4 s de llegar: abre el buscador de L1 y ninguna otra línea cambia.
 */
function mp112(width: number): Story {
  return {
    args: { response: c11ThreeResponse },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      row(0).scrollIntoView({ block: "start" });
      await sleep(POINTER_GUARD_MS + 200);
      await clickAt(browser, centerOf(button(row(0), /Descartar línea/)));
      await sleep(3000);
      const search = button(row(1), /Buscar producto/);
      const aim = centerOf(search);
      await browser.userEvent.hover(search);
      await sleep(1400);
      await expect(describeControl(document.elementFromPoint(aim.x, aim.y)?.closest("button") ?? null)).toBe(
        describeControl(search),
      );
      await clickAt(browser, aim);
      await sleep(300);
      await expect(within(row(1)).getByLabelText("Producto de la línea 2")).toBeInTheDocument();
      await expect(statuses()).toEqual({
        0: "discarded",
        1: "pending_doubtful",
        2: "pending_doubtful",
        3: "pending_doubtful",
      });
      await expectHeldSummary(0, /Línea descartada · Restaurar/);
    },
  };
}

export const MP112Raton1280 = mp112(1280);
export const MP112Raton390 = mp112(390);

/**
 * D49: con el ratón, el layout se aplica al salir del panel completo; al volver, el clic antes de
 * 1 s sobre un control que se movió no actúa y pasado 1 s sí.
 */
export const SalirDelPanelRaton1280: Story = {
  args: { response: c11ThreeResponse },
  play: async () => {
    const browser = await prepare(1280);
    if (!browser) {
      return;
    }
    row(0).scrollIntoView({ block: "start" });
    await sleep(POINTER_GUARD_MS + 200);
    const heldHeight = row(0).getBoundingClientRect().height;
    await clickAt(browser, centerOf(button(row(0), /Descartar línea/)));
    await sleep(POINTER_GUARD_MS + 100);
    await expect(row(0).getBoundingClientRect().height, "ratón en el panel: la caja se conserva").toBe(heldHeight);

    const outside = panel().getBoundingClientRect();
    await browser.userEvent.hover(document.body, { position: { x: 4, y: Math.max(4, outside.top - 8) } });
    await sleep(100);
    await expect(row(0).getBoundingClientRect().height, "fuera del panel: se aplica").toBeLessThan(heldHeight);

    const [chip] = within(row(2)).getAllByRole("button", { name: /^CAOSG Jabon Azul 250g/ });
    await clickAt(browser, centerOf(chip));
    await sleep(200);
    await expect(row(2).dataset.status, "antes de 1 s, el chip que se movió no actúa").toBe("pending_doubtful");

    await sleep(POINTER_GUARD_MS);
    await clickAt(browser, centerOf(chip));
    await sleep(200);
    await expect(row(2).dataset.status, "pasado 1 s, sí").toBe("resolved");
  },
};

/** REP11-03 · B-p11-1: una lista larga del buscador, abierta hacia arriba, tapa los chips de su fila. */
const galletas: ProductEntityOption[] = Array.from({ length: 8 }, (_, index) => ({
  barcode: null,
  categoryId: "cat-1",
  currentCostRef: 0.5,
  currentStock: 5,
  id: productUuid(700 + index),
  isActive: true,
  label: `CAOSG Galleta Maria ${index + 1}`,
  salePriceRef: 1,
  sku: `CAOSG-G${index + 1}`,
}));

/**
 * Abre el buscador de L0 con su campo al pie de la ventana (la lista se abre hacia arriba, sobre los
 * chips de la fila) y busca «Galleta».
 */
async function openSearchAtBottom(browser: Browser, opener: RegExp) {
  row(0).scrollIntoView({ block: "start" });
  await setupClick(browser, button(row(0), opener));
  const input = within(row(0)).getByLabelText("Producto de la línea 1");
  input.scrollIntoView({ block: "end" });
  await browser.userEvent.fill(input, "Galleta");
  await screen.findAllByRole("option", { name: /CAOSG Galleta Maria/ });
  await sleep(POINTER_GUARD_MS + 200);
}

/**
 * B-p11-1 (caos p11): se elige con el puntero una opción que tapa el chip candidato de la misma fila;
 * la lista se cierra y el chip queda bajo el punto. Una 2.ª activación en el mismo punto a `at` ms no
 * reemplaza el producto elegido. Antes se elige otra galleta con el teclado (sin guarda): así el chip
 * «Elegido por ti» ya existe y el candidato no cambia de sitio al elegir.
 */
function chipBajoOpcion(width: number, pointer: Pointer, at: number): Story {
  return {
    args: { productFetcher: async () => galletas, response: c11ThreeResponse },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      // Ventana baja: el campo puede quedar al pie y la lista se abre hacia arriba.
      await browser.page.viewport(width, 560);
      await openSearchAtBottom(browser, /Buscar producto/);
      await browser.userEvent.keyboard("{ArrowDown}{Enter}");
      await sleep(300);
      await openSearchAtBottom(browser, /Cambiar producto/);

      const chip = button(row(0), /^CAOSG Harina Maiz 1kg/);
      const chipBox = chip.getBoundingClientRect();
      const options = screen.getAllByRole("option").filter((item) => !/Maria 1(?!\d)/.test(item.textContent ?? ""));
      const option = options.find((item) => {
        const box = item.getBoundingClientRect();
        return box.top < chipBox.bottom - 4 && box.bottom > chipBox.top + 4;
      });
      if (!option) {
        throw new Error(`Ninguna opción de la lista tapa el chip de la fila (chip ${Math.round(chipBox.top)})`);
      }
      const box = option.getBoundingClientRect();
      const point = {
        x: (Math.max(box.left, chipBox.left) + Math.min(box.right, chipBox.right)) / 2,
        y: (Math.max(box.top, chipBox.top) + Math.min(box.bottom, chipBox.bottom)) / 2,
      };
      await expect(document.elementFromPoint(point.x, point.y)?.closest("[role='option']"), "el punto es de la opción").toBe(option);
      const picked = (option.textContent ?? "").match(/CAOSG Galleta Maria \d/)?.[0] ?? "";

      await activateAt(browser, point, pointer);
      const start = performance.now();
      await sleepUntil(start, 100);
      await expect(describeControl(decisionAt(point)), "al cerrarse la lista, bajo el punto").toBe(describeControl(chip));
      await expect(chip, "elegida la opción, el chip no está marcado").toHaveAttribute("aria-pressed", "false");
      await expect(row(0)).toHaveTextContent(picked);
      await sleepUntil(start, at);
      await activateAt(browser, point, pointer);
      await sleep(300);
      await expect(chip, `la 2.ª activación a ${at} ms no acepta el chip`).toHaveAttribute("aria-pressed", "false");
      await expect(row(0)).toHaveTextContent(picked);
    },
  };
}

export const ChipBajoOpcion1280Raton1200 = chipBajoOpcion(1280, "mouse", 1200);
export const ChipBajoOpcion1280Tactil1200 = chipBajoOpcion(1280, "touch", 1200);
export const ChipBajoOpcion390Raton1200 = chipBajoOpcion(390, "mouse", 1200);
export const ChipBajoOpcion390Tactil1200 = chipBajoOpcion(390, "touch", 1200);
export const ChipBajoOpcion390Tactil600 = chipBajoOpcion(390, "touch", 600);

/**
 * B-p11-2 (QA p11, D48-c): con el buscador abierto, Tab recorre la fila en el orden visual: cada
 * control al que llega está a la misma altura o más abajo que el anterior.
 */
function ordenTabBuscador(width: number): Story {
  return {
    args: { response: c11ThreeResponse },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      row(0).scrollIntoView({ block: "start" });
      await setupClick(browser, button(row(0), /Buscar producto/));
      button(row(0), /^CAOSG Harina Maiz 1kg/).focus();
      const visited: string[] = [];
      let previousTop = -Infinity;
      for (let presses = 0; presses < 8 && row(0).contains(document.activeElement); presses += 1) {
        const focused = document.activeElement as HTMLElement;
        const { top } = focused.getBoundingClientRect();
        visited.push(`${describeControl(focused)}@${Math.round(top)}`);
        await expect(top, `Tab sube: ${visited.join(" → ")}`).toBeGreaterThanOrEqual(previousTop - 1);
        previousTop = top;
        await browser.userEvent.keyboard("{Tab}");
        await sleep(50);
      }
      await expect(visited.some((item) => item.startsWith("INPUT")), `pasa por el buscador: ${visited.join(" → ")}`).toBe(true);
    },
  };
}

export const OrdenTabBuscador1280 = ordenTabBuscador(1280);
export const OrdenTabBuscador390 = ordenTabBuscador(390);

/**
 * B-p11-2 (caos p11): tras aplicarse el layout (aquí al desplazar), el toque que cae en un campo de
 * texto que se movió no le da el foco (ni abre el teclado) antes de 1 s; pasado 1 s, sí.
 */
export const CampoMovidoSinFocoTactil390: Story = {
  args: { response: c11ThreeResponse },
  play: async () => {
    const browser = await prepare(390);
    if (!browser) {
      return;
    }
    row(0).scrollIntoView({ block: "start" });
    await sleep(POINTER_GUARD_MS + 200);
    await tapAt(browser, centerOf(button(row(0), /Descartar línea/)));
    await sleep(POINTER_GUARD_MS + 200);
    const quantity = within(row(1)).getByLabelText(/^Cantidad/);
    const before = quantity.getBoundingClientRect().top;
    window.scrollBy({ top: 40, behavior: "instant" });
    await sleep(150);
    await expect(quantity.getBoundingClientRect().top, "al desplazar se aplica el layout").not.toBe(before);

    await tapAt(browser, centerOf(quantity));
    await sleep(150);
    await expect(document.activeElement, "antes de 1 s el campo movido no recibe el foco").not.toBe(quantity);

    await sleep(POINTER_GUARD_MS);
    await tapAt(browser, centerOf(quantity));
    await sleep(150);
    await expect(document.activeElement, "pasado 1 s, sí").toBe(quantity);
  },
};
