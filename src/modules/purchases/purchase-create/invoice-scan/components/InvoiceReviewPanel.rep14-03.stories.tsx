/**
 * REP14-03 · D64 (M-p15B-1): en el campo de fecha nativo se teclea una fecha imposible (31/02, 31/11)
 * o se borra un segmento con Retroceso. El campo da `value=""` (`validity.badInput`): la revisión avisa
 * en la línea reservada del motivo, sin mover las filas, y Cargar queda bloqueado. Si se borra entera la
 * fecha leída, Cargar pide marcar «Registrar sin fecha».
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep14-03.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay teclado real y la comprobación se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, fn, screen, waitFor } from "storybook/test";

import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";

import { makeReviewResponse, REVIEW_SCAN_ID, REVIEW_SUPPLIER_ID, REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { clickElement, pressKeys } from "./InvoiceReviewPanel.cdpInput";

const SUPPLIER_NAME = "Chevere Depot";

// Exenta: 1 × 1.750 cuadra con el total leído; con el proveedor confirmado Cargar está habilitado.
const response = makeReviewResponse({
  extraction: { date: "2026-10-17", total: 1750 },
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

function loadButton() {
  return screen.getByRole("button", { name: "Cargar en la compra" });
}

function dateInput() {
  return screen.getByLabelText("Fecha") as HTMLInputElement;
}

function rowTops() {
  return Array.from(panel().querySelectorAll<HTMLElement>("li[data-line-index]")).map((row) =>
    Math.round(row.getBoundingClientRect().top),
  );
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
  await waitFor(() => expect(loadButton()).toBeEnabled());
  await sleep(300);
  return browser;
}

/** Orden de los segmentos del campo nativo según el idioma del navegador (dd/mm/aaaa o mm/dd/aaaa). */
function segmentOrder(): ("day" | "month" | "year")[] {
  return new Intl.DateTimeFormat(navigator.language, { day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(new Date(2026, 9, 17))
    .map((part) => part.type)
    .filter((type): type is "day" | "month" | "year" => type === "day" || type === "month" || type === "year");
}

/** Teclea día, mes y año en el campo con el teclado real (CDP; entra con Tab desde el número de factura). */
async function typeDate(browser: Browser, day: string, month: string, year: string) {
  const parts = { day, month, year };
  screen.getByLabelText("Número de factura").focus();
  await pressKeys(browser, `{Tab}${segmentOrder().map((segment) => parts[segment]).join("")}{Tab}`);
}

async function snapshot(browser: Browser, name: string) {
  // Vite expone `import.meta.env`; el tsconfig de la app no lo tipa.
  if ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_REP14_03_SHOTS === "1") {
    await browser.page.screenshot({ path: `__rep14-03__/${name}.png` });
  }
}

function state(label: string) {
  const date = dateInput();
  const report =
    `${label}: value="${date.value}" badInput=${date.validity.badInput} aria-invalid=${date.getAttribute("aria-invalid")} ` +
    `motivo «${date.closest(".space-y-2")?.parentElement?.querySelector(":scope > p")?.textContent ?? ""}» ` +
    `Cargar=${!loadButton().hasAttribute("disabled")}`;
  console.warn(`[REP14-03] ${report}`);
  return report;
}

function badDateStory(width: number, height: number, day: string, month: string, name: string): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const before = rowTops();
      await typeDate(browser, day, month, "2026");
      await sleep(300);
      const report = state(`${name} ${width}×${height}`);
      await snapshot(browser, `${name}-${width}`);
      await expect(dateInput().validity.badInput, report).toBe(true);
      await expect(dateInput(), report).toHaveAttribute("aria-invalid", "true");
      await expect(dateInput(), report).toHaveAccessibleDescription(/no existe o está incompleta/);
      await expect(loadButton(), report).toBeDisabled();
      await expect(rowTops(), `${report}: las filas no se mueven`).toEqual(before);
    },
  };
}

/** Retroceso sobre el primer segmento y Tab: el campo queda a medias (dd/10/2026 o mm/17/2026). */
function backspaceStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      screen.getByLabelText("Número de factura").focus();
      await pressKeys(browser, "{Tab}{Backspace}{Tab}");
      await sleep(300);
      const report = state(`borrado ${width}×${height}`);
      await snapshot(browser, `borra-${width}`);
      await expect(dateInput(), report).toHaveAttribute("aria-invalid", "true");
      await expect(loadButton(), report).toBeDisabled();
    },
  };
}

/** Borrar los tres segmentos (fecha leída borrada a propósito): se pide confirmar registrar sin fecha. */
function clearStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      screen.getByLabelText("Número de factura").focus();
      await pressKeys(browser, "{Tab}{Backspace}{Tab}{Backspace}{Tab}{Backspace}");
      await sleep(300);
      const report = state(`vaciada ${width}×${height}`);
      await expect(dateInput().value, report).toBe("");
      await expect(dateInput(), report).not.toHaveAttribute("aria-invalid");
      await expect(loadButton(), report).toBeDisabled();
      const confirm = screen.getByRole("checkbox", { name: /Registrar sin fecha \(se leyó 17\/10\/2026\)/ });
      await snapshot(browser, `vaciada-${width}`);
      await clickElement(browser, confirm);
      await waitFor(() => expect(loadButton()).toBeEnabled());
      state(`vaciada y confirmada ${width}×${height}`);
    },
  };
}

const meta = {
  args: {
    canCreateProduct: true,
    context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
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
      // El marco de AppShell (como la historia de REP14-02): menú lateral desde lg y `<main>`.
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
  parameters: { layout: "fullscreen" },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP14-03 fecha imposible o borrada",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fecha3102x1280 = badDateStory(1280, 900, "31", "02", "3102");
export const Fecha3102x390 = badDateStory(390, 844, "31", "02", "3102");
export const Fecha3111x1280 = badDateStory(1280, 900, "31", "11", "3111");
export const Fecha3111x390 = badDateStory(390, 844, "31", "11", "3111");
export const Retroceso1280 = backspaceStory(1280, 900);
export const Retroceso390 = backspaceStory(390, 844);
export const Vaciada1280 = clearStory(1280, 900);
export const Vaciada390 = clearStory(390, 844);
