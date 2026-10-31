import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";

import { useLayoutHold } from "./useLayoutHold";

/**
 * REP17-16 (QA5 de REP17):
 * - M-r17Q5-1: Chromium manda `pointermove` táctiles (pointerType `touch`) antes del primer `touchmove`. Borraban el control
 *   que REP17-15 elige al apoyar el dedo, y se volvía a anclar en el punto del dedo: con el dedo en el hueco retenido de L1
 *   (lado de L2) L2 subía lo soltado. Solo el ratón (o un toque sin arrastre) borra esa elección.
 * - B-r17Q5-2 (D71(a), «solo libera el desplazamiento real»): arrastrar el dedo o girar la rueda donde no desplaza nada (la
 *   barra superior fija, fuera del panel) soltaba lo retenido sin ancla. Ahora sigue retenido hasta un desplazamiento real.
 * REP17-17 (D72(a)): tampoco el desplazamiento real suelta nada: en todos los casos sigue retenido.
 */

/** Geometría simulada (px): alto visible del contenedor y su desplazamiento. */
const geometry = { client: 560, scrollTop: 0 };
const PANEL_LEFT = 16;
const PANEL_WIDTH = 374;
/** Barra superior fija de la app, fuera del panel. */
const HEADER_HEIGHT = 56;
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
/**
 * Punto del hueco retenido de L1 en que se apoya el dedo, desde el principio de L1: a 146 px de «Restaurar línea» y a
 * 123 px del control de L2 (15 px más arriba ya está más cerca de «Restaurar línea»).
 */
const FINGER_OFFSET = 220;
const DRAG_PX = 30;
const FINGER_X = 200;
const WHEEL_PX = 100;

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
    case "header":
      return box(0, HEADER_HEIGHT);
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

/** `arrival`: una llegada asíncrona cambia el orden de las filas (D67(a)): se retiene sin layout pendiente. */
function Harness({ arrival = false }: { arrival?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hold = useLayoutHold<string[]>(rootRef, () => undefined);
  const [discarded, setDiscarded] = useState(false);
  const { retainOrder } = hold;
  useEffect(() => {
    if (arrival) {
      retainOrder(["L1", "L2"]);
    }
  }, [arrival, retainOrder]);
  return (
    <>
      <header data-geo="header" data-testid="header">
        BodegaHub
      </header>
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
    </>
  );
}

function scroller() {
  return screen.getByTestId("scroller");
}

function header() {
  return screen.getByTestId("header");
}

function l1() {
  return document.querySelector<HTMLElement>("[data-layout-box='row:1']") ?? document.body;
}

function l2() {
  return document.querySelector<HTMLElement>("[data-layout-box='row:2']") ?? document.body;
}

function held() {
  return screen.getByTestId("root").dataset.held;
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

/** jsdom no implementa PointerEvent: un MouseEvent con `pointerType: "touch"`, como los que Chromium manda con el dedo. */
function touchPointer(type: "pointerdown" | "pointermove", target: Element, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  fireEvent(target, event);
}

/** Implementación jsdom de un objeto del DOM: su única propiedad símbolo propia. */
function jsdomImpl(object: object): object {
  const [impl] = Object.getOwnPropertySymbols(object).map((symbol) => Reflect.get(object, symbol));
  return impl;
}

/** La rueda real (`isTrusted`) sobre `target`, como en REP17-14. */
function trustedWheel(target: Element, init: WheelEventInit) {
  const event = new WheelEvent("wheel", { bubbles: true, ...init });
  const impl = jsdomImpl(event);
  Reflect.set(impl, "isTrusted", true);
  expect(event.isTrusted).toBe(true);
  const dispatch: unknown = Reflect.get(jsdomImpl(target), "_dispatch");
  if (typeof dispatch !== "function") {
    throw new Error("jsdom sin _dispatch");
  }
  act(() => {
    Reflect.apply(dispatch, jsdomImpl(target), [impl]);
  });
}

/** Toque (sin arrastre) en «Descartar línea» de L1: layout pendiente; levantar el dedo no lo suelta (D71(a)). */
function tapDiscard() {
  const discard = screen.getByRole("button", { name: "Descartar línea" });
  const tap = { x: FINGER_X, y: discard.getBoundingClientRect().top + CONTROL_HEIGHT / 2 };
  touchPointer("pointerdown", discard, tap.x, tap.y);
  fireEvent.touchStart(discard, { touches: [{ clientX: tap.x, clientY: tap.y }] });
  fireEvent.touchEnd(discard, { touches: [] });
  fireEvent.click(discard, { clientX: tap.x, clientY: tap.y, detail: 1 });
  expect(held()).toBe("yes");
  expect(l1Height()).toBe(L1_PENDING);
}

/** Arrastre del dedo de 30 px hacia arriba sobre la barra fija (no desplaza nada), con los `pointermove` de Chromium. */
function dragOnHeader() {
  const start = HEADER_HEIGHT / 2 + 10;
  touchPointer("pointerdown", header(), FINGER_X, start);
  fireEvent.touchStart(header(), { touches: [{ clientX: FINGER_X, clientY: start }] });
  touchPointer("pointermove", header(), FINGER_X, start - 4);
  for (let step = 1; step <= 3; step += 1) {
    act(() => {
      fireEvent.touchMove(header(), { touches: [{ clientX: FINGER_X, clientY: start - (DRAG_PX * step) / 3 }] });
    });
  }
  fireEvent.touchEnd(header(), { touches: [] });
}

type Drag = "touchmove y luego su desplazamiento" | "holgura: el contenido sube la mitad que el dedo";

describe("REP17-16 · REP17-17 · ni el dedo, ni la rueda, ni el desplazamiento real sueltan lo retenido", () => {
  let rect: jest.SpyInstance;
  const elementFromPoint = document.elementFromPoint;

  beforeEach(() => {
    geometry.scrollTop = L1_TOP;
    rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
    Element.prototype.scrollBy = function scrollBy(this: Element, options?: ScrollToOptions | number) {
      this.scrollTop += typeof options === "object" ? (options.top ?? 0) : 0;
    };
    document.elementFromPoint = (_x: number, y: number) => {
      if (y < HEADER_HEIGHT) {
        return header();
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

  it.each<Drag>(["touchmove y luego su desplazamiento", "holgura: el contenido sube la mitad que el dedo"])(
    "M-r17Q5-1 · pointermove táctiles antes del primer touchmove (%s): L2 se mueve solo lo desplazado",
    (drag) => {
      render(<Harness />);
      wireScroller();
      tapDiscard();

      // El dedo se apoya sobre el hueco retenido de L1 (más cerca del control de L2) y sube 30 px; Chromium manda sus
      // `pointermove` dentro del umbral de arrastre antes del primer `touchmove`.
      const start = l1().getBoundingClientRect().top + FINGER_OFFSET;
      expect(document.elementFromPoint(FINGER_X, start)).toBe(l1());
      const before = l2().getBoundingClientRect().top;
      touchPointer("pointerdown", l1(), FINGER_X, start);
      fireEvent.touchStart(l1(), { touches: [{ clientX: FINGER_X, clientY: start }] });
      touchPointer("pointermove", l1(), FINGER_X, start - 4);
      touchPointer("pointermove", l1(), FINGER_X, start - 8);
      const landed = drag === "touchmove y luego su desplazamiento" ? DRAG_PX : DRAG_PX / 2;
      act(() => {
        fireEvent.touchMove(l1(), { touches: [{ clientX: FINGER_X, clientY: start - DRAG_PX }] });
      });
      geometry.scrollTop += landed;
      act(() => {
        fireEvent.scroll(scroller());
      });
      fireEvent.touchEnd(l1(), { touches: [] });

      expect(held()).toBe("yes");
      expect(l1Height()).toBe(L1_PENDING);
      expect(l2().getBoundingClientRect().top - (before - landed)).toBe(0);
    },
  );

  it("B-r17Q5-2 · layout pendiente: dedo y rueda sobre la barra fija (sin desplazamiento) no sueltan; el desplazamiento real tampoco", () => {
    render(<Harness />);
    wireScroller();
    tapDiscard();
    const before = l2().getBoundingClientRect().top;

    dragOnHeader();
    expect(held()).toBe("yes");
    expect(l2().getBoundingClientRect().top).toBe(before);

    trustedWheel(header(), { clientX: FINGER_X, clientY: HEADER_HEIGHT / 2, deltaY: WHEEL_PX });
    expect(held()).toBe("yes");
    expect(l2().getBoundingClientRect().top).toBe(before);

    // Ctrl+rueda es zoom: sin cambio de ancho no recoloca nada ni desplaza.
    trustedWheel(l2(), { clientX: FINGER_X, clientY: before + 10, ctrlKey: true, deltaY: WHEEL_PX });
    expect(held()).toBe("yes");
    expect(l2().getBoundingClientRect().top).toBe(before);

    geometry.scrollTop += WHEEL_PX;
    act(() => {
      fireEvent.scroll(scroller());
    });
    expect(held()).toBe("yes");
    expect(l1Height()).toBe(L1_PENDING);
    expect(l2().getBoundingClientRect().top).toBe(before - WHEEL_PX);
  });

  it("B-r17Q5-2 · orden retenido tras una llegada: dedo y rueda sobre la barra fija no lo sueltan; el desplazamiento real tampoco", () => {
    const { rerender } = render(<Harness />);
    wireScroller();
    rerender(<Harness arrival />);
    expect(held()).toBe("yes");

    dragOnHeader();
    expect(held()).toBe("yes");

    trustedWheel(header(), { clientX: FINGER_X, clientY: HEADER_HEIGHT / 2, deltaY: WHEEL_PX });
    expect(held()).toBe("yes");

    geometry.scrollTop += WHEEL_PX;
    act(() => {
      fireEvent.scroll(scroller());
    });
    expect(held()).toBe("yes");
  });
});
