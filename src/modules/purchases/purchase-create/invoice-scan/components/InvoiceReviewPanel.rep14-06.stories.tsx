/**
 * REP14-06 · D63 (B-qa234-1, B-qa234-2): en el marco real de la aplicación (menú lateral de 288 px desde
 * 1024 y el relleno de `<main>`):
 * - El proveedor elegido se ve entero (30 y 45 caracteres) de 320 a 1440, sin romper número ni fecha.
 * - Que aparezca o se resuelva un motivo de bloqueo («Corrige la fecha…», «Confirma que registras la
 *   factura sin fecha.», «Elige el proveedor.») no mueve «Cargar» ni la casilla de la diferencia
 *   (dy=0) a 1024, 1280 y 390.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep14-06.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockDate from "mockdate";
import { expect, fn, screen, waitFor } from "storybook/test";

import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";

import { doubtfulLine, makeReviewResponse, REVIEW_SCAN_ID, REVIEW_SUPPLIER_ID, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

/** El del lab (`c12-foot`, B-qa234-1) y uno de 45 caracteres. */
const NAME_30 = "Distribuidora Caos Global C.A.";
const NAME_45 = "Corporación Distribuidora Hermanos Pérez C.A.";

/** Cabecera como la de f05 (dos líneas con costos de 4 cifras). */
function headerResponse(name: string) {
  return makeReviewResponse({
    extraction: { date: "2026-08-13", number: "00-0123456", supplier: { name, taxId: "J-50203040-1" } },
    lines: [
      doubtfulLine(1, 0.72, { read: { description: "Malta 1.5L", lineTotal: 37681.8, quantity: 12, rawText: "MALTA 1.5L", unitPrice: 3140.15 } }),
      doubtfulLine(2, 0.72, { read: { description: "Harina P.A.N. 1kg", lineTotal: 23560.5, quantity: 25, rawText: "HARINA PAN 1KG", unitPrice: 942.42 } }),
    ],
  });
}

/** Pie: una línea lista y un total leído distinto (casilla de diferencia a la vista, como `c12-foot`). */
const footerResponse = makeReviewResponse({
  extraction: { date: "2026-10-17", supplier: { name: NAME_30, taxId: "J-50203040-1" }, total: 1800 },
  lines: [{ match: { taxRateCode: "exento" }, read: { lineTotal: 1750, quantity: 1, unitPrice: 1750 } }],
});

const noSuppliers: EntityFetcher<"contact"> = async () => [];

async function loadBrowser() {
  if (!("__vitest_browser__" in globalThis)) {
    return null;
  }
  return import("vitest/browser").catch(() => null);
}

type Browser = NonNullable<Awaited<ReturnType<typeof loadBrowser>>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function panel() {
  const element = document.querySelector<HTMLElement>('[data-testid="invoice-review-panel"]');
  if (!element) {
    throw new Error("Sin panel de revisión");
  }
  return element;
}

function supplierField() {
  return screen.getByRole("combobox", { name: /proveedor/i }) as HTMLInputElement;
}

async function prepare(width: number, height: number, supplierName: string) {
  const browser = await loadBrowser();
  if (!browser) {
    return null;
  }
  await browser.page.viewport(width, height);
  const hideDevtools = document.createElement("style");
  hideDevtools.textContent = ".tsqd-parent-container { display: none !important; }";
  document.head.append(hideDevtools);
  await waitFor(() => expect(panel()).toBeInTheDocument());
  await waitFor(() => expect(supplierField()).toHaveValue(supplierName));
  await sleep(300);
  return browser;
}

async function snapshot(browser: Browser, name: string) {
  // Vite expone `import.meta.env`; el tsconfig de la app no lo tipa.
  if ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_REP14_06_SHOTS === "1") {
    await browser.page.screenshot({ path: `__rep14-06__/${name}.png` });
  }
}

function textWidth(text: string, element: HTMLElement) {
  const style = getComputedStyle(element);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    throw new Error("Sin canvas");
  }
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(text).width;
}

function contentWidth(element: HTMLElement) {
  const style = getComputedStyle(element);
  return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

function isTransparent(color: string) {
  return color === "transparent" || /rgba\(.*,\s*0\)$/.test(color) || / \/ 0\)$/.test(color);
}

type Check = { label: string; fits: boolean; detail: string };

/**
 * Lo que se ve del proveedor: el nombre envuelto sobre el campo (si lo hay y el texto del campo no se
 * pinta) o el texto del propio campo.
 */
function supplierCheck(name: string): Check {
  const input = supplierField();
  const shown = input.parentElement?.querySelector<HTMLElement>("[data-entity-value-label]");
  const inputBox = input.getBoundingClientRect();
  if (shown && getComputedStyle(shown).visibility !== "hidden" && isTransparent(getComputedStyle(input).color)) {
    const box = shown.getBoundingClientRect();
    const inside = box.top >= inputBox.top - 1 && box.bottom <= inputBox.bottom + 1;
    const fits =
      shown.textContent === name && shown.scrollWidth <= shown.clientWidth && shown.scrollHeight <= shown.clientHeight + 1 && inside;
    return {
      detail: `nombre envuelto «${shown.textContent}» ${Math.round(box.width)}×${Math.round(box.height)} px, scroll ${shown.scrollWidth}×${shown.scrollHeight}/${shown.clientWidth}×${shown.clientHeight}, campo ${Math.round(inputBox.width)}×${Math.round(inputBox.height)}${inside ? "" : " · se sale del campo"}`,
      fits,
      label: "Proveedor",
    };
  }
  const needed = textWidth(input.value, input);
  const room = contentWidth(input);
  return {
    detail: `campo ${Math.round(inputBox.width)} px, «${input.value}» ${Math.round(needed)} px en ${Math.round(room)} px, scrollWidth ${input.scrollWidth}/${input.clientWidth}`,
    fits: input.value === name && input.scrollWidth <= input.clientWidth && needed <= room,
    label: "Proveedor",
  };
}

/** Número y fecha (con el año y el calendario) siguen cabiendo; el motivo de la fecha conserva sus 3 renglones. */
function otherChecks(): Check[] {
  const number = screen.getByLabelText("Número de factura") as HTMLInputElement;
  const date = screen.getByLabelText("Fecha") as HTMLInputElement;
  const reason = date.closest(".space-y-2")?.parentElement?.querySelector<HTMLElement>(":scope > p");
  const lineHeight = reason ? parseFloat(getComputedStyle(reason).lineHeight) : 0;
  const reserved = reason?.getBoundingClientRect().height ?? 0;
  const dateNeeded = textWidth("00/00/0000", date) + 24;
  return [
    {
      detail: `${Math.round(number.getBoundingClientRect().width)} px, scrollWidth ${number.scrollWidth}/${number.clientWidth}`,
      fits: number.scrollWidth <= number.clientWidth,
      label: "Número",
    },
    {
      detail: `${Math.round(date.getBoundingClientRect().width)} px, necesita ${Math.round(dateNeeded)}, hay ${Math.round(contentWidth(date))}`,
      fits: dateNeeded <= contentWidth(date),
      label: "Fecha",
    },
    {
      detail: `línea reservada ${Math.round(reserved)} px (3 × ${lineHeight})`,
      fits: reserved >= 3 * lineHeight - 1,
      label: "Motivo de fecha",
    },
  ];
}

function supplierStory(width: number, height: number, name: string): Story {
  return {
    parameters: { supplierName: name },
    args: { response: headerResponse(name) },
    play: async () => {
      const browser = await prepare(width, height, name);
      if (!browser) {
        return;
      }
      const checks = [supplierCheck(name), ...otherChecks()];
      await snapshot(browser, `proveedor${name.length}-${width}`);
      const report = checks.map((check) => `${check.label}: ${check.detail}${check.fits ? "" : " · CORTADO"}`).join(" | ");
      console.warn(`[REP14-06 proveedor ${name.length} car. ${width}×${height}] ${report}`);
      await expect(checks.filter((check) => !check.fits).map((check) => check.label), `${width}×${height}: ${report}`).toEqual([]);
    },
  };
}

/** Espacio real (CDP) sobre el elemento enfocado. */
async function keySpace(browser: Browser) {
  const session = browser.cdp();
  const key = { code: "Space", key: " ", windowsVirtualKeyCode: 32 };
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: " " });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  await sleep(300);
}

function typeDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

function differenceBox() {
  const box = document.querySelector<HTMLInputElement>('[data-testid="invoice-review-confirm-difference"] input');
  if (!box) {
    throw new Error("Sin casilla de diferencia");
  }
  return box;
}

function footerText() {
  return document.querySelector('footer[aria-label="Resumen de la revisión"]')?.textContent ?? "";
}

/** Arriba y alto del pie (para el informe). */
function footerBox() {
  const box = document.querySelector('footer[aria-label="Resumen de la revisión"]')?.getBoundingClientRect();
  return box ? `${Math.round(box.top)}+${Math.round(box.height)}` : "?";
}

/** Arriba de «Cargar» y de la casilla, en px de la ventana. */
function positions() {
  return {
    cargar: Math.round(loadButton().getBoundingClientRect().top),
    casilla: Math.round(differenceBox().getBoundingClientRect().top),
  };
}

type Reason = "fecha" | "sinFecha" | "proveedor";

const REASON_TEXT: Record<Reason, string> = {
  fecha: "Corrige la fecha de la factura.",
  proveedor: "Elige el proveedor.",
  sinFecha: "Confirma que registras la factura sin fecha.",
};

function footerStory(width: number, height: number, reason: Reason): Story {
  return {
    parameters: { supplierName: NAME_30 },
    args: { response: footerResponse },
    play: async () => {
      const browser = await prepare(width, height, NAME_30);
      if (!browser) {
        return;
      }
      const touch = width < 640;
      const date = screen.getByLabelText("Fecha") as HTMLInputElement;
      // Como `PREP` en `qa234.sh`: la diferencia se acepta con Espacio (el teclado aplica el layout retenido,
      // así el pie arranca con su alto propio y sin motivos).
      differenceBox().focus();
      await keySpace(browser);
      await waitFor(() => expect(loadButton()).toBeEnabled());
      await sleep(1500);
      const before = positions();
      const footerBefore = footerBox();
      if (reason === "fecha") {
        typeDate(date, "0026-10-17");
      } else if (reason === "sinFecha") {
        typeDate(date, "");
      } else {
        screen.getByRole("button", { name: "Limpiar Proveedor" }).click();
      }
      await waitFor(() => expect(loadButton()).toBeDisabled());
      if (!touch) {
        await waitFor(() => expect(footerText()).toContain(REASON_TEXT[reason]));
      }
      await sleep(100);
      const at100 = positions();
      await sleep(1400);
      const at1500 = positions();
      await snapshot(browser, `pie-${reason}-${width}`);
      let resolved = at1500;
      if (reason !== "proveedor") {
        typeDate(date, "2026-10-17");
        await waitFor(() => expect(loadButton()).toBeEnabled());
        await sleep(1500);
        resolved = positions();
      }
      const show = (p: { cargar: number; casilla: number }) => `Cargar ${p.cargar} casilla ${p.casilla}`;
      const report =
        `${width}×${height} «${REASON_TEXT[reason]}» · pie ${footerBefore} → ${footerBox()} · antes ${show(before)} · +100 ms ${show(at100)} · ` +
        `+1500 ms ${show(at1500)} · resuelto ${show(resolved)}`;
      console.warn(`[REP14-06 pie] ${report}`);
      await expect(at100, `${report}: dy=0 a los 100 ms`).toEqual(before);
      await expect(at1500, `${report}: dy=0 a los 1500 ms`).toEqual(before);
      await expect(resolved, `${report}: dy=0 al resolverse`).toEqual(before);
    },
  };
}

const meta = {
  args: {
    canCreateProduct: true,
    context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    // Sin duplicados (como `c12-foot`): sin la línea «No se pudo comprobar…» el pie arranca sin motivos.
    duplicateFetcher: async () => [],
    lastUnitCostFetcher: async () => null,
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher: async () => [],
    response: footerResponse,
    supplierFetcher: noSuppliers,
  },
  component: InvoiceReviewPanel,
  decorators: [
    (Story, context) => {
      const supplierName = (context.parameters.supplierName as string | undefined) ?? NAME_30;
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      queryClient.setQueryData(purchaseSuppliersQueryKeys.detail(REVIEW_SUPPLIER_ID), {
        id: REVIEW_SUPPLIER_ID,
        isActive: true,
        name: supplierName,
        taxId: "J-50203040-1",
      });
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
  beforeEach() {
    MockDate.reset();
  },
  parameters: { layout: "fullscreen" },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP14-06 proveedor entero y pie estable",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Proveedor30a320 = supplierStory(320, 640, NAME_30);
export const Proveedor30a390 = supplierStory(390, 844, NAME_30);
export const Proveedor30a768 = supplierStory(768, 1024, NAME_30);
export const Proveedor30a1024x1366 = supplierStory(1024, 1366, NAME_30);
export const Proveedor30a1280 = supplierStory(1280, 900, NAME_30);
export const Proveedor30a1440 = supplierStory(1440, 900, NAME_30);
export const Proveedor45a320 = supplierStory(320, 640, NAME_45);
export const Proveedor45a390 = supplierStory(390, 844, NAME_45);
export const Proveedor45a768 = supplierStory(768, 1024, NAME_45);
export const Proveedor45a1024x1366 = supplierStory(1024, 1366, NAME_45);
export const Proveedor45a1280 = supplierStory(1280, 900, NAME_45);
export const Proveedor45a1440 = supplierStory(1440, 900, NAME_45);
export const PieFecha1024 = footerStory(1024, 1366, "fecha");
export const PieSinFecha1024 = footerStory(1024, 1366, "sinFecha");
export const PieProveedor1024 = footerStory(1024, 1366, "proveedor");
export const PieFecha1280 = footerStory(1280, 900, "fecha");
export const PieSinFecha1280 = footerStory(1280, 900, "sinFecha");
export const PieProveedor1280 = footerStory(1280, 900, "proveedor");
export const PieFecha390 = footerStory(390, 844, "fecha");
export const PieSinFecha390 = footerStory(390, 844, "sinFecha");
export const PieProveedor390 = footerStory(390, 844, "proveedor");
