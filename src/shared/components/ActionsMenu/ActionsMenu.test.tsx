import "@testing-library/jest-dom";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ActionsMenu } from "./ActionsMenu";

type Box = { height: number; left: number; top: number; width: number };

function toRect({ height, left, top, width }: Box): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  };
}

describe("ActionsMenu", () => {
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  });

  /** Ventana, disparador y tamaño natural del menú simulados (jsdom no hace layout). */
  function mockLayout(layout: {
    menu: { height: number; width: number };
    trigger: Box;
    viewport: { height: number; width: number };
  }) {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: layout.viewport.height,
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: layout.viewport.width });
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return this.getAttribute("role") === "menu"
          ? toRect({ ...layout.menu, left: 0, top: 0 })
          : toRect(layout.trigger);
      });
  }

  function openMenu() {
    const view = render(
      <ActionsMenu
        actions={[
          { label: "Ver detalle", onSelect: jest.fn() },
          { label: "Ver recibo", onSelect: jest.fn() },
          { label: "Anular", onSelect: jest.fn(), variant: "danger" },
          { label: "Devolver", onSelect: jest.fn() },
        ]}
      />,
    );

    fireEvent.click(view.getByLabelText(/abrir acciones/i));

    return view.getByRole("menu");
  }

  it("opens menu actions", () => {
    const { getByLabelText, getByRole } = render(
      <ActionsMenu actions={[{ label: "Editar", onSelect: jest.fn() }]} />,
    );

    fireEvent.click(getByLabelText(/abrir acciones/i));

    expect(getByRole("menuitem", { name: /editar/i })).toBeVisible();
  });

  it("con sitio debajo abre bajo el disparador, alineado a su borde derecho", () => {
    mockLayout({
      menu: { height: 190, width: 160 },
      trigger: { height: 32, left: 1200, top: 100, width: 32 },
      viewport: { height: 800, width: 1280 },
    });

    const menu = openMenu();

    expect(menu.style.top).toBe("136px");
    // Borde derecho del menú = borde derecho del disparador (1232).
    expect(menu.style.left).toBe("1072px");
    expect(menu.style.maxHeight).toBe("");
  });

  it("M1: en la última fila, sin sitio debajo, abre hacia arriba y no se sale de la ventana", () => {
    // Medidas del reporte: 1280×800, menú de 190 px que quedaba en top 712 / bottom 902.
    mockLayout({
      menu: { height: 190, width: 160 },
      trigger: { height: 32, left: 1200, top: 676, width: 32 },
      viewport: { height: 800, width: 1280 },
    });

    const menu = openMenu();
    const top = Number.parseFloat(menu.style.top);

    expect(top + 190).toBeLessThanOrEqual(800);
    // Pegado al disparador por arriba: 676 - 4 - 190.
    expect(top).toBe(482);
    expect(menu.style.maxHeight).toBe("");
  });

  it("ventana muy baja: sin sitio arriba ni abajo, se acota a la ventana con desplazamiento propio", () => {
    mockLayout({
      menu: { height: 190, width: 160 },
      trigger: { height: 32, left: 800, top: 60, width: 32 },
      viewport: { height: 150, width: 1024 },
    });

    const menu = openMenu();
    const top = Number.parseFloat(menu.style.top);
    const maxHeight = Number.parseFloat(menu.style.maxHeight);

    expect(maxHeight).toBe(134);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + maxHeight).toBeLessThanOrEqual(150 - 8);
    expect(menu).toHaveClass("overflow-y-auto");
  });

  it("390 px: no se sale por la izquierda ni por la derecha", () => {
    mockLayout({
      menu: { height: 190, width: 160 },
      trigger: { height: 32, left: 68, top: 100, width: 32 },
      viewport: { height: 800, width: 390 },
    });

    expect(openMenu().style.left).toBe("8px");

    jest.restoreAllMocks();
    cleanup();
    mockLayout({
      menu: { height: 190, width: 160 },
      trigger: { height: 32, left: 380, top: 100, width: 32 },
      viewport: { height: 800, width: 390 },
    });

    // 390 - 8 - 160.
    expect(openMenu().style.left).toBe("222px");
  });

  it("recalcula la posición al desplazar la página con el menú abierto", () => {
    const layout = {
      menu: { height: 190, width: 160 },
      trigger: { height: 32, left: 1200, top: 100, width: 32 },
      viewport: { height: 800, width: 1280 },
    };

    mockLayout(layout);

    const menu = openMenu();

    expect(menu.style.top).toBe("136px");

    layout.trigger.top = 676;
    fireEvent.scroll(window);

    expect(menu.style.top).toBe("482px");
  });
});
