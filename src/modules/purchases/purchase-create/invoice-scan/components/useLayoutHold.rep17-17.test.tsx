import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";

import { COMPACTION_GUARD_MS, useLayoutHold } from "./useLayoutHold";

/**
 * REP17-17 (D72): nada suelta lo retenido de forma automática (ni desplazar, ni la rueda, ni el dedo, ni el pinch, ni el
 * teclado, ni sacar el puntero del panel, ni el tiempo). Lo retenido (la caja de la fila descartada, el aviso que encoge,
 * el orden de filas tras una llegada) se queda hasta que el usuario lo pide (`compact`, el botón «Compactar lista») o cambia
 * el ancho. `retainsSpace` dice si hay algo retenido (el botón solo se ve entonces). Tras compactar, lo que se movió no
 * actúa durante COMPACTION_GUARD_MS (D49).
 */

const geometry = { client: 560, scrollTop: 200, width: 374 };
const PANEL_LEFT = 16;
const NOTICE_TOP = 120;
const NOTICE_HEIGHT = 60;
const L1_PENDING = 279;
const L1_DISCARDED = 85;
const L2_HEIGHT = 400;
const CONTENT_BELOW = 1200;
const DISCARD_OFFSET = 126;
const L2_CONTROL_OFFSET = 64;
const CONTROL_HEIGHT = 36;

function px(element: HTMLElement | null, property: "minHeight" | "maxHeight") {
  return Number.parseFloat(element?.style[property] ?? "");
}

function noticeHeight() {
  const notice = document.querySelector<HTMLElement>("[data-layout-notice]");
  if (!notice || notice.style.display === "none") {
    return 0;
  }
  const natural = notice.textContent ? NOTICE_HEIGHT : 0;
  const floor = Math.max(natural, px(notice, "minHeight") || 0);
  return Number.isNaN(px(notice, "maxHeight")) ? floor : Math.min(floor, px(notice, "maxHeight"));
}

function l1Height() {
  const l1 = document.querySelector<HTMLElement>("[data-layout-box='row:1']");
  const natural = l1?.dataset.status === "discarded" ? L1_DISCARDED : L1_PENDING;
  return Math.max(natural, px(l1 ?? null, "minHeight") || 0);
}

function l1Top() {
  return NOTICE_TOP + noticeHeight() - geometry.scrollTop;
}

function contentHeight() {
  return NOTICE_TOP + noticeHeight() + l1Height() + L2_HEIGHT + CONTENT_BELOW;
}

function box(top: number, height: number) {
  const { width } = geometry;
  return { bottom: top + height, height, left: PANEL_LEFT, right: PANEL_LEFT + width, top, width, x: PANEL_LEFT, y: top, toJSON: () => ({}) };
}

function fakeRect(this: Element) {
  const top = l1Top();
  switch (this.closest<HTMLElement>("[data-geo]")?.dataset.geo) {
    case "notice":
      return box(NOTICE_TOP - geometry.scrollTop, noticeHeight());
    case "discard":
      return box(top + DISCARD_OFFSET, CONTROL_HEIGHT);
    case "l1":
      return box(top, l1Height());
    case "rows":
      return box(top, l1Height() + L2_HEIGHT);
    case "l2-control":
      return box(top + l1Height() + L2_CONTROL_OFFSET, CONTROL_HEIGHT);
    case "l2":
      return box(top + l1Height(), L2_HEIGHT);
    default:
      return box(-geometry.scrollTop, contentHeight());
  }
}

/** `noticeText`: el aviso dinámico (una llegada lo vacía); `arrival`: una llegada cambia el orden de las filas (D67(a)). */
function Harness({ arrival = false, noticeText = "" }: { arrival?: boolean; noticeText?: string }) {
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
    <main data-geo="scroller" data-testid="scroller" style={{ overflowY: "auto" }}>
      <div
        data-geo="root"
        data-held={hold.order ? "yes" : "no"}
        data-retains={hold.retainsSpace ? "yes" : "no"}
        data-testid="root"
        ref={rootRef}
      >
        <div data-geo="notice" data-layout-notice>
          {noticeText}
        </div>
        <div data-geo="rows" data-layout-notice-anchor>
          <section
            data-geo="l1"
            data-layout-box="row:1"
            data-status={discarded ? "discarded" : "pending"}
            style={hold.boxStyle("row:1")}
          >
            {discarded ? (
              <span>Línea descartada · Restaurar</span>
            ) : (
              <button
                data-geo="discard"
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
        <button onClick={hold.compact} type="button">
          Compactar lista
        </button>
      </div>
    </main>
  );
}

function scroller() {
  return screen.getByTestId("scroller");
}

function root() {
  return screen.getByTestId("root");
}

function l2Control() {
  return screen.getByRole("button", { name: /Jabon/ });
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

function scrollBy(delta: number) {
  act(() => {
    geometry.scrollTop += delta;
    fireEvent.scroll(scroller());
  });
}

function tapDiscard() {
  const discard = screen.getByRole("button", { name: "Descartar línea" });
  const point = { clientX: 200, clientY: discard.getBoundingClientRect().top + CONTROL_HEIGHT / 2 };
  fireEvent.pointerDown(discard, { ...point, pointerType: "touch" });
  fireEvent.touchStart(discard, { touches: [point] });
  fireEvent.touchEnd(discard, { touches: [] });
  fireEvent.click(discard, { ...point, detail: 1 });
}

/** Lo retenido sigue igual: la caja de L1 conserva su alto y el orden sigue fijado. */
function expectStillHeld() {
  expect(root().dataset.held).toBe("yes");
  expect(l1Height()).toBe(L1_PENDING);
  expect(root().dataset.retains).toBe("yes");
}

const GESTURES: Array<[string, () => void]> = [
  ["un desplazamiento real (barra o arrastre)", () => scrollBy(300)],
  ["la rueda sintética", () => fireEvent.wheel(window, { deltaY: 100 })],
  ["la rueda real, que desplaza", () => {
    fireEvent.wheel(l2Control(), { deltaY: 100 });
    scrollBy(100);
  }],
  ["un arrastre con el dedo y su inercia", () => {
    fireEvent.touchStart(l2Control(), { touches: [{ clientX: 200, clientY: 400 }] });
    fireEvent.touchMove(l2Control(), { touches: [{ clientX: 200, clientY: 300 }] });
    scrollBy(100);
    fireEvent.touchEnd(l2Control(), { touches: [] });
    scrollBy(60);
  }],
  ["un pinch con dos dedos", () => {
    const two = (spread: number) => [
      { clientX: 200 - spread, clientY: 400, identifier: 1 },
      { clientX: 200 + spread, clientY: 400, identifier: 2 },
    ];
    fireEvent.touchStart(l2Control(), { touches: two(20) });
    fireEvent.touchMove(l2Control(), { touches: two(60) });
    fireEvent.touchEnd(l2Control(), { touches: [] });
    scrollBy(40);
  }],
  ["el teclado (Tab, flechas, letras)", () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    fireEvent.keyDown(l2Control(), { key: "ArrowDown" });
    fireEvent.keyDown(l2Control(), { key: "a" });
  }],
  ["sacar el ratón del panel y de la ventana", () => {
    fireEvent.pointerMove(window, { clientX: 900, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerLeave(root(), { pointerType: "mouse" });
    fireEvent.mouseOut(document.documentElement, { relatedTarget: null });
  }],
  ["el tiempo (un minuto)", () => {
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
  }],
];

beforeEach(() => {
  jest.useFakeTimers();
  Object.assign(geometry, { scrollTop: 200, width: 374 });
  jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(fakeRect);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("REP17-17 · D72(a) · ningún gesto ni el tiempo sueltan la caja retenida de la fila descartada", () => {
  it.each(GESTURES)("tras %s, L1 conserva su alto y el control de L2 no se mueve", (_name, gesture) => {
    render(<Harness />);
    wireScroller();
    expect(root().dataset.retains).toBe("no");
    tapDiscard();
    expectStillHeld();
    const l2Before = l2Control().getBoundingClientRect().top + geometry.scrollTop;

    gesture();

    expectStillHeld();
    expect(l2Control().getBoundingClientRect().top + geometry.scrollTop).toBe(l2Before);
  });

  it("todos seguidos tampoco", () => {
    render(<Harness />);
    wireScroller();
    tapDiscard();
    for (const [, gesture] of GESTURES) {
      gesture();
    }
    expectStillHeld();
  });
});

describe("REP17-17 · D72(a) · el aviso que encoge y el orden retenidos tras una llegada tampoco se sueltan solos", () => {
  it.each(GESTURES)("aviso que se vacía solo: tras %s conserva su alto", (_name, gesture) => {
    const view = render(<Harness noticeText="Tasa de hoy llegando…" />);
    wireScroller();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    view.rerender(<Harness noticeText="" />);
    expect(noticeHeight()).toBe(NOTICE_HEIGHT);
    expect(root().dataset.retains).toBe("yes");

    gesture();

    expect(noticeHeight()).toBe(NOTICE_HEIGHT);
    expect(root().dataset.retains).toBe("yes");
  });

  it.each(GESTURES)("orden de filas retenido tras una llegada: tras %s sigue fijado", (_name, gesture) => {
    render(<Harness arrival />);
    wireScroller();
    expect(root().dataset.held).toBe("yes");

    gesture();

    expect(root().dataset.held).toBe("yes");
  });
});

describe("REP17-17 · D72(b) · «Compactar lista» recupera el espacio a petición, con la guarda D49", () => {
  it("compacta la fila descartada: L1 toma su alto y L2 sube", () => {
    render(<Harness />);
    wireScroller();
    tapDiscard();
    expectStillHeld();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    const l2Before = l2Control().getBoundingClientRect().top;

    act(() => {
      screen.getByRole("button", { name: "Compactar lista" }).click();
    });

    expect(root().dataset.held).toBe("no");
    expect(root().dataset.retains).toBe("no");
    expect(l1Height()).toBe(L1_DISCARDED);
    expect(l2Control().getBoundingClientRect().top).toBe(l2Before - (L1_PENDING - L1_DISCARDED));
  });

  it("compacta el aviso que encogió solo y el orden retenido", () => {
    const view = render(<Harness arrival noticeText="Tasa de hoy llegando…" />);
    wireScroller();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    view.rerender(<Harness arrival noticeText="" />);
    expect(noticeHeight()).toBe(NOTICE_HEIGHT);

    act(() => {
      screen.getByRole("button", { name: "Compactar lista" }).click();
    });

    expect(noticeHeight()).toBe(0);
    expect(root().dataset.held).toBe("no");
    expect(root().dataset.retains).toBe("no");
  });

  it("sin nada retenido, `retainsSpace` es falso (el botón no se ofrece)", () => {
    render(<Harness />);
    wireScroller();
    expect(root().dataset.retains).toBe("no");
    // Un clic que no cambia nada fija las cajas pero no retiene espacio.
    fireEvent.click(l2Control(), { clientX: 200, clientY: 300, detail: 1 });
    expect(root().dataset.retains).toBe("no");
  });
});

describe("REP17-17 · D72(b) · B-p17B-3: cambiar el ancho (girar) suelta lo retenido", () => {
  it("con otro ancho la caja de L1 toma su alto, sin guardar nada como movido", () => {
    render(<Harness />);
    wireScroller();
    tapDiscard();
    expectStillHeld();

    act(() => {
      geometry.width = 820;
      fireEvent(window, new Event("resize"));
      fireEvent.scroll(scroller());
    });

    expect(root().dataset.held).toBe("no");
    expect(root().dataset.retains).toBe("no");
    expect(l1Height()).toBe(L1_DISCARDED);
  });
});

/** D49 tras compactar, por el valor que el hook devuelve. */
function GuardHarness({ onReady }: { onReady: (moved: (control: Element) => boolean) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hold = useLayoutHold<string[]>(rootRef, () => undefined);
  const [discarded, setDiscarded] = useState(false);
  const { movedByCompaction } = hold;
  useEffect(() => onReady(movedByCompaction), [movedByCompaction, onReady]);
  return (
    <main data-geo="scroller" data-testid="scroller" style={{ overflowY: "auto" }}>
      <div data-geo="root" data-held={hold.order ? "yes" : "no"} data-retains={hold.retainsSpace ? "yes" : "no"} data-testid="root" ref={rootRef}>
        <div data-geo="rows" data-layout-notice-anchor>
          <section data-geo="l1" data-layout-box="row:1" data-status={discarded ? "discarded" : "pending"} style={hold.boxStyle("row:1")}>
            {discarded ? null : (
              <button
                data-geo="discard"
                onClick={() => setDiscarded(true)}
                onClickCapture={(event) => hold.holdLayout(event.currentTarget, ["L1"])}
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
        <button onClick={hold.compact} type="button">
          Compactar lista
        </button>
      </div>
    </main>
  );
}

describe("REP17-17 · D49 tras «Compactar lista»", () => {
  it("el control de L2, que sube al compactar, queda guardado 1 s desde la compactación; antes no lo estaba", () => {
    let moved: (control: Element) => boolean = () => false;
    render(<GuardHarness onReady={(fn) => (moved = fn)} />);
    wireScroller();
    tapDiscard();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(moved(l2Control())).toBe(false);

    act(() => {
      screen.getByRole("button", { name: "Compactar lista" }).click();
    });

    expect(moved(l2Control())).toBe(true);
    act(() => {
      jest.advanceTimersByTime(COMPACTION_GUARD_MS);
    });
    expect(moved(l2Control())).toBe(false);
  });
});
