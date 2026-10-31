import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";

import { useLayoutHold } from "./useLayoutHold";

/**
 * REP17-06 · D70(c) (B-r17Q-2), D71(a): con el ratón, sacarlo del panel no suelta nada (al volver al mismo punto está el
 * mismo control); lo suelta la rueda, sin mover lo que estaba bajo su última posición dentro del panel. Un aviso que
 * encoge solo (la reserva que la tasa del día no usa) queda retenido; el ratón, sobre un control de las filas, sale del
 * panel (sigue retenido) y gira la rueda fuera de él. REP17-17 (D72(a)): la rueda tampoco suelta nada ya; lo de abajo
 * describe lo que se hacía antes:
 * - con desplazamiento que compense lo soltado, se suelta anclado al control, y lo que movió la liberación (lo de encima)
 *   queda guardado desde ese instante (D49);
 * - sin él (página arriba, hueco encima), sigue retenido: el control no se mueve.
 */

/** Geometría simulada (px): alto natural del aviso, contenido desplazable de alto `client` y su desplazamiento. */
const geometry = { client: 800, notice: 200, scrollTop: 0 };
const PANEL_WIDTH = 390;
const NOTICE_TOP = 40;
/** Distancia del control de las filas al final del aviso. */
const ROW_CONTROL_OFFSET = 500;
const CONTENT_BELOW = 1500;

function noticeHeight(notice: HTMLElement) {
  return Math.max(geometry.notice, Number.parseFloat(notice.style.minHeight) || 0);
}

function contentHeight() {
  const notice = document.querySelector<HTMLElement>("[data-layout-notice]");
  return NOTICE_TOP + (notice ? noticeHeight(notice) : 0) + CONTENT_BELOW;
}

function box(top: number, height: number) {
  return { bottom: top + height, height, left: 0, right: PANEL_WIDTH, top, width: PANEL_WIDTH, x: 0, y: top, toJSON: () => ({}) };
}

function fakeRect(this: Element) {
  const area = this.closest<HTMLElement>("[data-geo]")?.dataset.geo;
  const notice = document.querySelector<HTMLElement>("[data-layout-notice]");
  const below = NOTICE_TOP + (notice ? noticeHeight(notice) : 0) - geometry.scrollTop;
  switch (area) {
    case "header":
      return box(-geometry.scrollTop, 30);
    case "notice":
      return box(NOTICE_TOP - geometry.scrollTop, notice ? noticeHeight(notice) : 0);
    case "rows":
      return box(below, CONTENT_BELOW);
    case "row-control":
      return box(below + ROW_CONTROL_OFFSET, 36);
    default:
      return box(-geometry.scrollTop, contentHeight());
  }
}

let movedByCompaction: (control: Element) => boolean = () => false;

function Harness({ tick }: { tick: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hold = useLayoutHold<string[]>(rootRef, () => undefined);
  useEffect(() => {
    movedByCompaction = hold.movedByCompaction;
  }, [hold.movedByCompaction]);
  return (
    <main data-geo="scroller" data-testid="scroller" style={{ overflowY: "auto" }}>
      <div data-geo="root" data-tick={tick} ref={rootRef}>
        <div data-geo="header">
          <button type="button">Cabecera</button>
        </div>
        <div data-geo="notice" data-layout-notice>
          <span>Reserva</span>
        </div>
        <section data-geo="rows" data-layout-notice-anchor>
          <button data-geo="row-control" type="button">
            Buscar producto
          </button>
        </section>
      </div>
    </main>
  );
}

function rowControl() {
  return screen.getByRole("button", { name: "Buscar producto" });
}

function notice() {
  const element = document.querySelector<HTMLElement>("[data-layout-notice]");
  if (!element) {
    throw new Error("Sin aviso");
  }
  return element;
}

function wireScroller() {
  const scroller = screen.getByTestId("scroller");
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => geometry.scrollTop,
    set: (value: number) => {
      geometry.scrollTop = Math.min(Math.max(0, value), Math.max(0, contentHeight() - geometry.client));
    },
  });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: contentHeight });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => geometry.client });
  return scroller;
}

/** jsdom no implementa PointerEvent: un MouseEvent con `pointerType: "mouse"`. */
function mouse(type: "pointermove" | "pointerleave", clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: type === "pointermove", clientX, clientY });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  return event;
}

type Exit = "pointermove" | "pointerleave";

/** El ratón sobre el control de las filas y luego fuera del panel (a la derecha: el visor de la factura). */
function mouseOutOfPanel(exit: Exit) {
  const y = rowControl().getBoundingClientRect().top + 10;
  fireEvent(rowControl(), mouse("pointermove", 100, y));
  fireEvent(document.body, mouse("pointermove", PANEL_WIDTH + 100, y));
  if (exit === "pointerleave") {
    fireEvent(document.documentElement, mouse("pointerleave", PANEL_WIDTH + 100, y));
  }
}

describe("REP17-06 · REP17-17 · sacar el ratón del panel y girar la rueda no sueltan nada ni mueven lo que estaba bajo él", () => {
  let rect: jest.SpyInstance;
  const elementFromPoint = document.elementFromPoint;

  beforeEach(() => {
    geometry.client = 800;
    geometry.notice = 200;
    geometry.scrollTop = 0;
    rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
    Element.prototype.scrollBy = function scrollBy(this: Element, options?: ScrollToOptions | number) {
      this.scrollTop += typeof options === "object" ? (options.top ?? 0) : 0;
    };
    document.elementFromPoint = (x: number, y: number) => {
      if (x > PANEL_WIDTH) {
        return document.body;
      }
      const { top, bottom } = rowControl().getBoundingClientRect();
      return y >= top && y <= bottom ? rowControl() : document.querySelector("[data-geo='rows']");
    };
  });

  afterEach(() => {
    rect.mockRestore();
    Reflect.deleteProperty(Element.prototype, "scrollBy");
    document.elementFromPoint = elementFromPoint;
  });

  it.each<Exit>(["pointermove", "pointerleave"])(
    "salir (%s) no suelta nada; la rueda, con desplazamiento que lo compense, tampoco (D72(a)) y nada queda guardado",
    (exit) => {
      const { rerender } = render(<Harness tick={0} />);
      const scroller = wireScroller();
      geometry.scrollTop = 300;
      fireEvent.scroll(scroller);
      geometry.notice = 28;
      rerender(<Harness tick={1} />);
      expect(notice().style.minHeight).toBe("200px");
      const before = rowControl().getBoundingClientRect().top;

      mouseOutOfPanel(exit);

      expect(notice().style.minHeight).toBe("200px");
      expect(rowControl().getBoundingClientRect().top).toBe(before);

      fireEvent.wheel(document.body, { deltaY: 40 });

      expect(notice().style.minHeight).toBe("200px");
      expect(rowControl().getBoundingClientRect().top).toBe(before);
      expect(document.elementFromPoint(100, before + 10)).toBe(rowControl());
      expect(movedByCompaction(rowControl())).toBe(false);
      expect(movedByCompaction(screen.getByRole("button", { name: "Cabecera" }))).toBe(false);
    },
  );

  it("salir y girar la rueda sin desplazamiento que lo compense (página arriba, hueco encima): sigue retenido y el control no se mueve", () => {
    const { rerender } = render(<Harness tick={0} />);
    wireScroller();
    geometry.notice = 28;
    rerender(<Harness tick={1} />);
    const before = rowControl().getBoundingClientRect().top;

    mouseOutOfPanel("pointermove");
    fireEvent.wheel(document.body, { deltaY: 40 });

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
  });
});
