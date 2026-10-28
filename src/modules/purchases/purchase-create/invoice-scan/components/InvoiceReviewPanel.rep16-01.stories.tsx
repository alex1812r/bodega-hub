/**
 * REP16-01 · D67(a) (M-p17B-1): tras el primer render de la revisión, ninguna llegada asíncrona cambia la posición
 * vertical de ningún control de ninguna fila ni del pie.
 *
 * Factura en Bs sin tasa impresa y sin tasa del día al abrir (como `ex/p17-tasa3.json`): L0 coherente, L1 a 4.500 Bs
 * con último costo 0,50 REF (al llegar la tasa, 900, se desvía) y L2 a 450 Bs. Se mide el `top` de cada control
 * visible de las filas y del pie en cada frame mientras llega la tasa (y, en otra historia, el último costo de un
 * producto elegido en el buscador con la tasa ya llegada), sin desplazar ni tocar: delta 0 a 390, 768, 1024×1366 y
 * 1280. Además, a 1024×1366 (táctil), el toque a «Descartar línea» de L2 1,1 s y 1,3 s después de la llegada descarta
 * L2 (no cae en su chip candidato).
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep16-01.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockDate from "mockdate";
import { http, HttpResponse } from "msw";
import { type ComponentProps, useEffect, useState } from "react";
import { expect, fn, screen, waitFor, within } from "storybook/test";

import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import type { EntityFetcher, ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import {
  doubtfulLine,
  makeReviewResponse,
  productUuid,
  REVIEW_SCAN_ID,
  REVIEW_SUPPLIER_ID,
  REVIEW_TAX_RATES,
  unmatchedLine,
} from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

const HARINA = "CAOSG Harina Maiz 1kg";

/** Línea de 1 unidad exenta a `price` Bs, dudosa, con el último costo (0,50 REF) del producto propuesto. */
function line(seed: number, description: string, price: number) {
  return doubtfulLine(seed, 0.72, {
    match: {
      candidates: [{ name: description, productId: productUuid(seed), reason: "nombre parecido 0,72", score: 0.72, sku: `CAOS-${seed}` }],
      lastUnitCostRef: 0.5,
      taxRateCode: "exento",
    },
    read: {
      description,
      lineTotal: price,
      quantity: 1,
      rawText: `${description.toUpperCase()} 1 ${price}`,
      taxHint: "exento",
      unitPrice: price,
    },
  });
}

const extraction = {
  date: "2026-10-17",
  number: "CG17-TASA3",
  printedRate: undefined,
  supplier: { name: "Distribuidora Caos Global C.A.", taxId: "J-40999888-1" },
  total: 5400,
};

/** `ex/p17-tasa3.json`: L1 se desvía al llegar la tasa (5,00 REF frente a 0,50). */
const rateResponse = makeReviewResponse({
  extraction,
  lines: [line(1, "JABON AZUL 250G", 450), line(3, HARINA, 4500), line(5, HARINA, 450)],
});

/**
 * L0 confirmada por el emparejamiento a 4.500 Bs (último 0,50 REF): al llegar la tasa se desvía y el modelo la pasa del
 * grupo de confirmadas (plegado) a las por revisar, delante de L1 y L2.
 */
const confirmedResponse = makeReviewResponse({
  extraction,
  lines: [
    { match: { lastUnitCostRef: 0.5, taxRateCode: "exento" }, read: { description: HARINA, lineTotal: 4500, quantity: 1, rawText: "HARINA 1 4500", taxHint: "exento", unitPrice: 4500 } },
    line(3, "JABON AZUL 250G", 450),
    line(5, HARINA, 450),
  ],
});

/** Igual, con una L3 sin emparejar cuyo producto se elige en el buscador (llega su último costo). */
const lastCostResponse = makeReviewResponse({
  extraction,
  lines: [
    line(1, "JABON AZUL 250G", 450),
    unmatchedLine(2, false, { read: { description: "Arroz Mary 1kg", quantity: 1, rawText: "ARROZ MARY 1KG", unitPrice: 4500, lineTotal: 4500 } }),
    line(5, HARINA, 450),
  ],
});

const products: ProductEntityOption[] = [
  {
    barcode: null,
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 4,
    id: productUuid(600),
    isActive: true,
    label: "Arroz Mary 1kg",
    salePriceRef: 2,
    sku: "SKU-ARROZ",
  },
];

type Gate<T> = { promise: Promise<T>; open: (value: T) => void };

function gate<T>(): Gate<T> {
  let open: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { open, promise };
}

let lastCost = gate<number | null>();

const RATE_EVENT = "rep16-01:system-rate";

/** La tasa del día llega con la revisión ya abierta (REP6-05): la página la pasa en `context` más tarde. */
function LateRatePanel(props: ComponentProps<typeof InvoiceReviewPanel>) {
  const [systemRateVes, setSystemRateVes] = useState<number | undefined>(undefined);
  useEffect(() => {
    const onRate = (event: Event) => setSystemRateVes((event as CustomEvent<number>).detail);
    window.addEventListener(RATE_EVENT, onRate);
    return () => window.removeEventListener(RATE_EVENT, onRate);
  }, []);
  return <InvoiceReviewPanel {...props} context={systemRateVes === undefined ? props.context : { ...props.context, systemRateVes }} />;
}

async function loadBrowser() {
  if (!("__vitest_browser__" in globalThis)) {
    return null;
  }
  return import("vitest/browser").catch(() => null);
}

type Browser = NonNullable<Awaited<ReturnType<typeof loadBrowser>>>;
type Point = { x: number; y: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila ${index}`);
  }
  return element;
}

/**
 * El aviso de desvío de una opción se ve: no el reservado invisible mientras falta la tasa o el último costo (texto en el
 * DOM, `visibility: hidden`), ni el que esté recortado sin asomar.
 */
function deviationShown(element: Element) {
  return [...element.querySelectorAll("[data-choice] span")].some(
    (span) => /Se aparta más del 40/.test(span.textContent ?? "") && span.checkVisibility({ visibilityProperty: true }),
  );
}

function main() {
  const element = document.querySelector("main");
  if (!element) {
    throw new Error("Sin main");
  }
  return element;
}

/** Punto del documento de la story en la página de Playwright (el iframe del runner puede escalarse). */
function pagePoint(point: Point): Point {
  let x = point.x;
  let y = point.y;
  for (let view: Window = window, frame = view.frameElement; frame; view = view.parent, frame = view.frameElement) {
    const box = frame.getBoundingClientRect();
    const width = frame.clientWidth + 2 * frame.clientLeft;
    const scale = width ? box.width / width : 1;
    x = box.left + (frame.clientLeft + x) * scale;
    y = box.top + (frame.clientTop + y) * scale;
  }
  return { x, y };
}

/** Toque real (CDP `Input.dispatchTouchEvent`), como `tapAt` de `layout.stories`. */
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

const CONTROL_SELECTOR = "button, a[href], input, select, textarea, [role='button'], [role='checkbox'], [role='radio']";

/** Controles visibles de las filas y del pie con su nombre (`Lfila:texto#n` o `pie:texto#n`). */
function controls(): Map<string, Element> {
  const found = new Map<string, Element>();
  const scopes = [
    ...[...document.querySelectorAll<HTMLElement>('[data-layout-box^="row:"]')].map(
      (element) => [`L${element.dataset.lineIndex}`, element] as const,
    ),
    ...[...document.querySelectorAll<HTMLElement>('[data-layout-box="footer"]')].map((element) => ["pie", element] as const),
  ];
  for (const [scope, element] of scopes) {
    for (const control of element.querySelectorAll(CONTROL_SELECTOR)) {
      const box = control.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || getComputedStyle(control).visibility === "hidden") {
        continue;
      }
      const name = `${scope}:${(control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 24)}`;
      let key = name;
      for (let n = 2; found.has(key); n += 1) {
        key = `${name}#${n}`;
      }
      found.set(key, control);
    }
  }
  return found;
}

/**
 * Muestrea en cada frame el `top` de cada control visible de las filas y del pie mientras corre `during`; devuelve los
 * que cambiaron (≥ 1 px) respecto al primer frame, con su recorrido.
 */
async function movedDuring(during: () => Promise<void>): Promise<string[]> {
  const first = controls();
  const tops = new Map([...first].map(([key, control]) => [key, [Math.round(control.getBoundingClientRect().top)]]));
  let running = true;
  const tick = () => {
    if (!running) {
      return;
    }
    for (const [key, control] of first) {
      if (!control.isConnected) {
        continue;
      }
      const top = Math.round(control.getBoundingClientRect().top);
      const seen = tops.get(key);
      if (seen && seen[seen.length - 1] !== top) {
        seen.push(top);
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
  try {
    await during();
  } finally {
    running = false;
  }
  return [...tops].filter(([, seen]) => seen.length > 1).map(([key, seen]) => `${key} ${seen.join("→")}`);
}

const heights = () =>
  [...document.querySelectorAll<HTMLElement>('[data-layout-box^="row:"]')]
    .map((element) => `L${element.dataset.lineIndex}=${Math.round(element.getBoundingClientRect().height)}`)
    .join(" ");

async function prepare(width: number, height: number) {
  const browser = await loadBrowser();
  if (!browser) {
    return null;
  }
  await browser.page.viewport(width, height);
  const hideDevtools = document.createElement("style");
  hideDevtools.textContent = ".tsqd-parent-container { display: none !important; }";
  document.head.append(hideDevtools);
  await waitFor(() => expect(row(2)).toBeInTheDocument());
  await sleep(400);
  return browser;
}

/** Lleva `element` a la mitad de la vista de `main` (desplazar antes de la llegada: no hay nada retenido). */
async function scrollToMiddle(element: Element) {
  const view = main().getBoundingClientRect();
  const box = element.getBoundingClientRect();
  main().scrollTop += box.top - (view.top + view.height / 2);
  await sleep(400);
}

/** La tasa del día (900) llega tarde: ningún control de las filas ni del pie cambia de `top` en ningún frame. */
function rateStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      await scrollToMiddle(row(1));
      const before = heights();
      const moved = await movedDuring(async () => {
        window.dispatchEvent(new CustomEvent(RATE_EVENT, { detail: 900 }));
        await waitFor(() => expect(deviationShown(row(1))).toBe(true), { timeout: 4000 });
        await sleep(500);
      });
      const text = `${width}×${height} tasa tarde: filas ${before} → ${heights()}; movidos ${moved.join(", ") || "ninguno"}`;
      console.warn(`[REP16-01 tasa] ${text}`);
      await expect(moved, text).toEqual([]);
    },
  };
}

/** Con la tasa ya llegada, el último costo de un producto elegido en el buscador llega tarde (desviado). */
function lastCostStory(width: number, height: number): Story {
  return {
    args: { context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES }, response: lastCostResponse },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      within(row(1)).getByRole("button", { name: /Buscar producto/ }).click();
      await screen.findAllByRole("option", { name: /Arroz Mary 1kg/ });
      screen.getAllByRole("option", { name: /Arroz Mary 1kg/ })[0].click();
      await waitFor(() => expect(within(row(1)).getByRole("button", { name: /Cambiar producto/ })).toBeInTheDocument());
      (document.activeElement as HTMLElement | null)?.blur();
      await scrollToMiddle(row(1));
      const before = heights();
      const moved = await movedDuring(async () => {
        lastCost.open(0.5);
        await waitFor(() => expect(deviationShown(row(1))).toBe(true), { timeout: 4000 });
        await sleep(500);
      });
      const text = `${width}×${height} último costo tarde: filas ${before} → ${heights()}; movidos ${moved.join(", ") || "ninguno"}`;
      console.warn(`[REP16-01 último costo] ${text}`);
      await expect(moved, text).toEqual([]);
    },
  };
}

/** Fila `index` en la lista «Líneas por revisar». */
const inReview = (index: number) => Boolean(row(index).closest('ul[aria-label="Líneas por revisar"]'));

/**
 * D67(a): la tasa que llega tarde desvía la confirmada L0 y el modelo la pasa a las por revisar (delante de L1): las filas
 * pintadas no cambian de lista ni de orden hasta que el usuario desplaza; entonces L0 sube a las por revisar.
 */
function confirmedStory(width: number, height: number): Story {
  return {
    args: { response: confirmedResponse },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      await scrollToMiddle(row(2));
      const before = heights();
      const moved = await movedDuring(async () => {
        window.dispatchEvent(new CustomEvent(RATE_EVENT, { detail: 900 }));
        await waitFor(() => expect(screen.getByText(/Llegó la tasa del día/)).toBeInTheDocument(), { timeout: 4000 });
        await sleep(500);
      });
      const retained = document.querySelector('li[data-line-index="0"]') === null || !inReview(0);
      main().scrollTop += main().scrollTop > 40 ? -40 : 40;
      await sleep(400);
      const released = inReview(0);
      const text = `${width}×${height} confirmada que se desvía: filas ${before} → ${heights()}; movidos ${moved.join(", ") || "ninguno"}; retenida en confirmadas ${retained}; tras desplazar por revisar ${released}`;
      console.warn(`[REP16-01 confirmada] ${text}`);
      await expect({ moved, released, retained }, text).toEqual({ moved: [], released: true, retained: true });
    },
  };
}

/**
 * D67(a): lo que crece solo en un aviso de una fila (sin acción del usuario) más allá de lo reservado no baja los
 * controles de las filas siguientes: useLayoutHold lo recorta a su alto anterior hasta que el usuario desplaza.
 */
function growStory(width: number, height: number): Story {
  return {
    args: { context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES } },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      await scrollToMiddle(row(2));
      const notices = row(1).querySelectorAll<HTMLElement>("[data-layout-notice]");
      const notice = notices[notices.length - 1];
      const extra = document.createElement("p");
      extra.style.height = "120px";
      extra.textContent = "Motivo que llega tarde";
      const moved = await movedDuring(async () => {
        notice.append(extra);
        await sleep(500);
      });
      const clipped = notice.style.maxHeight !== "" || notice.style.display === "none";
      const top = Math.round(within(row(2)).getByRole("button", { name: /Descartar línea/ }).getBoundingClientRect().top);
      const scrollBefore = main().scrollTop;
      main().scrollTop += scrollBefore > 40 ? -40 : 40;
      await sleep(400);
      const scrolled = main().scrollTop - scrollBefore;
      const releasedTop = Math.round(within(row(2)).getByRole("button", { name: /Descartar línea/ }).getBoundingClientRect().top) + scrolled;
      const released = notice.style.maxHeight === "" && notice.style.display !== "none";
      extra.remove();
      const text = `${width}×${height} aviso que crece 120 px: movidos ${moved.join(", ") || "ninguno"}; recortado ${clipped}; tras desplazar suelto ${released} (Descartar L2 ${top} → ${releasedTop} sin el desplazamiento)`;
      console.warn(`[REP16-01 crece] ${text}`);
      await expect({ clipped, moved, released }, text).toEqual({ clipped: true, moved: [], released: true });
      await expect(releasedTop - top, text).toBeGreaterThanOrEqual(100);
    },
  };
}

/** M-p17B-1: el dedo apunta a «Descartar línea» de L2 y toca `delay` ms después de llegar la tasa. */
function tapStory(width: number, height: number, delay: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const discard = () => within(row(2)).getByRole("button", { name: /Descartar línea/ });
      await scrollToMiddle(discard());
      const box = discard().getBoundingClientRect();
      const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      window.dispatchEvent(new CustomEvent(RATE_EVENT, { detail: 900 }));
      await waitFor(() => expect(deviationShown(row(1))).toBe(true), {
        interval: 5,
        timeout: 4000,
      });
      await sleep(delay);
      const target = document.elementFromPoint(point.x, point.y);
      const under = `${target?.closest("button")?.textContent ?? target?.tagName ?? "-"} (L${target?.closest("[data-line-index]")?.getAttribute("data-line-index") ?? "-"})`;
      await tapAt(browser, point);
      await sleep(900);
      const statuses = [0, 1, 2].map((index) => `L${index}:${row(index).dataset.status}`).join(" ");
      const text = `${width}×${height} d${delay}: bajo el dedo «${under}»; ${statuses}; filas ${heights()}`;
      console.warn(`[REP16-01 toque] ${text}`);
      await expect(row(2).dataset.status, text).toBe("discarded");
    },
  };
}

const noSuppliers: EntityFetcher<"contact"> = async () => [];

const meta = {
  args: {
    canCreateProduct: true,
    context: { taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: async () => [],
    lastUnitCostFetcher: () => lastCost.promise,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher: async () => products,
    response: rateResponse,
    supplierFetcher: noSuppliers,
  },
  beforeEach() {
    MockDate.reset();
    lastCost = gate<number | null>();
  },
  component: InvoiceReviewPanel,
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      queryClient.setQueryData(invoiceScanQueryKeys.images(REVIEW_SCAN_ID), []);
      // El marco de AppShell: menú lateral abierto (18rem desde lg, `.app-shell-content`) y `<main>`.
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
  parameters: {
    layout: "fullscreen",
    msw: {
      handlers: [
        http.get("/api/purchases/suppliers", ({ request }) =>
          HttpResponse.json({
            data: new URL(request.url).searchParams.has("id")
              ? { id: REVIEW_SUPPLIER_ID, isActive: true, name: extraction.supplier.name, taxId: extraction.supplier.taxId }
              : [],
          }),
        ),
      ],
    },
  },
  render: (args) => <LateRatePanel {...args} />,
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP16-01 llegadas asíncronas sin mover controles",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tasa390 = rateStory(390, 844);
export const Tasa768 = rateStory(768, 1024);
export const Tasa1024x1366 = rateStory(1024, 1366);
export const Tasa1280 = rateStory(1280, 900);
export const UltimoCosto390 = lastCostStory(390, 844);
export const UltimoCosto1024x1366 = lastCostStory(1024, 1366);
export const UltimoCosto1280 = lastCostStory(1280, 900);
export const Toque1024x1366d1100 = tapStory(1024, 1366, 1100);
export const Toque1024x1366d1300 = tapStory(1024, 1366, 1300);
export const Confirmada390 = confirmedStory(390, 844);
export const Confirmada1024x1366 = confirmedStory(1024, 1366);
export const Confirmada1280 = confirmedStory(1280, 900);
export const Crece390 = growStory(390, 844);
export const Crece1024x1366 = growStory(1024, 1366);
export const Crece1280 = growStory(1280, 900);
