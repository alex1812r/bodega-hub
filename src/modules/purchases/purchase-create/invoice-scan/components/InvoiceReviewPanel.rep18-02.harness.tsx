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
 * REP20-03 (D78(d)): «llegada con el visor abierto»: la tasa llega con el panel inerte bajo el visor y el usuario lo cierra;
 * lo que apareció no actúa en el segundo siguiente al cierre.
 *
 * El último costo no hace aparecer controles (las opciones se muestran mientras se consulta, REP15-01): su caso queda
 * como cobertura con 0 controles aparecidos.
 *
 * Como mucho un toque con efecto por montaje (lo que cambia puede tapar el resto): lo que queda sin tocar se toca en
 * otro montaje idéntico del mismo caso. El teclado no es parte de este test.
 *
 * REP18-13: un toque cuyo pointerdown cae pasado el segundo de la guarda (o no llega) es INCONCLUSO, con o sin efecto:
 * la guarda ya venció y el toque no dice nada de ella. No cuenta ni como fallo ni como paso: ese control se vuelve a
 * tocar en otro montaje. Solo si se agotan los montajes sin un toque válido el caso falla, «inconcluso por carga».
 */
import { expect } from "storybook/test";

import { clickAt, openCdpSession, pressKeys, settleCdpAcks, tapAt } from "./InvoiceReviewPanel.cdpInput";
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

export type Browser = NonNullable<Awaited<ReturnType<typeof openViewport>>>["browser"];
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
export type Appeared = { control: Element; key: string; point: Point; before: string };

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
export const GUARD_MS = 1000;
/**
 * Montajes del mismo caso para tocar lo que quedó sin tocar: como mucho un toque con efecto por montaje (cada caso hace
 * aparecer como mucho 2 controles) y, bajo carga, cada toque tardío (inconcluso) cuesta otro montaje. 8 deja margen
 * para varios tardíos seguidos sin alargar sin tope una historia que nunca logra tocar a tiempo.
 */
const MAX_MOUNTS = 8;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type Input = "dedo" | "ratón";

/** Resultado de un toque: qué cambió (`null`: nada) y a cuánto de la llegada cayó (`null`: no llegó a la ventana). */
type TapResult = { effect: string | null; downMs: number | null };

/**
 * Toca `point` y devuelve qué cambió. Un enlace activado (el clic llega al documento sin que lo frene el panel)
 * cuenta como efecto; su navegación se cancela para no salir de la historia.
 */
export async function tapOnce(browser: Browser, input: Input, item: Appeared, arrivedAt: number): Promise<TapResult> {
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
  /**
   * Desde cuándo cuenta el segundo de la guarda si no es la vuelta de `releaseArrival` (`performance.now()`): el visor
   * cuenta desde la tecla que lo cierra, no desde que el arnés lo ve cerrado.
   */
  arrivedAt?: () => number;
};

export async function toPage(page: Page) {
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
async function mountOnce(browser: Browser, input: Input, appearCase: AppearCase, tested: Set<string>, late: Map<string, string[]>) {
  return withCase(appearCase.fixture, async () => {
    await appearCase.prepare(browser);
    await toPage(appearCase.page);
    const grid = recordGrid();
    const confirmed = await (appearCase.releaseArrival?.() ?? release(appearCase.arrival, appearCase.adopted));
    const arrivedAt = appearCase.arrivedAt?.() ?? performance.now();
    await settle(`${appearCase.arrival.source}:${appearCase.arrival.outcome}`, confirmed);
    const appeared = appearedSince(grid);
    const pending = appeared.filter((item) => !tested.has(item.key));
    const failures: string[] = [];
    // REP20-09: por frames y no con un temporizador: tras un toque, Chrome bajo carga aplaza los temporizadores 0,5–0,9 s
    // (la espera de 300 ms dejaba el toque pasado el segundo, inconcluso).
    while (pending.length > 0 && performance.now() < arrivedAt + TAP_FROM_MS) {
      await frame();
    }
    for (const item of pending) {
      const elapsed = performance.now() - arrivedAt;
      if (elapsed > TAP_BUDGET_MS) {
        // Sin tiempo de tocar dentro del segundo: también inconcluso.
        late.set(item.key, [...(late.get(item.key) ?? []), `sin tocar: ${Math.round(elapsed)} ms de la llegada al ir a tocar`]);
        break;
      }
      const box = item.control.getBoundingClientRect();
      if (!item.control.isConnected || item.point.x < box.left || item.point.x > box.right || item.point.y < box.top || item.point.y > box.bottom) {
        continue;
      }
      const own = appearCase.firstListing === true && zoneOf(item.control) === "lista flotante";
      const result = await tapOnce(browser, input, item, arrivedAt);
      if (result.downMs === null || result.downMs > GUARD_MS) {
        // Inconcluso: queda sin tocar para otro montaje; lo que cambió (si cambió) puede tapar el resto.
        const when = result.downMs === null ? "no llegó" : `cayó a ${Math.round(result.downMs)} ms de la llegada (> 1 s)${result.effect ? " con efecto" : ""}`;
        late.set(item.key, [...(late.get(item.key) ?? []), when]);
        console.warn(`[REP18-02 inconcluso] ${appearCase.id} · ${item.key}: el toque ${when}: se repite en otro montaje`);
        break;
      }
      tested.add(item.key);
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
export async function runAppearCase(browser: Browser, input: Input, appearCase: AppearCase) {
  const tested = new Set<string>();
  /** Por control, sus toques inconclusos (pasado el segundo de la guarda o sin llegar). */
  const late = new Map<string, string[]>();
  const failures: string[] = [];
  let appeared = 0;
  let left: string[] = [];
  for (let mount = 0; mount < MAX_MOUNTS; mount += 1) {
    const result = await mountOnce(browser, input, appearCase, tested, late);
    appeared = Math.max(appeared, result.appeared);
    failures.push(...result.failures);
    left = result.left;
    if (left.length === 0) {
      break;
    }
  }
  const inconclusive = left.filter((key) => late.has(key));
  if (inconclusive.length > 0) {
    const detail = inconclusive.map((key) => `${key} (${late.get(key)?.join("; ")})`).join(", ");
    failures.push(`inconcluso por carga: tras ${MAX_MOUNTS} montajes ningún toque a ≤ 1 s de la llegada en ${detail}`);
  }
  const untouched = left.filter((key) => !late.has(key));
  if (untouched.length > 0) {
    failures.push(`sin tocar tras ${MAX_MOUNTS} montajes: ${untouched.join(", ")}`);
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
 * REP19-01 (D77(a)(b)): un cambio del DOM sin llegada declarada no se guarda. El refresco vuelve en el commit de una
 * llegada declarada, la tasa del día (aún pendiente al abrir el buscador), en la microtarea de su commit y antes de
 * pintar, como lo haría una respuesta tardía declarada.
 */
function refreshCase(): AppearCase {
  let swap: { option: HTMLElement; other: HTMLElement } | null = null;
  return {
    arrival: RATE,
    fixture: FIXTURES.estados,
    id: "refresco del buscador abierto: otra opción bajo el dedo",
    page: "tal cual",
    prepare: async () => {
      await openSearch();
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
      const prepared = swap;
      if (!prepared) {
        throw new Error("Sin refresco preparado");
      }
      swap = null;
      const refresh = new MutationObserver(() => {
        refresh.disconnect();
        prepared.other.replaceWith(prepared.option);
      });
      refresh.observe(document.body, { attributes: true, characterData: true, childList: true, subtree: true });
      return release(RATE);
    },
  };
}

/** Lo que tarda el usuario en cerrar el visor tras la llegada (el caso `visor2` de la pasada 21). */
const VIEWER_CLOSE_MS = 200;

const viewerOpen = () => [...document.querySelectorAll('[role="dialog"]')].some(isVisible);

/**
 * REP20-03 (B-p21B-2, D78(d)): la tasa llega con el visor «Ver factura» abierto (modal por debajo de `lg`: el panel queda
 * inerte debajo) y el usuario lo cierra con Escape VIEWER_CLOSE_MS después. Lo que difiere de cuando se abrió el visor
 * («Por unidad» en L1) no actúa en el segundo siguiente al cierre (los toques se cuentan desde el cierre).
 * REP20-09: el cierre es el keydown de Escape, anterior al que hace el producto (en el siguiente turno, al desmontarse el
 * visor). Contar desde que vuelven `pressKeys` (el keyup) y `settle` lo retrasaba 150–260 ms bajo carga: el toque caía
 * pasado el segundo desde el cierre, ya sin guarda, y se contaba como fallo. El cierre lo espera el `settle` del montaje
 * (uno solo: dos seguidos bajo carga dejaban el toque fuera del segundo, inconcluso).
 */
function viewerCase(): AppearCase {
  let browser: Browser | null = null;
  let closedAt: number | null = null;
  return {
    arrivedAt: () => {
      if (closedAt === null) {
        throw new Error("Sin Escape que cierre el visor");
      }
      return closedAt;
    },
    arrival: RATE,
    fixture: FIXTURES.tasa3,
    id: "tasa 900 con el visor abierto, cerrado con Escape",
    page: { row: 1 },
    prepare: async (opened) => {
      browser = opened;
      const open = [...panel().querySelectorAll("button")].find((button) => /Ver factura/.test(button.textContent ?? "") && isVisible(button));
      if (!open) {
        throw new Error("Sin «Ver factura» a la vista (desde lg el visor va al lado)");
      }
      open.click();
      await settle("abrir el visor", viewerOpen);
    },
    releaseArrival: async () => {
      if (!browser) {
        throw new Error("Sin navegador");
      }
      const confirmed = await release(RATE);
      await settle("tasa con el visor abierto", confirmed);
      await pause(VIEWER_CLOSE_MS);
      closedAt = null;
      const onEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          closedAt ??= performance.now();
        }
      };
      window.addEventListener("keydown", onEscape, true);
      try {
        await pressKeys(browser, "{Escape}");
      } finally {
        window.removeEventListener("keydown", onEscape, true);
      }
      return () => !viewerOpen();
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
  visor: viewerCase(),
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
