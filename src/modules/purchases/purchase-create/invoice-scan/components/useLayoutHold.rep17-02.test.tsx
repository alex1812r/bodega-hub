import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";

import { useLayoutHold } from "./useLayoutHold";

/**
 * REP17-02 · D70(c) (B-p18B-2): soltar una retención nunca mueve lo que está bajo el último punto de contacto.
 * Un aviso que encoge solo (la reserva que la tasa del día no usa) queda retenido a su alto; un arrastre corto con el dedo
 * en un control de debajo:
 * - sin desplazamiento que compense lo soltado (página arriba, hueco encima), sigue retenido: el control se mueve lo que
 *   se movió el dedo;
 * - con él, se suelta anclando el desplazamiento al control: se mueve lo que se movió el dedo, y lo que movió la
 *   liberación (lo de encima) queda guardado desde ese instante (D49).
 * REP17-17 (D72): ni el arrastre ni una tecla sueltan ya nada, haya o no desplazamiento que lo compense; lo suelta
 * «Compactar lista», y lo que se mueve con ello queda guardado desde ese instante (D49).
 * Y un aviso retenido que solo encoge conserva su `display` (la rejilla que apila sus reservas); el que se vacía
 * (`empty:hidden`) conserva su sitio como bloque.
 */

/** Geometría simulada (px): alto natural del aviso, contenido desplazable de alto `client` y su desplazamiento. */
const geometry = { client: 800, notice: 200, scrollTop: 0 };
const HEADER = { top: 0, height: 30 };
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

function maxScroll() {
  return Math.max(0, contentHeight() - geometry.client);
}

function box(top: number, height: number) {
  return { bottom: top + height, height, left: 0, right: 390, top, width: 390, x: 0, y: top, toJSON: () => ({}) };
}

function fakeRect(this: Element) {
  const area = this.closest<HTMLElement>("[data-geo]")?.dataset.geo;
  const notice = document.querySelector<HTMLElement>("[data-layout-notice]");
  const below = NOTICE_TOP + (notice ? noticeHeight(notice) : 0) - geometry.scrollTop;
  switch (area) {
    case "header":
      return box(HEADER.top - geometry.scrollTop, HEADER.height);
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

function Harness({ tick, empty = false }: { tick: number; empty?: boolean }) {
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
        <div className="grid" data-geo="notice" data-layout-notice>
          {empty ? null : <span>Reserva</span>}
        </div>
        <section data-geo="rows" data-layout-notice-anchor>
          <button data-geo="row-control" type="button">
            Descartar línea
          </button>
        </section>
        <button onClick={hold.compact} type="button">
          Compactar lista
        </button>
      </div>
    </main>
  );
}

function rowControl() {
  return screen.getByRole("button", { name: "Descartar línea" });
}

function notice() {
  const element = document.querySelector<HTMLElement>("[data-layout-notice]");
  if (!element) {
    throw new Error("Sin aviso");
  }
  return element;
}

/** El contenedor desplazable con `scrollTop`, `scrollHeight` y `clientHeight` de la geometría simulada. */
function wireScroller() {
  const scroller = screen.getByTestId("scroller");
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => geometry.scrollTop,
    set: (value: number) => {
      geometry.scrollTop = Math.min(Math.max(0, value), maxScroll());
    },
  });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: contentHeight });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => geometry.client });
  return scroller;
}

/** Una llegada asíncrona encoge el aviso (nadie actúa): queda retenido a su alto anterior. */
function shrinkAlone(rerender: (ui: React.ReactElement) => void, empty = false) {
  geometry.notice = empty ? 0 : 28;
  rerender(<Harness empty={empty} tick={1} />);
}

/** Dedo en el control de las filas y arrastre de `px` (el contenido sube con él) en pasos de 6 px. */
function shortDrag(scroller: HTMLElement, px: number) {
  const control = rowControl();
  const start = control.getBoundingClientRect().top + 10;
  fireEvent.touchStart(control, { touches: [{ clientX: 100, clientY: start }] });
  for (let moved = 6; moved <= px; moved += 6) {
    fireEvent.touchMove(control, { touches: [{ clientX: 100, clientY: start - moved }] });
    scroller.scrollTop += 6;
    fireEvent.scroll(scroller);
  }
  fireEvent.touchEnd(control, { touches: [] });
}

describe("REP17-02 · REP17-17 · el arrastre y el teclado no sueltan lo retenido; «Compactar lista» sí, con la guarda D49", () => {
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
    document.elementFromPoint = (_x: number, y: number) => {
      const control = rowControl();
      const { top, bottom } = control.getBoundingClientRect();
      return y >= top && y <= bottom ? control : document.querySelector("[data-geo='rows']");
    };
    const style = document.createElement("style");
    style.dataset.rep1702 = "";
    style.textContent = ".grid { display: grid; } .grid:empty { display: none; }";
    document.head.append(style);
  });

  afterEach(() => {
    rect.mockRestore();
    Reflect.deleteProperty(Element.prototype, "scrollBy");
    document.elementFromPoint = elementFromPoint;
    document.head.querySelector("style[data-rep1702]")?.remove();
  });

  it("página arriba y el hueco encima: un arrastre de 24 px no lo suelta y el control se mueve 24 px", () => {
    const { rerender } = render(<Harness tick={0} />);
    const scroller = wireScroller();
    shrinkAlone(rerender);
    expect(notice().style.minHeight).toBe("200px");
    const before = rowControl().getBoundingClientRect().top;

    shortDrag(scroller, 24);

    expect(rowControl().getBoundingClientRect().top).toBe(before - 24);
    expect(notice().style.minHeight).toBe("200px");
  });

  it("con desplazamiento que lo compense, el arrastre tampoco lo suelta; «Compactar lista» sí y guarda lo que movió (D49)", () => {
    const { rerender } = render(<Harness tick={0} />);
    const scroller = wireScroller();
    geometry.scrollTop = 300;
    fireEvent.scroll(scroller);
    shrinkAlone(rerender);
    expect(notice().style.minHeight).toBe("200px");
    const before = rowControl().getBoundingClientRect().top;

    shortDrag(scroller, 24);

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before - 24);
    expect(movedByCompaction(rowControl())).toBe(false);

    act(() => {
      screen.getByRole("button", { name: "Compactar lista" }).click();
    });

    expect(notice().style.minHeight).toBe("");
    expect(rowControl().getBoundingClientRect().top).toBe(before - 24 - (200 - 28));
    expect(movedByCompaction(rowControl())).toBe(true);
    expect(movedByCompaction(screen.getByRole("button", { name: "Cabecera" }))).toBe(false);
  });

  it.each([
    { scrollTop: 0, title: "sin desplazamiento que lo compense, una tecla no lo suelta" },
    { scrollTop: 300, title: "con él, una tecla tampoco lo suelta" },
  ])("ratón sobre el control de las filas: $title", ({ scrollTop }) => {
    const { rerender } = render(<Harness tick={0} />);
    const scroller = wireScroller();
    geometry.scrollTop = scrollTop;
    fireEvent.scroll(scroller);
    shrinkAlone(rerender);
    const before = rowControl().getBoundingClientRect().top;
    // jsdom no implementa PointerEvent: un MouseEvent «pointermove» lleva el punto.
    fireEvent(rowControl(), new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: before + 10 }));

    fireEvent.keyDown(window, { key: "Shift" });

    expect(notice().style.minHeight).toBe("200px");
    expect(rowControl().getBoundingClientRect().top).toBe(before);
  });

  it("el aviso retenido que solo encoge conserva su rejilla (la que apila sus reservas)", () => {
    const { rerender } = render(<Harness tick={0} />);
    wireScroller();
    shrinkAlone(rerender);

    expect(notice().style.minHeight).toBe("200px");
    expect(getComputedStyle(notice()).display).toBe("grid");
  });

  it("el aviso retenido que se vacía (`empty:hidden`) conserva su sitio como bloque", () => {
    const { rerender } = render(<Harness tick={0} />);
    wireScroller();
    shrinkAlone(rerender, true);

    expect(notice().style.minHeight).toBe("200px");
    expect(notice().style.display).toBe("block");
  });
});
