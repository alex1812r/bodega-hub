"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Calma que un modal recién cambiado de paso exige antes de aceptar un clic. Queda por
 * encima del umbral de doble clic del sistema (500 ms).
 */
export const STEP_CLICK_GUARD_MS = 700;

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
 * Cada pulsación o clic hecho durante el lapso, dentro o fuera del modal, lo rearma
 * desde ese instante: una ráfaga de clics nunca atraviesa la guarda; solo actúa el clic
 * que llega tras `lapseMs` de calma.
 *
 * Con el modal abierto se cancela además la auto-repetición de Enter y Espacio sobre
 * los botones de cualquier diálogo: mantener la tecla pulsada activa el botón una vez
 * y no el que aparezca después en su sitio.
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
  const lapseTimerRef = useRef<number | null>(null);
  const outsidePressAtRef = useRef<number | null>(null);

  if (rendered.enabled !== enabled || rendered.stepKey !== stepKey) {
    setRendered({ enabled, stepKey });
    setIsGuarded(enabled && rendered.enabled && rendered.stepKey !== stepKey);
  }

  const stopLapse = useCallback(() => {
    if (lapseTimerRef.current !== null) {
      window.clearTimeout(lapseTimerRef.current);
      lapseTimerRef.current = null;
    }
  }, []);

  /** Empieza a contar el lapso desde ahora, se hubiera empezado ya o no. */
  const restartLapse = useCallback(() => {
    stopLapse();
    lapseTimerRef.current = window.setTimeout(() => {
      lapseTimerRef.current = null;
      setIsGuarded(false);
    }, lapseMs);
  }, [lapseMs, stopLapse]);

  // `stepKey` va en las dependencias: otro cambio de paso dentro del lapso lo reinicia.
  useEffect(() => {
    if (!isGuarded) {
      return;
    }

    restartLapse();

    return stopLapse;
  }, [isGuarded, restartLapse, stepKey, stopLapse]);

  useLayoutEffect(() => {
    guardedRef.current = isGuarded;
  }, [isGuarded]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // El modal solo avisa de que le piden cerrarse, no de por qué: se anota aquí si lo
    // último que hizo el usuario fue pulsar fuera de todo diálogo durante el lapso.
    function handlePointerDown(event: Event) {
      const { target } = event;
      const isInsideDialog = target instanceof Element && target.closest('[role="dialog"]') !== null;

      outsidePressAtRef.current = !isInsideDialog && guardedRef.current ? Date.now() : null;
      rearm();
    }

    // Una pulsación que cae en plena guarda es parte de la ráfaga: la espera vuelve a
    // empezar. Se escuchan la pulsación (un botón deshabilitado no recibe el clic) y el
    // clic (Enter o Espacio sobre un botón no traen pulsación).
    function rearm() {
      if (guardedRef.current) {
        restartLapse();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      outsidePressAtRef.current = null;

      const { target } = event;

      // Tecla mantenida sobre un botón: el navegador repetiría el clic sobre lo que
      // ocupe su sitio en el paso siguiente.
      if (
        event.repeat &&
        (event.key === "Enter" || event.key === " ") &&
        target instanceof Element &&
        target.closest("button") !== null &&
        target.closest('[role="dialog"]') !== null
      ) {
        event.preventDefault();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", rearm, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", rearm, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      outsidePressAtRef.current = null;
    };
  }, [enabled, restartLapse]);

  const ignoresOutsideClose = useCallback(() => {
    const pressedAt = outsidePressAtRef.current;

    // La petición de cierre llega enseguida tras la pulsación; una anotación vieja no vale.
    return pressedAt !== null && Date.now() - pressedAt <= lapseMs;
  }, [lapseMs]);

  return { ignoresOutsideClose, isGuarded };
}
