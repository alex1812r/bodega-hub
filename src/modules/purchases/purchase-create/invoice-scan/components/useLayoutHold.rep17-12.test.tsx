import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";

import { useLayoutHold } from "./useLayoutHold";

/**
 * REP17-12 · D71(a) (B-r17Q3-1): con el ratón, salir del panel o de la ventana ya no suelta nada retenido (ni los avisos
 * ni el layout pendiente); igual que en táctil (D49), solo lo sueltan desplazar (anclado, D70(c)), el teclado y el cambio
 * de ancho. Un aviso que encoge solo (la reserva que la tasa del día no usa) queda retenido con la página desplazada hasta
 * las filas; el ratón se queda quieto sobre el hueco retenido y sale por arriba (o por la derecha): nada se mueve, y al
 * volver al mismo punto está lo mismo. REP17-17 (D72(a)): después, la rueda o una tecla tampoco lo sueltan.
 */

/** Geometría simulada (px): alto natural del aviso, contenido desplazable de alto `client` y su desplazamiento. */
const geometry = { client: 500, notice: 200, scrollTop: 300 };
const PANEL_WIDTH = 390;
/** Alto de la cabecera (lo que va encima del aviso). */
const NOTICE_TOP = 340;
/** Distancia del control de las filas al final del aviso. */
const ROW_CONTROL_OFFSET = 200;
const CONTENT_BELOW = 1500;
/** Lo que tarda entre eventos un trazo continuo del ratón, y una pausa (quieto). */
const STROKE_STEP_MS = 5;
const PAUSE_MS = 400;

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
      return box(-geometry.scrollTop, NOTICE_TOP);
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
      <div data-geo="root" data-held={hold.order ? "yes" : "no"} data-testid="root" data-tick={tick} ref={rootRef}>
        <div data-geo="header">
          <button type="button">Cabecera</button>
        </div>
        <div data-geo="notice" data-layout-notice>
          <span>Reserva</span>
        </div>
        <section data-geo="rows" data-layout-box="row:L2" data-layout-notice-anchor>
          <button
            data-geo="row-control"
            onClickCapture={(event) => hold.holdLayout(event.currentTarget, ["L2"])}
            type="button"
          >
            Por unidad
          </button>
        </section>
      </div>
    </main>
  );
}

function rowControl() {
  return screen.getByRole("button", { name: "Por unidad" });
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

let clock = 0;

/** jsdom no implementa PointerEvent: un MouseEvent con `pointerType: "mouse"`, `ms` después del anterior. */
function mouse(type: "pointermove" | "pointerleave", clientX: number, clientY: number, ms: number) {
  clock += ms;
  const target = type === "pointerleave" ? document.documentElement : (document.elementFromPoint(clientX, clientY) ?? document.body);
  const event = new MouseEvent(type, { bubbles: type === "pointermove", clientX, clientY });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(target, event);
}

/** Retiene la reserva (llega la tasa del día con la página desplazada hasta las filas). */
function retainNotice() {
  const { rerender } = render(<Harness tick={0} />);
  const scroller = wireScroller();
  fireEvent.scroll(scroller);
  geometry.notice = 28;
  rerender(<Harness tick={1} />);
  expect(notice().style.minHeight).toBe("200px");
}

type Exit = "arriba" | "derecha";

/** Quieto sobre el hueco retenido y fuera del panel de un trazo (por arriba, fuera de la ventana; o por la derecha). */
function restOnGapAndLeave(exit: Exit) {
  const gap = notice().getBoundingClientRect();
  const y = gap.top + gap.height / 2;
  mouse("pointermove", 100, y, 0);
  mouse("pointermove", 100, y, PAUSE_MS);
  if (exit === "arriba") {
    mouse("pointermove", 100, 5, STROKE_STEP_MS);
    mouse("pointerleave", 100, -8, STROKE_STEP_MS);
  } else {
    mouse("pointermove", PANEL_WIDTH + 6, y, STROKE_STEP_MS);
    mouse("pointerleave", PANEL_WIDTH + 200, y, STROKE_STEP_MS);
  }
}

describe("REP17-12 · D71(a), REP17-17 · con el ratón, salir del panel no suelta lo retenido, ni la rueda ni una tecla al volver", () => {
  let rect: jest.SpyInstance;
  let now: jest.SpyInstance;
  const elementFromPoint = document.elementFromPoint;

  beforeEach(() => {
    geometry.client = 500;
    geometry.notice = 200;
    geometry.scrollTop = 300;
    clock = 0;
    now = jest.spyOn(Date, "now").mockImplementation(() => clock);
    rect = jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
    Element.prototype.scrollBy = function scrollBy(this: Element, options?: ScrollToOptions | number) {
      this.scrollTop += typeof options === "object" ? (options.top ?? 0) : 0;
    };
    document.elementFromPoint = (x: number, y: number) => {
      if (x < 0 || y < 0 || x > PANEL_WIDTH) {
        return document.body;
      }
      const inside = (element: Element) => {
        const { top, bottom } = element.getBoundingClientRect();
        return y >= top && y <= bottom;
      };
      const header = screen.getByRole("button", { name: "Cabecera" });
      if (inside(rowControl())) {
        return rowControl();
      }
      if (inside(header)) {
        return header;
      }
      return inside(notice()) ? notice() : document.querySelector("[data-geo='rows']");
    };
  });

  afterEach(() => {
    now.mockRestore();
    rect.mockRestore();
    Reflect.deleteProperty(Element.prototype, "scrollBy");
    document.elementFromPoint = elementFromPoint;
  });

  it.each<Exit>(["arriba", "derecha"])(
    "quieto sobre el hueco retenido y salida por %s: el hueco sigue y el control de las filas no se mueve",
    (exit) => {
      retainNotice();
      const before = rowControl().getBoundingClientRect().top;

      restOnGapAndLeave(exit);

      expect(notice().style.minHeight).toBe("200px");
      expect(rowControl().getBoundingClientRect().top).toBe(before);
      expect(document.elementFromPoint(100, before + 10)).toBe(rowControl());
    },
  );

  it("tras salir, la rueda con el ratón de vuelta sobre el control tampoco lo suelta: el control no se mueve", () => {
    retainNotice();
    const before = rowControl().getBoundingClientRect().top;
    restOnGapAndLeave("arriba");

    mouse("pointermove", 100, before + 10, PAUSE_MS);
    fireEvent.wheel(rowControl(), { deltaY: 40 });

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
    expect(movedByCompaction(rowControl())).toBe(false);
    expect(movedByCompaction(screen.getByRole("button", { name: "Cabecera" }))).toBe(false);
  });

  it("tras salir, una tecla con el ratón de vuelta sobre el control tampoco lo suelta: el control no se mueve", () => {
    retainNotice();
    const before = rowControl().getBoundingClientRect().top;
    restOnGapAndLeave("derecha");

    mouse("pointermove", 100, before + 10, PAUSE_MS);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
  });

  it.each<Exit>(["arriba", "derecha"])("con el layout pendiente (clic con el ratón), salir por %s no lo aplica; una tecla tampoco", (exit) => {
    render(<Harness tick={0} />);
    wireScroller();
    const { top } = rowControl().getBoundingClientRect();
    fireEvent.click(rowControl(), { clientX: 100, clientY: top + 10, detail: 1 });
    expect(screen.getByTestId("root")).toHaveAttribute("data-held", "yes");

    restOnGapAndLeave(exit);

    expect(screen.getByTestId("root")).toHaveAttribute("data-held", "yes");
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(screen.getByTestId("root")).toHaveAttribute("data-held", "yes");
  });
});
