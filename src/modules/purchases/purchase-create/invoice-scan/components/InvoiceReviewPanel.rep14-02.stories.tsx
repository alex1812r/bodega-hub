/**
 * REP14-02 · D63/D64 (M-p15-2, B-p15B-1): la revisión dentro del marco real de la aplicación (menú
 * lateral de 288 px desde 1024 y el relleno de `<main>`). A 320–1440 px de ancho, proveedor, número,
 * fecha (con el año) y el costo de cada línea caben enteros en su campo; y a 1024 y 1280 el motivo de
 * una fecha inválida cabe en su línea reservada: al aparecer no baja las filas.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep14-02.stories.tsx`
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

/** f05 de la pasada 15: Mercaseu, costos de 4 cifras con decimales. */
const SUPPLIER_NAME = "Mercaseu 2030, C.A.";
const INVOICE_NUMBER = "00-0123456";

const response = makeReviewResponse({
  extraction: { date: "2026-08-13", number: INVOICE_NUMBER, supplier: { name: SUPPLIER_NAME, taxId: "J-50203040-1" } },
  lines: [
    doubtfulLine(1, 0.72, { read: { description: "Malta 1.5L", lineTotal: 37681.8, quantity: 12, rawText: "MALTA 1.5L", unitPrice: 3140.15 } }),
    doubtfulLine(2, 0.72, { read: { description: "Harina P.A.N. 1kg", lineTotal: 23560.5, quantity: 25, rawText: "HARINA PAN 1KG", unitPrice: 942.42 } }),
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

function panel() {
  const element = document.querySelector<HTMLElement>('[data-testid="invoice-review-panel"]');
  if (!element) {
    throw new Error("Sin panel de revisión");
  }
  return element;
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
  await waitFor(() => expect(screen.getByRole("combobox", { name: /proveedor/i })).toHaveValue(SUPPLIER_NAME));
  await sleep(300);
  return browser;
}

/** Ancho del texto con la fuente del campo. */
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

type FieldReport = { label: string; width: number; fits: boolean; detail: string };

function textField(label: string, input: HTMLInputElement): FieldReport {
  const needed = textWidth(input.value, input);
  const room = contentWidth(input);
  return {
    detail: `ancho ${Math.round(input.getBoundingClientRect().width)} px, texto «${input.value}» ${Math.round(needed)} px en ${Math.round(room)} px, scrollWidth ${input.scrollWidth}/${input.clientWidth}`,
    fits: input.scrollWidth <= input.clientWidth && needed <= room,
    label,
    width: input.getBoundingClientRect().width,
  };
}

/** Campo de fecha nativo: «13/08/2026» (o su forma del idioma) más el icono del calendario (~24 px). */
function dateField(input: HTMLInputElement): FieldReport {
  const needed = textWidth("00/00/0000", input) + 24;
  const room = contentWidth(input);
  return {
    detail: `ancho ${Math.round(input.getBoundingClientRect().width)} px, «${input.value}» necesita ${Math.round(needed)} px con el calendario, hay ${Math.round(room)} px`,
    fits: needed <= room,
    label: "Fecha",
    width: input.getBoundingClientRect().width,
  };
}

function measureFields(): FieldReport[] {
  const supplier = screen.getByRole("combobox", { name: /proveedor/i }) as HTMLInputElement;
  const number = screen.getByLabelText("Número de factura") as HTMLInputElement;
  const date = screen.getByLabelText("Fecha") as HTMLInputElement;
  const costs = screen.getAllByLabelText(/^Costo \(/) as HTMLInputElement[];
  return [
    textField("Proveedor", supplier),
    textField("Número", number),
    dateField(date),
    ...costs.map((cost, index) => textField(`Costo L${index + 1}`, cost)),
  ];
}

function fieldsStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const fields = measureFields();
      await snapshot(browser, `campos-${width}`);
      const report = fields.map((field) => `${field.label}: ${field.detail}${field.fits ? "" : " · CORTADO"}`).join(" | ");
      console.warn(`[REP14-02 campos ${width}×${height}] ${report}`);
      await expect(fields.filter((field) => !field.fits).map((field) => field.label), `${width}×${height}: ${report}`).toEqual([]);
    },
  };
}

/** Captura para la evidencia (con `VITE_REP14_02_SHOTS=1`; Vitest la guarda junto a la historia). */
async function snapshot(browser: NonNullable<Awaited<ReturnType<typeof loadBrowser>>>, name: string) {
  // Vite expone `import.meta.env`; el tsconfig de la app no lo tipa.
  if ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_REP14_02_SHOTS === "1") {
    await browser.page.screenshot({ path: `__rep14-02__/${name}.png` });
  }
}

function rowTops() {
  return Array.from(panel().querySelectorAll<HTMLElement>("li[data-line-index]")).map((row) =>
    Math.round(row.getBoundingClientRect().top),
  );
}

/** Teclea la fecha como lo deja el campo nativo con el año 0026 (B-p15B-1). */
function typeDate(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function dateReasonStory(width: number, height: number): Story {
  return {
    play: async () => {
      const browser = await prepare(width, height);
      if (!browser) {
        return;
      }
      const date = screen.getByLabelText("Fecha") as HTMLInputElement;
      // La línea reservada del motivo: el `<p>` hermano del campo (Input → su raíz `.space-y-2`).
      const reason = date.closest(".space-y-2")?.parentElement?.querySelector<HTMLElement>(":scope > p");
      const lines = panel().querySelector<HTMLElement>('section[aria-label="Líneas de la factura"]');
      const reserved = reason?.getBoundingClientRect().height ?? 0;
      const before = rowTops();
      const sectionBefore = Math.round(lines?.getBoundingClientRect().top ?? 0);
      typeDate(date, "0026-10-17");
      const message = await screen.findByText(/debe ser de un año entre/);
      await sleep(100);
      const at100 = rowTops();
      await sleep(1400);
      const at1500 = rowTops();
      await snapshot(browser, `motivo-${width}`);
      const sectionAfter = Math.round(lines?.getBoundingClientRect().top ?? 0);
      const shown = message.getBoundingClientRect().height;
      const report =
        `${width}×${height} · línea reservada ${Math.round(reserved)} px, motivo ${Math.round(shown)} px · ` +
        `filas antes ${before.join(",")} · +100 ms ${at100.join(",")} · +1500 ms ${at1500.join(",")} · ` +
        `sección de líneas ${sectionBefore} → ${sectionAfter}`;
      console.warn(`[REP14-02 motivo fecha] ${report}`);
      await expect(at100, `${report}: dy=0 a los 100 ms`).toEqual(before);
      await expect(at1500, `${report}: dy=0 a los 1500 ms`).toEqual(before);
      await expect(sectionAfter, report).toBe(sectionBefore);
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
      // El marco de AppShell: menú lateral abierto (18rem desde lg, `.app-shell-content`) y `<main>`.
      return (
        <QueryClientProvider client={queryClient}>
          <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div
              aria-hidden
              className="app-sidebar fixed inset-y-0 left-0 hidden bg-sidebar lg:block"
              data-testid="rep14-02-sidebar"
            />
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
  title: "Modules/Purchases/InvoiceReviewPanel/REP14-02 cabecera con menú lateral",
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Campos320 = fieldsStory(320, 844);
export const Campos390 = fieldsStory(390, 844);
export const Campos768 = fieldsStory(768, 1024);
export const Campos1024x1366 = fieldsStory(1024, 1366);
export const Campos1152 = fieldsStory(1152, 900);
export const Campos1232 = fieldsStory(1232, 900);
export const Campos1280 = fieldsStory(1280, 900);
export const Campos1440 = fieldsStory(1440, 900);
export const MotivoFecha1024x1366 = dateReasonStory(1024, 1366);
export const MotivoFecha1280 = dateReasonStory(1280, 900);
export const MotivoFecha390 = dateReasonStory(390, 844);
