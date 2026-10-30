import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";

import { useLayoutHold } from "./useLayoutHold";

/**
 * REP17-14 (gate g3 de REP17, historia «Anclaje Compactacion 1280 Raton Salir»): con el layout pendiente tras descartar L1
 * con el ratón, el ratón sale del panel y gira la rueda fuera de él. El desplazamiento de la rueda llega a la página en un
 * frame que no depende de la revisión: antes que el evento `wheel` (lo habitual), después (máquina cargada: el `wheel` se
 * despacha antes de que el desplazamiento llegue al hilo principal) o repartido en varios frames, uno de ellos entre la
 * liberación y su render. REP17-17 (D72(a)): la rueda ya no suelta nada; en todos los repartos sigue retenido y L2 se mueve
 * exactamente lo desplazado (la compensación del control pulsado no deshace el desplazamiento).
 */

/** Geometría simulada (px): alto visible del contenedor y su desplazamiento. */
const geometry = { client: 560, scrollTop: 0 };
const PANEL_LEFT = 16;
const PANEL_WIDTH = 1248;
/** Contenido encima de L1 (cabecera y L0). */
const L1_TOP = 674;
const L1_PENDING = 279;
const L1_DISCARDED = 85;
const L2_HEIGHT = 400;
const CONTENT_BELOW = 1200;
/** «Descartar línea» de L1 (pendiente) y «Restaurar línea» de L1 (descartada), desde el principio de L1. */
const DISCARD_OFFSET = 126;
const RESTORE_OFFSET = 38;
/** Control de L2 desde el principio de L2. */
const L2_CONTROL_OFFSET = 64;
const CONTROL_HEIGHT = 36;
const WHEEL_PX = 100;
/** Lo que del desplazamiento de la rueda llega en un frame posterior a su 1.er `scroll`. */
const LATE_PX = 20;

function l1Height() {
  const l1 = document.querySelector<HTMLElement>("[data-layout-box='row:1']");
  const natural = l1?.dataset.status === "discarded" ? L1_DISCARDED : L1_PENDING;
  return Math.max(natural, Number.parseFloat(l1?.style.minHeight ?? "") || 0);
}

function contentHeight() {
  return L1_TOP + l1Height() + L2_HEIGHT + CONTENT_BELOW;
}

function box(top: number, height: number) {
  return { bottom: top + height, height, left: PANEL_LEFT, right: PANEL_LEFT + PANEL_WIDTH, top, width: PANEL_WIDTH, x: PANEL_LEFT, y: top, toJSON: () => ({}) };
}

function fakeRect(this: Element) {
  const l1Top = L1_TOP - geometry.scrollTop;
  const l2Top = l1Top + l1Height();
  switch (this.closest<HTMLElement>("[data-geo]")?.dataset.geo) {
    case "discard":
      return box(l1Top + DISCARD_OFFSET, CONTROL_HEIGHT);
    case "restore":
      return box(l1Top + RESTORE_OFFSET, CONTROL_HEIGHT);
    case "l1":
      return box(l1Top, l1Height());
    case "l2-control":
      return box(l2Top + L2_CONTROL_OFFSET, CONTROL_HEIGHT);
    case "l2":
      return box(l2Top, L2_HEIGHT);
    default:
      return box(-geometry.scrollTop, contentHeight());
  }
}

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  const hold = useLayoutHold<string[]>(rootRef, () => undefined);
  const [discarded, setDiscarded] = useState(false);
  return (
    <main data-geo="scroller" data-testid="scroller" style={{ overflowY: "auto" }}>
      <div data-geo="root" data-held={hold.order ? "yes" : "no"} data-testid="root" ref={rootRef}>
        <section
          data-geo="l1"
          data-layout-box="row:1"
          data-status={discarded ? "discarded" : "pending"}
          style={hold.boxStyle("row:1")}
        >
          {discarded ? (
            <button data-geo="restore" key="restore" type="button">
              Restaurar línea
            </button>
          ) : (
            <button
              data-geo="discard"
              key="discard"
              onClick={() => setDiscarded(true)}
              onClickCapture={(event) => hold.holdLayout(event.currentTarget, ["L1", "L2"])}
              type="button"
            >
              Descartar línea
            </button>
          )}
        </section>
        <section data-geo="l2" data-layout-box="row:2" style={hold.boxStyle("row:2")}>
          <button data-geo="l2-control" type="button">
            CAOSG Jabon Azul 250
          </button>
        </section>
      </div>
    </main>
  );
}

function scroller() {
  return screen.getByTestId("scroller");
}

function l2() {
  return document.querySelector<HTMLElement>("[data-layout-box='row:2']") ?? document.body;
}

function wireScroller() {
  Object.defineProperty(scroller(), "scrollTop", {
    configurable: true,
    get: () => geometry.scrollTop,
    set: (value: number) => {
      geometry.scrollTop = Math.min(Math.max(0, value), Math.max(0, contentHeight() - geometry.client));
    },
  });
  Object.defineProperty(scroller(), "scrollHeight", { configurable: true, get: contentHeight });
  Object.defineProperty(scroller(), "clientHeight", { configurable: true, get: () => geometry.client });
}

/** jsdom no implementa PointerEvent: un MouseEvent con `pointerType: "mouse"`. */
function mouse(type: "pointermove" | "pointerdown", target: Element, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(target, event);
}

/** Implementación jsdom de un objeto del DOM: su única propiedad símbolo propia. */
function jsdomImpl(object: object): object {
  const [impl] = Object.getOwnPropertySymbols(object).map((symbol) => Reflect.get(object, symbol));
  return impl;
}

/**
 * La rueda real (`deltaY` px) sobre `target`: el navegador la despacha como evento de confianza (`isTrusted`), y solo esa
 * desplaza la página. `dispatchEvent` la marcaría sintética: se despacha como jsdom despacha los suyos (`_dispatch` de la
 * implementación del destino), marcada de confianza.
 */
function trustedWheel(target: Element, deltaY: number) {
  const event = new WheelEvent("wheel", { bubbles: true, deltaY });
  const impl = jsdomImpl(event);
  Reflect.set(impl, "isTrusted", true);
  expect(event.isTrusted).toBe(true);
  const dispatch: unknown = Reflect.get(jsdomImpl(target), "_dispatch");
  if (typeof dispatch !== "function") {
    throw new Error("jsdom sin _dispatch");
  }
  Reflect.apply(dispatch, jsdomImpl(target), [impl]);
}

/** El desplazamiento de la rueda llega a la página: cambia `scrollTop` (el `scroll` lo despacha el frame siguiente). */
function landScroll(px: number) {
  geometry.scrollTop += px;
}

type Order = "rueda y luego su desplazamiento" | "desplazamiento y luego la rueda" | "desplazamiento en dos frames";

describe("REP17-14 · REP17-17 · la rueda no suelta el layout retenido en ningún reparto de frames", () => {
  let rect: jest.SpyInstance;
  const elementFromPoint = document.elementFromPoint;

  beforeEach(() => {
    geometry.scrollTop = L1_TOP;
    rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
    Element.prototype.scrollBy = function scrollBy(this: Element, options?: ScrollToOptions | number) {
      this.scrollTop += typeof options === "object" ? (options.top ?? 0) : 0;
    };
    document.elementFromPoint = (x: number, y: number) => {
      if (x < PANEL_LEFT) {
        return document.body;
      }
      const hit = [...document.querySelectorAll("button, [data-layout-box]")].find((element) => {
        const { top, bottom } = element.getBoundingClientRect();
        return y >= top && y <= bottom;
      });
      return hit ?? screen.getByTestId("root");
    };
  });

  afterEach(() => {
    rect.mockRestore();
    Reflect.deleteProperty(Element.prototype, "scrollBy");
    document.elementFromPoint = elementFromPoint;
  });

  it.each<Order>(["rueda y luego su desplazamiento", "desplazamiento y luego la rueda", "desplazamiento en dos frames"])(
    "%s: L2 se mueve solo lo desplazado",
    async (order) => {
      render(<Harness />);
      wireScroller();
      const discard = screen.getByRole("button", { name: "Descartar línea" });
      const point = { x: 432, y: discard.getBoundingClientRect().top + CONTROL_HEIGHT / 2 };
      mouse("pointermove", discard, point.x, point.y);
      mouse("pointerdown", discard, point.x, point.y);
      fireEvent.click(discard, { clientX: point.x, clientY: point.y, detail: 1 });
      expect(screen.getByTestId("root")).toHaveAttribute("data-held", "yes");
      expect(l1Height()).toBe(L1_PENDING);
      const before = l2().getBoundingClientRect().top;
      mouse("pointermove", scroller(), 4, 280);

      if (order === "rueda y luego su desplazamiento") {
        act(() => trustedWheel(scroller(), WHEEL_PX));
        landScroll(WHEEL_PX);
        fireEvent.scroll(scroller());
      } else if (order === "desplazamiento y luego la rueda") {
        landScroll(WHEEL_PX);
        act(() => trustedWheel(scroller(), WHEEL_PX));
        fireEvent.scroll(scroller());
      } else {
        // 80 px llegan con el `wheel`; su `scroll` suelta lo retenido y los 20 restantes llegan antes del render que sigue.
        const previous = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
        try {
          landScroll(WHEEL_PX - LATE_PX);
          trustedWheel(scroller(), WHEEL_PX);
          scroller().dispatchEvent(new Event("scroll"));
          landScroll(LATE_PX);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
          Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previous);
        }
        await act(async () => {
          fireEvent.scroll(scroller());
        });
      }

      expect(screen.getByTestId("root")).toHaveAttribute("data-held", "yes");
      expect(l1Height()).toBe(L1_PENDING);
      expect(l2().getBoundingClientRect().top - (before - WHEEL_PX)).toBe(0);
    },
  );
});
