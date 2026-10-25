"use client";

import { type ChangeEvent, type PointerEvent, type RefObject, useCallback, useLayoutEffect, useRef } from "react";

type Place = { top: number; left: number; at: number };
type Press = { pointerId: number; at: number; released: boolean };

/**
 * D54(a)(3) (REP12-02, casilla de diferencia) y REP12-05 (casilla del aviso de duplicado): una casilla
 * que reconoce algo de dinero solo cambia con su propio control (su texto va por `aria-labelledby`,
 * no es `<label>`) y, con el puntero, con una pulsación (pointerdown + pointerup) sobre ella que
 * empezó después de su último cambio de sitio o de su aparición. El teclado (Espacio, clic con
 * `detail` 0) no tiene punto bajo el dedo y siempre vale.
 *
 * `inputRef` es el de la casilla. `accepts(event)` se llama en su `onChange` antes de aplicar el
 * cambio; `onPointerDown`/`onPointerUp` van en la casilla.
 */
export function useFreshPressCheckbox(inputRef: RefObject<HTMLInputElement | null>) {
  // Sitio de la casilla y desde cuándo está ahí; pulsación del puntero sobre ella.
  const placeRef = useRef<Place | null>(null);
  const pressRef = useRef<Press | null>(null);

  // Al aparecer o moverse la casilla, una pulsación que ya estaba en curso deja de contar.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) {
      placeRef.current = null;
      return;
    }
    const { top, left } = input.getBoundingClientRect();
    const place = placeRef.current;
    if (!place || Math.abs(place.top - top) >= 1 || Math.abs(place.left - left) >= 1) {
      placeRef.current = { top, left, at: Date.now() };
      pressRef.current = null;
    }
  });

  const accepts = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    // Con el puntero (clic con `detail` ≥ 1) solo vale una pulsación completa sobre la casilla desde
    // su último cambio de sitio; el teclado (Espacio) no tiene punto bajo el dedo.
    const native = event.nativeEvent;
    if (native instanceof MouseEvent && native.detail > 0) {
      const placedAt = placeRef.current?.at ?? 0;
      if (!press || !press.released || press.at < placedAt) {
        return false;
      }
    }
    return true;
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLInputElement>) => {
    pressRef.current = { pointerId: event.pointerId, at: Date.now(), released: false };
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<HTMLInputElement>) => {
    const press = pressRef.current;
    if (press?.pointerId === event.pointerId) {
      pressRef.current = { ...press, released: true };
    }
  }, []);

  return { accepts, onPointerDown, onPointerUp };
}
