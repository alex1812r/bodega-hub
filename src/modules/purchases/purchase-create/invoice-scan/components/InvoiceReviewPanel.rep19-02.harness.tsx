/**
 * REP19-02 · D77(e): el test de propiedad de REP18-02 (`InvoiceReviewPanel.rep18-02.harness.tsx`) con el usuario
 * TECLEANDO en otro campo cuando llega lo asíncrono (M-p20B-1).
 *
 * «Llegada durante tecleo»: con el foco en un campo de otra fila o de la cabecera, el teclado real (CDP,
 * `InvoiceReviewPanel.cdpInput.ts`, sin esperar el acuse) pulsa una tecla cada 30, 60 o 110 ms; la llegada (tasa del
 * día, la de la cabecera con tasa impresa, o el posible duplicado) se suelta en el frame siguiente a una de las teclas
 * de en medio, dentro del turno que esa tecla abre en `useLayoutHold.ts`. El campo y el sitio donde aparecerá el control
 * quedan a la vista a la vez (teclear en un campo fuera de la vista desplaza la página). El tecleo acaba antes del toque
 * y deja el campo como estaba. Lo que apareció bajo el dedo, tocado (dedo) o clicado (ratón a 1280) entre 0,5 y 1 s después de la llegada,
 * no debe tener efecto (D75(a), D77(a)). Los toques que caen pasado el segundo son inconclusos y se repiten en otro
 * montaje (REP18-13), como en REP18-02.
 *
 * Lo que el usuario provoca sigue tocable en menos de 1 s (D76(a), D77(b)):
 * - «primer listado del buscador tecleando»: escribe en el buscador mientras llegan los candidatos; el primer listado
 *   que deja su texto se elige con el toque;
 * - «Cambiar producto tras ver confirmadas» (M-q1809-1): toca «1 línea confirmada · ver» y, 300 o 700 ms después,
 *   «Cambiar producto» de la fila que se desplegó: actúa.
 */
import { expect } from "storybook/test";

import { clickAt, deferCdpAck, openCdpSession, pressKeys, settleCdpAcks, tapAt } from "./InvoiceReviewPanel.cdpInput";
import type { Arrival } from "./InvoiceReviewPanel.rep16-02.cases";
import { FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import { arrive, buttonIn, openViewport, panelRoot, release, row, scroller, settle, type VIEWPORTS, withCase } from "./InvoiceReviewPanel.rep16-02.harness";
import {
  APPEAR_CASES,
  type AppearCase,
  type Browser,
  GUARD_MS,
  type Input,
  runAppearCase,
  tapOnce,
  toPage,
} from "./InvoiceReviewPanel.rep18-02.harness";

const RATE: Arrival = { outcome: "ok", source: "rate" };
const CANDIDATES: Arrival = { outcome: "ok", source: "candidates" };
const SUPPLIER: Arrival = { outcome: "ok", source: "supplier" };

/** Lo que tarda como mucho en llegar a la página la tecla que suelta la llegada. */
const KEY_TIMEOUT_MS = 4000;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function center(element: Element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** El campo de texto de `container` cuya etiqueta cumple `name` (si lo hay). */
function fieldIn(container: Element | null | undefined, name: RegExp) {
  return [...(container?.querySelectorAll("input") ?? [])].find((input) => name.test(input.labels?.[0]?.textContent ?? input.getAttribute("aria-label") ?? ""));
}

/** «Cantidad» de las filas `indexes` que la tienen. */
function quantities(...indexes: number[]) {
  return indexes.flatMap((index) => fieldIn(panelRoot()?.querySelector(`li[data-line-index="${index}"]`), /^Cantidad/) ?? []);
}

const invoiceNumber = () => [fieldIn(panelRoot(), /Número de factura/) ?? []].flat();

/** Franja visible del área que se desplaza (sin el pie fijo, que tapa lo de debajo). */
function viewBand() {
  const main = scroller().getBoundingClientRect();
  const top = Math.max(0, main.top);
  let bottom = Math.min(window.innerHeight, main.bottom);
  const footer = panelRoot()?.querySelector('[data-layout-box="footer"]');
  if (footer && getComputedStyle(footer).position !== "static") {
    bottom = Math.min(bottom, footer.getBoundingClientRect().top);
  }
  return { bottom, top };
}

/** Un tramo vertical de la ventana (px). */
type Span = { top: number; bottom: number };

/** El tramo de `element`, o solo sus primeros `height` px. */
function spanOf(element: Element | null | undefined, height?: number): Span | null {
  if (!element) {
    return null;
  }
  const box = element.getBoundingClientRect();
  return box.width > 0 || box.height > 0 ? { bottom: height === undefined ? box.bottom : Math.min(box.bottom, box.top + height), top: box.top } : null;
}

/** Entero en la franja visible (el destino puede estar aún invisible: una reserva vacía). */
function inBand(span: Span) {
  const band = viewBand();
  return span.top >= band.top && span.bottom <= band.bottom;
}

/** Entero a la vista y sin nada encima: teclear en él no desplaza la página (el navegador trae el cursor a la vista). */
function inView(element: Element) {
  const box = element.getBoundingClientRect();
  if (box.width === 0 || !inBand(box)) {
    return false;
  }
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return hit !== null && element.contains(hit);
}

/**
 * El primer campo de `fields` (por preferencia) que puede quedar a la vista con `keep` (donde aparecerá el control):
 * tal cual o desplazando para centrar los dos juntos. Devuelve el campo, o por qué ninguno cabe.
 */
async function fieldInView(fields: HTMLInputElement[], keep: () => Span | null): Promise<HTMLInputElement | string> {
  const tried: string[] = [];
  for (const field of fields) {
    const b = keep();
    if (inView(field) && (!b || inBand(b))) {
      return field;
    }
    if (!b) {
      continue;
    }
    const band = viewBand();
    const a = field.getBoundingClientRect();
    const low = Math.min(a.top, b.top);
    const high = Math.max(a.bottom, b.bottom);
    tried.push(`${Math.round(high - low)} px`);
    if (high - low > band.bottom - band.top - 8) {
      continue;
    }
    scroller().scrollTop += (low + high) / 2 - (band.top + band.bottom) / 2;
    await settle("campo y destino a la vista");
    const after = keep();
    if (inView(field) && after && inBand(after)) {
      return field;
    }
  }
  const band = viewBand();
  return `${fields.length} campos; franja de ${Math.round(band.bottom - band.top)} px; campo + destino: ${tried.join(", ") || "sin destino"}`;
}

/**
 * Enfoca el campo sin desplazar, con el cursor al principio o al final. Al principio, «0» + Borrar deja la cantidad en
 * el mismo número («01» y «1»): el tecleo no cambia el importe ni hace aparecer avisos en la fila.
 */
function focusAt(field: HTMLInputElement, caret: "start" | "end") {
  field.focus({ preventScroll: true });
  if (document.activeElement !== field) {
    throw new Error(`«${field.labels?.[0]?.textContent ?? field.name}» no recibe el foco`);
  }
  const at = caret === "start" ? 0 : field.value.length;
  field.setSelectionRange(at, at);
}

/**
 * Pulsa `keys` (sintaxis de `pressKeys`), una cada `everyMs`, sobre el foco actual. `reached` se cumple cuando llega a
 * la ventana la tecla número `releaseAfter`; `done()`, cuando han llegado todas.
 */
function startTyping(browser: Browser, keys: readonly string[], everyMs: number, releaseAfter: number) {
  let downs = 0;
  let ups = 0;
  let onReached = () => {};
  let onTimeout: (error: Error) => void = () => {};
  const reached = new Promise<void>((resolve, reject) => {
    onReached = resolve;
    onTimeout = reject;
  });
  const timer = setTimeout(() => onTimeout(new Error(`no llegó la tecla ${releaseAfter} de ${keys.length}`)), KEY_TIMEOUT_MS);
  const onDown = () => {
    downs += 1;
    if (downs === releaseAfter) {
      clearTimeout(timer);
      onReached();
    }
  };
  const onUp = () => {
    ups += 1;
    if (ups >= keys.length) {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    }
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keyup", onUp, true);
  keys.forEach((key, index) => {
    setTimeout(() => deferCdpAck(pressKeys(browser, key)), index * everyMs);
  });
  return { done: () => ups >= keys.length, reached };
}

/** Cada 30, 60 o 110 ms (D77(e)): teclas rápidas, autorrepetición o lector de barras, y tecleo normal. */
export type Cadence = 30 | 60 | 110;

/** Pares «0» + Borrar (el campo vuelve a su valor): con la llegada tras el último «0» de la mitad, acaban en ≤ 330 ms. */
const PAIRS: Record<Cadence, number> = { 30: 7, 60: 4, 110: 3 };

type TypingCase = Omit<AppearCase, "releaseArrival" | "prepare"> & {
  /** Lo que pasa antes (llegadas previas), sin tocar el foco. */
  prepare?: () => Promise<void>;
  /** Campos de otra fila o de la cabecera, por preferencia: se teclea en el primero que esté a la vista. */
  fields: () => HTMLInputElement[];
  /** Dónde aparecerá el control: si no hay campo a la vista, se desplaza para ver los dos. */
  keep?: () => Span | null;
};

/** Un caso de REP18-02 cuya llegada se suelta en mitad del tecleo en `field`, una tecla cada `everyMs`. */
function typingCase(base: TypingCase, everyMs: Cadence): AppearCase {
  let browser: Browser | null = null;
  const pairs = PAIRS[everyMs];
  const keys = Array.from({ length: pairs }, () => ["0", "{Backspace}"]).flat();
  const { fields, keep, prepare, ...rest } = base;
  return {
    ...rest,
    id: `${base.id}, tecleando cada ${everyMs} ms`,
    // La coloca `prepare`, con el campo a la vista.
    page: "tal cual",
    prepare: async (opened) => {
      browser = opened;
      await prepare?.();
      await toPage(base.page);
      const field = await fieldInView(fields(), keep ?? (() => null));
      if (typeof field === "string") {
        throw new Error(`${base.id}: ningún campo donde teclear a la vista (${field})`);
      }
      focusAt(field, "start");
      await settle("enfocar el campo");
      console.warn(`[REP19-02 campo] ${base.id}: se teclea en ${field.labels?.[0]?.textContent ?? field.name} de ${field.closest("li[data-line-index]")?.getAttribute("data-line-index") ?? "la cabecera"}`);
    },
    releaseArrival: async () => {
      if (!browser) {
        throw new Error("Sin navegador");
      }
      // La llegada cae tras una tecla de en medio (el «0» del par central), en el turno que abre esa tecla.
      // Se suelta en el frame siguiente a esa tecla: su turno dura al menos hasta el frame después (`useLayoutHold.ts`).
      const typing = startTyping(browser, keys, everyMs, 2 * pairs - 1);
      await typing.reached;
      await frame();
      const confirmed = await release(base.arrival, base.adopted);
      return () => typing.done() && confirmed();
    },
  };
}

/** Fila sin producto de `estados` (la del buscador de REP16-02). */
const SEARCH_ROW = 3;

function hasArrozOption() {
  return [...document.querySelectorAll('[role="option"]')].some((option) => /Arroz Mary 1kg/.test(option.textContent ?? ""));
}

/**
 * D76(a) tecleando: con el buscador abierto (la tasa ya llegó), el usuario escribe 4 cifras cada 60 ms y los
 * candidatos se resuelven tras la 2.ª. El listado que se ve es el del texto final (tras el debounce): primer listado,
 * del usuario, y el toque en menos de 1 s lo elige.
 */
function firstListingTypingCase(): AppearCase {
  let browser: Browser | null = null;
  return {
    arrival: CANDIDATES,
    firstListing: true,
    fixture: FIXTURES.estados,
    id: "primer listado del buscador tecleando cada 60 ms: tocable",
    page: "tal cual",
    prepare: async (opened) => {
      browser = opened;
      buttonIn(row(SEARCH_ROW), /Buscar producto/).click();
      await settle("abrir el buscador");
      await arrive(RATE);
      const search = row(SEARCH_ROW).querySelector<HTMLInputElement>('input[role="combobox"]');
      if (!search) {
        throw new Error("Sin campo del buscador");
      }
      focusAt(search, "end");
      await settle("enfocar el buscador");
    },
    releaseArrival: async () => {
      if (!browser) {
        throw new Error("Sin navegador");
      }
      const typing = startTyping(browser, ["1", "2", "3", "4"], 60, 2);
      await typing.reached;
      await frame();
      await release(CANDIDATES);
      return () => typing.done() && hasArrozOption();
    },
  };
}

/** «Por unidad» y «Por bulto» aparecen en la primera franja de la reserva (las opciones miden 36–44 px). */
const OPTION_ROW_PX = 48;
const optionsReserve = (index: number) => row(index).querySelector('[data-testid="invoice-review-options-reserve"]');
const rateField = () => fieldIn(panelRoot(), /^Tasa/) ?? null;
/** Lo de tras las filas (el sitio reservado del aviso de duplicado, REP17-01). */
const afterRows = () => panelRoot()?.querySelector('section[aria-label="Líneas de la factura"]')?.nextElementSibling ?? null;

const TASA = (everyMs: Cadence) =>
  typingCase(
    { ...APPEAR_CASES.tasa900, fields: () => quantities(2, 0), id: "tasa 900 (tasa3), «Por unidad» en L1, tecleo en otra fila", keep: () => spanOf(optionsReserve(1), OPTION_ROW_PX) },
    everyMs,
  );

export const TYPING_CASES = {
  /** M-p20B-1: «Por unidad» aparece en la reserva de L1 mientras se teclea en «Cantidad» de L2 (o L0). */
  tasaK30: TASA(30),
  tasaK60: TASA(60),
  tasaK110: TASA(110),
  /**
   * La guarda de cabecera (REP17-01, D76(c)): «Tasa de hoy» aparece mientras se teclea en la cabecera. (En una fila no
   * cabe: la cabecera y la primera «Cantidad» no se ven a la vez a ningún ancho.)
   */
  tasaImpresaCabeceraK60: typingCase(
    { ...APPEAR_CASES.tasaImpresa, fields: invoiceNumber, id: "tasa 1000 con impresa 895, tecleo en «Número de factura»", keep: () => spanOf(rateField()) },
    60,
  ),
  /**
   * Otra llegada: el posible duplicado (su aviso, en el pie o tras las filas), tecleando en una fila. No en el número
   * ni la fecha: son parte de la consulta de duplicados.
   */
  duplicadosK30: typingCase(
    { ...APPEAR_CASES.duplicados, fields: () => quantities(2, 1, 0), id: "posible duplicado, tecleo en una fila", keep: () => spanOf(afterRows()), page: "final" },
    30,
  ),
  primerListado: firstListingTypingCase(),
} satisfies Record<string, AppearCase>;

export type TypingCaseId = keyof typeof TYPING_CASES;

/**
 * Casos en que algo tiene que aparecer a la vista a todos los anchos. «Tasa de hoy» no aparece a la vista a 390 ni a
 * 844×390 (tampoco en REP18-02): ahí sus casos no tocan nada.
 */
const MUST_APPEAR: ReadonlySet<TypingCaseId> = new Set(["tasaK30", "tasaK60", "tasaK110", "duplicadosK30", "primerListado"]);

/** Montajes para lograr un toque a ≤ 1 s del gesto (los tardíos son inconclusos, REP18-13). */
const MAX_MOUNTS = 8;
const TIMEOUT_MS = 4000;

function changeProductButton() {
  const buttons = panelRoot()?.querySelectorAll<HTMLButtonElement>('li[data-line-index="0"] button') ?? [];
  return [...buttons].find((button) => /Cambiar producto/.test(button.textContent ?? ""));
}

/** Un toque a ≤ 1 s (qué cambió, `null`: nada) o inconcluso (por qué). */
type ChangeProductResult = { effect: string | null; downMs: number } | { late: string };

/**
 * M-q1809-1: toca «1 línea confirmada · ver» y, `delayMs` después de su pointerdown, «Cambiar producto» de la fila que
 * se desplegó. Devuelve el efecto (`null`: ninguno) o «tardío» si el toque cayó pasado el segundo.
 */
async function changeProductOnce(browser: Browser, input: Input, delayMs: number): Promise<ChangeProductResult> {
  return withCase(FIXTURES.estados, async () => {
    await arrive(SUPPLIER);
    await arrive(RATE);
    const toggle = [...(panelRoot()?.querySelectorAll<HTMLButtonElement>("button[aria-expanded]") ?? [])].find((button) => /confirmada/.test(button.textContent ?? ""));
    if (!toggle) {
      throw new Error("Sin «1 línea confirmada · ver»");
    }
    toggle.scrollIntoView({ block: "center" });
    await settle("colocar «ver confirmadas»");
    let downAt: number | null = null;
    const onDown = () => {
      downAt ??= performance.now();
    };
    window.addEventListener("pointerdown", onDown, true);
    try {
      await (input === "dedo" ? tapAt(browser, center(toggle)) : clickAt(browser, center(toggle)));
    } finally {
      window.removeEventListener("pointerdown", onDown, true);
    }
    const openedAt = downAt;
    if (openedAt === null) {
      return { late: "el toque en «ver» no llegó" };
    }
    const start = performance.now();
    let button = changeProductButton();
    while (!button) {
      if (performance.now() - start > TIMEOUT_MS) {
        throw new Error("No aparece «Cambiar producto» tras «ver confirmadas»");
      }
      await frame();
      button = changeProductButton();
    }
    const point = center(button);
    if (point.y < 0 || point.y > window.innerHeight) {
      button.scrollIntoView({ block: "center" });
    }
    const wait = openedAt + delayMs - performance.now();
    if (wait > 0) {
      await pause(wait);
    }
    const result = await tapOnce(browser, input, { before: "nada (lo desplegó el usuario)", control: button, key: "L0 «Cambiar producto»", point: center(button) }, openedAt);
    if (result.downMs === null || result.downMs > GUARD_MS) {
      return { late: result.downMs === null ? "no llegó" : `cayó a ${Math.round(result.downMs)} ms de «ver»` };
    }
    return { effect: result.effect, downMs: result.downMs };
  });
}

async function runChangeProduct(browser: Browser, input: Input, delayMs: number) {
  const late: string[] = [];
  for (let mount = 0; mount < MAX_MOUNTS; mount += 1) {
    const result = await changeProductOnce(browser, input, delayMs);
    if ("late" in result) {
      late.push(result.late);
      console.warn(`[REP19-02 inconcluso] «Cambiar producto» a ${delayMs} ms: ${result.late}: se repite`);
      continue;
    }
    const what = `«Cambiar producto» a ${Math.round(result.downMs)} ms de «ver confirmadas»`;
    return { failures: result.effect ? [] : [`${what} no actuó (M-q1809-1)`], text: `${what}: ${result.effect ?? "sin efecto"}` };
  }
  return { failures: [`inconcluso por carga: tras ${MAX_MOUNTS} montajes ningún toque a ≤ 1 s (${late.join("; ")})`], text: "inconcluso" };
}

async function opened(viewport: keyof typeof VIEWPORTS) {
  const result = await openViewport(viewport);
  if (result) {
    await openCdpSession(result.browser);
  }
  return result;
}

const inputOf = (viewport: keyof typeof VIEWPORTS): Input => (viewport === "w1280" ? "ratón" : "dedo");

/** `play` de «llegada durante tecleo» (y del primer listado tecleando): falla con cada toque con efecto (o sin él). */
export function typingPlay(caseId: TypingCaseId, viewport: keyof typeof VIEWPORTS) {
  return async () => {
    const page = await opened(viewport);
    if (!page) {
      return;
    }
    const input = inputOf(viewport);
    const typingCaseNow = TYPING_CASES[caseId];
    const result = await runAppearCase(page.browser, input, typingCaseNow);
    await settleCdpAcks();
    const failures = result.failures.map((failure) => `${page.label} ${failure}`);
    failures.forEach((failure) => console.warn(`[REP19-02 rojo] ${failure}`));
    const text = `${page.label} ${typingCaseNow.id} (${input}): ${result.appeared} controles aparecidos, ${result.tapped.length} tocados (${result.tapped.join("; ") || "ninguno"}), ${failures.length} fallos`;
    console.warn(`[REP19-02] ${text}`);
    if (MUST_APPEAR.has(caseId)) {
      await expect(result.appeared, `${text}: no apareció nada que tocar`).toBeGreaterThan(0);
    }
    await expect(failures, text).toEqual([]);
  };
}

/** `play` de M-q1809-1: «Cambiar producto» `delayMs` después de «ver confirmadas» actúa. */
export function changeProductPlay(delayMs: 300 | 700, viewport: keyof typeof VIEWPORTS) {
  return async () => {
    const page = await opened(viewport);
    if (!page) {
      return;
    }
    const input = inputOf(viewport);
    const result = await runChangeProduct(page.browser, input, delayMs);
    await settleCdpAcks();
    const text = `${page.label} (${input}) ${result.text}`;
    result.failures.forEach((failure) => console.warn(`[REP19-02 rojo] ${page.label} ${failure}`));
    console.warn(`[REP19-02] ${text}`);
    await expect(result.failures, text).toEqual([]);
  };
}
