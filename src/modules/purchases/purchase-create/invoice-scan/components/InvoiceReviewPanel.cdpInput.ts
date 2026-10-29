/**
 * REP17-10 (M-r17Q3-1, D69(a)): clic, teclado y texto reales por CDP para las historias del panel de revisión.
 * Con la carpeta entera, en la ventana en que unos archivos acaban y otros arrancan, cada orden `userEvent` de
 * Playwright tardaba 0,3–13 s en volver (REP17-09). Aquí las órdenes de un gesto van seguidas por la sesión CDP de la
 * página (el canal las entrega en orden) y solo se espera su acuse.
 */
import type { CDPSession } from "vitest/browser";

type CdpBrowser = { cdp: () => CDPSession };
type Point = { x: number; y: number };

/** La 1.ª orden CDP del archivo abre su sesión en el servidor: dos órdenes en frío podían abrir dos y adelantarse. */
let cdpOpened: Promise<unknown> | null = null;

async function sendInOrder(browser: CdpBrowser, send: (session: CDPSession) => Promise<unknown>[]) {
  const session = browser.cdp();
  cdpOpened ??= session.send("Runtime.evaluate", { expression: "0" });
  await cdpOpened;
  await Promise.all(send(session));
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

/** Clic real con el ratón en el centro de `element`, que tiene que estar a la vista y sin nada encima. */
export async function clickElement(browser: CdpBrowser, element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const hit = document.elementFromPoint(center.x, center.y);
  if (!hit || !element.contains(hit)) {
    throw new Error(`el centro de «${element.getAttribute("aria-label") ?? element.textContent ?? element.tagName}» queda bajo ${hit?.tagName ?? "nada"}`);
  }
  const { x, y } = pagePoint(center);
  await sendInOrder(browser, (session) => [
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
  await sendInOrder(browser, (session) =>
    parseKeys(keys).flatMap(({ code, key, keyCode, text }) => [
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
  await sendInOrder(browser, (session) => [session.send("Input.insertText", { text })]);
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
