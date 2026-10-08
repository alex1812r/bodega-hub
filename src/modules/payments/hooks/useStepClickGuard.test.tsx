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
    advance(STEP_CLICK_GUARD_MS - 100);
    guard.rerender({ stepKey: "form" });
    expect(guard.result.current.isGuarded).toBe(true);

    advance(STEP_CLICK_GUARD_MS - 100);
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

  describe("PAG-F10 · una ráfaga de clics nunca atraviesa la guarda", () => {
    it("el lapso supera el umbral de doble clic del sistema (500 ms)", () => {
      expect(STEP_CLICK_GUARD_MS).toBeGreaterThan(500);
    });

    it("un clic a 450 ms del cambio de paso se ignora y rearma el lapso desde ese instante", () => {
      const guard = renderGuard({ stepKey: "form" });

      guard.rerender({ stepKey: "preview" });
      advance(450);
      expect(guard.result.current.isGuarded).toBe(true);

      fireEvent.click(dialog.querySelector("button")!);
      advance(STEP_CLICK_GUARD_MS - 1);
      expect(guard.result.current.isGuarded).toBe(true);

      advance(1);
      expect(guard.result.current.isGuarded).toBe(false);
    });

    it("clics cada 200 ms: ninguno encuentra la guarda abierta; tras el lapso en calma, sí", () => {
      const guard = renderGuard({ stepKey: "form" });

      guard.rerender({ stepKey: "preview" });

      for (let click = 0; click < 8; click += 1) {
        advance(200);
        expect(guard.result.current.isGuarded).toBe(true);
        fireEvent.pointerDown(dialog.querySelector("button")!);
        fireEvent.click(dialog.querySelector("button")!);
      }

      advance(STEP_CLICK_GUARD_MS - 1);
      expect(guard.result.current.isGuarded).toBe(true);

      advance(1);
      expect(guard.result.current.isGuarded).toBe(false);
    });

    it("una pulsación sobre un botón deshabilitado (sin clic) también rearma", () => {
      const guard = renderGuard({ stepKey: "form" });
      const button = dialog.querySelector("button")!;

      button.disabled = true;
      guard.rerender({ stepKey: "preview" });
      advance(450);
      fireEvent.pointerDown(button);
      advance(450);

      expect(guard.result.current.isGuarded).toBe(true);
    });

    it("un clic fuera ignorado rearma: el siguiente clic fuera de la ráfaga tampoco cierra", () => {
      const guard = renderGuard({ stepKey: "form" });

      guard.rerender({ stepKey: "preview" });
      advance(450);
      fireEvent.pointerDown(document.body);
      expect(guard.result.current.ignoresOutsideClose()).toBe(true);

      advance(450);
      expect(guard.result.current.isGuarded).toBe(true);
      fireEvent.pointerDown(document.body);
      expect(guard.result.current.ignoresOutsideClose()).toBe(true);

      advance(STEP_CLICK_GUARD_MS);
      fireEvent.pointerDown(document.body);
      expect(guard.result.current.ignoresOutsideClose()).toBe(false);
    });

    it("sin guarda armada los clics no arman nada", () => {
      const guard = renderGuard({ stepKey: "form" });

      fireEvent.pointerDown(dialog.querySelector("button")!);
      fireEvent.click(dialog.querySelector("button")!);

      expect(guard.result.current.isGuarded).toBe(false);
    });

    it("R5: la auto-repetición de Enter o Espacio sobre un botón de un diálogo se cancela; la primera pulsación no", () => {
      renderGuard({ stepKey: "form" });

      const button = dialog.querySelector("button")!;

      // `fireEvent` devuelve `false` si alguien canceló el evento (no habrá clic).
      expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
      expect(fireEvent.keyDown(button, { key: "Enter", repeat: true })).toBe(false);
      expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
      expect(fireEvent.keyDown(button, { key: " ", repeat: true })).toBe(false);
      // Otras teclas mantenidas (Tab, flechas) siguen su curso.
      expect(fireEvent.keyDown(button, { key: "Tab", repeat: true })).toBe(true);
    });

    it("R5: no toca la auto-repetición en campos de texto, fuera de los diálogos ni con el modal cerrado", () => {
      const input = document.createElement("input");
      const outsideButton = document.createElement("button");

      dialog.append(input);
      document.body.append(outsideButton);

      const guard = renderGuard({ enabled: true, stepKey: "form" });

      expect(fireEvent.keyDown(input, { key: "Enter", repeat: true })).toBe(true);
      expect(fireEvent.keyDown(outsideButton, { key: "Enter", repeat: true })).toBe(true);

      guard.rerender({ enabled: false, stepKey: "form" });
      expect(
        fireEvent.keyDown(dialog.querySelector("button")!, { key: "Enter", repeat: true }),
      ).toBe(true);

      outsideButton.remove();
    });
  });

  it("con el modal cerrado no escucha pulsaciones", () => {
    const guard = renderGuard({ enabled: true, stepKey: "form" });

    guard.rerender({ enabled: true, stepKey: "preview" });
    guard.rerender({ enabled: false, stepKey: "preview" });
    fireEvent.pointerDown(document.body);

    expect(guard.result.current.ignoresOutsideClose()).toBe(false);
  });
});
