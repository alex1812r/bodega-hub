/**
 * REP16-03 · D67(c): bajos de la pasada 17 (caos B).
 *
 * 1. B-p17B-1: el error al leer el proveedor preseleccionado llega con el campo ya tecleado (`isDirty`). Salía como
 *    descripción bajo el campo y la cabecera crecía 24 px. Debe ir dentro del campo (title, aria-invalid,
 *    aria-describedby), como con el campo limpio, sin cambiar el alto de la cabecera ni el `top` de las filas.
 * 2. B-p17B-2: con un alto de viewport < 500 px (teléfono en horizontal, 844×390) el pie fijo ocupaba ~176 px. Debe
 *    dejar de ser fijo (o medir ≤ 64 px) sin perder Cargar ni los motivos. Con ≥ 500 px sigue fijo.
 * 3. B-p17B-3: los altos retenidos (layout pendiente tras un toque, avisos retenidos tras una llegada) sobrevivían al
 *    giro y dejaban huecos hasta desplazar. Al cambiar el ancho se sueltan todos, sin guardar controles como movidos:
 *    tras girar se aceptan «Restaurar» a 1,4 s y el 2.º homónimo a 150 ms (N7 de pasada-17-B).
 *    REP17-02: desde REP17-01 (D70(d)) el aviso de duplicado reserva su sitio y no encoge al irse; el aviso retenido es la
 *    reserva del desvío de una línea, que la tasa del día deja de usar al llegar sin desviarla (B-p18B-2).
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep16-03.stories.tsx`
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
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";

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

const LONG_NAME = "Distribuidora Internacional de Alimentos y Víveres Los Andes del Sur, C.A. (CAOS16B)";
const SUPPLIER_ERROR = "caos: no se pudo leer el proveedor";
const HOMONYM = "CAOSG Jabon Azul 250g";

const extraction = {
  date: "2026-10-14",
  number: "00-0161601",
  printedRate: 895,
  supplier: { name: LONG_NAME, taxId: "J-16160001-1" },
};

/** L0 con dos homónimos (solo cambia el SKU), L1 sin emparejar y L2 dudosa. */
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
const lines = [
  homonymLine,
  unmatchedLine(2, false, { read: { description: "Arroz Mary 1kg", rawText: "ARROZ MARY 1KG" } }),
  doubtfulLine(3, 0.72, { read: { description: "Harina P.A.N. 1kg", rawText: "HARINA PAN 1KG" } }),
];
const response = makeReviewResponse({ extraction, lines });
/**
 * Sin tasa impresa; L2 (Bs 450, último costo 0,50 REF) reserva el sitio de su desvío mientras falta la tasa del día. Con
 * 900 no se desvía (450 / 900 = 0,50): la reserva sobra y queda retenida (D65(b)).
 */
const lateRateResponse = makeReviewResponse({
  extraction: { date: extraction.date, number: extraction.number, supplier: extraction.supplier },
  lines: [
    homonymLine,
    lines[1],
    doubtfulLine(3, 0.72, {
      match: { lastUnitCostRef: 0.5, taxRateCode: "exento" },
      read: { description: "Harina P.A.N. 1kg", lineTotal: 450, quantity: 1, rawText: "HARINA PAN 1KG", unitPrice: 450 },
    }),
  ],
});
const LATE_RATE = 900;

type Gate<T> = { promise: Promise<T>; open: (value: T) => void };

function gate<T>(): Gate<T> {
  let open: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { open, promise };
}

function newGates() {
  return { duplicates: gate<InvoiceDuplicateMatch[]>(), supplier: gate<void>(), supplierFails: false };
}

let gates = newGates();

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

function footer() {
  const element = document.querySelector<HTMLElement>('footer[aria-label="Resumen de la revisión"]');
  if (!element) {
    throw new Error("Sin pie");
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

/** Toque real (CDP `Input.dispatchTouchEvent`), como `tapAt` de REP15-01. */
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
  await sleep(300);
  const main = document.querySelector("main");
  if (main) {
    main.scrollTop = 0;
  }
  await sleep(300);
  return browser;
}

/** Alto de la cabecera y `top` + alto de cada fila (px de la ventana). */
function measure(): string {
  const header = document.querySelector('[data-layout-box="header"]');
  if (!header) {
    throw new Error("Sin cabecera");
  }
  const rows = [...document.querySelectorAll<HTMLElement>('[data-layout-box^="row:"]')].map((element) => {
    const box = element.getBoundingClientRect();
    return `${element.dataset.layoutBox}@${Math.round(box.top)}+${Math.round(box.height)}`;
  });
  return `cabecera ${Math.round(header.getBoundingClientRect().height)} filas ${rows.join("/")}`;
}

/** Muestrea `measure` en cada frame mientras corre `during`. */
async function sampleFrames(during: () => Promise<void>): Promise<string[]> {
  const seen = new Set<string>();
  let running = true;
  const tick = () => {
    if (!running) {
      return;
    }
    seen.add(measure());
    requestAnimationFrame(tick);
  };
  tick();
  try {
    await during();
  } finally {
    running = false;
  }
  seen.add(measure());
  return [...seen];
}

/** Escribe en el campo del proveedor como el usuario (evento `input`), sin desplazar. */
function typeSupplier(value: string) {
  const field = supplierField();
  field.focus({ preventScroll: true });
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * (1) B-p17B-1: se teclea «Distri» en el proveedor antes de que falle la lectura del preseleccionado. El error va dentro
 * del campo: `title`, `aria-invalid` y `aria-describedby` a un texto dentro de su caja; ni la cabecera ni las filas
 * cambian (en cada frame, también al salir del campo).
 */
function dirtySupplierErrorStory(width: number, height: number): Story {
  return {
    play: async () => {
      gates.supplierFails = true;
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      await waitFor(() => expect(supplierField()).toHaveAttribute("placeholder", "Cargando proveedor…"));
      typeSupplier("Distri");
      await waitFor(() => expect(supplierField()).toHaveValue("Distri"));
      await sleep(400);
      /** Valor, title y dónde está el texto que cita `aria-describedby` (dentro de la caja del campo o debajo). */
      const describe = () => {
        const field = supplierField();
        const describedBy = field.getAttribute("aria-describedby");
        const description = describedBy ? document.getElementById(describedBy) : null;
        const where = description ? (field.parentElement?.contains(description) ? "dentro del campo" : "bajo el campo") : "ninguna";
        return { description, text: `campo «${field.value}», title «${field.title}», descripción ${where}`, title: field.title, where };
      };
      let typed = describe();
      const frames = await sampleFrames(async () => {
        gates.supplier.open();
        await waitFor(() => expect(supplierField()).toHaveAttribute("aria-invalid", "true"), { timeout: 4000 });
        await sleep(400);
        typed = describe();
        supplierField().blur();
        await sleep(400);
      });
      const left = describe();
      const text = `${width}×${height}: ${frames.join(" → ")}; tecleado: ${typed.text}; al salir: ${left.text}`;
      console.warn(`[REP16-03 error proveedor tecleado] ${text}`);
      for (const state of [typed, left]) {
        await expect(state.title, text).toContain(SUPPLIER_ERROR);
        await expect(state.description?.textContent ?? "", text).toContain(SUPPLIER_ERROR);
        await expect(state.where, text).toBe("dentro del campo");
      }
      await expect(frames.length, text).toBe(1);
    },
  };
}

/**
 * (2) B-p17B-2: con < 500 px de alto el pie no es fijo (o mide ≤ 64 px); al final de la revisión se llega a «Cargar» y
 * a los motivos. Con ≥ 500 px (`sticky` esperado) sigue fijo abajo.
 */
function footerStory(width: number, height: number): Story {
  return {
    args: { context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES } },
    play: async () => {
      gates.supplier.open();
      if (!(await prepare(width, height))) {
        return;
      }
      const box = footer().getBoundingClientRect();
      const position = getComputedStyle(footer()).position;
      const text = `${width}×${height}: pie ${position}, alto ${Math.round(box.height)} px`;
      console.warn(`[REP16-03 pie] ${text}`);
      if (height >= 500) {
        await expect(position, text).toBe("sticky");
        return;
      }
      await expect(position !== "sticky" || box.height <= 64, text).toBe(true);
      const main = document.querySelector("main");
      if (main) {
        main.scrollTop = main.scrollHeight;
      }
      await sleep(300);
      const load = document.querySelector<HTMLButtonElement>("[data-load-button]");
      const blockers = document.querySelector<HTMLElement>('[data-testid="invoice-review-blockers"]');
      if (!load || !blockers) {
        throw new Error("Sin Cargar o sin motivos");
      }
      // Cargar está deshabilitado (hay pendientes; sin eventos de puntero): basta con que se vea entero al final.
      const loadBox = load.getBoundingClientRect();
      const seen = `${text}; al final, Cargar en y ${Math.round(loadBox.top)}–${Math.round(loadBox.bottom)} de ${window.innerHeight}`;
      await expect(loadBox.top >= 0 && loadBox.bottom <= window.innerHeight, seen).toBe(true);
      await expect(blockers.checkVisibility(), text).toBe(true);
      await expect(blockers.textContent ?? "").not.toBe("");
    },
  };
}

/** Estilos en línea que retienen altos: cajas (`min-height` del layout pendiente) y avisos (suelo, recorte, ocultos). */
function heldHeights(): string[] {
  const boxes = [...panel().querySelectorAll<HTMLElement>("[data-layout-box]")]
    .filter((box) => box.style.minHeight !== "")
    .map((box) => `${box.dataset.layoutBox}→${box.style.minHeight}`);
  const notices = [...panel().querySelectorAll<HTMLElement>("[data-layout-notice]")]
    .filter((notice) => notice.style.minHeight !== "" || notice.style.maxHeight !== "" || notice.style.display !== "")
    .map((notice) => `aviso «${notice.textContent?.trim().slice(0, 30) || "(vacío)"}»→${notice.style.minHeight || notice.style.maxHeight || notice.style.display}`);
  return [...boxes, ...notices];
}

/**
 * (3a) B-p17B-3 (`rot2-1024`, `rot4-390`): toque a «Descartar línea» de una fila (layout pendiente) y, 500 ms después,
 * girar. `at`: L0 arriba de la vista, o la última fila (L2) con la página al final. `leave`: como Chromium al girar en el
 * arnés real (rot4-390), un `pointerleave` de ratón en `<html>` llega con el evento `resize`, antes del ResizeObserver
 * (soltaba el layout pendiente aplicando D49 y dejaba guardado «Restaurar»).
 * Tras girar (250 ms) no queda ningún alto retenido; «Restaurar» de esa fila, tocado a 1,4 s del primer toque (~0,9 s tras
 * el giro, como en el arnés), se acepta: la fila vuelve a por revisar.
 */
function rotateHoldStory(
  from: readonly [number, number],
  to: readonly [number, number],
  at: "top" | "bottom",
  leave = false,
): Story {
  return {
    args: { context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES } },
    play: async () => {
      gates.supplier.open();
      gates.duplicates.open([]);
      const browser = await prepare(...from);
      if (!browser) {
        return;
      }
      await waitFor(() => expect(supplierField()).toHaveValue(LONG_NAME));
      const index = at === "top" ? 0 : 2;
      const main = document.querySelector("main");
      if (main) {
        main.scrollTop = at === "top" ? main.scrollTop + row(0).getBoundingClientRect().top - 80 : main.scrollHeight;
      }
      await sleep(400);
      const tapped = Date.now();
      await tapAt(browser, centerOf(within(row(index)).getByRole("button", { name: "Descartar línea" })));
      await waitFor(() => expect(row(index).dataset.status).toBe("discarded"));
      await sleep(Math.max(0, 500 - (Date.now() - tapped)));
      const before = heldHeights();
      const onResize = () =>
        document.documentElement.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
      if (leave) {
        window.addEventListener("resize", onResize, { once: true });
      }
      await browser.page.viewport(...to);
      await sleep(250);
      window.removeEventListener("resize", onResize);
      const after = heldHeights();
      await sleep(Math.max(0, 1400 - (Date.now() - tapped)));
      const restore = within(row(index)).getByRole("button", { name: "Restaurar" });
      const restoredAt = Date.now() - tapped;
      const point = centerOf(restore);
      const under = document.elementFromPoint(point.x, point.y)?.closest("button")?.textContent ?? "-";
      await tapAt(browser, point);
      await sleep(500);
      const text = `${from.join("×")} → ${to.join("×")}${leave ? " (pointerleave al girar)" : ""}: retenidos antes de girar [${before.join(", ")}] → tras girar [${after.join(", ")}]; bajo el dedo «${under}»; L${index} tras «Restaurar» a ${restoredAt} ms del 1.er toque: ${row(index).dataset.status}`;
      console.warn(`[REP16-03 giro con layout pendiente] ${text}`);
      await expect(before.length, `${text} (el toque debía retener)`).toBeGreaterThan(0);
      await expect(after, text).toEqual([]);
      await expect(under, text).toBe("Restaurar");
      await expect(row(index).dataset.status, text).toMatch(/^pending_/);
    },
  };
}

/** Llega la tasa del día (como `useExchangeRate` en la página), sin evento del usuario: lo que cambie es una llegada. */
let arriveRate: () => void = () => undefined;

function LateRatePanel(props: ComponentProps<typeof InvoiceReviewPanel>) {
  const [context, setContext] = useState(props.context);
  useEffect(() => {
    arriveRate = () => setContext({ ...props.context, systemRateVes: LATE_RATE });
  }, [props.context]);
  return <InvoiceReviewPanel {...props} context={context} />;
}

/**
 * (3b) B-p17B-3 (`rotdup-1024`): un aviso se va solo (queda retenido a su alto), girar. Tras girar no queda ningún alto
 * retenido, y el toque al 2.º homónimo 150 ms después del giro lo elige. REP17-02: el aviso es la reserva del desvío de L2,
 * que la tasa del día deja de usar al llegar sin desviarla.
 */
function rotateNoticeStory(): Story {
  return {
    args: { response: lateRateResponse },
    render: (args) => <LateRatePanel {...args} />,
    play: async () => {
      gates.supplier.open();
      gates.duplicates.open([]);
      const browser = await prepare(1024, 1366);
      if (!browser) {
        return;
      }
      await waitFor(() => expect(supplierField()).toHaveValue(LONG_NAME));
      // L0 (la de los homónimos) va tras L1 (sin emparejar): arriba de la vista, para que tras girar no quede bajo el pie.
      row(0).scrollIntoView({ block: "start" });
      await sleep(300);
      arriveRate();
      // La reserva del desvío de L2 deja de usarse (su alto queda retenido).
      await waitFor(() => expect(panel().querySelector('[data-testid="invoice-review-options-reserve"]')).toBeNull());
      await sleep(300);
      const before = heldHeights();
      await browser.page.viewport(1366, 1024);
      await sleep(150);
      const after = heldHeights();
      const target = within(row(0)).getAllByRole("button", { name: new RegExp(HOMONYM) })[1];
      await tapAt(browser, centerOf(target));
      await sleep(600);
      const pressed = within(row(0))
        .getAllByRole("button", { name: new RegExp(HOMONYM) })
        .filter((chip) => chip.getAttribute("aria-pressed") === "true")
        .map((chip) => chip.textContent ?? "");
      const text = `retenidos antes de girar [${before.join(", ")}] → tras girar [${after.join(", ")}]; pulsado tras girar ${JSON.stringify(pressed)}`;
      console.warn(`[REP16-03 giro con aviso retenido] ${text}`);
      await expect(before.length, `${text} (el aviso debía quedar retenido)`).toBeGreaterThan(0);
      await expect(after, text).toEqual([]);
      await expect(pressed.join(" "), text).toContain("CAOSG-005");
    },
  };
}

const noSuppliers: EntityFetcher<"contact"> = async () => [];

const meta = {
  args: {
    canCreateProduct: true,
    context: { taxRates: REVIEW_TAX_RATES },
    duplicateFetcher: () => gates.duplicates.promise,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher: async () => [],
    response,
    supplierFetcher: noSuppliers,
  },
  beforeEach() {
    // Las guardas (D46-b, D49) miden tiempo: con el reloj fijo del preview no caducan.
    MockDate.reset();
    gates = newGates();
  },
  component: InvoiceReviewPanel,
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      queryClient.setQueryData(invoiceScanQueryKeys.images(REVIEW_SCAN_ID), []);
      // El marco de AppShell: menú lateral abierto desde lg y `<main>` con su desplazamiento.
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
        // `usePurchaseSupplier`: el nombre del proveedor preseleccionado (red lenta, o falla).
        http.get("/api/purchases/suppliers", async ({ request }) => {
          if (!new URL(request.url).searchParams.has("id")) {
            return HttpResponse.json({ data: [] });
          }
          await gates.supplier.promise;
          if (gates.supplierFails) {
            return HttpResponse.json({ error: { code: "UNKNOWN_ERROR", message: SUPPLIER_ERROR } }, { status: 500 });
          }
          return HttpResponse.json({
            data: { id: REVIEW_SUPPLIER_ID, isActive: true, name: LONG_NAME, taxId: "J-16160001-1" },
          });
        }),
        http.get("/api/purchases/invoice-scan/:scanId", () => HttpResponse.json({ data: { purchaseId: null } })),
      ],
    },
  },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP16-03 bajos de la pasada 17",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorProveedorTecleado1280 = dirtySupplierErrorStory(1280, 900);
export const ErrorProveedorTecleado1024x1366 = dirtySupplierErrorStory(1024, 1366);
export const ErrorProveedorTecleado390 = dirtySupplierErrorStory(390, 1100);
export const PieHorizontal844x390 = footerStory(844, 390);
export const PieHorizontal740x360 = footerStory(740, 360);
export const PieVertical390x844 = footerStory(390, 844);
export const PieEscritorio1280x900 = footerStory(1280, 900);
export const GiroConLayoutPendiente1024 = rotateHoldStory([1024, 1366], [1366, 1024], "top");
export const GiroConLayoutPendienteAlFinal1024 = rotateHoldStory([1024, 1366], [1366, 1024], "bottom");
export const GiroConLayoutPendienteAlFinal390 = rotateHoldStory([390, 844], [844, 390], "bottom");
export const GiroConSalidaDelPuntero390 = rotateHoldStory([390, 844], [844, 390], "bottom", true);
export const GiroConSalidaDelPuntero1024 = rotateHoldStory([1024, 1366], [1366, 1024], "top", true);
export const GiroConAvisoRetenido1024 = rotateNoticeStory();
