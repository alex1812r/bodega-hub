import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";

import { useLayoutHold } from "./useLayoutHold";

/**
 * REP17-08 · D70(c) (B-r17Q2-1), D71(a): salir del panel con el ratón no suelta nada, crucen lo que crucen (el borde por
 * arriba, encima de lo retenido, o un elemento pegado, el visor). Un aviso que encoge solo (la reserva que la tasa del día
 * no usa) queda retenido; el ratón se queda sobre un control de las filas y luego sale del panel de un trazo:
 * - por la derecha cruzando el visor pegado (1440/1366: la franja entre el visor y el borde de la ventana);
 * - por arriba, cruzando la cabecera, fuera de la ventana (1280, 1024×1366).
 * En ambos sigue retenido y el control no se mueve; al volver sobre él, la rueda o una tecla lo sueltan anclado a él. Si
 * estuvo quieto sobre el visor, también sigue retenido.
 */

/** Geometría simulada (px): alto natural del aviso, contenido desplazable de alto `client` y su desplazamiento. */
const geometry = { client: 500, notice: 200, scrollTop: 300 };
const PANEL_WIDTH = 390;
/** Alto de la cabecera (lo que va encima del aviso). */
const NOTICE_TOP = 340;
/** Distancia del control de las filas al final del aviso. */
const ROW_CONTROL_OFFSET = 200;
const CONTENT_BELOW = 1500;
/** El visor pegado ocupa la franja derecha del panel. */
const VISOR_LEFT = 300;
/** Lo que tarda entre eventos un trazo continuo del ratón, y una pausa (quieto). */
const STROKE_STEP_MS = 5;
const PAUSE_MS = 1000;

function noticeHeight(notice: HTMLElement) {
  return Math.max(geometry.notice, Number.parseFloat(notice.style.minHeight) || 0);
}

function contentHeight() {
  const notice = document.querySelector<HTMLElement>("[data-layout-notice]");
  return NOTICE_TOP + (notice ? noticeHeight(notice) : 0) + CONTENT_BELOW;
}

function box(top: number, height: number, left = 0) {
  const width = PANEL_WIDTH - left;
  return { bottom: top + height, height, left, right: PANEL_WIDTH, top, width, x: left, y: top, toJSON: () => ({}) };
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
    case "visor":
      // Pegado: no se mueve al desplazar.
      return box(0, geometry.client, VISOR_LEFT);
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
        <aside data-geo="visor" style={{ position: "sticky" }}>
          <button type="button">Ampliar</button>
        </aside>
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

describe("REP17-08 · D70(c), D71(a) · al sacar el ratón del panel tras estar quieto, nada se suelta ni se mueve", () => {
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
      if (x >= VISOR_LEFT) {
        return screen.getByRole("button", { name: "Ampliar" });
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

  it("por la derecha cruzando el visor pegado: sigue retenido; al volver, la rueda suelta anclado al control", () => {
    retainNotice();
    const y = rowControl().getBoundingClientRect().top + 10;
    const before = rowControl().getBoundingClientRect().top;

    mouse("pointermove", 100, y, 0);
    mouse("pointermove", 350, y, PAUSE_MS);
    mouse("pointermove", PANEL_WIDTH + 6, y, STROKE_STEP_MS);

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
    expect(document.elementFromPoint(100, y)).toBe(rowControl());

    mouse("pointermove", 100, y, PAUSE_MS);
    fireEvent.wheel(rowControl(), { deltaY: 40 });

    expect(notice().style.minHeight).toBe("");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
    expect(movedByCompaction(rowControl())).toBe(false);
    expect(movedByCompaction(screen.getByRole("button", { name: "Cabecera" }))).toBe(true);
  });

  it("por arriba, cruzando la cabecera, fuera de la ventana: sigue retenido; al volver, una tecla suelta anclado al control", () => {
    retainNotice();
    const y = rowControl().getBoundingClientRect().top + 10;
    const before = rowControl().getBoundingClientRect().top;

    mouse("pointermove", 100, y, 0);
    mouse("pointermove", 100, 200, PAUSE_MS);
    mouse("pointermove", 100, 5, STROKE_STEP_MS);
    mouse("pointerleave", 100, -8, STROKE_STEP_MS);

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
    expect(document.elementFromPoint(100, y)).toBe(rowControl());

    mouse("pointermove", 100, y, PAUSE_MS);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(notice().style.minHeight).toBe("");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
    expect(movedByCompaction(screen.getByRole("button", { name: "Cabecera" }))).toBe(true);
  });

  it("quieto sobre el visor pegado y salida por la derecha: sigue retenido y el control de las filas no se mueve", () => {
    retainNotice();
    const y = rowControl().getBoundingClientRect().top + 10;
    const before = rowControl().getBoundingClientRect().top;

    mouse("pointermove", 350, y, 0);
    mouse("pointermove", PANEL_WIDTH + 6, y, PAUSE_MS);

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
  });
});
