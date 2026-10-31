/**
 * REP17-18 · D72(d): gestos reales por CDP que `InvoiceReviewPanel.cdpInput.ts` no tiene (rueda, arrastre y pinch con el
 * dedo, movimientos del ratón y teclas con Mayúsculas), con su mismo contrato: las órdenes de un gesto van seguidas por
 * la sesión CDP del archivo, el gesto vuelve cuando su último evento llega a la ventana de la story (o, si no llega,
 * cuando están los acuses) y los fallos de CDP los ve el `settleCdpAcks` siguiente.
 */
import type { CDPSession } from "vitest/browser";

import { deferCdpAck, openCdpSession } from "./InvoiceReviewPanel.cdpInput";

type CdpBrowser = Parameters<typeof openCdpSession>[0];
export type Point = { x: number; y: number };

/** Qué evento de la ventana dice que el gesto llegó: el `count`-ésimo de `type` que cumpla `match`. */
type Arrival = { type: "keyup" | "pointermove" | "touchend" | "wheel"; count: number; match?: (event: Event) => boolean };

async function sendGesture(browser: CdpBrowser, arrival: Arrival, send: (session: CDPSession) => Promise<unknown>[]) {
  let seen = 0;
  let onEvent: (event: Event) => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    onEvent = (event) => {
      if (arrival.match && !arrival.match(event)) {
        return;
      }
      seen += 1;
      if (seen >= arrival.count) {
        resolve();
      }
    };
    window.addEventListener(arrival.type, onEvent, { capture: true });
  });
  const done = openCdpSession(browser)
    .then((session) => Promise.all(send(session)))
    .then(() => undefined);
  deferCdpAck(done);
  await Promise.race([arrived, done]);
  window.removeEventListener(arrival.type, onEvent, { capture: true });
}

/**
 * Punto del documento de la story en la página de Playwright (el iframe del runner puede escalarse). El mismo cálculo
 * que `pagePoint` de `InvoiceReviewPanel.cdpInput.ts`, que no lo exporta.
 */
function pagePoint(point: Point): Point {
  let { x, y } = point;
  // `frameElement` es del documento padre (otro reino): `instanceof HTMLElement` no sirve.
  for (let view: Window = window, frame = view.frameElement; frame; view = view.parent, frame = view.frameElement) {
    const box = frame.getBoundingClientRect();
    const width = frame.clientWidth + 2 * frame.clientLeft;
    const scale = width ? box.width / width : 1;
    x = box.left + (frame.clientLeft + x) * scale;
    y = box.top + (frame.clientTop + y) * scale;
  }
  return { x, y };
}

export type WheelStep = { dx: number; dy: number };

/** El ratón llega a `point` y gira la rueda: un `mouseWheel` real por paso (vertical, horizontal o ambos). */
export async function wheelAt(browser: CdpBrowser, point: Point, steps: readonly WheelStep[]) {
  const { x, y } = pagePoint(point);
  await sendGesture(browser, { count: steps.length, type: "wheel" }, (session) => [
    session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
    ...steps.map(({ dx, dy }) => session.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy })),
  ]);
}

/**
 * Trazo del dedo: los puntos (en el documento de la story) con su instante relativo en ms. Chrome calcula la velocidad
 * del lanzamiento (flick) con el `timestamp` de cada evento: un trazo que acaba quieto (`liftAfterMs` sin moverse) no
 * lanza; uno que se levanta en marcha, sí.
 */
export type TouchStroke = { points: readonly Point[]; stepMs: number; liftAfterMs: number };

/** Arrastre real con un dedo (CDP `Input.dispatchTouchEvent` con la emulación táctil, que se apaga en el mismo gesto). */
export async function touchDrag(browser: CdpBrowser, stroke: TouchStroke) {
  const [first, ...rest] = stroke.points.map(pagePoint);
  if (!first) {
    throw new Error("trazo sin puntos");
  }
  const start = Date.now() / 1000;
  const at = (ms: number) => start + ms / 1000;
  await sendGesture(browser, { count: 1, type: "touchend" }, (session) => [
    session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 }),
    session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first], timestamp: at(0) }),
    ...rest.map((point, index) =>
      session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point], timestamp: at((index + 1) * stroke.stepMs) }),
    ),
    session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
      timestamp: at(rest.length * stroke.stepMs + stroke.liftAfterMs),
    }),
    session.send("Emulation.setTouchEmulationEnabled", { enabled: false }),
  ]);
}

/**
 * Pinch real con dos dedos alrededor de `center`: se separan `spread` px en vertical en `steps` pasos (amplía), vuelven a
 * juntarse otros tantos (reduce: la página queda a escala 1 para la historia siguiente) y se levantan.
 */
export async function pinchAt(browser: CdpBrowser, center: Point, spread: number, steps: number) {
  const fingers = (k: number) => {
    const offset = 30 + (spread * k) / steps / 2;
    return [
      { ...pagePoint({ x: center.x, y: center.y - offset }), id: 1 },
      { ...pagePoint({ x: center.x + 16, y: center.y + offset }), id: 2 },
    ];
  };
  const start = Date.now() / 1000;
  const at = (ms: number) => start + ms / 1000;
  await sendGesture(browser, { count: 1, type: "touchend" }, (session) => [
    session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 }),
    session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(0), timestamp: at(0) }),
    ...Array.from({ length: 2 * steps }, (_, index) => {
      const k = index < steps ? index + 1 : 2 * steps - index - 1;
      return session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(k), timestamp: at((index + 1) * 16) });
    }),
    session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: at(2 * steps * 16 + 200) }),
    session.send("Emulation.setTouchEmulationEnabled", { enabled: false }),
  ]);
}

/**
 * El ratón recorre `path` (sin botones). Vuelve cuando llega a la story el movimiento a `arrivesAt`, el último punto del
 * recorrido que cae dentro de la ventana de la story (los de fuera salen de ella y no llegan).
 */
export async function moveMouse(browser: CdpBrowser, path: readonly Point[], arrivesAt: Point) {
  const near = (event: Event) =>
    event instanceof PointerEvent && Math.abs(event.clientX - arrivesAt.x) < 1.5 && Math.abs(event.clientY - arrivesAt.y) < 1.5;
  await sendGesture(browser, { count: 1, match: near, type: "pointermove" }, (session) =>
    path.map((point) => session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...pagePoint(point) })),
  );
}

/** Movimientos del ratón que salen de la ventana de la story: no llega nada que esperar; sus acuses se siguen igual. */
export function moveMouseOut(browser: CdpBrowser, path: readonly Point[]) {
  const done = openCdpSession(browser)
    .then((session) => Promise.all(path.map((point) => session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...pagePoint(point) }))))
    .then(() => undefined);
  deferCdpAck(done);
}

type Key = { code: string; key: string; keyCode: number };

const KEYS = {
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", keyCode: 38 },
  Tab: { code: "Tab", key: "Tab", keyCode: 9 },
} satisfies Record<string, Key>;

const SHIFT: Key = { code: "ShiftLeft", key: "Shift", keyCode: 16 };
const SHIFT_MODIFIER = 8;

/** Pulsa las teclas en orden con el teclado real; con `shift`, cada una con Mayúsculas pulsada (Shift+Tab). */
export async function pressNavigation(browser: CdpBrowser, keys: readonly (keyof typeof KEYS)[], shift = false) {
  const modifiers = shift ? SHIFT_MODIFIER : 0;
  const down = (key: Key, mods: number) =>
    ({ type: "rawKeyDown", code: key.code, key: key.key, modifiers: mods, windowsVirtualKeyCode: key.keyCode }) as const;
  const up = (key: Key, mods: number) =>
    ({ type: "keyUp", code: key.code, key: key.key, modifiers: mods, windowsVirtualKeyCode: key.keyCode }) as const;
  const strokes = keys.flatMap((name) => [down(KEYS[name], modifiers), up(KEYS[name], modifiers)]);
  const events = shift ? [down(SHIFT, SHIFT_MODIFIER), ...strokes, up(SHIFT, 0)] : strokes;
  await sendGesture(browser, { count: events.filter((event) => event.type === "keyUp").length, type: "keyup" }, (session) =>
    events.map((event) => session.send("Input.dispatchKeyEvent", event)),
  );
}
