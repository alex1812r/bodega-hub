/**
 * REP17-10 (M-r17Q3-1, D69(a)): clic, teclado y texto reales por CDP para las historias del panel de revisión.
 * Con la carpeta entera, en la ventana en que unos archivos acaban y otros arrancan, cada orden `userEvent` de
 * Playwright tardaba 0,3–13 s en volver (REP17-09), y cada acuse CDP 1,6–2,3 s (`rep17/10-diag-1-acuses.txt`) aunque la
 * entrada llegaba a la página al momento. Aquí las órdenes de un gesto van seguidas por la sesión CDP de la página (el
 * canal las entrega en orden), el paso siguiente arranca cuando el último evento del gesto llega a la ventana y los
 * acuses se esperan al final de la historia (`settleCdpAcks`): un fallo de CDP sigue haciendo fallar la historia.
 */
import type { CDPSession } from "vitest/browser";

type CdpBrowser = { cdp: () => CDPSession };
type Point = { x: number; y: number };

/** La 1.ª orden CDP del archivo abre su sesión en el servidor: dos órdenes en frío podían abrir dos y adelantarse. */
let cdpOpened: Promise<unknown> | null = null;

/** Acuses CDP de los gestos ya llegados a la página, pendientes hasta el final de la historia. */
const pendingAcks: Promise<void>[] = [];

/** Deja el acuse de un gesto para `settleCdpAcks`. */
export function deferCdpAck(done: Promise<void>) {
  pendingAcks.push(done);
}

/** Espera los acuses de todos los gestos de la historia (`afterEach` o final del `play`). */
export async function settleCdpAcks() {
  await Promise.all(pendingAcks.splice(0));
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
  const session = browser.cdp();
  cdpOpened ??= session.send("Runtime.evaluate", { expression: "0" });
  const done = cdpOpened.then(() => Promise.all(send(session))).then(() => undefined);
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
  const { x, y } = pagePoint(centerOf(element));
  await sendGesture(browser, "pointerup", 1, (session) => [
    session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
    session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }),
    session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }),
  ]);
}

type KeyDefinition = { code: string; key: string; keyCode: number; text?: string };

const NAMED_KEYS: Record<string, KeyDefinition> = {
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  Backspace: { code: "Backspace", key: "Backspace", keyCode: 8 },
  Enter: { code: "Enter", key: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", key: "Tab", keyCode: 9 },
};

/** `{Tab}`, `{Backspace}`, `{ArrowDown}`, `{Enter}` y dígitos, con la sintaxis de `userEvent.keyboard`. */
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
