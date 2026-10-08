import { act, fireEvent, renderHook } from "@testing-library/react";

import { STEP_CLICK_GUARD_MS, useStepClickGuard } from "./useStepClickGuard";

describe("useStepClickGuard", () => {
  let dialog: HTMLElement;

  beforeEach(() => {
    jest.useFakeTimers();
    dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.append(document.createElement("button"));
    document.body.append(dialog);
  });

  afterEach(() => {
    dialog.remove();
    jest.useRealTimers();
  });

  function advance(ms: number) {
    act(() => {
      jest.advanceTimersByTime(ms);
    });
  }

  function renderGuard(initial: { enabled?: boolean; stepKey: string }) {
    return renderHook(
      ({ enabled, stepKey }: { enabled?: boolean; stepKey: string }) =>
        useStepClickGuard(stepKey, { enabled }),
      { initialProps: initial },
    );
  }

  it("no guarda al montar; tras un cambio de paso guarda exactamente el lapso", () => {
    const guard = renderGuard({ stepKey: "form" });

    expect(guard.result.current.isGuarded).toBe(false);

    guard.rerender({ stepKey: "preview" });
    expect(guard.result.current.isGuarded).toBe(true);

    advance(STEP_CLICK_GUARD_MS - 1);
    expect(guard.result.current.isGuarded).toBe(true);

    advance(1);
    expect(guard.result.current.isGuarded).toBe(false);
  });

  it("otro cambio de paso dentro del lapso lo reinicia, también al volver al paso anterior", () => {
    const guard = renderGuard({ stepKey: "form" });

    guard.rerender({ stepKey: "preview" });
    advance(300);
    guard.rerender({ stepKey: "form" });
    expect(guard.result.current.isGuarded).toBe(true);

    advance(300);
    expect(guard.result.current.isGuarded).toBe(true);

    advance(100);
    expect(guard.result.current.isGuarded).toBe(false);
  });

  it("un render sin cambio de paso no arma nada", () => {
    const guard = renderGuard({ stepKey: "form" });

    guard.rerender({ stepKey: "form" });

    expect(guard.result.current.isGuarded).toBe(false);
  });

  it("con el modal cerrado no guarda, y abrirlo tampoco aunque llegue en otro paso", () => {
    const guard = renderGuard({ enabled: false, stepKey: "form" });

    guard.rerender({ enabled: false, stepKey: "run" });
    expect(guard.result.current.isGuarded).toBe(false);

    guard.rerender({ enabled: true, stepKey: "form" });
    expect(guard.result.current.isGuarded).toBe(false);

    guard.rerender({ enabled: true, stepKey: "preview" });
    expect(guard.result.current.isGuarded).toBe(true);

    // Cerrar suelta la guarda.
    guard.rerender({ enabled: false, stepKey: "preview" });
    expect(guard.result.current.isGuarded).toBe(false);
  });

  it("delata el cierre por un clic fuera de todo diálogo hecho durante el lapso", () => {
    const guard = renderGuard({ stepKey: "form" });

    // Sin cambio de paso reciente, un clic fuera cierra como siempre.
    fireEvent.pointerDown(document.body);
    expect(guard.result.current.ignoresOutsideClose()).toBe(false);

    guard.rerender({ stepKey: "preview" });
    fireEvent.pointerDown(document.body);
    expect(guard.result.current.ignoresOutsideClose()).toBe(true);
  });

  it("la X, los botones del modal y Esc no cuentan como clic fuera", () => {
    const guard = renderGuard({ stepKey: "form" });

    guard.rerender({ stepKey: "preview" });
    fireEvent.pointerDown(dialog.querySelector("button")!);
    expect(guard.result.current.ignoresOutsideClose()).toBe(false);

    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(guard.result.current.ignoresOutsideClose()).toBe(false);
  });

  it("pasado el lapso, ni un clic fuera nuevo ni el anterior frenan el cierre", () => {
    const guard = renderGuard({ stepKey: "form" });

    guard.rerender({ stepKey: "preview" });
    advance(STEP_CLICK_GUARD_MS - 1);
    fireEvent.pointerDown(document.body);
    expect(guard.result.current.ignoresOutsideClose()).toBe(true);

    // Un cierre sin pulsación propia (lector de pantalla) no hereda la anotación vieja.
    advance(STEP_CLICK_GUARD_MS + 1);
    expect(guard.result.current.ignoresOutsideClose()).toBe(false);

    fireEvent.pointerDown(document.body);
    expect(guard.result.current.ignoresOutsideClose()).toBe(false);
  });

  it("con el modal cerrado no escucha pulsaciones", () => {
    const guard = renderGuard({ enabled: true, stepKey: "form" });

    guard.rerender({ enabled: true, stepKey: "preview" });
    guard.rerender({ enabled: false, stepKey: "preview" });
    fireEvent.pointerDown(document.body);

    expect(guard.result.current.ignoresOutsideClose()).toBe(false);
  });
});
