/**
 * REP17-18 · D72(d): el test de propiedad del panel de revisión con algo RETENIDO y un gesto del usuario. Monta los
 * casos con el arnés de REP16-02 (`InvoiceReviewPanel.rep16-02.harness.tsx`) y mide TODO el panel (cabecera, filas, lo
 * de tras las filas y pie).
 *
 * Lo retenido (D72(a)), cada uno en su montaje:
 * - «reserva»: la tasa del día llega sin desviar L1 (`tasa3` a 9.000) y la reserva que no usa queda como hueco.
 * - «fila»: el usuario descarta con el ratón una fila a la vista y resuelve otra (la caja de la fila se queda).
 * - «aviso»: los avisos de varias filas encogen al llegar la tasa del día (`estadosImpresa`, impresa 895 y del día 1.000).
 *
 * Gestos (solo por CDP, `InvoiceReviewPanel.rep17-18.cdpGestures.ts`): rueda (varios pasos, horizontal, hasta el borde
 * de arriba y contra él), dedo (corto, largo, flick, desde el hueco), pinch, salida del panel con el ratón (por arriba y por los lados,
 * con y sin pausa), teclado (Tab de una fila a otra, Shift+Tab, flechas) y portátil táctil (dedo y luego rueda). Propiedad: ningún control
 * del panel cambia de posición en el DOCUMENTO (en el contenido desplazable: el desplazamiento del gesto no cuenta) en
 * ningún frame, y lo retenido sigue retenido. En una caja fija (el pie, el visor) se mide la posición dentro de la caja
 * y el alto de la caja (su sitio en la ventana es el de la caja fija).
 *
 * «Compactar lista» (D72(b)): sin pulsarlo nada se mueve; el botón (rol button, nombre /Compactar lista/) está con
 * algo retenido; al pulsarlo (desplazado hasta el pie de la franja visible) se compacta (se mueve algo y el botón se va:
 * no queda nada retenido), y un control que se movió en pantalla no actúa si se pulsa en seguida en su sitio nuevo (D49).
 */
import { expect, within } from "storybook/test";

import { clickAt, clickElement, settleCdpAcks } from "./InvoiceReviewPanel.cdpInput";
import { type Fixture, FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import { arrive, openViewport, panelRoot, scroller, settle, type VIEWPORTS, withCase } from "./InvoiceReviewPanel.rep16-02.harness";
import {
  moveMouse,
  moveMouseOut,
  pinchAt,
  type Point,
  pressNavigation,
  touchDrag,
  wheelAt,
  type WheelStep,
} from "./InvoiceReviewPanel.rep17-18.cdpGestures";

type Browser = NonNullable<Awaited<ReturnType<typeof openViewport>>>["browser"];

function panel() {
  const root = panelRoot();
  if (!root) {
    throw new Error("Sin panel");
  }
  return root;
}

/** Los controles que mide el arnés de REP16-02 (mismo selector). */
const CONTROL_SELECTOR =
  'button, a[href], input, select, textarea, [role="radio"], [role="checkbox"], [role="switch"], [role="option"], [tabindex]:not([tabindex="-1"])';

/** Lo que el producto toma por control bajo el dedo o el puntero (`CONTROL_SELECTOR` de `useLayoutHold.ts`). */
const HIT_SELECTOR =
  "button, a[href], input, select, textarea, label, [role='button'], [role='checkbox'], [role='radio'], [role='option'], [role='switch'], [role='tab']";

function nameOf(element: Element) {
  const label = element instanceof HTMLInputElement ? element.labels?.[0]?.textContent?.trim() : undefined;
  const text = element.getAttribute("aria-label") || label || element.textContent?.replace(/\s+/g, " ").trim() || "";
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
  return element.closest('[data-layout-box="footer"]') ? "pie" : "tras las filas";
}

/** La caja fija (sticky o fixed) más externa que contiene `element` dentro del contenido desplazable, si la hay. */
function pinOf(element: Element, main: Element): HTMLElement | null {
  let pin: HTMLElement | null = null;
  for (let node: Element | null = element; node && node !== main; node = node.parentElement) {
    const { position } = getComputedStyle(node);
    if ((position === "sticky" || position === "fixed") && node instanceof HTMLElement) {
      pin = node;
    }
  }
  return pin;
}

type Probe = { element: Element; name: string; zone: string; pin: HTMLElement | null; at: number };
type PinProbe = { pin: HTMLElement; name: string; height: number };

function isVisible(box: DOMRect) {
  return box.width > 0 || box.height > 0;
}

/** Posición en el documento (contenido desplazable) o, en una caja fija, dentro de ella. */
function placeOf(element: Element, pin: HTMLElement | null, main: Element) {
  const top = element.getBoundingClientRect().top;
  return pin ? top - pin.getBoundingClientRect().top : top - main.getBoundingClientRect().top + main.scrollTop;
}

export type PanelTracker = {
  /** Mide ahora y guarda el mayor cambio de cada control (y del alto de cada caja fija). */
  sample: () => void;
  /** Controles que cambiaron de posición en algún frame medido. */
  moved: () => Element[];
  /** `null` si nada se movió; si no, por zona: cuántos, cuánto y un ejemplo. */
  report: () => string | null;
};

/** Referencia de TODO el panel ahora: cada control visible y el alto de cada caja fija. */
export function trackPanel(): PanelTracker {
  const main = scroller();
  const root = panel();
  const probes: Probe[] = [...root.querySelectorAll(CONTROL_SELECTOR)].flatMap((element) => {
    if (!isVisible(element.getBoundingClientRect())) {
      return [];
    }
    const pin = pinOf(element, main);
    return [{ at: placeOf(element, pin, main), element, name: nameOf(element), pin, zone: zoneOf(element) }];
  });
  const pins: PinProbe[] = [...new Set(probes.flatMap((probe) => (probe.pin ? [probe.pin] : [])))].map((pin) => ({
    height: pin.getBoundingClientRect().height,
    name: zoneOf(pin),
    pin,
  }));
  const moves = new Map<Probe, number>();
  const resized = new Map<PinProbe, number>();
  const keepLargest = <T,>(map: Map<T, number>, key: T, delta: number) => {
    if (Math.abs(delta) > 0.5 && Math.abs(delta) > Math.abs(map.get(key) ?? 0)) {
      map.set(key, delta);
    }
  };
  return {
    moved: () => [...moves.keys()].map((probe) => probe.element),
    report: () => {
      const byZone = new Map<string, [Probe, number][]>();
      for (const entry of moves) {
        byZone.set(entry[0].zone, [...(byZone.get(entry[0].zone) ?? []), entry]);
      }
      const parts = [...byZone].map(([zone, entries]) => {
        const [probe, delta] = entries.find(([item]) => /Descartar/.test(item.name)) ?? entries[0];
        const deltas = [...new Set(entries.map(([, value]) => Math.round(value)))].map((value) => (value > 0 ? `+${value}` : `${value}`));
        return `${zone} ×${entries.length} (${deltas.join("/")} px; p. ej. ${probe.name} ${Math.round(probe.at)}→${Math.round(probe.at + delta)})`;
      });
      parts.push(...[...resized].map(([item, delta]) => `caja fija ${item.name} cambió de alto ${Math.round(item.height)}→${Math.round(item.height + delta)}`));
      return parts.length > 0 ? `se movieron ${moves.size} controles: ${parts.join("; ")}` : null;
    },
    sample: () => {
      for (const probe of probes) {
        if (probe.element.isConnected && isVisible(probe.element.getBoundingClientRect())) {
          keepLargest(moves, probe, placeOf(probe.element, probe.pin, main) - probe.at);
        }
      }
      for (const item of pins) {
        if (item.pin.isConnected) {
          keepLargest(resized, item, item.pin.getBoundingClientRect().height - item.height);
        }
      }
    },
  };
}

/** Mide `tracker` en cada frame hasta que se llame lo que devuelve (que mide una última vez). */
function sampleEveryFrame(tracker: PanelTracker) {
  let running = true;
  const loop = () => {
    if (running) {
      tracker.sample();
      requestAnimationFrame(loop);
    }
  };
  requestAnimationFrame(loop);
  return () => {
    running = false;
    tracker.sample();
  };
}

/** Frames seguidos sin desplazamiento para dar por acabado el del gesto (el lanzamiento de un flick sigue solo). */
const STILL_FRAMES = 6;

/** Espera a que el desplazamiento del gesto acabe y el DOM quede quieto. */
async function settleGesture(what: string) {
  const main = scroller();
  let last = main.scrollTop;
  let still = 0;
  await settle(what, () => {
    const now = main.scrollTop;
    still = Math.abs(now - last) < 0.5 ? still + 1 : 0;
    last = now;
    return still >= STILL_FRAMES;
  });
}

/** Cajas del panel con un alto, tope o `display` retenidos en línea (D46-a, D65(b), D67(a)). */
function retainedBoxes(): HTMLElement[] {
  return [...panel().querySelectorAll<HTMLElement>("[data-layout-box], [data-layout-notice]")].filter(
    (box) => box.style.minHeight !== "" || box.style.maxHeight !== "" || (box.matches("[data-layout-notice]") && box.style.display !== ""),
  );
}

/** «Compactar lista» (D72(b)): por rol y nombre accesible. */
function compactButton() {
  return within(panel()).queryByRole<HTMLButtonElement>("button", { name: /Compactar lista/ });
}

type Held = { boxes: number; compact: boolean };

export function heldNow(): Held {
  return { boxes: retainedBoxes().length, compact: compactButton() !== null };
}

export function isHolding(held: Held) {
  return held.boxes > 0 || held.compact;
}

const heldText = (held: Held) => `${held.boxes} cajas retenidas${held.compact ? " y «Compactar lista»" : ""}`;

/** Qué se soltó entre `before` y `after` (`null`: sigue todo retenido). */
export function releasedBetween(before: Held, after: Held): string | null {
  return after.boxes < before.boxes || (before.compact && !after.compact)
    ? `se soltó lo retenido sin pulsar «Compactar lista» (antes ${heldText(before)}, después ${heldText(after)})`
    : null;
}

/** Punto de la ventana sobre `inside` (por defecto el panel) que no cae en un control ni en el pie, entre `minY` y el pie. */
function freePoint(minY: number, inside: Element = panel()): Point | null {
  const box = inside.getBoundingClientRect();
  const footer = panel().querySelector('[data-layout-box="footer"]');
  const footerTop = footer ? footer.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
  const maxY = Math.min(box.bottom - 4, footerTop - 8, window.innerHeight - 8);
  for (let y = maxY; y >= Math.max(minY, box.top + 4, 8); y -= 6) {
    for (let x = box.left + 24; x <= box.right - 24; x += 24) {
      const hit = document.elementFromPoint(x, y);
      if (hit && inside.contains(hit) && !hit.closest(HIT_SELECTOR) && !footer?.contains(hit)) {
        return { x, y };
      }
    }
  }
  return null;
}

/** Punto libre sobre lo retenido (el hueco; primero `preferred`, luego los avisos) a la vista, lo más abajo posible en él. */
function holePoint(minY: number, preferred: Element | null): Point | null {
  const boxes = retainedBoxes();
  const notices = boxes.filter((box) => box.matches("[data-layout-notice]"));
  for (const box of [...(preferred ? [preferred] : []), ...notices, ...boxes]) {
    const point = freePoint(minY, box);
    if (point) {
      return point;
    }
  }
  return null;
}

function centerOf(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** `element` está a la vista, sin nada encima de su centro y (si no es del pie) por encima del pie. */
function isClear(element: Element) {
  const footer = panel().querySelector('[data-layout-box="footer"]');
  const footerTop = footer && !footer.contains(element) ? footer.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
  const { x, y } = centerOf(element);
  return y > 4 && y < Math.min(footerTop, window.innerHeight) - 4 && element.contains(document.elementFromPoint(x, y));
}

/** El primer elemento de `selector` a la vista (`isClear`) cuyo texto cumpla `name`. */
function visibleButton(selector: string, name: RegExp | null): HTMLElement | null {
  return (
    [...panel().querySelectorAll<HTMLElement>(selector)].find((button) => (!name || name.test(button.textContent ?? "")) && isClear(button)) ??
    null
  );
}

/** Dónde queda el hueco de una retención: la fila (o el panel) y el orden de la caja en ella (-1: la fila misma). */
type HoleSpot = { line: string | null; nth: number };

const BOX_SELECTOR = "[data-layout-box], [data-layout-notice]";

function spotOf(box: Element): HoleSpot {
  const line = box.closest("li[data-line-index]");
  const scope = line ?? panel();
  return { line: line instanceof HTMLElement ? (line.dataset.lineIndex ?? null) : null, nth: box === line ? -1 : [...scope.querySelectorAll(BOX_SELECTOR)].indexOf(box) };
}

function boxAt(spot: HoleSpot): Element | null {
  const scope = spot.line === null ? panel() : panel().querySelector(`li[data-line-index="${spot.line}"]`);
  if (!scope || spot.nth === -1) {
    return scope;
  }
  return scope.querySelectorAll(BOX_SELECTOR)[spot.nth] ?? null;
}

/**
 * Antes de retener nada: la página con las filas desde un tercio de la ventana (se ven a la vez lo de encima y las
 * primeras filas) o, si el gesto empieza en el hueco, con su caja en mitad de la ventana.
 */
async function place(spot: HoleSpot | null) {
  const main = scroller();
  const max = main.scrollHeight - main.clientHeight;
  const docTop = (element: Element) => element.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
  const hole = spot ? boxAt(spot) : null;
  const lines = panel().querySelector('section[aria-label="Líneas de la factura"]');
  if (hole) {
    main.scrollTop = Math.max(0, Math.min(max, docTop(hole) - main.clientHeight / 2));
  } else if (lines) {
    main.scrollTop = Math.max(0, Math.min(max, docTop(lines) - main.clientHeight / 3));
  }
  await settle("colocar la página");
}

export type Retention = "reserva" | "fila" | "aviso";

/** La tasa del día que no desvía L1 de `tasa3` (4.500 Bs a 9.000 = 0,50 REF, su último costo): su reserva sobra. */
const TASA3_ALIGNED: Fixture = { ...FIXTURES.tasa3, systemRateVes: 9000 };

/** Cada retención: su factura y cómo se llega a ella (devuelve su hueco si lo sabe: la fila descartada). */
const RETENTIONS: Record<Retention, { fixture: Fixture; hold: (browser: Browser) => Promise<Element | null> }> = {
  aviso: {
    fixture: FIXTURES.estadosImpresa,
    hold: async () => {
      await arrive({ outcome: "ok", source: "rate" });
      return null;
    },
  },
  fila: {
    fixture: FIXTURES.estados,
    hold: async (browser) => {
      const discard = visibleButton("li[data-line-index] button", /Descartar línea/);
      if (!discard) {
        throw new Error("ninguna fila con «Descartar línea» a la vista");
      }
      const line = discard.closest("li[data-line-index]");
      const index = line instanceof HTMLElement ? line.dataset.lineIndex : undefined;
      await clickAt(browser, centerOf(discard));
      await settle("descartar con el ratón");
      const candidate = visibleButton("li[data-line-index] [data-candidate]", null);
      if (candidate) {
        await clickAt(browser, centerOf(candidate));
        await settle("resolver con el ratón");
      }
      return panel().querySelector(`li[data-line-index="${index}"]`);
    },
  },
  reserva: {
    fixture: TASA3_ALIGNED,
    hold: async () => {
      await arrive({ outcome: "ok", source: "rate" });
      return null;
    },
  },
};

type Gesture = (browser: Browser, point: Point) => Promise<void>;

type Variant = {
  id: string;
  /** El gesto empieza sobre el hueco retenido (si no, sobre él si se ve, o sobre otro punto libre del panel). */
  fromHole: boolean;
  /** Alto que el gesto necesita por encima del punto (el dedo sube). */
  above: number;
  gesture: Gesture;
};

const WHEEL_DOWN: WheelStep[] = [{ dx: 0, dy: 120 }, { dx: 0, dy: 120 }, { dx: 0, dy: 120 }];
/** Más de lo que hay hasta arriba (el resto empuja contra el borde) y, ya arriba, dos pasos que no desplazan. */
const WHEEL_TO_TOP: WheelStep[] = [{ dx: 0, dy: -1500 }, { dx: 0, dy: -1500 }];
const WHEEL_UP: WheelStep[] = [{ dx: 0, dy: -120 }, { dx: 0, dy: -120 }];
const WHEEL_SIDE: WheelStep[] = [{ dx: 120, dy: 0 }, { dx: 120, dy: 0 }, { dx: -120, dy: 0 }];

/**
 * Arrastre corto: 40 px de la story. El runner escala el iframe (a 1024×1366, a la mitad): con 24 px el dedo se movía
 * menos que la holgura del toque de Chrome y el arrastre era un toque (un clic en la fila).
 */
const SHORT_DRAG_PX = 40;

/** El dedo sube `distance` px desde `point` en `steps` pasos de `stepMs`; se levanta quieto o en marcha (flick). */
function stroke(point: Point, distance: number, steps: number, stepMs: number, liftAfterMs: number) {
  const points = Array.from({ length: steps + 1 }, (_, index) => ({ x: point.x, y: point.y - (distance * index) / steps }));
  return { liftAfterMs, points, stepMs };
}

/** Pausa del ratón fuera del panel (D71(a): más que cualquier ventana de soltar por tiempo). */
const PAUSE_MS = 1200;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** El ratón va de `point` al borde de la ventana por arriba o por un lado, sale, (espera) y vuelve a `point`. */
function leave(side: "arriba" | "izquierda" | "derecha", pauseMs: number): Gesture {
  return async (browser, point) => {
    const edge = side === "arriba" ? { x: point.x, y: 2 } : { x: side === "izquierda" ? 2 : window.innerWidth - 2, y: point.y };
    const outside = side === "arriba" ? { x: edge.x, y: -8 } : { x: side === "izquierda" ? -8 : window.innerWidth + 8, y: point.y };
    await moveMouse(browser, [point, edge], edge);
    moveMouseOut(browser, [outside]);
    await pause(pauseMs);
    await moveMouse(browser, [edge, point], point);
  };
}

/** Los controles del panel a los que llega Tab, en orden del documento (el panel no usa tabindex positivos). */
function tabStops(): HTMLElement[] {
  return [...panel().querySelectorAll<HTMLElement>(CONTROL_SELECTOR)].filter(
    (element) => element.tabIndex >= 0 && !element.matches(":disabled") && isVisible(element.getBoundingClientRect()),
  );
}

/**
 * Tab como NAVEGACIÓN entre filas. Sobre una fila pendiente Tab es una acción, no navegación: abre su buscador
 * («Tab abre el buscador», `InvoiceReviewPanel.test.tsx`), que crece dentro de la fila como al pulsar «Buscar
 * producto». Por eso el foco empieza (sin desplazar) dos paradas antes de la segunda fila: el primer Tab va al último
 * control de la fila anterior y el segundo entra en la segunda fila (cruza el límite entre filas), y ninguna tecla se
 * pulsa sobre una fila. Si el foco no acaba en esa fila el caso no prueba lo que dice y falla.
 */
const tabAcrossRows: Gesture = async (browser) => {
  const stops = tabStops();
  const row = stops.filter((element) => element.matches("li[data-line-index]"))[1];
  const index = row ? stops.indexOf(row) : -1;
  const start = stops[index - 2];
  if (!row || !start || [start, stops[index - 1]].some((element) => element.matches("li[data-line-index]"))) {
    throw new Error("Tab: sin dos controles antes de la segunda fila para cruzar a ella navegando");
  }
  start.focus({ preventScroll: true });
  await pressNavigation(browser, ["Tab", "Tab"]);
  if (document.activeElement !== row) {
    const now = document.activeElement ? nameOf(document.activeElement) : "nada";
    throw new Error(`Tab: desde ${nameOf(start)} el foco acabó en ${now}, no en ${nameOf(row)}`);
  }
};

export type Family = "rueda" | "dedo" | "pinch" | "salida" | "teclado" | "portatil";

const FAMILIES: Record<Family, Variant[]> = {
  dedo: [
    { above: 56, fromHole: false, gesture: (browser, point) => touchDrag(browser, stroke(point, SHORT_DRAG_PX, 4, 16, 150)), id: "corto" },
    { above: 320, fromHole: false, gesture: (browser, point) => touchDrag(browser, stroke(point, 300, 15, 16, 150)), id: "largo" },
    { above: 200, fromHole: false, gesture: (browser, point) => touchDrag(browser, stroke(point, 180, 4, 8, 8)), id: "flick" },
    { above: 130, fromHole: true, gesture: (browser, point) => touchDrag(browser, stroke(point, 120, 8, 16, 150)), id: "desde el hueco" },
  ],
  pinch: [{ above: 0, fromHole: true, gesture: (browser, point) => pinchAt(browser, point, 160, 8), id: "dos dedos sobre el hueco" }],
  portatil: [
    {
      above: 90,
      fromHole: false,
      gesture: async (browser, point) => {
        await touchDrag(browser, stroke(point, 80, 8, 16, 150));
        await settleGesture("dedo del portátil");
        await wheelAt(browser, point, [{ dx: 0, dy: 100 }, { dx: 0, dy: 100 }]);
      },
      id: "dedo y luego rueda",
    },
  ],
  rueda: [
    { above: 0, fromHole: false, gesture: (browser, point) => wheelAt(browser, point, WHEEL_DOWN), id: "varios pasos" },
    { above: 0, fromHole: false, gesture: (browser, point) => wheelAt(browser, point, WHEEL_SIDE), id: "horizontal" },
    {
      above: 0,
      fromHole: false,
      gesture: async (browser, point) => {
        await wheelAt(browser, point, WHEEL_TO_TOP);
        await settleGesture("rueda hasta arriba");
        await wheelAt(browser, point, WHEEL_UP);
      },
      id: "en el borde",
    },
  ],
  salida: [
    { above: 0, fromHole: false, gesture: leave("arriba", 0), id: "por arriba sin pausa" },
    { above: 0, fromHole: false, gesture: leave("arriba", PAUSE_MS), id: "por arriba con pausa" },
    { above: 0, fromHole: false, gesture: leave("izquierda", 0), id: "por un lado sin pausa" },
    { above: 0, fromHole: false, gesture: leave("derecha", PAUSE_MS), id: "por un lado con pausa" },
  ],
  teclado: [
    { above: 0, fromHole: false, gesture: tabAcrossRows, id: "Tab" },
    { above: 0, fromHole: false, gesture: (browser) => pressNavigation(browser, ["Tab", "Tab"], true), id: "Shift+Tab" },
    { above: 0, fromHole: false, gesture: (browser) => pressNavigation(browser, ["ArrowDown", "ArrowDown", "ArrowUp"]), id: "flechas" },
  ],
};

/** Monta lo retenido y comprueba que lo está (si no, el escenario no prueba nada); devuelve qué y su hueco preferido. */
async function holdSomething(browser: Browser, retention: Retention, spot: HoleSpot | null) {
  await place(spot);
  const preferred = await RETENTIONS[retention].hold(browser);
  const held = heldNow();
  if (!isHolding(held)) {
    throw new Error(`${retention}: tras prepararlo no hay nada retenido`);
  }
  return { held, preferred };
}

/**
 * Dónde queda el hueco de `retention` (montaje de prueba): la fila que sabe su preparación o el primer aviso retenido.
 * Así el gesto que empieza en el hueco coloca la página antes de retener nada (desplazar después ya sería un gesto).
 */
async function locateHole(browser: Browser, retention: Retention): Promise<HoleSpot> {
  return withCase(RETENTIONS[retention].fixture, async () => {
    const { preferred } = await holdSomething(browser, retention, null);
    const boxes = retainedBoxes();
    const hole = preferred ?? boxes.find((box) => box.matches("[data-layout-notice]")) ?? boxes[0];
    if (!hole) {
      throw new Error(`${retention}: lo retenido no está en ninguna caja del panel`);
    }
    return spotOf(hole);
  });
}

/** Un gesto con algo retenido: nada del panel se mueve en el documento y lo retenido sigue retenido. */
async function runVariant(browser: Browser, retention: Retention, variant: Variant): Promise<string[]> {
  const spot = variant.fromHole ? await locateHole(browser, retention) : null;
  return withCase(RETENTIONS[retention].fixture, async () => {
    const { held: before, preferred } = await holdSomething(browser, retention, spot);
    const hole = holePoint(variant.above + 8, preferred);
    const point = hole ?? (variant.fromHole ? null : freePoint(variant.above + 8));
    if (!point) {
      throw new Error(`${retention} · ${variant.id}: ${variant.fromHole ? "el hueco retenido no está a la vista" : "sin punto libre en el panel"}`);
    }
    const tracker = trackPanel();
    const stop = sampleEveryFrame(tracker);
    // Ninguno de estos gestos es un clic: si acaba en uno (un arrastre tomado por toque), lo que mueva es del clic.
    const clicks: string[] = [];
    const onClick = (event: Event) => clicks.push(event.target instanceof Element ? nameOf(event.target) : "la ventana");
    window.addEventListener("click", onClick, true);
    try {
      await variant.gesture(browser, point);
      await settleGesture(variant.id);
    } finally {
      stop();
      window.removeEventListener("click", onClick, true);
    }
    if (clicks.length > 0) {
      throw new Error(`${retention} · ${variant.id}: el gesto acabó en un clic sobre ${clicks.join(", ")} y no prueba lo que dice`);
    }
    const failures = [tracker.report(), releasedBetween(before, heldNow())].filter((failure) => failure !== null);
    return failures.map((failure) => `${retention} · ${variant.id} · ${failure}`);
  });
}

/**
 * Pulsa en seguida `target`, movido al compactar: la guarda D49 cancela el clic antes de que llegue al control
 * (`preventDefault` y `stopPropagation` en captura). Falla si el clic no cae en él o si llega sin cancelar; en un
 * «Descartar línea», también si la fila ya no lo tiene (se descartó).
 */
async function pressMoved(browser: Browser, target: Element): Promise<string[]> {
  const line = target.closest("li[data-line-index]");
  const discard = /Descartar línea/.test(target.textContent ?? "") && line instanceof HTMLElement ? line.dataset.lineIndex : undefined;
  const name = `${nameOf(target)} (${zoneOf(target)})`;
  let landed = false;
  let reached = false;
  const onWindowClick = (event: Event) => {
    landed ||= event.target instanceof Node && target.contains(event.target);
  };
  const onTargetClick = (event: Event) => {
    reached ||= !event.defaultPrevented;
  };
  window.addEventListener("click", onWindowClick, true);
  target.addEventListener("click", onTargetClick);
  try {
    await clickAt(browser, centerOf(target));
    await settle("pulsar lo movido");
  } finally {
    window.removeEventListener("click", onWindowClick, true);
    target.removeEventListener("click", onTargetClick);
  }
  if (!landed) {
    return [`el clic en ${name}, movido al compactar, no cayó en él: no comprueba la guarda D49`];
  }
  const now = discard === undefined ? null : panel().querySelector(`li[data-line-index="${discard}"]`);
  const discarded =
    discard !== undefined && !(now !== null && [...now.querySelectorAll("button")].some((item) => /Descartar línea/.test(item.textContent ?? "")));
  return reached || discarded ? [`${name}, movido al compactar, actuó al pulsarlo en seguida (sin guarda D49)`] : [];
}

/** Punto de la pantalla de cada control del panel, a la vista o no (lo que compara la guarda D49). */
function screenPlaces(): Map<Element, { top: number; left: number }> {
  return new Map(
    [...panel().querySelectorAll(CONTROL_SELECTOR)].map((element) => {
      const { top, left } = element.getBoundingClientRect();
      return [element, { left, top }] as const;
    }),
  );
}

/**
 * El usuario desplaza (desplazar no suelta nada, D72(a)) hasta tener `button` al pie de la franja visible (sobre el pie
 * fijo, si lo hay): encima se ve lo de antes del botón y, si debajo queda contenido, compactar no recorta el
 * desplazamiento y lo que sigue al hueco sube en pantalla (a 844×390, con el botón centrado, el recorte dejaba todo en
 * su sitio de la pantalla y ningún control movido a la vista).
 */
async function bringToBandBottom(button: HTMLElement) {
  const main = scroller();
  const footer = panel().querySelector('[data-layout-box="footer"]');
  const pinnedTop = footer && pinOf(footer, main) ? footer.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
  const bottom = Math.min(window.innerHeight, pinnedTop) - 8;
  main.scrollTop = Math.max(0, Math.min(main.scrollHeight - main.clientHeight, main.scrollTop + button.getBoundingClientRect().bottom - bottom));
  await settle("desplazar hasta «Compactar lista»");
  // Si el botón no queda a la vista, `clickElement` lo centraría desplazando y todo se movería en pantalla por eso.
  if (!isClear(button)) {
    throw new Error("«Compactar lista» no queda a la vista al pie de la franja visible");
  }
}

/** «Compactar lista»: sin pulsarlo nada se mueve; pulsado, se compacta y lo movido queda bajo la guarda D49. */
async function runCompact(browser: Browser, retention: Retention): Promise<string[]> {
  return withCase(RETENTIONS[retention].fixture, async () => {
    const failures: string[] = [];
    const { held: before } = await holdSomething(browser, retention, null);
    const waiting = trackPanel();
    const stop = sampleEveryFrame(waiting);
    await pause(PAUSE_MS);
    stop();
    const early = [waiting.report(), releasedBetween(before, heldNow())].filter((failure) => failure !== null);
    failures.push(...early.map((failure) => `sin pulsar «Compactar lista» ${failure}`));
    const button = compactButton();
    if (!button) {
      failures.push(`con ${heldText(before)} no hay botón «Compactar lista»`);
      return failures.map((failure) => `${retention} · compactar · ${failure}`);
    }
    await bringToBandBottom(button);
    const compaction = trackPanel();
    const onScreen = screenPlaces();
    const pressed = centerOf(button);
    await clickElement(browser, button);
    await settle("compactar");
    compaction.sample();
    const movedOnScreen = [...onScreen].filter(([element, at]) => {
      const box = element.getBoundingClientRect();
      return element.isConnected && (Math.abs(box.top - at.top) > 0.5 || Math.abs(box.left - at.left) > 0.5);
    });
    // El clic en el botón es una activación con el puntero (D46-a fija las cajas un momento): lo que dice que ya no queda
    // nada retenido es que el botón, visible solo con algo retenido, se fue.
    if (compactButton()) {
      failures.push("tras pulsar «Compactar lista» el botón sigue: queda algo retenido");
    }
    const moved = compaction.moved();
    if (moved.length === 0) {
      failures.push("tras pulsar «Compactar lista» no se movió nada: no compactó");
    }
    // D49: un control que se movió EN PANTALLA (bajo el puntero) y está a la vista, pulsado en seguida en su sitio nuevo, no
    // actúa. El primer «Descartar línea» si se ve alguno; si no, el control movido más cercano a donde se pulsó «Compactar
    // lista» (el siguiente toque del usuario cae ahí). Un control que solo se movió en el documento (el recorte del
    // desplazamiento al acortarse la página lo deja en el mismo punto de la pantalla) no está bajo la guarda.
    const candidates = movedOnScreen.map(([element]) => element).filter((element) => element.matches(HIT_SELECTOR) && isClear(element));
    const distance = (element: Element) => Math.hypot(centerOf(element).x - pressed.x, centerOf(element).y - pressed.y);
    const target =
      candidates.find((element) => element.matches("button") && /^Descartar línea/.test(element.textContent?.trim() ?? "")) ??
      [...candidates].sort((a, b) => distance(a) - distance(b))[0];
    if (!target) {
      failures.push("ningún control movido en pantalla por la compactación queda a la vista para comprobar la guarda D49");
    } else {
      failures.push(...(await pressMoved(browser, target)));
    }
    return failures.map((failure) => `${retention} · compactar · ${failure}`);
  });
}

/** `play` de una historia: la familia de gestos (o «Compactar lista») con `retention` a ese ancho. */
export function gesturePlay(family: Family | "compactar", retention: Retention, viewport: keyof typeof VIEWPORTS) {
  return async () => {
    const opened = await openViewport(viewport);
    if (!opened) {
      return;
    }
    const scale = window.visualViewport?.scale ?? 1;
    if (Math.abs(scale - 1) > 0.01) {
      throw new Error(`la página sigue ampliada (${scale.toFixed(2)}) por un pinch anterior`);
    }
    const results: string[][] = [];
    if (family === "compactar") {
      results.push(await runCompact(opened.browser, retention));
    } else {
      for (const variant of FAMILIES[family]) {
        results.push(await runVariant(opened.browser, retention, variant));
      }
    }
    await settleCdpAcks();
    const failures = results.flat().map((failure) => `${opened.label} ${failure}`);
    failures.forEach((failure) => console.warn(`[REP17-18 rojo] ${failure}`));
    const text = `${opened.label} ${family} con ${retention}: ${results.length} casos, ${results.filter((result) => result.length > 0).length} en rojo`;
    console.warn(`[REP17-18] ${text}`);
    await expect(failures, text).toEqual([]);
  };
}
