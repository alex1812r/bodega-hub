"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Lapso en que un modal recién cambiado de paso ignora el segundo clic de un doble clic. */
export const STEP_CLICK_GUARD_MS = 400;

type StepClickGuardOptions = {
  /**
   * `false` con el modal cerrado: no se arma ni escucha nada. Abrirlo tampoco arma el
   * lapso (abrir no es un cambio de paso).
   */
  enabled?: boolean;
  lapseMs?: number;
};

export type StepClickGuard = {
  /**
   * `true` si la petición de cierre que se está atendiendo viene de un clic fuera de
   * todo diálogo hecho durante el lapso. Esc, la X y los botones del modal no cuentan.
   */
  ignoresOutsideClose: () => boolean;
  /** `true` durante el lapso que sigue a un cambio de `stepKey`. */
  isGuarded: boolean;
};

/**
 * Guarda de doble clic para modales por pasos. Cuando un modal cambia de paso, el
 * botón nuevo aparece donde estaba el pulsado (o el modal cambia de alto y ese punto
 * queda sobre el fondo): el segundo clic de un doble clic ejecutaría una acción que el
 * usuario no ha visto, o cerraría el modal.
 *
 * `stepKey` resume lo que el modal enseña (paso, envío en curso, estado por
 * confirmar...). Cada vez que cambia con el modal abierto, durante `lapseMs`
 * `isGuarded` es `true` (las acciones deben ignorar el clic) e `ignoresOutsideClose()`
 * delata los cierres por clic fuera.
 *
 * @example
 * const guard = useStepClickGuard(`${step}|${isSending}`, { enabled: open });
 *
 * <Modal
 *   footer={<Button onClick={() => !guard.isGuarded && confirm()}>Confirmar</Button>}
 *   onOpenChange={(next) => {
 *     if (!next && guard.ignoresOutsideClose()) return;
 *     setOpen(next);
 *   }}
 * />
 */
export function useStepClickGuard(
  stepKey: string,
  { enabled = true, lapseMs = STEP_CLICK_GUARD_MS }: StepClickGuardOptions = {},
): StepClickGuard {
  const [rendered, setRendered] = useState({ enabled, stepKey });
  const [isGuarded, setIsGuarded] = useState(false);
  const guardedRef = useRef(false);
  const outsidePressAtRef = useRef<number | null>(null);

  if (rendered.enabled !== enabled || rendered.stepKey !== stepKey) {
    setRendered({ enabled, stepKey });
    setIsGuarded(enabled && rendered.enabled && rendered.stepKey !== stepKey);
  }

  // `stepKey` va en las dependencias: otro cambio de paso dentro del lapso lo reinicia.
  useEffect(() => {
    if (!isGuarded) {
      return;
    }

    const timer = window.setTimeout(() => setIsGuarded(false), lapseMs);

    return () => window.clearTimeout(timer);
  }, [isGuarded, lapseMs, stepKey]);

  useLayoutEffect(() => {
    guardedRef.current = isGuarded;
  }, [isGuarded]);

  // El modal solo avisa de que le piden cerrarse, no de por qué: se anota aquí si lo
  // último que hizo el usuario fue pulsar fuera de todo diálogo durante el lapso.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handlePointerDown(event: Event) {
      const { target } = event;
      const isInsideDialog = target instanceof Element && target.closest('[role="dialog"]') !== null;

      outsidePressAtRef.current = !isInsideDialog && guardedRef.current ? Date.now() : null;
    }

    function handleKeyDown() {
      outsidePressAtRef.current = null;
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      outsidePressAtRef.current = null;
    };
  }, [enabled]);

  const ignoresOutsideClose = useCallback(() => {
    const pressedAt = outsidePressAtRef.current;

    // La petición de cierre llega enseguida tras la pulsación; una anotación vieja no vale.
    return pressedAt !== null && Date.now() - pressedAt <= lapseMs;
  }, [lapseMs]);

  return { ignoresOutsideClose, isGuarded };
}
