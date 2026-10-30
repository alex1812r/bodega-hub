/**
 * REP16-01b · D67(a): regresiones de las causas que dejaban rojo el test de propiedad de REP16-02 tras REP16-01.
 *
 * 1. El turno del usuario era una ventana fija de 250 ms tras cualquier clic: lo que llegaba en ella (la tasa justo
 *    después de resolver una fila) crecía sin retenerse. Caso `pares11:rate:ok` de `estados` a 1024×1366 y 1280.
 * 2. Con un campo enfocado (el buscador abierto) nada se retenía, aunque nadie tecleara. Caso `buscador0` a 390.
 * 3. En la lista de motivos del pie, «Marca el aviso de factura duplicada» iba tras los motivos que llegan o se van (tasa,
 *    fallo de duplicados): se movía ±16 px. Caso `pares2` de `estadosImpresa` a 768.
 * 4. Con la tasa pendiente, el motivo del costo desviado se reservaba con 3 renglones fijos: medía 48 px y llegaba con
 *    32 (1280) o 64 (390). Ahora la reserva es su texto: mide lo mismo antes y después de la tasa.
 * 5. Riesgo del recorte: un aviso que crece solo (aquí, con una tasa de cifras más largas que las reservadas) se recorta
 *    hasta el primer gesto; mientras, su fila sigue pendiente y «Cargar» bloqueado (el pie la cuenta), y la rueda lo
 *    suelta entero.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep16-01b.stories.tsx`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { expect, waitFor } from "storybook/test";

import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";

import { REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { compactList } from "./InvoiceReviewPanel.cdpInput";
import { CASES, type FixtureId } from "./InvoiceReviewPanel.rep16-02.cases";
import { FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import { CaseHost, harnessHandlers, runCase, VIEWPORTS } from "./InvoiceReviewPanel.rep16-02.harness";

async function loadBrowser() {
  if (!("__vitest_browser__" in globalThis)) {
    return null;
  }
  return import("vitest/browser").catch(() => null);
}

async function prepare(viewport: keyof typeof VIEWPORTS) {
  const browser = await loadBrowser();
  if (!browser) {
    return false;
  }
  const [width, height] = VIEWPORTS[viewport];
  await browser.page.viewport(width, height);
  const hideDevtools = document.createElement("style");
  hideDevtools.textContent = ".tsqd-parent-container { display: none !important; }";
  document.head.append(hideDevtools);
  return true;
}

/** Un caso del test de propiedad (por su prefijo de id) a un ancho: ningún control se mueve. */
function caseStory(list: keyof typeof CASES, fixture: FixtureId, id: string, viewport: keyof typeof VIEWPORTS): Story {
  return {
    play: async () => {
      if (!(await prepare(viewport))) {
        return;
      }
      const reviewCase = CASES[list].find((item) => item.id.startsWith(`${id}:`) || item.id === id);
      if (!reviewCase) {
        throw new Error(`Sin caso ${id} en ${list}`);
      }
      const moved = await runCase(FIXTURES[fixture], reviewCase);
      console.warn(`[REP16-01b] ${viewport} ${reviewCase.id}: ${moved.join(" | ") || "nada se movió"}`);
      await expect(moved).toEqual([]);
    },
  };
}

const RATE_EVENT = "rep16-01b:system-rate";
const noSuppliers: EntityFetcher<"contact"> = async () => [];
const noop = () => undefined;

/** La factura `estados` sin tasa del día al abrir; la tasa llega con `RATE_EVENT`. */
function LateRateHost() {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(invoiceScanQueryKeys.images(FIXTURES.estados.response.scanId), []);
    return client;
  });
  const [systemRateVes, setSystemRateVes] = useState<number | undefined>(undefined);
  useEffect(() => {
    const onRate = (event: Event) => setSystemRateVes((event as CustomEvent<number>).detail);
    window.addEventListener(RATE_EVENT, onRate);
    return () => window.removeEventListener(RATE_EVENT, onRate);
  }, []);
  const context = { taxRates: REVIEW_TAX_RATES, ...(systemRateVes === undefined ? {} : { systemRateVes }) };
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <div aria-hidden className="app-sidebar fixed inset-y-0 left-0 hidden bg-sidebar lg:block" />
        <div className="app-shell-content flex min-h-0 min-w-0 flex-1 flex-col" data-sidebar-collapsed="false">
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-surface px-4 py-6 lg:px-6">
            <div className="space-y-6 pb-8">
              <InvoiceReviewPanel
                canCreateProduct
                context={context}
                duplicateFetcher={async () => []}
                onDiscard={noop}
                onLoad={noop}
                onRescan={noop}
                response={FIXTURES.estados.response}
                supplierFetcher={noSuppliers}
              />
            </div>
          </main>
        </div>
      </div>
    </QueryClientProvider>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila ${index}`);
  }
  return element;
}

/** Filas de `estados` que se desvían con la tasa del día (Harina a 4.500 Bs y Azúcar a 640, último 0,50 REF). */
const DEVIATING_ROWS = [4, 5] as const;

function notices(index: number) {
  const list = row(index).querySelector('[data-testid="invoice-review-line-notices"]');
  if (!list) {
    throw new Error(`Sin avisos en la fila ${index}`);
  }
  return list;
}

/** El motivo del costo desviado se ve (no el reservado invisible). */
function reasonShown(index: number) {
  return [...notices(index).children].some(
    (item) => /El costo sale a/.test(item.textContent ?? "") && item.checkVisibility({ visibilityProperty: true }),
  );
}

async function arriveRate(rate: number) {
  window.dispatchEvent(new CustomEvent(RATE_EVENT, { detail: rate }));
  await waitFor(() => expect(DEVIATING_ROWS.every(reasonShown)).toBe(true), { timeout: 4000 });
  await sleep(300);
}

/** (4) Lo reservado para el motivo mide lo que mide el motivo al llegar la tasa (900: cifras de igual largo). */
function reserveStory(viewport: keyof typeof VIEWPORTS): Story {
  return {
    play: async () => {
      if (!(await prepare(viewport))) {
        return;
      }
      await waitFor(() => expect(row(8)).toBeInTheDocument());
      await sleep(400);
      const before = DEVIATING_ROWS.map((index) => Math.round(notices(index).getBoundingClientRect().height));
      await arriveRate(900);
      const after = DEVIATING_ROWS.map((index) => Math.round(notices(index).getBoundingClientRect().height));
      console.warn(`[REP16-01b reserva] ${viewport}: avisos L4/L5 ${before.join("/")} → ${after.join("/")} px`);
      await expect(after).toEqual(before);
    },
  };
}

/** Avisos de las filas recortados u ocultos por useLayoutHold (estilo en línea). */
function clippedNotices() {
  return [...document.querySelectorAll<HTMLElement>('[data-layout-box^="row:"] [data-layout-notice]')].filter(
    (notice) => notice.style.display === "none" || notice.style.maxHeight !== "",
  );
}

/**
 * (5) La tasa del día llega con cifras más largas que las de lo reservado (`rate`): el motivo de alguna fila crece y se
 * recorta. Mientras, su fila sigue pendiente (reconocer el costo) y «Cargar» bloqueado (el pie lo dice); REP17-17 (D72):
 * la rueda ya no lo suelta, «Compactar lista» sí, entero y visible.
 */
function clipRiskStory(viewport: keyof typeof VIEWPORTS, rate: number): Story {
  return {
    render: () => <LateRateHost />,
    play: async () => {
      if (!(await prepare(viewport))) {
        return;
      }
      await waitFor(() => expect(row(8)).toBeInTheDocument());
      await sleep(400);
      const before = DEVIATING_ROWS.map((index) => Math.round(notices(index).getBoundingClientRect().height));
      await arriveRate(rate);
      const after = DEVIATING_ROWS.map((index) => Math.round(notices(index).getBoundingClientRect().height));
      const clipped = clippedNotices();
      const clippedRows = clipped.map((notice) => notice.closest<HTMLElement>("li[data-line-index]"));
      const where = clippedRows.map((item) => `L${item?.dataset.lineIndex}`).join(", ") || "ninguna";
      console.warn(`[REP16-01b recorte] ${viewport} tasa ${rate}: avisos L4/L5 ${before.join("/")} → ${after.join("/")} px; recortados en ${where}`);
      await expect(clipped.length, "algún motivo crece más allá de lo reservado y se recorta").toBeGreaterThan(0);
      for (const item of clippedRows) {
        await expect(item?.dataset.status).toMatch(/^pending_/);
      }
      const load = document.querySelector<HTMLButtonElement>("[data-load-button]");
      await expect(load?.disabled).toBe(true);
      await expect(document.querySelector('[data-testid="invoice-review-blockers"]')?.textContent ?? "").toMatch(/por resolver/);
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 1 }));
      await sleep(200);
      await expect(clippedNotices().length, "la rueda no suelta el recorte (D72)").toBe(clipped.length);
      const browser = await loadBrowser();
      if (browser) {
        await compactList(browser);
      }
      await waitFor(() => expect(clippedNotices()).toEqual([]));
      for (const notice of clipped) {
        await expect(notice.scrollHeight - notice.clientHeight).toBeLessThan(1);
      }
      await expect(DEVIATING_ROWS.every(reasonShown)).toBe(true);
    },
  };
}

const meta = {
  component: CaseHost,
  parameters: { layout: "fullscreen", msw: { handlers: harnessHandlers } },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP16-01b lo asíncrono no mueve controles (causas)",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TasaTrasResolver1024: Story = caseStory("estados", "estados", "pares11", "w1024x1366");
export const TasaTrasResolver1280: Story = caseStory("estados", "estados", "pares11", "w1280");
export const BuscadorEnfocado390: Story = caseStory("estadosBuscador", "estados", "buscador0", "w390");
export const PieFalloDuplicados768: Story = caseStory("estadosImpresa", "estadosImpresa", "pares2", "w768");
export const ReservaDelMotivo390: Story = { ...reserveStory("w390"), render: () => <LateRateHost /> };
export const ReservaDelMotivo1024: Story = { ...reserveStory("w1024x1366"), render: () => <LateRateHost /> };
export const ReservaDelMotivo1280: Story = { ...reserveStory("w1280"), render: () => <LateRateHost /> };
/** Tasa absurda a propósito: «5.000.000.000,00 REF» es más largo que lo reservado y fuerza el recorte. */
const CLIP_RATE = 0.0000009;
export const RecorteNoDejaCargar390: Story = clipRiskStory("w390", CLIP_RATE);
export const RecorteNoDejaCargar1024: Story = clipRiskStory("w1024x1366", CLIP_RATE);
