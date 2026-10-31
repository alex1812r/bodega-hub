import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";

import { useLayoutHold } from "./useLayoutHold";

/**
 * REP17-15 (D70(c), lo que REP17-14 dejó dicho del dedo): con el layout pendiente tras descartar L1 con un toque, el dedo
 * se apoya sobre el hueco retenido de L1, más cerca de L2 que de «Restaurar línea», y arrastra 30 px hacia arriba. El
 * desplazamiento del arrastre llega a la página en un frame que no depende de la revisión: después del `touchmove` (con la
 * máquina cargada), antes, o repartido en varios frames. Sin él, el punto del dedo cae 30 px más arriba en el contenido,
 * más cerca de «Restaurar línea»: anclar ahí sube L2 lo soltado (194 px). REP17-17 (D72(a)): el dedo ya no suelta nada; en
 * todos los repartos sigue retenido y L2 (lo que el dedo arrastra) se mueve exactamente lo arrastrado.
 */

/** Geometría simulada (px): alto visible del contenedor y su desplazamiento. */
const geometry = { client: 560, scrollTop: 0 };
const PANEL_LEFT = 16;
const PANEL_WIDTH = 374;
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
 * 123 px del control de L2.
 */
const FINGER_OFFSET = 220;
const DRAG_PX = 30;
const FINGER_X = 200;

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

function l1() {
  return document.querySelector<HTMLElement>("[data-layout-box='row:1']") ?? document.body;
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

/** El desplazamiento del arrastre llega a la página: cambia `scrollTop` (el `scroll` lo despacha el frame siguiente). */
function landScroll(px: number) {
  geometry.scrollTop += px;
}

function fingerMove(y: number) {
  act(() => {
    fireEvent.touchMove(l1(), { touches: [{ clientX: FINGER_X, clientY: y }] });
  });
}

function scrollEvent() {
  act(() => {
    fireEvent.scroll(scroller());
  });
}

type Order =
  | "touchmove y luego su desplazamiento"
  | "desplazamiento y luego el touchmove"
  | "desplazamiento en dos frames, el touchmove entre ellos"
  | "tres touchmove, cada uno antes de su desplazamiento";

describe("REP17-15 · REP17-17 · el dedo no suelta el layout retenido en ningún reparto de frames", () => {
  let rect: jest.SpyInstance;
  const elementFromPoint = document.elementFromPoint;

  beforeEach(() => {
    geometry.scrollTop = L1_TOP;
    rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
    Element.prototype.scrollBy = function scrollBy(this: Element, options?: ScrollToOptions | number) {
      this.scrollTop += typeof options === "object" ? (options.top ?? 0) : 0;
    };
    document.elementFromPoint = (_x: number, y: number) => {
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

  it.each<Order>([
    "touchmove y luego su desplazamiento",
    "desplazamiento y luego el touchmove",
    "desplazamiento en dos frames, el touchmove entre ellos",
    "tres touchmove, cada uno antes de su desplazamiento",
  ])("%s: L2 se mueve solo lo arrastrado", (order) => {
    render(<Harness />);
    wireScroller();
    const discard = screen.getByRole("button", { name: "Descartar línea" });
    const tap = { x: FINGER_X, y: discard.getBoundingClientRect().top + CONTROL_HEIGHT / 2 };
    // Toque (sin arrastre) en «Descartar línea» de L1: layout pendiente; levantar el dedo no lo suelta (D71(a)).
    fireEvent.touchStart(discard, { touches: [{ clientX: tap.x, clientY: tap.y }] });
    fireEvent.touchEnd(discard, { touches: [] });
    fireEvent.click(discard, { clientX: tap.x, clientY: tap.y, detail: 1 });
    expect(screen.getByTestId("root")).toHaveAttribute("data-held", "yes");
    expect(l1Height()).toBe(L1_PENDING);

    // El dedo se apoya sobre el hueco retenido de L1 (más cerca del control de L2) y sube 30 px.
    const start = l1().getBoundingClientRect().top + FINGER_OFFSET;
    expect(document.elementFromPoint(FINGER_X, start)).toBe(l1());
    const before = l2().getBoundingClientRect().top;
    fireEvent.touchStart(l1(), { touches: [{ clientX: FINGER_X, clientY: start }] });
    const end = start - DRAG_PX;

    if (order === "touchmove y luego su desplazamiento") {
      fingerMove(end);
      landScroll(DRAG_PX);
      scrollEvent();
    } else if (order === "desplazamiento y luego el touchmove") {
      landScroll(DRAG_PX);
      fingerMove(end);
      scrollEvent();
    } else if (order === "desplazamiento en dos frames, el touchmove entre ellos") {
      landScroll(DRAG_PX / 3);
      fingerMove(end);
      scrollEvent();
      landScroll((DRAG_PX * 2) / 3);
      scrollEvent();
    } else {
      for (let step = 1; step <= 3; step += 1) {
        fingerMove(start - (DRAG_PX * step) / 3);
        landScroll(DRAG_PX / 3);
        scrollEvent();
      }
    }
    fireEvent.touchEnd(l1(), { touches: [] });

    expect(screen.getByTestId("root")).toHaveAttribute("data-held", "yes");
    expect(l1Height()).toBe(L1_PENDING);
    expect(l2().getBoundingClientRect().top - (before - DRAG_PX)).toBe(0);
  });
});
