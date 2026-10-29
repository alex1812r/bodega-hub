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
import { type ComponentProps, useEffect, useState } from "react";
import { expect, fn, screen, waitFor, within } from "storybook/test";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { InvoiceDuplicatesFetcher } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type { EntityFetcher, ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import { makeReviewResponse, productUuid, REVIEW_SCAN_ID, REVIEW_SUPPLIER_ID, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { deferCdpAck, fillField, pressKeys, settleCdpAcks, typeText } from "./InvoiceReviewPanel.cdpInput";
import { POINTER_GUARD_MS } from "./useLayoutHold";

const HARINA = productUuid(1);
/** f19d (REP12-05): proveedor que el usuario elige a mano en la revisión. */
const FARMATODO = "00000000-0000-4000-8000-0000000000f1";
const farmatodo = { id: FARMATODO, isActive: true, name: "Farmatodo", taxId: "J-00030426-5" };

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
const noSuppliers: EntityFetcher<"contact"> = async () => [];
// REP17-07 (M-r17Q-1): sin él, la consulta iba al servidor de Vitest y fallaba cuando le tocaba (según la carga).
const noDuplicates: InvoiceDuplicatesFetcher = async () => [];

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

/**
 * Clic real en un punto de la pantalla: lo recibe lo que esté ahí (no un elemento concreto).
 * REP13-05 (M-qa23-1): ratón por CDP, como `tapAt`. `userEvent.click/hover(body, { position })` dejaba que
 * Playwright desplazara la página antes del clic cuando el punto quedaba cerca del borde superior
 * del iframe escalado (con 395 px de scroll, a 89 px de arriba volvía a 0): la medición veía mover
 * las filas sin que la revisión las moviera.
 */
async function clickAt(browser: Browser, point: Point) {
  await clickGesture(browser, point).landed;
}

function clickGesture(browser: Browser, point: Point) {
  const { x, y } = pagePoint(point);
  return sendGesture(browser, "pointerup", (session) => [
    session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
    session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }),
    session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }),
  ]);
}

/**
 * REP17-09 (M-r17Q2-1): un gesto real por CDP, con sus órdenes seguidas (el canal las entrega en orden, como
 * `mouse.click` de Puppeteer). Con la carpeta entera, mientras otros archivos cerraban y abrían, cada acuse tardaba
 * 0,3–1,1 s aunque la entrada llegaba a la página en < 0,25 s. `landed`: el último evento del gesto llegó a la
 * ventana (o ya no llegará: hay acuse).
 * REP17-10 (M-r17Q3-1): los acuses de las preparaciones llegaron a tardar 1,6–2,3 s cada uno; ya no se esperan en serie:
 * el `afterEach` del meta espera todos los de la historia (`settleCdpAcks`).
 */
type Gesture = { landed: Promise<void> };
type CdpSession = ReturnType<Browser["cdp"]>;

/** La 1.ª orden CDP del archivo abre su sesión en el servidor: dos órdenes en frío podían abrir dos y adelantarse. */
let cdpOpened: Promise<unknown> | null = null;

function sendGesture(
  browser: Browser,
  lastEvent: "pointerup" | "keyup",
  send: (session: CdpSession) => Promise<unknown>[],
): Gesture {
  const arrived = new Promise<void>((resolve) => {
    window.addEventListener(lastEvent, () => resolve(), { capture: true, once: true });
  });
  const session = browser.cdp();
  cdpOpened ??= session.send("Runtime.evaluate", { expression: "0" });
  const done = cdpOpened.then(() => Promise.all(send(session))).then(() => undefined);
  deferCdpAck(done);
  return { landed: Promise.race([arrived, done]) };
}

/** Lleva el ratón a un punto de la pantalla sin desplazar la página (por CDP, como `clickAt`). */
async function moveMouseTo(browser: Browser, point: Point): Promise<Point> {
  const target = pagePoint(point);
  await browser.cdp().send("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
  return target;
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
  await tapGesture(browser, point).landed;
}

/** La emulación táctil se apaga en el mismo gesto aunque falle el toque (cada orden se procesa por separado). */
function tapGesture(browser: Browser, point: Point) {
  const touch = pagePoint(point);
  return sendGesture(browser, "pointerup", (session) => [
    session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }),
    session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] }),
    session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
    session.send("Emulation.setTouchEmulationEnabled", { enabled: false }),
  ]);
}

const activateAt = async (browser: Browser, point: Point, pointer: Pointer) => {
  await activationGesture(browser, point, pointer).landed;
};

const activationGesture = (browser: Browser, point: Point, pointer: Pointer) =>
  pointer === "touch" ? tapGesture(browser, point) : clickGesture(browser, point);

function centerOf(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * REP17-07 (M-r17Q-1): el control a la vista y sin nada encima (el pie fijo tapa el borde de abajo de la ventana).
 * Si ni centrado se alcanza, el usuario tampoco podría: es del panel, no del test.
 */
function revealForClick(element: HTMLElement) {
  const atCenter = () => {
    const point = centerOf(element);
    return document.elementFromPoint(point.x, point.y);
  };
  const reachable = () => element.contains(atCenter());
  if (reachable()) {
    return;
  }
  element.scrollIntoView({ block: "center" });
  if (!reachable()) {
    throw new Error(`${describeControl(element)} queda bajo ${describeControl(atCenter())} incluso centrado en la ventana`);
  }
}

/**
 * Paso previo con clic real; el teclado aplica el layout pendiente y se deja pasar la guarda.
 * REP17-09 (M-r17Q2-1): clic y tecla por CDP, el clic en el centro que `revealForClick` acaba de comprobar libre,
 * como el clic objetivo. Mientras la carpeta cerraba y abría archivos, `userEvent.click` (Playwright) tardaba
 * 10–13 s y `userEvent.keyboard` hasta 2,5 s. La guarda corre desde que el clic llega a la página.
 * REP17-10: la tecla, desde que llega; sus acuses se esperan al final de la historia.
 */
async function setupClick(browser: Browser, element: HTMLElement) {
  revealForClick(element);
  await clickGesture(browser, centerOf(element)).landed;
  await sleep(POINTER_GUARD_MS + 100);
  await shiftGesture(browser).landed;
}

/** Clic real (CDP) en el centro de un campo, que `revealForClick` comprueba libre. REP17-10: antes `userEvent.click`. */
async function clickField(browser: Browser, field: HTMLElement) {
  revealForClick(field);
  await clickGesture(browser, centerOf(field)).landed;
}

/** Shift real (CDP `Input.dispatchKeyEvent`): una tecla que no escribe ni mueve el foco. */
function shiftGesture(browser: Browser) {
  const key = { code: "ShiftLeft", key: "Shift", location: 1, windowsVirtualKeyCode: 16 };
  return sendGesture(browser, "keyup", (session) => [
    session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key, modifiers: 8 }),
    session.send("Input.dispatchKeyEvent", { type: "keyUp", ...key }),
  ]);
}

/**
 * La medición de D46-c sobre `target`: tras el clic real no queda OTRO control de decisión en el
 * punto, y el 2.º clic en ese punto a 600 ms no cambia ninguna otra línea ni deja el foco en BODY.
 * REP17-09: los tiempos cuentan desde que el clic llega a la página, no desde su acuse por CDP.
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
  const first = activationGesture(browser, point, timing.pointer);
  await first.landed;
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

  await activationGesture(browser, point, timing.pointer).landed;
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
      await fillField(browser, within(row(3)).getByLabelText(/^Unidades por/), "12");
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

async function prepare(width: number, height = width < 640 ? 844 : 900) {
  const browser = await loadBrowser();
  if (!browser) {
    return null;
  }
  await browser.page.viewport(width, height);
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
    duplicateFetcher: noDuplicates,
    lastUnitCostFetcher: async () => null,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher,
    response: linesResponse,
    supplierFetcher: noSuppliers,
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
      queryClient.setQueryData(purchaseSuppliersQueryKeys.detail(FARMATODO), farmatodo);
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
  afterEach: settleCdpAcks,
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
      await moveMouseTo(browser, aim);
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
 * REP13-05 (M-qa23-1): desde REP12-04 la fila que sigue a la compactada vuelve a su punto desplazando la
 * página, y el chip de L2 ya no se mueve al salir (en la UI real resuelve al primer clic, QA-23). Solo
 * lo movía el desplazamiento que hacía Playwright al pasar el ratón. En una ventana sin desplazamiento
 * nada compensa la compactación: el chip de L2 sí se mueve y la guarda se mide sobre él.
 */
export const SalirDelPanelRaton1280: Story = {
  args: { response: c11ThreeResponse },
  play: async () => {
    const browser = await prepare(1280, 1800);
    if (!browser) {
      return;
    }
    row(0).scrollIntoView({ block: "start" });
    await sleep(POINTER_GUARD_MS + 200);
    const heldHeight = row(0).getBoundingClientRect().height;
    await clickAt(browser, centerOf(button(row(0), /Descartar línea/)));
    await sleep(POINTER_GUARD_MS + 100);
    await expect(row(0).getBoundingClientRect().height, "ratón en el panel: la caja se conserva").toBe(heldHeight);

    const chipTop = within(row(2)).getAllByRole("button", { name: /^CAOSG Jabon Azul 250g/ })[0]?.getBoundingClientRect().top ?? 0;
    const outside = panel().getBoundingClientRect();
    await moveMouseTo(browser, { x: 4, y: Math.max(4, outside.top - 8) });
    await sleep(100);
    await expect(row(0).getBoundingClientRect().height, "fuera del panel: se aplica").toBeLessThan(heldHeight);

    const [chip] = within(row(2)).getAllByRole("button", { name: /^CAOSG Jabon Azul 250g/ });
    await expect(chip.getBoundingClientRect().top, "la compactación mueve el chip de L2").toBeLessThan(chipTop - 1);
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
  await fillField(browser, input, "Galleta");
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
      await pressKeys(browser, "{ArrowDown}{Enter}");
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
        await pressKeys(browser, "{Tab}");
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
 * REP12-04 (B-qa02-1): la fila que sigue a la compactada ya no se mueve (anclaje); se descarta L1 y el
 * campo es la Cantidad de L0, que la compactación sí mueve.
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
    await tapAt(browser, centerOf(button(row(1), /Descartar línea/)));
    await sleep(POINTER_GUARD_MS + 200);
    const quantity = within(row(0)).getByLabelText(/^Cantidad/);
    const before = quantity.getBoundingClientRect().top;
    window.scrollBy({ top: 40, behavior: "instant" });
    await sleep(150);
    const moved = quantity.getBoundingClientRect().top - (before - 40);
    await expect(Math.abs(moved), `al desplazar se aplica el layout y mueve el campo (${Math.round(moved)} px)`).toBeGreaterThan(40);

    await tapAt(browser, centerOf(quantity));
    await sleep(150);
    await expect(document.activeElement, "antes de 1 s el campo movido no recibe el foco").not.toBe(quantity);

    await sleep(POINTER_GUARD_MS);
    await tapAt(browser, centerOf(quantity));
    await sleep(150);
    await expect(document.activeElement, "pasado 1 s, sí").toBe(quantity);
  },
};

/** Alto de cada fila y su posición vertical, redondeados a 0,5 px. */
function rowGeometry() {
  return [...panel().querySelectorAll<HTMLElement>("li[data-line-index]")].map((item) => {
    const { top, height } = item.getBoundingClientRect();
    return `L${item.dataset.lineIndex}@${Math.round(top * 2) / 2}h${Math.round(height * 2) / 2}`;
  });
}

/**
 * B-qa02-2 (QA REP11-02, D48(b)): con el puntero sobre el panel, descartar L0 o resolverla con el
 * chip no cambia la altura ni la posición de ninguna fila: el resumen retenido solo ocupa el alto
 * sobrante (0 px extra), al instante y a los 1,5 s.
 */
function resumenRetenido(width: number, pointer: Pointer, target: () => HTMLElement): Story {
  return {
    args: { response: c11ThreeResponse },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      row(0).scrollIntoView({ block: "start" });
      await sleep(POINTER_GUARD_MS + 200);
      const before = rowGeometry();
      await activateAt(browser, centerOf(target()), pointer);
      await sleep(100);
      await expect(row(0).querySelector('[data-testid="invoice-review-held-summary"]'), "fila retenida").not.toBeNull();
      await expect(rowGeometry(), "a los 100 ms ninguna fila cambia de alto ni de sitio").toEqual(before);
      await sleep(1400);
      await expect(rowGeometry(), "a los 1,5 s tampoco").toEqual(before);
    },
  };
}

const chipL0 = () => button(row(0), /^CAOSG Harina Maiz 1kg/);
const discardL0 = () => button(row(0), /Descartar línea/);

export const ResumenRetenidoChip1280Raton = resumenRetenido(1280, "mouse", chipL0);
export const ResumenRetenidoChip390Tactil = resumenRetenido(390, "touch", chipL0);
export const ResumenRetenidoDescartada1280Raton = resumenRetenido(1280, "mouse", discardL0);
export const ResumenRetenidoDescartada390Tactil = resumenRetenido(390, "touch", discardL0);

/**
 * B-qa02-3 (QA REP11-02, D49): tras descartar L0, activar la Cantidad de L1 y teclear (el mismo
 * valor: el texto de la fila no cambia, solo la compactación podría mover el campo) compacta el
 * layout (el teclado lo aplica), pero el campo en que se escribe se queda en el mismo punto de la
 * pantalla (< 2 px) y conserva el foco y lo tecleado.
 */
function teclearTrasDescartar(width: number, pointer: Pointer): Story {
  return {
    args: { response: c11ThreeResponse },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      row(0).scrollIntoView({ block: "start" });
      await sleep(POINTER_GUARD_MS + 200);
      const heldHeight = row(0).getBoundingClientRect().height;
      await activateAt(browser, centerOf(discardL0()), pointer);
      await sleep(1200);
      const quantity = within(row(1)).getByLabelText(/^Cantidad/);
      await activateAt(browser, centerOf(quantity), pointer);
      await sleep(300);
      await expect(document.activeElement, "la Cantidad de L1 tiene el foco").toBe(quantity);
      const before = quantity.getBoundingClientRect().top;
      await pressKeys(browser, "1");
      await sleep(300);
      await expect(row(0).getBoundingClientRect().height, "el teclado aplica el layout").toBeLessThan(heldHeight);
      await expect(document.activeElement, "el foco sigue en la Cantidad").toBe(quantity);
      await expect(quantity instanceof HTMLInputElement ? quantity.value : "", "lo tecleado llega al campo").toBe("1");
      const moved = quantity.getBoundingClientRect().top - before;
      await expect(Math.abs(moved), `el campo enfocado se movió ${Math.round(moved)} px`).toBeLessThan(2);
    },
  };
}

export const TeclearTrasDescartar390Tactil = teclearTrasDescartar(390, "touch");
export const TeclearTrasDescartar1280Raton = teclearTrasDescartar(1280, "mouse");

/** c12-foot (C12B-M1): L0 «CG-HARINA» 1 × 450 confirmada por SKU; L1 «FLETE Y TRANSPORTE» 1 × 900 sin emparejar; leído 1.350. */
const footResponse = makeReviewResponse({
  extraction: { subtotal: 1350, total: 1350 },
  lines: [
    {
      read: {
        rawText: "CG-HARINA HARINA MAIZ 1KG 1 450,00 450,00",
        description: "HARINA MAIZ 1KG",
        supplierSku: "CG-HARINA",
        unit: "unidad",
        quantity: 1,
        unitPrice: 450,
        lineTotal: 450,
      },
      match: {
        status: "confirmed",
        productId: HARINA,
        taxRateCode: "exento",
        candidates: [{ productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "SKU del proveedor", lastUnitCostRef: 0.5 }],
        lastUnitCostRef: 0.5,
      },
    },
    {
      read: {
        rawText: "FLETE Y TRANSPORTE 1 900,00 900,00",
        description: "FLETE Y TRANSPORTE",
        unit: "otro",
        quantity: 1,
        unitPrice: 900,
        lineTotal: 900,
      },
      match: { status: "unmatched", productId: undefined, candidates: undefined, taxRateCode: "exento" },
    },
  ],
});

const boxText = (box: DOMRect) =>
  `(${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}×${Math.round(box.height)})`;

function intersects(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * C12B-M1 (REP12-02 · D54(a)): descartar la última pendiente (L1) y, a los `at` ms, activar el punto
 * donde estaba «Cargar». La casilla de diferencia aparece en un sitio que no es el de «Cargar», que no
 * se mueve (0 px); el 2.º toque no marca la casilla ni habilita «Cargar». Con `height` la ventana es
 * más baja y el pie queda pegado abajo, como en el reporte (crecía hacia arriba; B-p12B-1 a 1280).
 */
function c12bm1Pie(width: number, pointer: Pointer, at: number, height?: number): Story {
  return {
    args: { response: footResponse },
    play: async ({ args }) => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      if (height) {
        await browser.page.viewport(width, height);
      }
      const discard = button(row(1), /Descartar línea/);
      discard.scrollIntoView({ block: "center" });
      await sleep(POINTER_GUARD_MS + 200);
      const load = screen.getByRole("button", { name: "Cargar en la compra" });
      const footer = screen.getByRole("contentinfo", { name: "Resumen de la revisión" });
      const loadBefore = load.getBoundingClientRect();
      const footerBefore = footer.getBoundingClientRect();
      const aim = centerOf(load);
      await expect(load, "antes, «Cargar» está deshabilitado (falta L1)").toBeDisabled();
      // «Cargar» deshabilitado no recibe el puntero (pointer-events: none): el punto cae en el pie.
      await expect(
        document.elementFromPoint(aim.x, aim.y)?.closest("footer"),
        `antes, el punto de «Cargar» ${boxText(loadBefore)} está en el pie ${boxText(footerBefore)} (ventana ${window.innerHeight})`,
      ).toBe(footer);

      await activateAt(browser, centerOf(discard), pointer);
      const start = performance.now();
      await sleepUntil(start, 100);
      await expect(row(1).dataset.status, "el 1.er toque descarta L1").toBe("discarded");
      const slot = screen.getByTestId("invoice-review-confirm-difference");
      const box = within(slot).getByRole("checkbox");
      const loadAfter = load.getBoundingClientRect();
      const footerAfter = footer.getBoundingClientRect();
      const report =
        `${width} ${pointer} @${at}ms · viewport ${window.innerWidth}×${window.innerHeight} · ` +
        `pie antes ${boxText(footerBefore)} después ${boxText(footerAfter)} · ` +
        `Cargar antes ${boxText(loadBefore)} después ${boxText(loadAfter)} ` +
        `Δ=(${Math.round(loadAfter.left - loadBefore.left)},${Math.round(loadAfter.top - loadBefore.top)}) · ` +
        `casilla ${boxText(box.getBoundingClientRect())} zona ${boxText(slot.getBoundingClientRect())} · ` +
        `bajo el punto de Cargar: ${describeControl(document.elementFromPoint(aim.x, aim.y)?.closest("button, input, label") ?? null)}`;
      console.log(`[C12B-M1] ${report}`);

      await sleepUntil(start, at);
      await activateAt(browser, aim, pointer);
      await sleep(300);
      console.log(`[C12B-M1] ${width} ${pointer} @${at}ms · casilla=${String(box instanceof HTMLInputElement && box.checked)} · Cargar=${String(!(load as HTMLButtonElement).disabled)}`);
      await expect(box, `${report}: el toque a ${at} ms no marca la casilla`).not.toBeChecked();
      await expect(load, "ni habilita «Cargar»").toBeDisabled();
      await expect(Math.abs(loadAfter.top - loadBefore.top), `«Cargar» no se mueve: ${report}`).toBeLessThan(0.5);
      await expect(Math.abs(loadAfter.left - loadBefore.left), `«Cargar» no se mueve: ${report}`).toBeLessThan(0.5);
      await expect(intersects(box.getBoundingClientRect(), loadBefore), `la casilla no cae en la caja previa de «Cargar»: ${report}`).toBe(false);
      await expect(intersects(slot.getBoundingClientRect(), loadBefore), `ni su texto: ${report}`).toBe(false);
      await expect(args.onLoad).not.toHaveBeenCalled();
    },
  };
}

export const C12BM1Pie390Tactil300 = c12bm1Pie(390, "touch", 300);
export const C12BM1Pie390Tactil700 = c12bm1Pie(390, "touch", 700);
export const C12BM1Pie390Tactil1500 = c12bm1Pie(390, "touch", 1500);
export const C12BM1Pie390Tactil700Pegado = c12bm1Pie(390, "touch", 700, 600);
export const C12BM1Pie1280Raton700 = c12bm1Pie(1280, "mouse", 700);
export const C12BM1Pie1280Raton700Pegado = c12bm1Pie(1280, "mouse", 700, 560);

type Compaction = "salir" | "desplazar" | "teclado";

/** Mueve el ratón real (CDP) a un punto de la pantalla, sin que Playwright desplace la página. */
async function mouseMoveTo(browser: Browser, point: Point) {
  const target = pagePoint(point);
  await browser.cdp().send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
}

/** Aplica el layout pendiente como el usuario: sacando el ratón del panel, desplazando o con el teclado. */
async function compact(browser: Browser, how: Compaction) {
  if (how === "salir") {
    // Margen izquierdo del decorador (p-4): fuera del panel, sobre nada accionable.
    await mouseMoveTo(browser, { x: 4, y: Math.round(window.innerHeight / 2) });
  } else if (how === "desplazar") {
    window.scrollBy({ top: 40, behavior: "instant" });
  } else {
    await shiftGesture(browser).landed;
  }
  await sleep(300);
}

/**
 * B-qa02-1 (D52): con L1 arriba de la vista, descartarla y aplicar el layout (salir del panel,
 * desplazar o teclado). La fila siguiente (L2) no se va: su posición en pantalla cambia < 2 px
 * (descontando los 40 px que desplaza el usuario), aunque L1 encoja.
 */
function anclajeCompactacion(width: number, pointer: Pointer, how: Compaction): Story {
  return {
    args: { response: c11ThreeResponse },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      if (width >= 640) {
        await browser.page.viewport(width, 560);
      }
      row(1).scrollIntoView({ block: "start" });
      await sleep(POINTER_GUARD_MS + 200);
      await activateAt(browser, centerOf(button(row(1), /Descartar línea/)), pointer);
      await sleep(POINTER_GUARD_MS + 200);
      await expect(row(1).dataset.status, "L1 descartada").toBe("discarded");
      const heldHeight = row(1).getBoundingClientRect().height;
      const before = row(2).getBoundingClientRect().top;
      const expected = before - (how === "desplazar" ? 40 : 0);
      await compact(browser, how);
      const after = row(2).getBoundingClientRect().top;
      const report = `${width} ${pointer} ${how} · L1 ${Math.round(heldHeight)}→${Math.round(row(1).getBoundingClientRect().height)} px · L2 antes ${Math.round(before)} esperado ${Math.round(expected)} después ${Math.round(after)} · scrollY ${Math.round(window.scrollY)}`;
      console.log(`[B-qa02-1] ${report}`);
      await expect(row(1).getBoundingClientRect().height, `se aplicó el layout: ${report}`).toBeLessThan(heldHeight - 40);
      await expect(Math.abs(after - expected), `L2 se desplazó ${Math.round(after - expected)} px: ${report}`).toBeLessThan(2);
    },
  };
}

export const AnclajeCompactacion1280RatonSalir = anclajeCompactacion(1280, "mouse", "salir");
export const AnclajeCompactacion1280RatonDesplazar = anclajeCompactacion(1280, "mouse", "desplazar");
export const AnclajeCompactacion1280RatonTeclado = anclajeCompactacion(1280, "mouse", "teclado");
export const AnclajeCompactacion390TactilDesplazar = anclajeCompactacion(390, "touch", "desplazar");
export const AnclajeCompactacion390TactilTeclado = anclajeCompactacion(390, "touch", "teclado");

/**
 * B-p12B-2 (caos p12 B): con pocas líneas y la página casi sin desplazamiento, la compactación acorta
 * el documento, el navegador recorta el desplazamiento y lo que está ENCIMA del panel baja: un campo
 * del formulario (aquí la fecha, fuera del panel) queda bajo el puntero que acaba de salir del panel.
 * La activación antes de 1 s desde la compactación no le da el foco (D49, guarda anclada a la
 * compactación); pasado 1 s, sí.
 */
function campoFueraDelPanel(width: number, pointer: Pointer): Story {
  return {
    args: { response: homonymsResponse },
    render: (args) => (
      <>
        <input aria-label="Fecha de la compra" className="mb-1.5 block h-10 w-full rounded border" type="date" />
        <InvoiceReviewPanel {...args} />
      </>
    ),
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      // Ventana 30 px más baja que el documento: al fondo, la fecha (encima del panel) se ve.
      await browser.page.viewport(width, document.documentElement.scrollHeight - 30);
      await sleep(300);
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      await sleep(POINTER_GUARD_MS + 200);
      const date = screen.getByLabelText("Fecha de la compra");
      const discard = button(row(1), /Descartar línea/);
      const aimDiscard = centerOf(discard);
      await expect(document.elementFromPoint(aimDiscard.x, aimDiscard.y)?.closest("button"), "«Descartar línea» de L1 a la vista").toBe(discard);
      await activateAt(browser, aimDiscard, pointer);
      await sleep(POINTER_GUARD_MS + 200);
      await expect(row(1).dataset.status, "L1 descartada").toBe("discarded");
      const geo = () =>
        `scrollY ${Math.round(window.scrollY)} doc ${document.documentElement.scrollHeight} L1 ${Math.round(row(1).getBoundingClientRect().height)} fecha ${Math.round(date.getBoundingClientRect().top)}`;
      const geoBefore = geo();
      // Entre la fecha y el panel (fuera del panel, nada accionable).
      const point = { x: centerOf(date).x, y: panel().getBoundingClientRect().top - 3 };
      if (pointer === "mouse") {
        await mouseMoveTo(browser, point);
      } else {
        window.scrollBy({ top: -10, behavior: "instant" });
      }
      const start = performance.now();
      await sleepUntil(start, 300);
      const under = document.elementFromPoint(point.x, point.y);
      const report = `${width} ${pointer} · antes ${geoBefore} · después ${geo()} · punto (${Math.round(point.x)},${Math.round(point.y)}) · bajo el punto: ${describeControl(under?.closest("button, input, textarea, label") ?? null)}`;
      console.log(`[B-p12B-2] ${report}`);
      await expect(row(1).getBoundingClientRect().height, `se aplicó el layout: ${report}`).toBeLessThan(150);
      await expect(under, `tras compactar, la fecha quedó bajo el puntero: ${report}`).toBe(date);
      await activateAt(browser, point, pointer);
      await sleep(150);
      await expect(document.activeElement, `antes de 1 s el campo que bajó no recibe el foco: ${report}`).not.toBe(date);
      await sleepUntil(start, POINTER_GUARD_MS + 400);
      await activateAt(browser, point, pointer);
      await sleep(150);
      await expect(document.activeElement, "pasado 1 s, sí").toBe(date);
    },
  };
}

export const CampoFueraDelPanel1280Raton = campoFueraDelPanel(1280, "mouse");
export const CampoFueraDelPanel390Tactil = campoFueraDelPanel(390, "touch");

const farmatodoFetcher: EntityFetcher<"contact"> = async () => [
  { id: FARMATODO, isActive: true, label: "Farmatodo", phone: "", taxId: farmatodo.taxId, type: "proveedor" },
];

/** f19d: «FARMACIA OPALO», sin RIF ni proveedor reconocido; la línea ya está resuelta (Cargar solo espera el duplicado). */
const f19Response = makeReviewResponse({
  lines: [{ read: { quantity: 1, unitPrice: 1750, lineTotal: 1750 }, match: { taxRateCode: "exento" } }],
  extraction: { supplier: { name: "FARMACIA OPALO" }, number: "00362952", date: "2026-09-03", total: 1750 },
  matched: { supplier: {} },
});

/**
 * M-qa-rep12-1 (REP12-05 · D49/D54): f19d. Escribir «Farma» en Proveedor, elegir «Farmatodo» y, a los
 * `at` ms, volver a activar el punto del campo Proveedor. El aviso de duplicado aparece y empuja la
 * cabecera; lo que quede en ese punto (su texto, su casilla) no marca la casilla ni habilita «Cargar».
 */
function f19dAviso(width: number, pointer: Pointer, at: number): Story {
  return {
    args: {
      duplicateFetcher: async (query) =>
        query.supplierId === FARMATODO
          ? [{ scanId: "scan-previo", purchaseId: "00000000-0000-4000-8000-0000000000c8", number: "00362952", date: "2026-09-03" }]
          : [],
      response: f19Response,
      supplierFetcher: farmatodoFetcher,
    },
    play: async ({ args }) => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      const field = screen.getByRole("combobox", { name: /proveedor/i });
      field.scrollIntoView({ block: "center" });
      await clickField(browser, field);
      await typeText(browser, "Farma");
      const option = await screen.findByRole("option", { name: /farmatodo/i });
      await sleep(POINTER_GUARD_MS + 200);
      const aim = centerOf(field);
      const load = screen.getByRole("button", { name: "Cargar en la compra" });
      await expect(screen.queryByText(/ya se registró en una compra/), "antes de elegir no hay aviso").toBeNull();

      await activateAt(browser, centerOf(option), pointer);
      const start = performance.now();
      await waitFor(() => expect(screen.getByText(/ya se registró en una compra/)).toBeInTheDocument(), { timeout: 900 });
      const shownAt = Math.round(performance.now() - start);
      const box = screen.getByRole("checkbox", { name: /cargarla igual/i });
      const under = document.elementFromPoint(aim.x, aim.y);
      const report =
        `${width} ${pointer} @${at}ms · aviso a los ${shownAt} ms · punto del campo (${Math.round(aim.x)},${Math.round(aim.y)}) · ` +
        `casilla ${boxText(box.getBoundingClientRect())} · bajo el punto: ${describeControl(under?.closest("button, input, label, span, div") ?? null)}`;
      console.log(`[M-qa-rep12-1] ${report}`);
      await expect(box, "el aviso aparece sin marcar").not.toBeChecked();
      await expect(load, "y «Cargar» espera la casilla").toBeDisabled();

      await sleepUntil(start, at);
      await activateAt(browser, aim, pointer);
      await sleep(300);
      console.log(
        `[M-qa-rep12-1] ${width} ${pointer} @${at}ms · casilla=${String((box as HTMLInputElement).checked)} · Cargar=${String(!(load as HTMLButtonElement).disabled)}`,
      );
      await expect(box, `${report}: el toque a ${at} ms no marca la casilla`).not.toBeChecked();
      await expect(load, `${report}: ni habilita «Cargar»`).toBeDisabled();
      await expect(args.onLoad).not.toHaveBeenCalled();
    },
  };
}

export const MQaRep12F19d390Tactil400 = f19dAviso(390, "touch", 400);
export const MQaRep12F19d390Tactil700 = f19dAviso(390, "touch", 700);
export const MQaRep12F19d390Tactil1500 = f19dAviso(390, "touch", 1500);
export const MQaRep12F19d1280Raton400 = f19dAviso(1280, "mouse", 400);
export const MQaRep12F19d1280Raton700 = f19dAviso(1280, "mouse", 700);
export const MQaRep12F19d1280Raton1500 = f19dAviso(1280, "mouse", 1500);

/** REP12-06: aviso de duplicado del escaneo y diferencia frente al total leído a la vez. */
const casillasResponse = makeReviewResponse({
  extraction: { total: 9999 },
  lines: [{}, { read: { description: "Arroz Mary 1kg", rawText: "ARROZ MARY 1KG" } }],
  matched: { duplicateOfScanId: "scan-previo" },
});

/**
 * REP12-06 (QA-05, observación): las casillas que reconocen dinero (aviso de duplicado y diferencia)
 * solo responden a su propio control; su área táctil mide al menos 24 × 24 px (WCAG 2.5.8).
 */
function casillasTactiles(width: number): Story {
  return {
    args: {
      // REP17-07: la consulta confirma el duplicado del escaneo (antes la casilla dependía de que fallara la de la red).
      duplicateFetcher: async () => [{ date: "2026-10-14", number: "000123", purchaseId: null, scanId: "scan-previo" }],
      response: casillasResponse,
    },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      const boxes = {
        duplicado: screen.getByRole("checkbox", { name: /cargarla igual/i }),
        diferencia: within(screen.getByTestId("invoice-review-confirm-difference")).getByRole("checkbox"),
      };
      for (const [name, box] of Object.entries(boxes)) {
        const rect = box.getBoundingClientRect();
        await expect(Math.min(rect.width, rect.height), `${width} casilla de ${name}: ${boxText(rect)}`).toBeGreaterThanOrEqual(24);
      }
    },
  };
}

export const Rep1206CasillasTactiles390 = casillasTactiles(390);
export const Rep1206CasillasTactiles1280 = casillasTactiles(1280);

/**
 * REP12-06 (B-qa05-1): a 390, con la consulta de duplicados caída tras elegir el proveedor a mano, el
 * pie PLEGADO dice que no se pudo comprobar (Cargar sigue habilitado: el fallo no bloquea, D52).
 */
export const Rep1206FalloDuplicadosPiePlegado390: Story = {
  args: {
    duplicateFetcher: async () => {
      throw new Error("500");
    },
    response: f19Response,
    supplierFetcher: farmatodoFetcher,
  },
  play: async () => {
    const browser = await prepare(390);
    if (!browser) {
      return;
    }
    const field = screen.getByRole("combobox", { name: /proveedor/i });
    field.scrollIntoView({ block: "center" });
    await clickField(browser, field);
    await typeText(browser, "Farma");
    await clickAt(browser, centerOf(await screen.findByRole("option", { name: /farmatodo/i })));
    const footer = screen.getByRole("contentinfo", { name: "Resumen de la revisión" });
    await expect(within(footer).getByRole("button", { name: "Ver detalle del total" }), "pie plegado").toBeVisible();
    await waitFor(
      () => {
        const shown = within(footer)
          .queryAllByText(/No se pudo comprobar/)
          .filter((element) => element.checkVisibility() && element.getBoundingClientRect().height > 0);
        expect(shown.length, "texto de fallo visible en el pie plegado").toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
    await expect(screen.getByRole("button", { name: "Cargar en la compra" })).toBeEnabled();
  },
};

/** Arriba de cada fila de la revisión, en orden (px de pantalla). */
function rowTops() {
  return [...panel().querySelectorAll<HTMLElement>("li[data-line-index]")].map((item) => item.getBoundingClientRect().top);
}

function shifts(before: readonly number[], after: readonly number[]) {
  return after.map((top, index) => Math.round(top - (before[index] ?? top)));
}

/** Espera a que `find` encuentre el aviso (al render que lo monta) y a que se pinte. */
function whenShown(find: () => Element | null, timeout: number) {
  return new Promise<Element>((resolve, reject) => {
    const settle = (element: Element) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(element)));
    const found = find();
    if (found) {
      settle(found);
      return;
    }
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`el aviso no apareció en ${timeout} ms`));
    }, timeout);
    const observer = new MutationObserver(() => {
      const element = find();
      if (element) {
        observer.disconnect();
        clearTimeout(timer);
        settle(element);
      }
    });
    observer.observe(document.body, { characterData: true, childList: true, subtree: true });
  });
}

/** c14-jabonfirst: L0 y L3 jabón con dos homónimos, L1 y L2 harina; proveedor leído desconocido. */
const jabonFirstResponse = makeReviewResponse({
  lines: [
    jabonHomonyms(),
    harinaByName(450),
    (() => {
      const line = harinaByName(450);
      return { ...line, read: { ...line.read, quantity: 2, lineTotal: 900 } };
    })(),
    jabonHomonyms(),
  ],
  extraction: {
    supplier: { name: "Comercial Desconocida 14B" },
    number: "CG14-JABON1",
    date: "2026-10-17",
    subtotal: 2250,
    total: 2250,
  },
  matched: { supplier: {} },
});

const DUPLICATE_DELAY_MS = 1500;

/**
 * M-p14B-2 / B-p13B-2 (REP13-03 · D60(c)): arriba del todo, elegir «Farmatodo» a mano; la consulta de
 * duplicados tarda 1,5 s. Al llegar, el aviso no mueve las filas: el toque destinado a «Descartar línea»
 * de L0 (justo al llegar o `after` ms después) la descarta y nunca acepta un homónimo.
 */
function avisoDuplicadoFilas(width: number, height: number, pointer: Pointer, after: number): Story {
  return {
    args: {
      duplicateFetcher: async (query) => {
        await sleep(DUPLICATE_DELAY_MS);
        return query.supplierId === FARMATODO
          ? [{ scanId: "scan-previo", purchaseId: null, number: "CG14-JABON1", date: "2026-10-17" }]
          : [];
      },
      response: jabonFirstResponse,
      supplierFetcher: farmatodoFetcher,
    },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const field = screen.getByRole("combobox", { name: /proveedor/i });
      await clickField(browser, field);
      await typeText(browser, "Farma");
      const option = await screen.findByRole("option", { name: /farmatodo/i });
      await sleep(POINTER_GUARD_MS + 200);
      await activateAt(browser, centerOf(option), pointer);
      await sleep(200);
      window.scrollTo({ top: 0, behavior: "instant" });
      await sleep(100);
      const discard = button(row(0), /Descartar línea/);
      const aim = centerOf(discard);
      const footerTop = screen.getByRole("contentinfo", { name: "Resumen de la revisión" }).getBoundingClientRect().top;
      await expect(aim.y < footerTop && decisionAt(aim) === discard, `«Descartar línea» de L0 a la vista en ${width}×${height}`).toBe(true);
      const before = rowTops();
      const boxBefore = discard.getBoundingClientRect();

      await whenShown(() => screen.queryByText(/ya se escaneó antes en la tienda/), DUPLICATE_DELAY_MS + 2000);
      const moved = shifts(before, rowTops());
      const under = decisionAt(aim);
      const report =
        `${width}×${height} ${pointer} +${after}ms · scrollY=${Math.round(window.scrollY)} · Descartar L0 antes ${boxText(boxBefore)} ` +
        `después ${boxText(discard.getBoundingClientRect())} · Δ filas ${moved.join(",")} · bajo el punto: ${describeControl(under)}`;
      console.log(`[M-p14B-2] ${report}`);
      if (after > 0) {
        await sleep(after);
      }
      await activateAt(browser, aim, pointer);
      await sleep(400);
      console.log(`[M-p14B-2] ${width}×${height} ${pointer} +${after}ms · L0=${row(0).dataset.status ?? "?"}`);
      await expect(row(0).dataset.status, `${report}: L0 nunca queda resuelta`).not.toBe("resolved");
      await expect(within(row(0)).queryByRole("button", { name: /Restaurar/ }), `${report}: el toque descarta L0`).not.toBeNull();
      await expect(moved.every((shift) => shift === 0), `${report}: las filas no se mueven`).toBe(true);
    },
  };
}

export const MP14B2Duplicado1024x1366Tactil0 = avisoDuplicadoFilas(1024, 1366, "touch", 0);
export const MP14B2Duplicado1024x1366Tactil150 = avisoDuplicadoFilas(1024, 1366, "touch", 150);
export const MP14B2Duplicado390x1100Tactil0 = avisoDuplicadoFilas(390, 1100, "touch", 0);
export const MP14B2Duplicado1280x900Raton0 = avisoDuplicadoFilas(1280, 900, "mouse", 0);

type ControlPoint = { control: HTMLElement; point: Point };

/**
 * D60(c), tras aparecer o cambiar un aviso: las filas siguen en su punto y cada control de `points` también.
 * Solo si la página ya no da para desplazar lo que creció (o encogió) el aviso se mueven; entonces lo que quedó bajo esos
 * puntos no actúa (guarda de 1 s anclada a la aparición del aviso).
 */
async function expectRowsKept(browser: Browser, label: string, before: readonly number[], points: readonly ControlPoint[]) {
  const moved = shifts(before, rowTops());
  const lost = points.filter(({ control, point }) => decisionAt(point) !== control);
  const scroller = document.scrollingElement ?? document.documentElement;
  // Lo que creció el aviso se compensa bajando; lo que encogió, subiendo.
  const atLimit =
    moved.some((shift) => shift > 0)
      ? Math.ceil(scroller.scrollTop) >= scroller.scrollHeight - scroller.clientHeight - 1
      : scroller.scrollTop < 1;
  const report =
    `${label} · scrollY=${Math.round(window.scrollY)}${atLimit ? " (tope del desplazamiento)" : ""} · Δ filas ${moved.join(",")} · ` +
    `controles que dejan su punto: ${lost.map(({ control, point }) => `${describeControl(control)} punto (${Math.round(point.x)},${Math.round(point.y)}) ahora ${boxText(control.getBoundingClientRect())}, en el punto ${describeControl(document.elementFromPoint(point.x, point.y))}`).join(" | ") || "ninguno"}`;
  console.log(report);
  if (moved.every((shift) => shift === 0)) {
    await expect(lost.length, report).toBe(0);
    return;
  }
  await expect(atLimit, `${report}: las filas solo se mueven si no queda desplazamiento`).toBe(true);
  const state = observableState();
  for (const { point } of lost) {
    await clickAt(browser, point);
  }
  await sleep(200);
  await expect(observableState(), `${report}: lo que quedó bajo esos puntos no actúa`).toBe(state);
}

/** p14-ivaplain: harina confirmada y jabón dudoso a 450 con IVA 16 %; subtotal 900, IVA 144, total 1.044. */
const ivaPlainResponse = makeReviewResponse({
  lines: [
    { read: { quantity: 1, unitPrice: 450, lineTotal: 450 } },
    { ...jabonHomonyms(), match: { ...jabonHomonyms().match, taxRateCode: "general" } },
  ],
  extraction: { subtotal: 900, tax: 144, total: 1044 },
});

/**
 * B-p14B-2 (REP13-03 · D60(c)): con la moneda de la cabecera arriba de la vista (el anclaje del navegador
 * elige la cabecera), teclear 594 en el costo de L1 hace que la suma dé el total leído y aparece el aviso
 * de IVA. Las filas y los controles de L1 siguen donde estaban.
 */
function avisoIvaAlTeclear(width: number): Story {
  return {
    args: { response: ivaPlainResponse },
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      const currency = screen.getByText("Moneda de la factura");
      window.scrollBy({ top: currency.getBoundingClientRect().top - 8, behavior: "instant" });
      await sleep(200);
      const cost = row(1).querySelector<HTMLInputElement>('input[data-need="unitPrice"]');
      if (!cost) {
        throw new Error("Sin costo en L1");
      }
      const controls = [...row(1).querySelectorAll<HTMLElement>("[data-candidate], [data-row-action]")];
      const points = controls
        .map((control): ControlPoint => ({ control, point: centerOf(control) }))
        .filter(({ control, point }) => decisionAt(point) === control);
      const before = rowTops();
      await expect(screen.queryByTestId("invoice-review-tax-notice"), "sin aviso de IVA antes").toBeNull();

      await fillField(browser, cost, "594");
      await whenShown(() => screen.queryByTestId("invoice-review-tax-notice"), 2000);
      await expectRowsKept(browser, `[B-p14B-2] ${width}`, before, points);
    },
  };
}

export const BP14B2Iva390 = avisoIvaAlTeclear(390);
export const BP14B2Iva1280 = avisoIvaAlTeclear(1280);

const RATE_DELAY_MS = 800;

/** c11-three con tasa impresa 856,30 (a 4,9 % de la del día, 900) y todo exento: solo cambia el aviso de tasa. */
const lateRateResponse = makeReviewResponse({
  lines: [harinaByName(450), harinaByName(450), jabonHomonyms(), jabonHomonyms()],
  extraction: { printedRate: 856.3 },
});

/** La tasa del día llega con la revisión ya abierta (REP6-05): el aviso de tasa cambia solo. */
function LateRatePanel(props: ComponentProps<typeof InvoiceReviewPanel>) {
  const [systemRateVes, setSystemRateVes] = useState<number | undefined>(undefined);
  useEffect(() => {
    const timer = setTimeout(() => setSystemRateVes(900), RATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return <InvoiceReviewPanel {...props} context={{ ...props.context, systemRateVes }} />;
}

/**
 * D60(c) con la tasa (REP13-03): sin tasa del día al abrir, el aviso de tasa ofrece la impresa o escribirla;
 * al llegar la del día cambia a «Tasa de hoy / Tasa de la factura» y encoge. Con la página algo desplazada,
 * las filas y los controles a la vista siguen donde estaban.
 */
function avisoTasaTardia(width: number): Story {
  return {
    args: { response: lateRateResponse },
    render: (args) => <LateRatePanel {...args} />,
    play: async () => {
      const browser = await prepare(width);
      if (!browser) {
        return;
      }
      await expect(screen.queryByRole("radio", { name: /Tasa de hoy/ }), "sin tasa del día al abrir").toBeNull();
      // Algo desplazada (la cabecera arriba de la vista): lo que encoge el aviso se puede compensar.
      window.scrollTo({ top: 150, behavior: "instant" });
      await sleep(100);
      const points = [...panel().querySelectorAll<HTMLElement>("[data-candidate], [data-row-action]")]
        .map((control): ControlPoint => ({ control, point: centerOf(control) }))
        .filter(({ control, point }) => decisionAt(point) === control);
      const before = rowTops();
      const scrollBefore = Math.round(window.scrollY);
      await whenShown(() => screen.queryByRole("radio", { name: /Tasa de hoy/ }), RATE_DELAY_MS + 2000);
      await expectRowsKept(browser, `[tasa] ${width} · scrollY antes ${scrollBefore}`, before, points);
    },
  };
}

export const Rep1303TasaTardia390 = avisoTasaTardia(390);
export const Rep1303TasaTardia1280 = avisoTasaTardia(1280);


/** p14-ivaplain con L1 dudosa pero con producto (como en la UI real de QA-23): «Cambiar producto» y «Descartar línea». */
const ivaChosenResponse = makeReviewResponse({
  lines: [
    { read: { quantity: 1, unitPrice: 450, lineTotal: 450 } },
    { ...jabonHomonyms(), match: { ...jabonHomonyms().match, productId: productUuid(4), taxRateCode: "general" } },
  ],
  extraction: { subtotal: 900, tax: 144, total: 1044 },
});

/**
 * B-qa23-2 (REP13-05 · D60(c)): teclear 594 en el costo de L1 hace aparecer «La factura dice …» bajo su
 * importe y, en móvil, baja 36-44 px los controles de la propia fila. El toque a los 250 ms donde estaba
 * «Descartar línea» la descarta o no hace nada; nunca acciona lo que quedó ahí («Cambiar producto», un
 * candidato). Si no se movió (tableta, 1280), el toque la descarta.
 */
function toqueTrasTeclearCosto(width: number, height: number, pointer: Pointer): Story {
  return {
    args: { response: ivaChosenResponse },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const cost = row(1).querySelector<HTMLInputElement>('input[data-need="unitPrice"]');
      if (!cost) {
        throw new Error("Sin costo en L1");
      }
      const discard = button(row(1), /Descartar línea/);
      cost.scrollIntoView({ block: "center" });
      await sleep(POINTER_GUARD_MS + 200);
      const aim = centerOf(discard);
      const topBefore = discard.getBoundingClientRect().top;
      await expect(decisionAt(aim), "«Descartar línea» en su punto antes de teclear").toBe(discard);

      await fillField(browser, cost, "594");
      const start = performance.now();
      await whenShown(() => screen.queryByTestId("line-mismatch-1"), 2000);
      const moved = Math.round(discard.getBoundingClientRect().top - topBefore);
      const under = document.elementFromPoint(aim.x, aim.y)?.closest("button") ?? null;
      const report = `${width}×${height} ${pointer} · «Descartar línea» bajó ${moved} px · en el punto: ${describeControl(under)}`;
      const typed = observableState();
      await sleepUntil(start, 250);
      await activateAt(browser, aim, pointer);
      await sleep(400);

      const discarded = row(1).dataset.status === "discarded";
      if (moved === 0) {
        await expect(discarded, `${report}: sin moverse, el toque la descarta`).toBe(true);
        return;
      }
      await expect(within(row(1)).queryByLabelText("Producto de la línea 2"), `${report}: no abre el buscador`).toBeNull();
      await expect(discarded || observableState() === typed, `${report}: descarta o no hace nada`).toBe(true);
    },
  };
}

export const BQa232Toque360Tactil = toqueTrasTeclearCosto(360, 844, "touch");
export const BQa232Toque375Tactil = toqueTrasTeclearCosto(375, 844, "touch");
export const BQa232Toque390Tactil = toqueTrasTeclearCosto(390, 844, "touch");
export const BQa232Toque1024Tactil = toqueTrasTeclearCosto(1024, 1366, "touch");
export const BQa232Toque1280Raton = toqueTrasTeclearCosto(1280, 900, "mouse");
