/**
 * REP15-01 · D65 (M-p16B-1): ninguna llegada asíncrona cambia la altura de la cabecera ni mueve las filas.
 *
 * La revisión se abre con todo lo que llega tarde aún en vuelo (nombre del proveedor preseleccionado,
 * compra del escaneo duplicado, consulta de duplicados, tasa del día y, tras elegir un producto en el
 * buscador, su último costo). Se suelta cada llegada por separado y se mide antes y después el alto de la
 * cabecera (`[data-layout-box="header"]` y «Datos de la factura») y el `top` de cada fila: delta 0 a 390,
 * 768, 1024×1366 y 1280. Además, a 1024×1366 y 390×1100 (táctil), el toque dirigido al 2.º homónimo justo
 * cuando llega el nombre largo del proveedor elige ese homónimo y no el 1.º.
 *
 * REP15-01b (D65(a)): la cabecera mide lo mismo desde el primer render. Las llegadas se miden en cada frame, con la
 * página arriba, sin desplazar y sin layout retenido; ningún aviso de la cabecera puede estar retenido por
 * useLayoutHold (se suelta al desplazar). Llegadas: nombre, compra del duplicado, duplicados que se van y que
 * aparecen o se van al teclear o borrar el número (N9), tasa del día, último costo y su motivo; y, en otra historia,
 * el error al leer el proveedor. Al final, tras desplazar, la cabecera mide lo que en el primer render. El aviso de
 * duplicado va tras las líneas: aparecer o irse no mueve la cabecera ni las filas.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep15-01.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockDate from "mockdate";
import { http, HttpResponse } from "msw";
import { type ComponentProps, useEffect, useState } from "react";
import { expect, fn, screen, waitFor, within } from "storybook/test";

import type { InvoiceDuplicateMatch } from "@/modules/invoice-scan/contracts";
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

/** El del lab (`fixtures-p16b-sup.sql`, M-p16B-1). */
const LONG_NAME = "Distribuidora Internacional de Alimentos y Víveres Los Andes del Sur, C.A. (CAOS16B)";
const DUPLICATE_SCAN_ID = "6b1f2c3d-4e5f-4a6b-8c7d-8e9fa0b1c2d3";
const HOMONYM = "CAOSG Jabon Azul 250g";

const extraction = {
  date: "2026-10-14",
  number: "00-0161601",
  printedRate: 895,
  supplier: { name: LONG_NAME, taxId: "J-16160001-1" },
};

/** L0 con dos homónimos: solo cambia el SKU, como `c14-jabonfirst`. */
const homonymLine = doubtfulLine(1, 0.8, {
  match: {
    candidates: [
      { name: HOMONYM, productId: productUuid(4), reason: "nombre parecido 0,80", score: 0.8, sku: "CAOSG-004" },
      { name: HOMONYM, productId: productUuid(5), reason: "nombre parecido 0,80", score: 0.8, sku: "CAOSG-005" },
    ],
    productId: productUuid(4),
  },
  read: { description: "JABON AZUL 250G", rawText: "JABON AZUL 250G" },
});
const harinaLine = doubtfulLine(3, 0.72, { read: { description: "Harina P.A.N. 1kg", rawText: "HARINA PAN 1KG" } });

/** L0 homónimos, L1 sin emparejar (buscador) y L2 dudosa; el escaneo avisó de un duplicado. */
const response = makeReviewResponse({
  extraction,
  lines: [
    homonymLine,
    unmatchedLine(2, false, { read: { description: "Arroz Mary 1kg", rawText: "ARROZ MARY 1KG" } }),
    harinaLine,
  ],
  matched: { duplicateOfScanId: DUPLICATE_SCAN_ID },
});

/** Como `p16-suptj`: L0 es la primera fila por revisar; sin duplicado. */
const homonymResponse = makeReviewResponse({ extraction, lines: [homonymLine, harinaLine] });

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

/** Lo que llega tarde, retenido hasta que la historia lo suelta. */
function newGates() {
  return {
    // REP15-01b: cada consulta de duplicados (la inicial y las de teclear el número) espera su puerta.
    duplicates: [] as Gate<InvoiceDuplicateMatch[]>[],
    lastCost: gate<number | null>(),
    purchase: gate<void>(),
    supplier: gate<void>(),
    // El nombre del proveedor no llega: la consulta falla (error bajo el campo).
    supplierFails: false,
  };
}

/** Puerta de la última consulta de duplicados (espera a que la haga el panel). */
async function lastDuplicatesGate(count: number) {
  await waitFor(() => expect(gates.duplicates.length).toBeGreaterThanOrEqual(count), { timeout: 4000 });
  return gates.duplicates[gates.duplicates.length - 1];
}

let gates = newGates();

const RATE_EVENT = "rep15-01:system-rate";

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

function panel() {
  const element = document.querySelector<HTMLElement>('[data-testid="invoice-review-panel"]');
  if (!element) {
    throw new Error("Sin panel de revisión");
  }
  return element;
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila ${index}`);
  }
  return element;
}

function supplierField() {
  return screen.getByRole("combobox", { name: /proveedor/i }) as HTMLInputElement;
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

function centerOf(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
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
  await waitFor(() => expect(panel()).toBeInTheDocument());
  // Abierta arriba del todo, con el nombre del proveedor aún en vuelo.
  await waitFor(() => expect(supplierField()).toHaveAttribute("placeholder", "Cargando proveedor…"));
  await sleep(300);
  // Como en el informe: la página arriba del todo (ahí Chromium no ancla el desplazamiento).
  const main = document.querySelector("main");
  if (main) {
    main.scrollTop = 0;
  }
  await sleep(300);
  return browser;
}

type Layout = { header: number; datos: number; rows: string[] };

/** REP15-01b: el aviso de duplicado va tras las líneas (aparecer o irse no mueve la cabecera ni las filas). */
function duplicateSlot() {
  const lines = document.querySelector('section[aria-label="Líneas de la factura"]');
  const slot = lines?.nextElementSibling;
  if (!(slot instanceof HTMLElement) || !slot.hasAttribute("data-layout-notice")) {
    throw new Error("Sin el sitio del aviso de duplicado tras las líneas");
  }
  return slot;
}

/** Alto de la cabecera (con los avisos) y de «Datos de la factura», y `top` de cada fila (px de la ventana). */
function measure(): Layout {
  const header = document.querySelector('[data-layout-box="header"]');
  const datos = document.querySelector('section[aria-label="Datos de la factura"]');
  if (!header || !datos) {
    throw new Error("Sin cabecera");
  }
  return {
    datos: Math.round(datos.getBoundingClientRect().height),
    header: Math.round(header.getBoundingClientRect().height),
    rows: [...document.querySelectorAll<HTMLElement>('[data-layout-box^="row:"]')].map((element) => {
      const box = element.getBoundingClientRect();
      return `${element.dataset.layoutBox}@${Math.round(box.top)}+${Math.round(box.height)}`;
    }),
  };
}

const show = (layout: Layout) => `cabecera ${layout.header} datos ${layout.datos} filas ${layout.rows.join("/")}`;

/**
 * REP15-01b (D65(a)): avisos que useLayoutHold retiene a su alto anterior (`min-height` en línea), en la cabecera
 * (`scope` "header") o tras ella ("below": filas y aviso de duplicado). La cabecera no puede deber su alto a esa
 * retención (se suelta al desplazar): con el sitio reservado no hace falta ninguna. Debajo es el residuo de D65(b) (se
 * informa: no mueve la cabecera ni lo que hay encima).
 */
function heldNotices(scope: "header" | "below"): string[] {
  const header = document.querySelector('[data-layout-box="header"]');
  return [...document.querySelectorAll<HTMLElement>('[data-testid="invoice-review-panel"] [data-layout-notice]')]
    .filter((notice) => (scope === "header") === Boolean(header?.contains(notice)))
    .filter((notice) => notice.style.minHeight !== "")
    .map((notice) => `${notice.textContent?.trim().slice(0, 40) || "(vacío)"}→${notice.style.minHeight}`);
}

/** Muestrea alto de cabecera y filas en cada frame mientras corre `during` (lo que asoma entre medias cuenta). */
async function sampleFrames(during: () => Promise<void>): Promise<string[]> {
  const seen = new Set<string>();
  let running = true;
  const tick = () => {
    if (!running) {
      return;
    }
    seen.add(show(measure()));
    requestAnimationFrame(tick);
  };
  tick();
  try {
    await during();
  } finally {
    running = false;
  }
  seen.add(show(measure()));
  return [...seen];
}

/** Campo «Número de factura» (no controlado: se escribe como el usuario, con su evento `input`). */
function numberField() {
  return screen.getByRole("textbox", { name: "Número de factura" }) as HTMLInputElement;
}

/** Escribe en el campo sin desplazar (el campo está a la vista, con la página arriba). */
function typeNumber(value: string) {
  const field = numberField();
  field.focus({ preventScroll: true });
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const DUPLICATE_WITH_PURCHASE: InvoiceDuplicateMatch = {
  date: "2026-10-14",
  number: "00-0161609",
  purchaseId: "7c2a3b4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  scanId: "5a0e1b2c-3d4e-4f5a-9b6c-7d8e9fa0b1c2",
};

/**
 * Cada llegada con la página arriba, la cabecera a la vista, sin desplazar y sin layout retenido (ni hold ni avisos
 * retenidos): alto de cabecera y `top` de filas idénticos en cada frame. Al final, tras desplazar (lo que soltaría
 * cualquier retención), la cabecera mide lo mismo que en el primer render.
 */
function measureStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const first = measure();
      const report: string[] = [];
      const failures: string[] = [];
      const step = async (label: string, arrive: () => void | Promise<void>, arrived: () => void | Promise<void>) => {
        const frames = await sampleFrames(async () => {
          await arrive();
          await waitFor(arrived, { timeout: 4000 });
          await sleep(400);
        });
        const held = heldNotices("header");
        const rowHeld = heldNotices("below");
        report.push(
          `${label}: ${frames.join(" → ")}${held.length ? ` retenidos ${held.join(", ")}` : ""}${rowHeld.length ? ` (debajo, D65(b): ${rowHeld.join(", ")})` : ""}`,
        );
        if (frames.length > 1 || held.length > 0) {
          failures.push(`${label}: ${frames.join(" → ")}${held.length ? ` retenidos ${held.join(", ")}` : ""}`);
        }
      };

      await step(
        "nombre del proveedor",
        () => gates.supplier.open(),
        () => expect(supplierField()).toHaveValue(LONG_NAME),
      );
      // El aviso de duplicado (del escaneo) está tras las líneas, no en la cabecera.
      await expect(duplicateSlot()).toHaveTextContent(/Esta factura \(/);
      // Cortado a 2 renglones, el nombre entero sigue en el `title` (y en el valor del campo, que lee el lector).
      await expect(supplierField()).toHaveAttribute("title", LONG_NAME);
      await step(
        "compra del duplicado",
        () => gates.purchase.open(),
        () => expect(screen.getByRole("link", { name: "Ver" })).toBeInTheDocument(),
      );
      await step(
        "duplicados: desaparece",
        // La consulta con los datos de la cabecera no halla nada: el aviso del escaneo se va.
        async () => (await lastDuplicatesGate(1)).open([]),
        () => expect(screen.queryByText(/Esta factura \(/)).not.toBeInTheDocument(),
      );
      await step(
        "tasa del día",
        () => {
          window.dispatchEvent(new CustomEvent(RATE_EVENT, { detail: 900 }));
        },
        () => expect(screen.queryByRole("radiogroup", { name: "Tasa para convertir los costos" })).not.toBeInTheDocument(),
      );
      // N9 (caos p16 B): al teclear el número aparece el duplicado (con compra); al borrarlo, se va.
      await step(
        "duplicados: aparece al teclear",
        async () => {
          const count = gates.duplicates.length;
          typeNumber("00-0161609");
          (await lastDuplicatesGate(count + 1)).open([DUPLICATE_WITH_PURCHASE]);
        },
        () => expect(screen.getByRole("link", { name: "Ver" })).toBeInTheDocument(),
      );
      await step(
        // Sin número (y sin total leído) no hay consulta: vuelve el aviso del escaneo, con el criterio sin número.
        "duplicados: borrar el número",
        () => typeNumber(""),
        () => expect(screen.getByText(/Esta factura \(/)).toBeInTheDocument(),
      );
      // B-p16Q-1: el criterio del aviso es el de los valores efectivos (sin número tecleado), no el de los leídos.
      if (!screen.queryByText(/Esta factura \(mismo proveedor, fecha y total\)/)) {
        failures.push(`criterio sin número: ${screen.getByText(/Esta factura \(/).textContent ?? ""}`);
      }
      await step(
        "duplicados: se va al volver a teclearlo",
        async () => {
          const count = gates.duplicates.length;
          typeNumber("00-0161601");
          (await lastDuplicatesGate(count + 1)).open([]);
        },
        () => expect(screen.queryByText(/Esta factura \(/)).not.toBeInTheDocument(),
      );
      numberField().blur();

      // Último costo y su motivo: llegan tras elegir un producto en el buscador de L1. Clic de DOM (sin desplazar
      // ni retener el layout: la medición no se apoya en useLayoutHold).
      within(row(1)).getByRole("button", { name: /Buscar producto/ }).click();
      await screen.findAllByRole("option", { name: /Arroz Mary 1kg/ });
      screen.getAllByRole("option", { name: /Arroz Mary 1kg/ })[0].click();
      await waitFor(() => expect(within(row(1)).getByRole("button", { name: /Cambiar producto/ })).toBeInTheDocument());
      await sleep(400);
      await step(
        "último costo y motivo",
        // Muy por encima del costo de la línea: llega el desvío y su motivo.
        () => gates.lastCost.open(50),
        () => expect(within(row(1)).queryByText(/consultando el costo previo/i)).not.toBeInTheDocument(),
      );

      // Desplazar suelta toda retención: la cabecera sigue con el alto del primer render.
      const main = document.querySelector("main");
      if (main) {
        main.scrollTop = 40;
        await sleep(300);
        main.scrollTop = 0;
        await sleep(400);
      }
      const last = measure();
      report.push(`primer render → tras soltar: ${first.header}/${first.datos} → ${last.header}/${last.datos}`);
      if (last.header !== first.header || last.datos !== first.datos) {
        failures.push(`alto fijo: cabecera ${first.header} → ${last.header}, datos ${first.datos} → ${last.datos}`);
      }

      const text = `${width}×${height} · ${report.join(" | ")}`;
      console.warn(`[REP15-01b llegadas] ${text}`);
      await expect(failures, text).toEqual([]);
    },
  };
}

/**
 * La tasa del día llega tarde con otra impresa: `printedRate` (o ninguna) y `systemRate` que difiere (aviso para elegir)
 * o no (el aviso se va). El aviso de tasa tiene reservado desde el primer render el alto de antes y de después.
 */
function rateStory(width: number, height: number, printedRate: number | undefined, systemRate: number): Story {
  return {
    args: {
      response: makeReviewResponse({ extraction: { ...extraction, printedRate }, lines: [homonymLine, harinaLine] }),
    },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      gates.supplier.open();
      await waitFor(() => expect(supplierField()).toHaveValue(LONG_NAME));
      (await lastDuplicatesGate(1)).open([]);
      await sleep(400);
      const first = measure();
      const frames = await sampleFrames(async () => {
        window.dispatchEvent(new CustomEvent(RATE_EVENT, { detail: systemRate }));
        await waitFor(() => expect(screen.getByText(/hoy es|Llegó la tasa del día/)).toBeInTheDocument(), { timeout: 4000 });
        await sleep(400);
      });
      const held = heldNotices("header");
      const main = document.querySelector("main");
      if (main) {
        main.scrollTop = 40;
        await sleep(300);
        main.scrollTop = 0;
        await sleep(400);
      }
      const last = measure();
      const text = `${width}×${height} impresa ${printedRate ?? "-"} → del día ${systemRate}: ${frames.join(" → ")}${held.length ? ` retenidos ${held.join(", ")}` : ""}; tras soltar ${first.header} → ${last.header}`;
      console.warn(`[REP15-01b tasa] ${text}`);
      await expect(frames.length === 1 && held.length === 0 && last.header === first.header, text).toBe(true);
    },
  };
}

/** El nombre del proveedor no llega (la consulta falla): el error bajo el campo tiene su sitio reservado. */
function supplierErrorStory(width: number, height: number): Story {
  return {
    play: async () => {
      gates.supplierFails = true;
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const frames = await sampleFrames(async () => {
        gates.supplier.open();
        await waitFor(() => expect(supplierField()).toHaveAttribute("aria-invalid", "true"), { timeout: 4000 });
        await sleep(400);
      });
      const text = `${width}×${height} · error del proveedor: ${frames.join(" → ")}`;
      console.warn(`[REP15-01b error proveedor] ${text}`);
      await expect(frames.length, text).toBe(1);
    },
  };
}

/** M-p16B-1: el dedo apunta al 2.º homónimo y toca justo al llegar el nombre (d0) o 150 ms después. */
function homonymStory(width: number, height: number, delay: number): Story {
  return {
    // Solo llega tarde el nombre (con tasa del día y sin duplicado): las filas quedan a la vista con la página arriba.
    args: { context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES }, response: homonymResponse },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const chips = within(row(0)).getAllByRole("button", { name: new RegExp(HOMONYM) });
      const target = chips[1];
      const point = centerOf(target);
      const before = Math.round(target.getBoundingClientRect().top);
      gates.supplier.open();
      await waitFor(() => expect(supplierField()).toHaveValue(LONG_NAME), { interval: 5 });
      await sleep(delay);
      const under = document.elementFromPoint(point.x, point.y)?.closest("button")?.textContent ?? "-";
      await tapAt(browser, point);
      await sleep(900);
      const pressed = within(row(0))
        .getAllByRole("button", { name: new RegExp(HOMONYM) })
        .filter((chip) => chip.getAttribute("aria-pressed") === "true")
        .map((chip) => chip.textContent ?? "");
      const text = `${width}×${height} d${delay}: chip 2 en y=${before} → ${Math.round(target.getBoundingClientRect().top)}; bajo el dedo «${under}»; pulsado ${JSON.stringify(pressed)}`;
      console.warn(`[REP15-01 homónimo] ${text}`);
      await expect(under, text).toContain("CAOSG-005");
      await expect(pressed.join(" "), text).toContain("CAOSG-005");
      await expect(pressed.join(" "), text).not.toContain("CAOSG-004");
    },
  };
}

const noSuppliers: EntityFetcher<"contact"> = async () => [];

const meta = {
  args: {
    canCreateProduct: true,
    context: { taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: () => {
      const next = gate<InvoiceDuplicateMatch[]>();
      gates.duplicates.push(next);
      return next.promise;
    },
    lastUnitCostFetcher: () => gates.lastCost.promise,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher: async () => products,
    response,
    supplierFetcher: noSuppliers,
  },
  beforeEach() {
    MockDate.reset();
    gates = newGates();
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
        // `usePurchaseSupplier`: el nombre del proveedor preseleccionado (red lenta).
        http.get("/api/purchases/suppliers", async ({ request }) => {
          if (!new URL(request.url).searchParams.has("id")) {
            return HttpResponse.json({ data: [] });
          }
          await gates.supplier.promise;
          if (gates.supplierFails) {
            return HttpResponse.json({ error: { code: "UNKNOWN_ERROR", message: "No se pudo leer el proveedor de la factura: la conexión con el servidor se cortó antes de responder." } }, { status: 500 });
          }
          return HttpResponse.json({
            data: { id: REVIEW_SUPPLIER_ID, isActive: true, name: LONG_NAME, taxId: "J-16160001-1" },
          });
        }),
        // `useInvoiceScanPurchase`: la compra del escaneo duplicado («Ver»).
        http.get("/api/purchases/invoice-scan/:scanId", async () => {
          await gates.purchase.promise;
          return HttpResponse.json({ data: { purchaseId: "7c2a3b4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" } });
        }),
      ],
    },
  },
  render: (args) => <LateRatePanel {...args} />,
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP15-01 llegadas asíncronas sin mover la cabecera",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Llegadas390 = measureStory(390, 1100);
export const Llegadas768 = measureStory(768, 1024);
export const Llegadas1024x1366 = measureStory(1024, 1366);
export const Llegadas1280 = measureStory(1280, 900);
export const Homonimo1024x1366d0 = homonymStory(1024, 1366, 0);
export const Homonimo1024x1366d150 = homonymStory(1024, 1366, 150);
export const Homonimo390x1100d0 = homonymStory(390, 1100, 0);
export const ErrorProveedor390 = supplierErrorStory(390, 1100);
export const ErrorProveedor768 = supplierErrorStory(768, 1024);
export const ErrorProveedor1024x1366 = supplierErrorStory(1024, 1366);
export const ErrorProveedor1280 = supplierErrorStory(1280, 900);
export const TasaDifiere390 = rateStory(390, 1100, 895, 1000);
export const TasaDifiere768 = rateStory(768, 1024, 895, 1000);
export const TasaDifiere1024x1366 = rateStory(1024, 1366, 895, 1000);
export const TasaDifiere1280 = rateStory(1280, 900, 895, 1000);
export const TasaSinImpresa390 = rateStory(390, 1100, undefined, 900);
export const TasaSinImpresa1280 = rateStory(1280, 900, undefined, 900);
