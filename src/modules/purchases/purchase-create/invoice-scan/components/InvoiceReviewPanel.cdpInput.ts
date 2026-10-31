/**
 * REP17-10 (M-r17Q3-1, D69(a)): clic, teclado y texto reales por CDP para las historias del panel de revisión.
 * Con la carpeta entera, en la ventana en que unos archivos acaban y otros arrancan, cada orden `userEvent` de
 * Playwright tardaba 0,3–13 s en volver (REP17-09), y cada acuse CDP 1,6–2,3 s (`rep17/10-diag-1-acuses.txt`) aunque la
 * entrada llegaba a la página al momento. Aquí las órdenes de un gesto van seguidas por la sesión CDP de la página (el
 * canal las entrega en orden), el paso siguiente arranca cuando el último evento del gesto llega a la ventana y los
 * acuses se esperan al final de la historia (`settleCdpAcks`): un fallo de CDP sigue haciendo fallar la historia.
 * REP17-11 (D69(a)): también el toque (`tapAt`), el clic en un punto (`clickAt`) y la tecla Espacio. Con
 * `npm run test:storybook` completo (todo el repo), mientras abren y cierran decenas de archivos, el acuse de una orden
 * ya llegada a la página tardaba hasta 15 s en volver (`rep17/11-diag-completo-1.txt`: llegada < 0,2 s, acuse 8–16 s):
 * esperarlo en el `afterEach` agotaba los 15 s de la historia. Ahora el `afterEach` comprueba los fallos de CDP ya
 * conocidos sin esperar los acuses de gestos llegados; los que lleguen después se comprueban en el siguiente.
 */
import type { CDPSession } from "vitest/browser";

type CdpBrowser = { cdp: () => CDPSession };
type Point = { x: number; y: number };

/**
 * La 1.ª orden CDP del archivo abre su sesión en el servidor: dos órdenes en frío podían abrir dos y adelantarse. Una
 * sola apertura por archivo para todos sus gestos: con dos, la 2.ª costaba otro acuse completo (2,2 s en la ventana,
 * `rep17/10-diag-2-marcas.txt`).
 */
let cdpOpened: Promise<unknown> | null = null;

export async function openCdpSession(browser: CdpBrowser) {
  const session = browser.cdp();
  cdpOpened ??= session.send("Runtime.evaluate", { expression: "0" });
  await cdpOpened;
  return session;
}

/**
 * REP17-11: la apertura cuesta dos idas y vueltas por el canal saturado (5 s en la 1.ª historia de un archivo,
 * `rep17/11-diag-completo-1.txt`); arranca al cargar el archivo, en paralelo con su 1.ª historia, y el 1.er gesto la
 * espera (si falla, falla ese gesto).
 */
if ("__vitest_browser__" in globalThis) {
  cdpOpened = import("vitest/browser").then((browser) => browser.cdp().send("Runtime.evaluate", { expression: "0" }));
}

/** Fallos de CDP de gestos ya llegados a la página, pendientes de que los vea un `settleCdpAcks`. */
const cdpFailures: unknown[] = [];

/**
 * Sigue el acuse de un gesto: si falla, el siguiente `settleCdpAcks` del archivo hace fallar la historia. Un gesto que no
 * llega a la página ya espera su acuse (`sendGesture`): su fallo hace fallar la historia en ese mismo paso.
 */
export function deferCdpAck(done: Promise<void>) {
  done.then(undefined, (error: unknown) => {
    cdpFailures.push(error);
  });
}

/**
 * Comprueba los fallos de CDP conocidos (`afterEach` o final del `play`). No espera los acuses en vuelo de gestos que ya
 * llegaron a la página: los fallos que traigan los ve el siguiente `settleCdpAcks` del archivo.
 */
export async function settleCdpAcks() {
  const failures = cdpFailures.splice(0);
  if (failures.length > 0) {
    throw new AggregateError(failures, `falló CDP en ${failures.length} gesto(s)`);
  }
}

/**
 * Manda las órdenes de un gesto seguidas y vuelve cuando llega a la ventana el `count`-ésimo `lastEvent` (o, si no
 * llega, cuando están los acuses).
 */
async function sendGesture(
  browser: CdpBrowser,
  lastEvent: "input" | "keyup" | "pointerup",
  count: number,
  send: (session: CDPSession) => Promise<unknown>[],
) {
  let seen = 0;
  let onEvent = () => {};
  const arrived = new Promise<void>((resolve) => {
    onEvent = () => {
      seen += 1;
      if (seen >= count) {
        resolve();
      }
    };
    window.addEventListener(lastEvent, onEvent, { capture: true });
  });
  const done = openCdpSession(browser)
    .then((session) => Promise.all(send(session)))
    .then(() => undefined);
  deferCdpAck(done);
  await Promise.race([arrived, done]);
  window.removeEventListener(lastEvent, onEvent, { capture: true });
}

/** Punto del documento de la story en la página de Playwright (el iframe del runner puede escalarse). */
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

/** Clic real con el ratón en `point` del documento de la story: lo recibe lo que esté ahí. */
export async function clickAt(browser: CdpBrowser, point: Point) {
  const { x, y } = pagePoint(point);
  await sendGesture(browser, "pointerup", 1, (session) => [
    session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
    session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }),
    session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }),
  ]);
}

/**
 * Toque real (CDP `Input.dispatchTouchEvent`) en `point` del documento de la story: pointerdown/up con `pointerType`
 * touch y su clic. La emulación táctil se apaga en el mismo gesto aunque falle el toque (cada orden va por separado).
 */
export async function tapAt(browser: CdpBrowser, point: Point) {
  const touch = pagePoint(point);
  await sendGesture(browser, "pointerup", 1, (session) => [
    session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }),
    session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] }),
    session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
    session.send("Emulation.setTouchEmulationEnabled", { enabled: false }),
  ]);
}

function centerOf(element: HTMLElement): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Clic real con el ratón en el centro de `element`. Como el clic de Playwright, si no se alcanza lo trae a la vista;
 * centrado, tiene que quedar sin nada encima.
 */
export async function clickElement(browser: CdpBrowser, element: HTMLElement) {
  const hitAtCenter = () => {
    const center = centerOf(element);
    return document.elementFromPoint(center.x, center.y);
  };
  if (!element.contains(hitAtCenter())) {
    element.scrollIntoView({ block: "center" });
  }
  const hit = hitAtCenter();
  if (!hit || !element.contains(hit)) {
    throw new Error(`el centro de «${element.getAttribute("aria-label") ?? element.tagName}» queda bajo ${hit?.tagName ?? "nada"} incluso centrado`);
  }
  await clickAt(browser, centerOf(element));
}

type KeyDefinition = { code: string; key: string; keyCode: number; text?: string };

const NAMED_KEYS: Record<string, KeyDefinition> = {
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  Backspace: { code: "Backspace", key: "Backspace", keyCode: 8 },
  Enter: { code: "Enter", key: "Enter", keyCode: 13, text: "\r" },
  Space: { code: "Space", key: " ", keyCode: 32, text: " " },
  Tab: { code: "Tab", key: "Tab", keyCode: 9 },
};

/** `{Tab}`, `{Backspace}`, `{ArrowDown}`, `{Enter}`, `{Space}` y dígitos, con la sintaxis de `userEvent.keyboard`. */
function parseKeys(keys: string): KeyDefinition[] {
  return [...keys.matchAll(/\{(\w+)\}|(\d)|(.)/g)].map(([token, named, digit]) => {
    if (digit) {
      return { code: `Digit${digit}`, key: digit, keyCode: 48 + Number(digit), text: digit };
    }
    const definition = named ? NAMED_KEYS[named] : undefined;
    if (!definition) {
      throw new Error(`tecla sin definir: «${token}»`);
    }
    return definition;
  });
}

/** Pulsa las teclas en orden con el teclado real (CDP `Input.dispatchKeyEvent`) sobre el foco actual. */
export async function pressKeys(browser: CdpBrowser, keys: string) {
  const parsed = parseKeys(keys);
  await sendGesture(browser, "keyup", parsed.length, (session) =>
    parsed.flatMap(({ code, key, keyCode, text }) => [
      session.send("Input.dispatchKeyEvent", {
        type: text ? "keyDown" : "rawKeyDown",
        code,
        key,
        text,
        unmodifiedText: text,
        windowsVirtualKeyCode: keyCode,
      }),
      session.send("Input.dispatchKeyEvent", { type: "keyUp", code, key, windowsVirtualKeyCode: keyCode }),
    ]),
  );
}

/** Escribe `text` donde está el cursor del campo enfocado (CDP `Input.insertText`: `beforeinput` e `input` reales). */
export async function typeText(browser: CdpBrowser, text: string) {
  await sendGesture(browser, "input", 1, (session) => [session.send("Input.insertText", { text })]);
}

/**
 * Como `userEvent.fill` de Playwright: enfoca el campo, selecciona lo que tenga y lo sustituye por `text` (CDP
 * `Input.insertText`). El campo tiene que admitir escritura y quedar con `text`.
 */
export async function fillField(browser: CdpBrowser, field: HTMLElement, text: string) {
  if (!(field instanceof HTMLInputElement) || field.disabled || field.readOnly) {
    throw new Error(`«${field.getAttribute("aria-label") ?? field.tagName}» no es un campo en que se pueda escribir`);
  }
  field.focus();
  if (document.activeElement !== field) {
    throw new Error(`«${field.getAttribute("aria-label") ?? field.name}» no recibe el foco`);
  }
  field.select();
  await typeText(browser, text);
  if (field.value !== text) {
    throw new Error(`«${field.getAttribute("aria-label") ?? field.name}» dice «${field.value}» tras escribir «${text}»`);
  }
}

/**
 * REP17-17 (D72(b)): «Compactar lista» con el teclado real (foco sin desplazar y Enter por CDP), sin mover el puntero.
 * Devuelve el botón pulsado, o `null` si no se ofrecía (nada retenido).
 */
export async function compactList(browser: CdpBrowser): Promise<HTMLElement | null> {
  const button = [...document.querySelectorAll<HTMLElement>("[data-testid='invoice-review-compact-slot'] button")].find(
    (candidate) => candidate.textContent?.trim() === "Compactar lista",
  );
  if (!button) {
    return null;
  }
  button.focus({ preventScroll: true });
  await pressKeys(browser, "{Enter}");
  return button;
}
