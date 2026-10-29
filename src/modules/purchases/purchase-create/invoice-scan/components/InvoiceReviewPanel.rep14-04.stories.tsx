/**
 * REP14-04 · B-p14-1: la × «Limpiar Proveedor» de la revisión quita el proveedor (campo vacío, Cargar
 * bloqueado con «Elige el proveedor.»). B-p15B-2: el aviso de tasa dice la tasa en uso al escribirla
 * y, al llegar la del día, la ofrece sin pisar la escrita. Ratón y toque reales (CDP), a 1280 y 390.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep14-04.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay CDP y la comprobación se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockDate from "mockdate";
import { useState, type ComponentProps } from "react";
import { expect, fn, screen, waitFor } from "storybook/test";

import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, REVIEW_SCAN_ID, REVIEW_SUPPLIER_ID, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { pressKeys, settleCdpAcks } from "./InvoiceReviewPanel.cdpInput";

const SUPPLIER_NAME = "Mercaseu 2030, C.A.";
const LINE = { match: { taxRateCode: "exento" }, read: { lineTotal: 1750, quantity: 1, unitPrice: 1750 } };
const supplierResponse = makeReviewResponse({ extraction: { date: "2026-10-17", total: 1750 }, lines: [LINE] });
const rateResponse = makeReviewResponse({
  extraction: { date: "2026-10-17", printedRate: 856.3, total: 1750 },
  lines: [LINE],
});
const SYSTEM: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const NO_RATE: InvoiceReviewContext = { taxRates: REVIEW_TAX_RATES };

const noSuppliers: EntityFetcher<"contact"> = async () => [];

type Point = { x: number; y: number };
type Pointer = "mouse" | "touch";

async function loadBrowser() {
  if (!("__vitest_browser__" in globalThis)) {
    return null;
  }
  return import("vitest/browser").catch(() => null);
}

type Browser = NonNullable<Awaited<ReturnType<typeof loadBrowser>>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Punto del documento de la story en la página de Playwright (el iframe del runner puede escalarse). */
function pagePoint(point: Point): Point {
  let { x, y } = point;
  for (let view: Window = window, frame = view.frameElement; frame; view = view.parent, frame = view.frameElement) {
    const box = frame.getBoundingClientRect();
    const width = frame.clientWidth + 2 * frame.clientLeft;
    const scale = width ? box.width / width : 1;
    x = box.left + (frame.clientLeft + x) * scale;
    y = box.top + (frame.clientTop + y) * scale;
  }
  return { x, y };
}

/** Ratón o toque reales por CDP en el centro del elemento (como `InvoiceReviewPanel.layout.stories`). */
async function activate(browser: Browser, element: Element, pointer: Pointer) {
  element.scrollIntoView({ block: "center" });
  await sleep(600);
  const box = element.getBoundingClientRect();
  const target = pagePoint({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  const session = browser.cdp();
  if (pointer === "touch") {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [target] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    }
  } else {
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
    await session.send("Input.dispatchMouseEvent", { type: "mousePressed", ...target, button: "left", clickCount: 1 });
    await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...target, button: "left", clickCount: 1 });
  }
  await sleep(300);
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

function blockers() {
  return document.querySelector('[data-testid="invoice-review-blockers"]')?.textContent ?? "";
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
  await waitFor(() => expect(screen.getByTestId("invoice-review-panel")).toBeInTheDocument());
  await sleep(500);
  return browser;
}

async function snapshot(browser: Browser, name: string) {
  if ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_REP14_04_SHOTS === "1") {
    await browser.page.screenshot({ path: `__rep14-04__/${name}.png` });
  }
}

function log(report: string) {
  console.warn(`[REP14-04] ${report}`);
  return report;
}

function supplierStory(width: number, height: number, pointer: Pointer): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const field = () => screen.getByRole("combobox", { name: /Proveedor/ }) as HTMLInputElement;
      await waitFor(() => expect(field().value).toBe(SUPPLIER_NAME));
      await waitFor(() => expect(loadButton()).toBeEnabled());
      const before = log(`× ${pointer} ${width}: antes valor=«${field().value}» Cargar=${!loadButton().hasAttribute("disabled")}`);
      await activate(browser, screen.getByRole("button", { name: "Limpiar Proveedor" }), pointer);
      const report = log(
        `× ${pointer} ${width}: tras × valor=«${field().value}» Cargar=${!loadButton().hasAttribute("disabled")} motivos=«${blockers()}» (${before})`,
      );
      await snapshot(browser, `x-${pointer}-${width}`);
      await expect(field().value, report).toBe("");
      await expect(loadButton(), report).toBeDisabled();
      await expect(blockers(), report).toContain("Elige el proveedor.");
    },
  };
}

function notice() {
  const panelNotice = [...document.querySelectorAll('[data-testid="invoice-review-panel"] [role="status"], [data-testid="invoice-review-panel"] [role="alert"]')]
    .map((element) => element.textContent ?? "")
    .find((text) => /tasa/i.test(text));
  return panelNotice ?? "";
}

function radios() {
  return [...document.querySelectorAll('[aria-label="Tasa para convertir los costos"] [role="radio"]')].map(
    (radio) => `${radio.textContent}=${radio.getAttribute("aria-checked")}`,
  );
}

/**
 * Cada opción de la tasa, por su nombre, y si está elegida. REP17-02: el orden lo fija el diseño (D70(a): «Tasa de hoy»
 * aparece debajo del campo de la tasa escrita, nunca encima); lo que se comprueba es qué opción hay y cuál está elegida.
 */
function radioStates() {
  return Object.fromEntries(radios().map((radio) => [radio.slice(0, radio.lastIndexOf("=")), radio.slice(radio.lastIndexOf("=") + 1)]));
}

/** El panel con la tasa del día que llega tarde (como `useExchangeRate` en la página). */
function LateRatePanel(props: ComponentProps<typeof InvoiceReviewPanel>) {
  const [context, setContext] = useState<InvoiceReviewContext>(NO_RATE);
  return (
    <>
      <button className="sr-only" data-testid="rep14-04-rate-arrives" onClick={() => setContext(SYSTEM)} type="button">
        Llega la tasa del día
      </button>
      <InvoiceReviewPanel {...props} context={context} />
    </>
  );
}

function rateStory(width: number, height: number, pointer: Pointer): Story {
  return {
    render: (args) => <LateRatePanel {...args} />,
    args: { response: rateResponse },
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      log(`tasa ${pointer} ${width}: inicial «${notice()}» ${JSON.stringify(radios())}`);
      await snapshot(browser, `tasa-${pointer}-${width}-1-inicial`);
      await activate(browser, screen.getByRole("radio", { name: "Escribir la tasa" }), pointer);
      const input = screen.getByLabelText("Tasa Bs por REF");
      await activate(browser, input, pointer);
      await pressKeys(browser, "950{Tab}");
      await sleep(300);
      const typed = log(`tasa ${pointer} ${width}: escrita «${notice()}» ${JSON.stringify(radios())}`);
      await snapshot(browser, `tasa-${pointer}-${width}-2-escrita`);
      await expect(notice(), typed).not.toMatch(/se usa la tasa impresa/);
      await expect(notice(), typed).toMatch(/se usa la tasa escrita \(Bs\. 950,00\)/);

      (screen.getByTestId("rep14-04-rate-arrives") as HTMLButtonElement).click();
      await sleep(300);
      const arrived = log(`tasa ${pointer} ${width}: llegó la del día «${notice()}» ${JSON.stringify(radios())}`);
      await snapshot(browser, `tasa-${pointer}-${width}-3-llega`);
      await expect(notice(), arrived).not.toMatch(/No hay tasa del día|se usa la tasa impresa/);
      await expect(notice(), arrived).toMatch(/Ya hay tasa del día \(Bs\. 900,00\); se usa la tasa escrita \(Bs\. 950,00\)/);
      await expect(radioStates(), arrived).toEqual({
        "Escribir la tasa": "true",
        "Tasa de hoy (900,00)": "false",
        "Tasa de la factura (856,30)": "false",
      });

      await activate(browser, screen.getByRole("radio", { name: "Tasa de hoy (900,00)" }), pointer);
      const today = log(`tasa ${pointer} ${width}: elegida la de hoy «${notice()}» ${JSON.stringify(radios())}`);
      await snapshot(browser, `tasa-${pointer}-${width}-4-hoy`);
      await expect(notice(), today).toMatch(/La factura trae tasa Bs\. 856,30; hoy es Bs\. 900,00\./);
      await expect(radioStates(), today).toEqual({
        "Escribir la tasa": "false",
        "Tasa de hoy (900,00)": "true",
        "Tasa de la factura (856,30)": "false",
      });
    },
  };
}

const meta = {
  args: {
    canCreateProduct: true,
    context: SYSTEM,
    duplicateFetcher: async () => [],
    lastUnitCostFetcher: async () => null,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher: async () => [],
    response: supplierResponse,
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
        taxId: "J-50604031-0",
      });
      queryClient.setQueryData(invoiceScanQueryKeys.images(REVIEW_SCAN_ID), []);
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
  // Las guardas del panel miden tiempo real: sin el reloj fijo de `preview.tsx` (con él, la guarda espacial D46-b
  // no caduca nunca y descarta un toque deliberado a < 32 px del anterior, segundos después).
  beforeEach() {
    MockDate.reset();
  },
  afterEach: settleCdpAcks,
  parameters: { layout: "fullscreen" },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP14-04 proveedor y aviso de tasa",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LimpiarProveedorRaton1280 = supplierStory(1280, 900, "mouse");
export const LimpiarProveedorToque1280 = supplierStory(1280, 900, "touch");
export const LimpiarProveedorRaton390 = supplierStory(390, 844, "mouse");
export const LimpiarProveedorToque390 = supplierStory(390, 844, "touch");
export const TasaRaton1280 = rateStory(1280, 900, "mouse");
export const TasaToque1280 = rateStory(1280, 900, "touch");
export const TasaRaton390 = rateStory(390, 844, "mouse");
export const TasaToque390 = rateStory(390, 844, "touch");
