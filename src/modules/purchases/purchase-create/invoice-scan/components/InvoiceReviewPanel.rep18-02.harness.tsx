/**
 * REP18-02 · D75(c): test de propiedad «un control APARECE o SE HABILITA bajo el dedo por una llegada asíncrona y el
 * toque en el segundo siguiente no tiene efecto», sobre el arnés de REP16-02 (`InvoiceReviewPanel.rep16-02.harness.tsx`).
 *
 * Para cada llegada (tasa del día normal 900, tasa 1, 12.345,67, último costo, candidatos del buscador, duplicados y
 * la compra del escaneo duplicado) en cada zona (cabecera, filas, contenido tras las filas, pie y la lista flotante):
 * - antes de soltarla se anota qué hay en cada punto de una rejilla sobre la ventana (texto, hueco, control habilitado
 *   o deshabilitado);
 * - al soltarla, cada control interactivo habilitado que ahora está en un punto donde antes había texto, hueco, un
 *   control deshabilitado u otro control distinto (no uno que ya estaba habilitado y se movió: eso es de D49) se toca
 *   en ese punto con el dedo o el ratón reales (CDP, `InvoiceReviewPanel.cdpInput.ts`, sin esperar el acuse) entre 0,5
 *   y 1 s después de la llegada;
 * - el toque no debe tener efecto: el estado del modelo que se ve (estado de cada fila, opciones pulsadas, casillas y
 *   radios marcados, valores, desplegables, diálogos, si se compactó, callbacks de la página y enlaces) sigue igual.
 *
 * REP18-10 (D76(a)): las opciones del primer listado de la lista flotante (pasa de «Buscando...» a tener opciones) son
 * del usuario: en «candidatos» el toque en menos de 1 s debe elegir. Lo que un refresco con la lista abierta pone donde
 * había otra opción («refresco») sí debe quedar sin efecto.
 *
 * El último costo no hace aparecer controles (las opciones se muestran mientras se consulta, REP15-01): su caso queda
 * como cobertura con 0 controles aparecidos.
 *
 * Como mucho un toque con efecto por montaje (lo que cambia puede tapar el resto): lo que queda sin tocar se toca en
 * otro montaje idéntico del mismo caso. El teclado no es parte de este test.
 */
import { expect } from "storybook/test";

import { clickAt, openCdpSession, settleCdpAcks, tapAt } from "./InvoiceReviewPanel.cdpInput";
import type { Arrival } from "./InvoiceReviewPanel.rep16-02.cases";
import { type Fixture, FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import {
  arrive,
  buttonIn,
  openViewport,
  pageCalls,
  panelRoot,
  release,
  row,
  scroller,
  settle,
  type VIEWPORTS,
  withCase,
} from "./InvoiceReviewPanel.rep16-02.harness";
import { heldNow } from "./InvoiceReviewPanel.rep17-18.harness";

type Browser = NonNullable<Awaited<ReturnType<typeof openViewport>>>["browser"];
type Point = { x: number; y: number };

function panel() {
  const root = panelRoot();
  if (!root) {
    throw new Error("Sin panel");
  }
  return root;
}

/** Lo que el producto toma por control bajo el dedo o el puntero (`CONTROL_SELECTOR` de `useLayoutHold.ts`). */
const HIT_SELECTOR =
  "button, a[href], input, select, textarea, label, [role='button'], [role='checkbox'], [role='radio'], [role='option'], [role='switch'], [role='tab']";

function nameOf(element: Element) {
  const label = element instanceof HTMLInputElement ? element.labels?.[0]?.textContent?.trim() : undefined;
  const text = element.getAttribute("aria-label") || label || element.textContent?.replace(/\s+/g, " ").trim() || element.getAttribute("placeholder") || "";
  return `${element.tagName.toLowerCase()}«${text.slice(0, 40)}»`;
}

function zoneOf(element: Element) {
  if (!panel().contains(element)) {
    return "lista flotante";
  }
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
  return element.closest('[data-layout-box="footer"]') ? "pie" : "tras las filas";
}

function isEnabled(control: Element) {
  return !control.matches(":disabled") && control.getAttribute("aria-disabled") !== "true" && !control.closest("[inert]");
}

/** Con caja y pintado (una reserva `invisible` tiene los botones montados pero no a la vista ni al toque). */
function isVisible(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && element.checkVisibility({ visibilityProperty: true });
}

/** Qué había en un punto antes de la llegada. */
type Before = { control: Element | null; enabled: boolean; what: string };

function ownText(element: Element) {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function describeHit(hit: Element | null): Before {
  const control = hit?.closest(HIT_SELECTOR) ?? null;
  if (control) {
    const enabled = isEnabled(control);
    return { control, enabled, what: `${enabled ? "control" : "control deshabilitado"} ${nameOf(control)}` };
  }
  const text = hit ? ownText(hit) : "";
  return { control: null, enabled: false, what: text ? `texto «${text.slice(0, 40)}»` : `hueco ${hit ? hit.tagName.toLowerCase() : "fuera"}` };
}

/** Paso de la rejilla (px de la story): menor que el control más bajo del panel (las opciones, 36–44 px). */
const GRID_PX = 8;

type Grid = { at: (point: Point) => Before | undefined; enabledBefore: ReadonlySet<Element> };

/** Lo que hay ahora en cada punto de la rejilla sobre la ventana y los controles habilitados a la vista. */
function recordGrid(): Grid {
  const cells = new Map<string, Before>();
  for (let y = GRID_PX / 2; y < window.innerHeight; y += GRID_PX) {
    for (let x = GRID_PX / 2; x < window.innerWidth; x += GRID_PX) {
      cells.set(`${x},${y}`, describeHit(document.elementFromPoint(x, y)));
    }
  }
  const enabledBefore = new Set([...document.querySelectorAll(HIT_SELECTOR)].filter((control) => isEnabled(control) && isVisible(control)));
  return { at: ({ x, y }) => cells.get(`${x},${y}`), enabledBefore };
}

/** Un control que apareció o se habilitó en un punto (de la rejilla) donde antes no estaba. */
type Appeared = { control: Element; key: string; point: Point; before: string };

/** El punto lo recibe `control` (o, si deja pasar el puntero, el contenedor que lo tiene y que no es otro control). */
function receives(control: Element, point: Point) {
  const hit = document.elementFromPoint(point.x, point.y);
  return hit !== null && (control.contains(hit) || (hit.contains(control) && hit.closest(HIT_SELECTOR) === null));
}

function isNewAt(control: Element, before: Before) {
  if (!before.control || !before.enabled) {
    return true;
  }
  // Otro control distinto (no él mismo ni uno que lo contiene o contiene) que no es el mismo vuelto a montar.
  return before.control !== control && !control.contains(before.control) && !before.control.contains(control) && nameOf(before.control) !== nameOf(control);
}

function appearedSince(grid: Grid): Appeared[] {
  const found: Appeared[] = [];
  for (const control of document.querySelectorAll(HIT_SELECTOR)) {
    if (!isEnabled(control) || grid.enabledBefore.has(control) || !isVisible(control)) {
      continue;
    }
    const box = control.getBoundingClientRect();
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    let best: { point: Point; before: Before } | null = null;
    for (let y = GRID_PX / 2; y < Math.min(box.bottom - 1, window.innerHeight); y += GRID_PX) {
      for (let x = GRID_PX / 2; x < Math.min(box.right - 1, window.innerWidth); x += GRID_PX) {
        if (x <= box.left + 1 || y <= box.top + 1) {
          continue;
        }
        const point = { x, y };
        const before = grid.at(point);
        if (!before || !isNewAt(control, before) || !receives(control, point)) {
          continue;
        }
        if (!best || Math.hypot(x - center.x, y - center.y) < Math.hypot(best.point.x - center.x, best.point.y - center.y)) {
          best = { before, point };
        }
      }
    }
    if (best) {
      found.push({ before: best.before.what, control, key: `${zoneOf(control)} ${nameOf(control)}`, point: best.point });
    }
  }
  // Una etiqueta y su campo son un solo control: se toca el de fuera.
  return found.filter((item) => !found.some((other) => other !== item && other.control.contains(item.control)));
}

/** Estado del modelo que se ve: lo que un toque con efecto cambia. */
function modelState(): string[] {
  const root = panel();
  const entries = [...root.querySelectorAll<HTMLElement>("li[data-line-index]")].map((line) => `L${line.dataset.lineIndex} estado=${line.dataset.status ?? ""}`);
  for (const element of document.querySelectorAll("[aria-pressed], [aria-checked], [aria-expanded], input, select, textarea")) {
    const name = `${zoneOf(element)} ${nameOf(element)}`;
    for (const attribute of ["aria-pressed", "aria-checked", "aria-expanded"]) {
      const value = element.getAttribute(attribute);
      if (value !== null) {
        entries.push(`${name} ${attribute}=${value}`);
      }
    }
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      entries.push(`${name} checked=${element.checked}`);
    } else if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      entries.push(`${name} valor=«${element.value}»`);
    }
  }
  const visibleCount = (selector: string) => [...document.querySelectorAll(selector)].filter(isVisible).length;
  entries.push(`diálogos=${visibleCount('[role="dialog"], [role="alertdialog"]')}`, `listas=${visibleCount('[role="listbox"]')}`);
  // Compactada o no (las cajas que fija cada activación con el puntero, D46-a, no son del modelo).
  entries.push(`«Compactar lista» ${heldNow().compact ? "ofrecida" : "no ofrecida"}`);
  const calls = pageCalls();
  entries.push(`callbacks descartar=${calls.discard} cargar=${calls.load} reescanear=${calls.rescan}`);
  return entries;
}

function diff(before: string[], after: string[]) {
  const gone = before.filter((entry) => !after.includes(entry));
  const added = after.filter((entry) => !before.includes(entry));
  return [...gone.map((entry) => `−${entry}`), ...added.map((entry) => `+${entry}`)];
}

/**
 * Desde la llegada, los toques caen entre TAP_FROM_MS y TAP_BUDGET_MS (más su viaje): dentro del segundo de D75(a), pero
 * pasada la guarda corta de 400 ms que arma cada foco programático (`armGuard` del panel), que no es la de D75: así la
 * propiedad pide que la guarda cubra el segundo entero y no solo sus primeros instantes.
 */
const TAP_FROM_MS = 500;
const TAP_BUDGET_MS = 850;
const GUARD_MS = 1000;
/** Montajes del mismo caso para tocar lo que quedó sin tocar (como mucho un toque con efecto por montaje). */
const MAX_MOUNTS = 5;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Input = "dedo" | "ratón";

/** Resultado de un toque: qué cambió (`null`: nada) y a cuánto de la llegada cayó (`null`: no llegó a la ventana). */
type TapResult = { effect: string | null; downMs: number | null };

/**
 * Toca `point` y devuelve qué cambió. Un enlace activado (el clic llega al documento sin que lo frene el panel)
 * cuenta como efecto; su navegación se cancela para no salir de la historia.
 */
async function tapOnce(browser: Browser, input: Input, item: Appeared, arrivedAt: number): Promise<TapResult> {
  const before = modelState();
  let downAt: number | null = null;
  let followed = false;
  const onDown = () => {
    downAt ??= performance.now();
  };
  const onClick = (event: Event) => {
    if (event.target instanceof Element && event.target.closest("a[href]") && item.control.contains(event.target)) {
      followed = true;
      event.preventDefault();
    }
  };
  window.addEventListener("pointerdown", onDown, true);
  document.addEventListener("click", onClick);
  try {
    await (input === "dedo" ? tapAt(browser, item.point) : clickAt(browser, item.point));
    // El clic y su repintado llegan tras el pointerup.
    await frame();
    await frame();
  } finally {
    window.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("click", onClick);
  }
  const changes = diff(before, modelState());
  if (followed) {
    changes.push("se siguió el enlace");
  }
  return { downMs: downAt === null ? null : downAt - arrivedAt, effect: changes.length > 0 ? changes.join(", ") : null };
}

/**
 * Dónde queda la página antes de la llegada: arriba (la cabecera), al final (lo de tras las filas y el pie), donde la
 * deje la preparación (el buscador abierto) o con la reserva de opciones de la fila `row` (o la fila, si no reserva) en
 * mitad de la ventana.
 */
export type Page = "arriba" | "final" | "tal cual" | { row: number };

export type AppearCase = {
  id: string;
  fixture: Fixture;
  /** Lo que pasa antes de la llegada medida (llegadas previas, acciones del usuario). */
  prepare: (browser: Browser) => Promise<void>;
  page: Page;
  arrival: Arrival;
  /** Cuándo está confirmado el efecto de la llegada (por defecto el del arnés de REP16-02). */
  adopted?: () => boolean;
  /** REP18-10 (D76(a)): lo aparecido en la lista flotante es su primer listado, del usuario: el toque debe elegir. */
  firstListing?: boolean;
  /** Suelta la llegada y devuelve cuándo está confirmada (por defecto `release(arrival, adopted)`). */
  releaseArrival?: () => Promise<() => boolean>;
};

async function toPage(page: Page) {
  if (page === "tal cual") {
    return;
  }
  const main = scroller();
  if (typeof page === "object") {
    const line = row(page.row);
    const target = line.querySelector('[data-testid="invoice-review-options-reserve"]') ?? line;
    const box = target.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    main.scrollTop = Math.max(0, main.scrollTop + box.top + box.height / 2 - (mainBox.top + main.clientHeight / 2));
  } else {
    main.scrollTop = page === "final" ? main.scrollHeight : 0;
  }
  await settle("colocar la página");
}

/** Un montaje: prepara, anota la rejilla, suelta la llegada y toca lo aparecido que no esté en `tested`. */
async function mountOnce(browser: Browser, input: Input, appearCase: AppearCase, tested: Set<string>) {
  return withCase(appearCase.fixture, async () => {
    await appearCase.prepare(browser);
    await toPage(appearCase.page);
    const grid = recordGrid();
    const confirmed = await (appearCase.releaseArrival?.() ?? release(appearCase.arrival, appearCase.adopted));
    const arrivedAt = performance.now();
    await settle(`${appearCase.arrival.source}:${appearCase.arrival.outcome}`, confirmed);
    const appeared = appearedSince(grid);
    const pending = appeared.filter((item) => !tested.has(item.key));
    const failures: string[] = [];
    const wait = arrivedAt + TAP_FROM_MS - performance.now();
    if (pending.length > 0 && wait > 0) {
      await pause(wait);
    }
    for (const item of pending) {
      if (performance.now() - arrivedAt > TAP_BUDGET_MS) {
        break;
      }
      const box = item.control.getBoundingClientRect();
      if (!item.control.isConnected || item.point.x < box.left || item.point.x > box.right || item.point.y < box.top || item.point.y > box.bottom) {
        continue;
      }
      tested.add(item.key);
      const own = appearCase.firstListing === true && zoneOf(item.control) === "lista flotante";
      const result = await tapOnce(browser, input, item, arrivedAt);
      if (result.downMs === null || result.downMs > GUARD_MS) {
        const when = result.downMs === null ? "no llegó a la ventana" : `cayó a ${Math.round(result.downMs)} ms de la llegada (> 1 s)`;
        failures.push(`${item.key}: el toque ${when}: no prueba la guarda`);
      }
      if (own && !result.effect) {
        failures.push(`${item.key} es del primer listado de la lista flotante (D76(a)) y el ${input === "dedo" ? "toque" : "clic"} en (${item.point.x},${item.point.y}) no eligió`);
      }
      if (result.effect && own) {
        break;
      }
      if (result.effect) {
        failures.push(`${item.key} apareció donde había ${item.before} y el ${input === "dedo" ? "toque" : "clic"} en (${item.point.x},${item.point.y}) tuvo efecto: ${result.effect}`);
        // Lo que cambió puede tapar el resto: lo que quede se toca en otro montaje.
        break;
      }
    }
    return { appeared: appeared.length, failures, left: appeared.filter((item) => !tested.has(item.key)).map((item) => item.key) };
  });
}

/** Corre un caso: monta tantas veces como haga falta para tocar todo lo que aparece; devuelve los fallos. */
async function runAppearCase(browser: Browser, input: Input, appearCase: AppearCase) {
  const tested = new Set<string>();
  const failures: string[] = [];
  let appeared = 0;
  let left: string[] = [];
  for (let mount = 0; mount < MAX_MOUNTS; mount += 1) {
    const result = await mountOnce(browser, input, appearCase, tested);
    appeared = Math.max(appeared, result.appeared);
    failures.push(...result.failures);
    left = result.left;
    if (left.length === 0) {
      break;
    }
  }
  if (left.length > 0) {
    failures.push(`sin tocar tras ${MAX_MOUNTS} montajes: ${left.join(", ")}`);
  }
  return { appeared, failures: failures.map((failure) => `${appearCase.id} · ${failure}`), tapped: [...tested] };
}

/* ---------------------------------------------------------------- casos ---------------------------------------------------------------- */

const withRate = (fixture: Fixture, systemRateVes: number): Fixture => ({ ...fixture, systemRateVes });

const RATE: Arrival = { outcome: "ok", source: "rate" };
const CANDIDATES: Arrival = { outcome: "ok", source: "candidates" };
const nothing = async () => undefined;

/** Fila sin producto del buscador en `estados` (la de REP16-02). */
const SEARCH_ROW = 3;

async function openSearch() {
  buttonIn(row(SEARCH_ROW), /Buscar producto/).click();
  await settle("abrir el buscador");
}

function arrozOption() {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => /Arroz Mary 1kg/.test(item.textContent ?? ""));
  if (!option) {
    throw new Error("Sin «Arroz Mary 1kg» en el buscador");
  }
  return option;
}

function pickArroz() {
  arrozOption().click();
}

/**
 * REP18-10 (D76(a)): refresco con la lista abierta. `EntityAutocomplete` pasa por «Buscando...» entre dos listados, así
 * que el refresco que la deja abierta (resultados tardíos, otro buscador) se reproduce en el DOM: con los candidatos ya
 * listados, donde está «Arroz Mary 1kg» se pone otra opción (una copia inerte) y la llegada devuelve «Arroz» (el nodo de
 * React, con su manejador) a ese punto.
 */
function refreshCase(): AppearCase {
  let swap: { option: HTMLElement; other: HTMLElement } | null = null;
  return {
    arrival: CANDIDATES,
    fixture: FIXTURES.estados,
    id: "refresco del buscador abierto: otra opción bajo el dedo",
    page: "tal cual",
    prepare: async () => {
      await openSearch();
      await arrive(RATE);
      await arrive(CANDIDATES);
      const option = arrozOption();
      const other = option.cloneNode(true);
      if (!(other instanceof HTMLElement)) {
        throw new Error("Sin copia de la opción");
      }
      other.textContent = "Otra opción";
      option.replaceWith(other);
      swap = { option, other };
      await settle("otra opción en la lista");
    },
    releaseArrival: async () => {
      if (!swap) {
        throw new Error("Sin refresco preparado");
      }
      swap.other.replaceWith(swap.option);
      swap = null;
      return () => true;
    },
  };
}

export const APPEAR_CASES = {
  /** M-p19B-1: «Esperando la tasa del día…» en la reserva de L1 y llega 900: aparece «Por unidad». */
  tasa900: { arrival: RATE, fixture: FIXTURES.tasa3, id: "tasa 900 (tasa3)", page: { row: 1 }, prepare: nothing },
  tasa900Estados: { arrival: RATE, fixture: FIXTURES.estados, id: "tasa 900 (estados)", page: { row: 4 }, prepare: nothing },
  /** Impresa 895 y del día 1.000: la cabecera ofrece «Tasa de hoy». */
  tasaImpresa: { arrival: RATE, fixture: FIXTURES.estadosImpresa, id: "tasa 1000 con impresa 895", page: "arriba", prepare: nothing },
  tasa1: { arrival: RATE, fixture: withRate(FIXTURES.tasa3, 1), id: "tasa 1", page: { row: 1 }, prepare: nothing },
  tasa1Final: { arrival: RATE, fixture: withRate(FIXTURES.tasa3, 1), id: "tasa 1 al final", page: "final", prepare: nothing },
  tasaLarga: { arrival: RATE, fixture: withRate(FIXTURES.tasa3, 12345.67), id: "tasa 12.345,67", page: { row: 2 }, prepare: nothing },
  tasaLargaFinal: { arrival: RATE, fixture: withRate(FIXTURES.tasa3, 12345.67), id: "tasa 12.345,67 al final", page: "final", prepare: nothing },
  /** La tasa no desvía L1 (9.000): su reserva queda retenida y «Compactar lista» aparece en el pie. */
  tasaSinDesvio: { arrival: RATE, fixture: withRate(FIXTURES.tasa3, 9000), id: "tasa 9000: L1 sin desvío, «Compactar lista» en el pie", page: "final", prepare: nothing },
  /** REP18-10 (D76(a)): el primer listado tras «Buscando...» es del usuario: se elige con el toque antes de 1 s. */
  candidatos: {
    arrival: CANDIDATES,
    firstListing: true,
    fixture: FIXTURES.estados,
    id: "candidatos del buscador: primer listado, tocable",
    page: "tal cual",
    prepare: async () => {
      await openSearch();
      await arrive(RATE);
    },
  },
  refresco: refreshCase(),
  ultimoCosto: {
    arrival: { outcome: "deviated", source: "lastCost" },
    fixture: FIXTURES.estados,
    id: "último costo desviado",
    page: { row: SEARCH_ROW },
    prepare: async () => {
      await openSearch();
      await arrive(RATE);
      await arrive(CANDIDATES);
      pickArroz();
      await settle("elegir producto");
    },
  },
  duplicados: {
    arrival: { outcome: "match", source: "duplicates" },
    fixture: FIXTURES.tasa3,
    id: "posible duplicado",
    page: "arriba",
    prepare: async () => {
      await arrive({ outcome: "ok", source: "supplier" });
      await arrive(RATE);
    },
  },
  compraDuplicada: {
    arrival: { outcome: "ok", source: "purchase" },
    fixture: FIXTURES.estados,
    id: "compra del escaneo duplicado",
    page: "arriba",
    prepare: async () => {
      await arrive({ outcome: "ok", source: "supplier" });
    },
  },
} satisfies Record<string, AppearCase>;

export type AppearCaseId = keyof typeof APPEAR_CASES;

/** `play` de una historia: el caso a ese ancho (ratón a 1280, dedo en el resto); falla con cada toque que tuvo efecto. */
export function appearPlay(caseId: AppearCaseId, viewport: keyof typeof VIEWPORTS) {
  return async () => {
    const opened = await openViewport(viewport);
    if (!opened) {
      return;
    }
    // La sesión CDP abierta antes de la llegada: el primer toque no espera a abrirla.
    await openCdpSession(opened.browser);
    const input: Input = viewport === "w1280" ? "ratón" : "dedo";
    const result = await runAppearCase(opened.browser, input, APPEAR_CASES[caseId]);
    await settleCdpAcks();
    const failures = result.failures.map((failure) => `${opened.label} ${failure}`);
    failures.forEach((failure) => console.warn(`[REP18-02 rojo] ${failure}`));
    const text = `${opened.label} ${APPEAR_CASES[caseId].id} (${input}): ${result.appeared} controles aparecidos, ${result.tapped.length} tocados (${result.tapped.join("; ") || "ninguno"}), ${failures.length} fallos`;
    console.warn(`[REP18-02] ${text}`);
    await expect(failures, text).toEqual([]);
  };
}
