"use client";

import { type FocusEvent, useCallback, useEffect, useRef } from "react";

import { type ProcessGuardController, useProcessGuard } from "@/shared/hooks/useProcessGuard";

type UseFormModalDiscardGuardOptions = {
  /** El formulario está abierto y tiene cambios sin guardar. */
  active: boolean;
  /** Nombre del proceso que muestra la confirmación. */
  label: string;
};

type FormModalDiscardGuard = {
  /** Se pinta con `<ProcessGuardModal guard={guard} />` DENTRO del modal del formulario. */
  guard: ProcessGuardController;
  /**
   * Cierre pedido por el usuario (Esc, clic fuera, Cancelar, la X). Con cambios
   * pregunta antes de llamar a `close`; sin cambios lo llama en el acto.
   */
  requestClose: (close: () => void) => void;
  /** `onFocus` del formulario: recuerda el último campo con foco. */
  trackFocus: (event: FocusEvent<HTMLElement>) => void;
};

/**
 * Guardia (`onLeave: "discard"`) de un formulario en modal. Además de lo que ya
 * intercepta `useProcessGuard` (enlaces, atrás, recarga), pregunta al cerrar el
 * modal y, con "Seguir aquí", devuelve el foco a donde estaba: el modal
 * compartido no lo hace al cerrarse.
 */
export function useFormModalDiscardGuard({
  active,
  label,
}: UseFormModalDiscardGuardOptions): FormModalDiscardGuard {
  const guard = useProcessGuard({ active, label, onLeave: "discard" });
  const { requestLeave } = guard;
  const isAsking = guard.dialog.open;
  const lastFieldRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isAsking) {
      // Pregunta que no viene de cerrar el modal (atrás del navegador): vuelve al último campo.
      returnFocusRef.current ??= lastFieldRef.current;
      return;
    }

    const target = returnFocusRef.current;

    returnFocusRef.current = null;

    if (target?.isConnected) {
      target.focus();
    }
  }, [isAsking]);

  const requestClose = useCallback(
    (close: () => void) => {
      const focused = document.activeElement;

      returnFocusRef.current =
        focused instanceof HTMLElement && focused !== document.body
          ? focused
          : lastFieldRef.current;

      requestLeave(() => {
        // Se cierra (sin cambios o tras "Salir"): no queda campo al que volver.
        returnFocusRef.current = null;
        close();
      });
    },
    [requestLeave],
  );

  const trackFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    lastFieldRef.current = event.target;
  }, []);

  return { guard, requestClose, trackFocus };
}
