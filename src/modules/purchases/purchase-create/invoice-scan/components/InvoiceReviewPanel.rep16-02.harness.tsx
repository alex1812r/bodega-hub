/**
 * REP16-02 · D67(b): arnés del test de propiedad del panel de revisión (solo lo importan sus historias).
 *
 * Monta el panel (dentro del marco de AppShell, como `rep15-01.stories`) con TODAS las fuentes asíncronas retenidas en
 * puertas que el caso suelta en su orden: nombre del proveedor (MSW, 200 o 500), compra del escaneo duplicado (MSW,
 * 200 o 500), duplicados (fetcher: vacíos, con uno o rechazo), tasa del día (la página la pasa en `context`; su error
 * es que no llega), candidatos del buscador (fetcher: lista o rechazo) y último costo (fetcher: valor, `null` o
 * rechazo). Nada depende del reloj: cada llegada espera a que el panel haya pedido esa fuente, la suelta y espera a que
 * el DOM quede quieto (sin mutaciones durante varios frames y sin consulta en vuelo de esa fuente).
 *
 * Propiedad: tras el primer render (o tras la última acción del usuario, que sí puede mover), el `top` en la ventana de
 * CADA control interactivo de las filas, del aviso tras las líneas y del pie no cambia en NINGÚN frame de ninguna
 * llegada. La página está arriba y nadie desplaza, teclea ni mueve el puntero (nada suelta lo retenido).
 * REP17-03 (D70(b)): con el alcance «panel» se mide TODO el panel (también la cabecera y el visor); lo usan las
 * historias `InvoiceReviewPanel.rep17-03.*`, que además montan sus escenarios con las piezas exportadas aquí.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { useSyncExternalStore } from "react";
import { expect } from "storybook/test";

import type { InvoiceDuplicateMatch } from "@/modules/invoice-scan/contracts";
import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type { EntityFetcher, ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import { REVIEW_TAX_RATES } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { type Arrival, type CASES, chunkOf, type FixtureId, type ReviewCase, type SourceId } from "./InvoiceReviewPanel.rep16-02.cases";
import { DUPLICATE_MATCH, ESTADOS_ROWS, type Fixture, FIXTURES, LAST_COST_REF, SEARCH_PRODUCTS } from "./InvoiceReviewPanel.rep16-02.fixtures";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // Una puerta que nadie llega a esperar no deja un rechazo sin manejar.
  promise.catch(() => undefined);
  return { promise, reject, resolve };
}

/** Lo que el panel ha pedido y las puertas de cada fuente en el caso montado. */
type Runtime = {
  seq: number;
  fixture: Fixture;
  queryClient: QueryClient;
  systemRateVes: number | undefined;
  asked: Record<Exclude<SourceId, "rate">, number>;
  supplier: Deferred<"ok" | "fail">;
  purchase: Deferred<"ok" | "fail">;
  duplicates: Deferred<InvoiceDuplicateMatch[]>;
  candidates: Deferred<ProductEntityOption[]>;
  lastCost: Deferred<number | null>;
};

let runtime: Runtime | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): Runtime {
  if (!runtime) {
    throw new Error("Sin caso montado");
  }
  return runtime;
}

const duplicateFetcher = () => {
  const state = current();
  state.asked.duplicates += 1;
  return state.duplicates.promise;
};

const lastUnitCostFetcher = () => {
  const state = current();
  state.asked.lastCost += 1;
  return state.lastCost.promise;
};

const productFetcher: EntityFetcher<"product"> = () => {
  const state = current();
  state.asked.candidates += 1;
  return state.candidates.promise;
};

const noSuppliers: EntityFetcher<"contact"> = async () => [];
const noop = () => undefined;

/** Monta el caso del `runtime` (otro `seq`: otro árbol, con su QueryClient). */
export function CaseHost() {
  const state = useSyncExternalStore(subscribe, () => runtime, () => null);
  if (!state) {
    return <div data-rep16-02-host="vacío" />;
  }
  const { fixture } = state;
  const context = { taxRates: REVIEW_TAX_RATES, ...(state.systemRateVes === undefined ? {} : { systemRateVes: state.systemRateVes }) };
  return (
    <QueryClientProvider client={state.queryClient} key={state.seq}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground" data-rep16-02-case={state.seq}>
        <div aria-hidden className="app-sidebar fixed inset-y-0 left-0 hidden bg-sidebar lg:block" />
        <div className="app-shell-content flex min-h-0 min-w-0 flex-1 flex-col" data-sidebar-collapsed="false">
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-surface px-4 py-6 lg:px-6">
            <div className="space-y-6 pb-8">
              <InvoiceReviewPanel
                canCreateProduct
                context={context}
                duplicateFetcher={duplicateFetcher}
                lastUnitCostFetcher={lastUnitCostFetcher}
                onDiscard={noop}
                onLoad={noop}
                onRescan={noop}
                productFetcher={productFetcher}
                response={fixture.response}
                supplierFetcher={noSuppliers}
              />
            </div>
          </main>
        </div>
      </div>
    </QueryClientProvider>
  );
}

/** Handlers de MSW de la historia: proveedor y compra del duplicado esperan su puerta. */
export const harnessHandlers = [
  http.get("/api/purchases/suppliers", async ({ request }) => {
    if (!new URL(request.url).searchParams.has("id") || !runtime) {
      return HttpResponse.json({ data: [] });
    }
    const state = runtime;
    state.asked.supplier += 1;
    if ((await state.supplier.promise) === "fail") {
      return HttpResponse.json(
        { error: { code: "UNKNOWN_ERROR", message: "No se pudo leer el proveedor de la factura: la conexión se cortó." } },
        { status: 500 },
      );
    }
    const contactId = state.fixture.response.matched.supplier.contactId ?? "";
    return HttpResponse.json({ data: { id: contactId, isActive: true, name: state.fixture.supplierName, taxId: state.fixture.response.extraction.supplier.taxId } });
  }),
  http.get("/api/purchases/invoice-scan/:scanId", async () => {
    if (!runtime) {
      return HttpResponse.json({ data: { purchaseId: null } });
    }
    const state = runtime;
    state.asked.purchase += 1;
    if ((await state.purchase.promise) === "fail") {
      return HttpResponse.json({ error: { code: "UNKNOWN_ERROR", message: "Sin conexión" } }, { status: 500 });
    }
    return HttpResponse.json({ data: { purchaseId: "7c2a3b4d-5e6f-4a7b-8c9d-160200000c02" } });
  }),
];

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** Frames seguidos sin mutaciones para dar el DOM por quieto (React confirma en el mismo frame que recibe el dato). */
const QUIET_FRAMES = 2;
const SETTLE_TIMEOUT_MS = 4000;

/**
 * Espera a que `ready()` se cumpla y el DOM (incluidas las capas flotantes) no cambie durante QUIET_FRAMES frames;
 * `onFrame` corre en cada frame (el muestreo de posiciones).
 */
export async function settle(what: string, ready: () => boolean = () => true, onFrame: () => void = noop) {
  let mutated = true;
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !(record.target instanceof Element && record.target.closest(".tsqd-parent-container")))) {
      mutated = true;
    }
  });
  observer.observe(document.body, { attributes: true, characterData: true, childList: true, subtree: true });
  const start = performance.now();
  let quiet = 0;
  try {
    while (quiet < QUIET_FRAMES) {
      await frame();
      onFrame();
      if (mutated || !ready()) {
        mutated = false;
        quiet = 0;
      } else {
        quiet += 1;
      }
      if (performance.now() - start > SETTLE_TIMEOUT_MS) {
        throw new Error(`El panel no se queda quieto (${what})`);
      }
    }
  } finally {
    observer.disconnect();
  }
}

async function until(what: string, condition: () => boolean) {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > SETTLE_TIMEOUT_MS) {
      throw new Error(`No llega: ${what}`);
    }
    await frame();
  }
}

export function panelRoot() {
  return document.querySelector<HTMLElement>('[data-testid="invoice-review-panel"]');
}

export function scroller() {
  const main = panelRoot()?.closest("main");
  if (!main) {
    throw new Error("Sin <main>");
  }
  return main;
}

export function row(index: number) {
  const element = panelRoot()?.querySelector<HTMLElement>(`li[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila ${index}`);
  }
  return element;
}

export function buttonIn(container: HTMLElement, name: RegExp) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => name.test(item.textContent ?? ""));
  if (!button) {
    throw new Error(`Sin botón ${name}`);
  }
  return button;
}

const CONTROL_SELECTOR =
  'button, a[href], input, select, textarea, [role="radio"], [role="checkbox"], [role="switch"], [role="option"], [tabindex]:not([tabindex="-1"])';

type Tracked = { element: Element; zone: string; name: string; top: number };

function nameOf(element: Element) {
  // REP17-03: los campos de la cabecera se nombran por su etiqueta («Tasa Bs por REF»).
  const label = element instanceof HTMLInputElement ? element.labels?.[0]?.textContent?.trim() : undefined;
  const text = element.getAttribute("aria-label") || label || element.textContent?.replace(/\s+/g, " ").trim() || element.getAttribute("placeholder") || "";
  return `${element.tagName.toLowerCase()}«${text.slice(0, 32)}»`;
}

function zoneOf(element: Element) {
  const line = element.closest("li[data-line-index]");
  if (line instanceof HTMLElement) {
    return `L${line.dataset.lineIndex}`;
  }
  if (element.closest('[data-layout-box="header"]')) {
    return "cabecera";
  }
  if (element.closest('aside[aria-label="Factura escaneada"]')) {
    return "visor";
  }
  return element.closest('[data-layout-box="footer"]') ? "pie" : "aviso";
}

/**
 * Qué se mide: «filas» (D67(b), REP16-02) las filas, el aviso tras las líneas y el pie; «panel» (D70(b), REP17-03)
 * todo el panel, cabecera y visor incluidos.
 */
export type Scope = "filas" | "panel";

/** Zonas medidas en el alcance: las filas (y el grupo de confirmadas), el aviso tras las líneas y el pie, o el panel. */
function zones(scope: Scope): Element[] {
  const root = panelRoot();
  if (scope === "panel") {
    if (!root) {
      throw new Error("Sin panel");
    }
    return [root];
  }
  const lines = root?.querySelector('section[aria-label="Líneas de la factura"]');
  const footer = root?.querySelector('[data-layout-box="footer"]');
  if (!lines || !footer) {
    throw new Error("Sin líneas o sin pie");
  }
  const notice = lines.nextElementSibling;
  return [lines, ...(notice && !notice.contains(footer) ? [notice] : []), footer];
}

function isVisible(box: DOMRect) {
  return box.width > 0 || box.height > 0;
}

function snapshot(scope: Scope): Tracked[] {
  return zones(scope).flatMap((zone) =>
    [...(zone.matches(CONTROL_SELECTOR) ? [zone] : []), ...zone.querySelectorAll(CONTROL_SELECTOR)].flatMap((element) => {
      const box = element.getBoundingClientRect();
      return isVisible(box) ? [{ element, name: nameOf(element), top: box.top, zone: zoneOf(element) }] : [];
    }),
  );
}

/** Mayor desplazamiento visto de cada control en la llegada en curso. */
type Moves = Map<Tracked, number>;

function sampleInto(tracked: Tracked[], moves: Moves) {
  for (const item of tracked) {
    if (!item.element.isConnected) {
      continue;
    }
    const box = item.element.getBoundingClientRect();
    if (!isVisible(box)) {
      continue;
    }
    const delta = box.top - item.top;
    if (Math.abs(delta) > 0.5 && Math.abs(delta) > Math.abs(moves.get(item) ?? 0)) {
      moves.set(item, delta);
    }
  }
}

function newRuntime(fixture: Fixture): Runtime {
  seq += 1;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(invoiceScanQueryKeys.images(fixture.response.scanId), []);
  return {
    asked: { candidates: 0, duplicates: 0, lastCost: 0, purchase: 0, supplier: 0 },
    candidates: deferred(),
    duplicates: deferred(),
    fixture,
    lastCost: deferred(),
    purchase: deferred(),
    queryClient,
    seq,
    supplier: deferred(),
    systemRateVes: undefined,
  };
}

/** La consulta respondió con el resultado del caso (200 → éxito, 500 → error) y ya no está en vuelo. */
function answered(key: readonly unknown[], outcome: "ok" | "fail") {
  const query = current().queryClient.getQueryCache().find({ exact: true, queryKey: key });
  if (!query || query.state.fetchStatus === "fetching") {
    return false;
  }
  // Sin nadie mirándola (p. ej. el aviso del duplicado ya se fue) la petición se cancela y no hay nada que pintar.
  return query.getObserversCount() === 0 || query.state.status === (outcome === "fail" ? "error" : "success");
}

/** El panel adoptó la tasa del día: la cabecera lo dice (con impresa distinta, «hoy es …»). */
const rateAdopted = () => /Llegó la tasa del día|hoy es/.test(panelRoot()?.textContent ?? "");

/**
 * Suelta una fuente (cuando el panel ya la pidió) y devuelve cuándo su efecto está confirmado (`adopted`: cuándo lo
 * está el de la tasa, si el escenario lo ve de otra forma).
 */
async function release(arrival: Arrival, adopted: () => boolean = rateAdopted): Promise<() => boolean> {
  const state = current();
  const { outcome, source } = arrival;
  if (source === "rate") {
    // Otro objeto: `useSyncExternalStore` solo repinta si cambia la instantánea.
    runtime = { ...state, systemRateVes: state.fixture.systemRateVes };
    emit();
    return adopted;
  }
  await until(`petición de ${source}`, () => state.asked[source] > 0);
  switch (source) {
    case "supplier": {
      const result = outcome === "fail" ? "fail" : "ok";
      state.supplier.resolve(result);
      const key = purchaseSuppliersQueryKeys.detail(state.fixture.response.matched.supplier.contactId ?? "");
      return () => answered(key, result);
    }
    case "purchase": {
      const result = outcome === "fail" ? "fail" : "ok";
      state.purchase.resolve(result);
      const key = ["invoice-scan", "purchase", state.fixture.response.matched.duplicateOfScanId ?? ""];
      return () => answered(key, result);
    }
    case "duplicates":
      if (outcome === "fail") {
        state.duplicates.reject(new Error("Sin conexión"));
      } else {
        state.duplicates.resolve(outcome === "match" ? [DUPLICATE_MATCH] : []);
      }
      return () => true;
    case "candidates":
      if (outcome === "fail") {
        state.candidates.reject(new Error("Sin conexión"));
      } else {
        state.candidates.resolve(SEARCH_PRODUCTS);
      }
      return () => true;
    case "lastCost":
      if (outcome === "fail") {
        state.lastCost.reject(new Error("Sin conexión"));
      } else {
        state.lastCost.resolve(outcome === "deviated" ? LAST_COST_REF.deviated : outcome === "aligned" ? LAST_COST_REF.aligned : null);
      }
      return () => true;
  }
}

/**
 * Acciones del usuario previas a la referencia (clic de DOM: sin puntero, no retiene el layout), cada una con el panel
 * quieto antes de la siguiente (la descarte o la resolución mueven el foco a otra fila). La página queda arriba; el
 * buscador se abre al final y se deja donde el panel lo deje (al enfocarlo puede desplazar: nadie más desplaza).
 */
async function prepareRows(fixture: Fixture, search: boolean) {
  if (fixture.id !== "tasa3") {
    buttonIn(row(ESTADOS_ROWS.discarded), /Descartar línea/).click();
    await settle("descartar");
    row(ESTADOS_ROWS.resolvedByUser).querySelector<HTMLButtonElement>("[data-candidate]")?.click();
    await settle("resolver");
  }
  await toTop();
  if (search) {
    buttonIn(row(ESTADOS_ROWS.search), /Buscar producto/).click();
    await settle("abrir el buscador");
  }
}

function pick() {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => /Arroz Mary 1kg/.test(item.textContent ?? ""));
  if (!option) {
    throw new Error("Sin «Arroz Mary 1kg» en el buscador");
  }
  option.click();
}

async function toTop() {
  const main = scroller();
  if (main.scrollTop !== 0) {
    main.scrollTop = 0;
  }
  await settle("arriba");
}

/** Por zona: cuántos controles, cuánto y un ejemplo (el de «Descartar» si se movió, el del caso M-p17B-1). */
function describeMoves(moves: Moves) {
  const byZone = new Map<string, [Tracked, number][]>();
  for (const entry of moves) {
    byZone.set(entry[0].zone, [...(byZone.get(entry[0].zone) ?? []), entry]);
  }
  return [...byZone]
    .map(([zone, entries]) => {
      const [item, delta] = entries.find(([tracked]) => /Descartar/.test(tracked.name)) ?? entries[0];
      const deltas = [...new Set(entries.map(([, value]) => Math.round(value)))].map((value) => (value > 0 ? `+${value}` : `${value}`));
      return `${zone} ×${entries.length} (${deltas.join("/")} px; p. ej. ${item.name} y=${Math.round(item.top)}→${Math.round(item.top + delta)})`;
    })
    .join("; ");
}

/** Monta `fixture` con todas sus fuentes retenidas, corre `body` con el panel ya quieto y lo desmonta. */
export async function withCase<T>(fixture: Fixture, body: () => Promise<T>): Promise<T> {
  runtime = newRuntime(fixture);
  const caseSeq = runtime.seq;
  emit();
  try {
    await until("panel montado", () => document.querySelector(`[data-rep16-02-case="${caseSeq}"] [data-testid="invoice-review-panel"]`) !== null);
    await settle("primer render");
    return await body();
  } finally {
    const finished = current();
    runtime = null;
    emit();
    // Lo que quedó retenido ya no tiene a nadie montado esperando.
    finished.supplier.resolve("ok");
    finished.purchase.resolve("ok");
    finished.duplicates.resolve([]);
    finished.candidates.resolve([]);
    finished.lastCost.resolve(null);
    finished.queryClient.clear();
  }
}

/**
 * Suelta una llegada con la referencia justo antes (también lo que trajo una anterior) y devuelve qué controles del
 * alcance se movieron en algún frame hasta quedar quieto (`null`: ninguno).
 */
export async function measureArrival(arrival: Arrival, scope: Scope, adopted?: () => boolean): Promise<string | null> {
  const tracked = snapshot(scope);
  const moves: Moves = new Map();
  const confirmed = await release(arrival, adopted);
  await settle(`${arrival.source}:${arrival.outcome}`, confirmed, () => sampleInto(tracked, moves));
  return moves.size > 0 ? `tras ${arrival.source}:${arrival.outcome} se movieron ${moves.size} controles: ${describeMoves(moves)}` : null;
}

/** Suelta una llegada sin medirla (lo que prepara un escenario) y espera a que el panel quede quieto. */
export async function arrive(arrival: Arrival) {
  const confirmed = await release(arrival);
  await settle(`${arrival.source}:${arrival.outcome}`, confirmed);
}

/** Corre un caso y devuelve los controles que se movieron (vacío = cumple). */
export async function runCase(fixture: Fixture, reviewCase: ReviewCase, scope: Scope = "filas"): Promise<string[]> {
  return withCase(fixture, async () => {
    await prepareRows(fixture, reviewCase.search);
    const failures: string[] = [];
    for (const step of reviewCase.steps) {
      if (step.kind === "pick") {
        // Acción del usuario: puede mover; la referencia pasa a ser lo que queda tras ella.
        pick();
        await settle("elegir producto");
        continue;
      }
      const moved = await measureArrival(step.arrival, scope);
      if (moved) {
        failures.push(moved);
      }
    }
    return failures.map((failure) => `${fixture.id} · ${reviewCase.id} · ${failure}`);
  });
}

async function loadBrowser() {
  if (!("__vitest_browser__" in globalThis)) {
    return null;
  }
  return import("vitest/browser").catch(() => null);
}

const FIXTURE_OF: Record<keyof typeof CASES, FixtureId> = {
  estados: "estados",
  estadosBuscador: "estados",
  estadosImpresa: "estadosImpresa",
  tasa3: "tasa3",
};

/** Viewports de D67(b) y, de D70(b), el teléfono en horizontal (alto < 500 px: el pie no es fijo). */
export const VIEWPORTS = {
  w390: [390, 844],
  w768: [768, 1024],
  w1024x1366: [1024, 1366],
  w1280: [1280, 900],
  w844x390: [844, 390],
} as const;

/**
 * Pone la ventana de la historia en `viewport` y oculta las herramientas de React Query; `null` fuera de Vitest
 * (Storybook en el navegador: no hay viewport real y la medición se omite).
 */
export async function openViewport(viewport: keyof typeof VIEWPORTS) {
  const browser = await loadBrowser();
  if (!browser) {
    return null;
  }
  const [width, height] = VIEWPORTS[viewport];
  await browser.page.viewport(width, height);
  const hideDevtools = document.createElement("style");
  hideDevtools.textContent = ".tsqd-parent-container { display: none !important; }";
  document.head.append(hideDevtools);
  return { browser, label: `${width}×${height}` };
}

const TAG: Record<Scope, string> = { filas: "REP16-02", panel: "REP17-03 panel" };

/**
 * `play` de una historia: el tramo `chunk` de la lista `list` a ese ancho, midiendo `scope`; falla con los controles
 * movidos.
 */
export function propertyPlay(list: keyof typeof CASES, viewport: keyof typeof VIEWPORTS, chunk: number, scope: Scope = "filas") {
  return async () => {
    const opened = await openViewport(viewport);
    if (!opened) {
      return;
    }
    const cases = chunkOf(list, chunk);
    await expect(cases.length, `tramo ${chunk} de ${list} vacío`).toBeGreaterThan(0);
    const failures: string[] = [];
    let red = 0;
    for (const reviewCase of cases) {
      const moved = await runCase(FIXTURES[FIXTURE_OF[list]], reviewCase, scope);
      red += moved.length > 0 ? 1 : 0;
      failures.push(...moved.map((failure) => `${opened.label} ${failure}`));
    }
    // Una línea por llegada que movió algo (se puede contar y comparar entre corridas).
    failures.forEach((failure) => console.warn(`[${TAG[scope]} rojo] ${failure}`));
    const text = `${opened.label} ${list}#${chunk}: ${cases.length} casos, ${red} con controles movidos`;
    console.warn(`[${TAG[scope]}] ${text}`);
    await expect(failures, text).toEqual([]);
  };
}
