"use client";

import { createContext, useContext, useLayoutEffect, useState } from "react";

/**
 * REP19-01 (D77(a)): declaración de una llegada asíncrona (respuesta de una consulta, su error) en el sitio donde se
 * resuelve. Quien la recibe (la guarda de `useLayoutHold` de la revisión de factura) toma una foto síncrona de los
 * controles justo antes de `apply` y, tras el commit de lo que `apply` pida, guarda 1 s para el puntero lo que apareció,
 * se habilitó o se movió respecto a la foto. Fuera de un proveedor, `apply` sin más. REP19-05: lo que se declara
 * mientras el panel se monta (lo que ya estaba disponible al montarse) no es una llegada: se aplica sin foto.
 * - `arrive`: desde la respuesta (un `then`, un manejador): aplica en un commit síncrono.
 * - `arriveInLayoutEffect`: desde un efecto de layout (React aplica lo que pide ahí antes de pintar).
 */
export type LayoutArrival = {
  arrive: (apply: () => void) => void;
  arriveInLayoutEffect: (apply: () => void) => void;
};

const applyNow = (apply: () => void) => apply();

export const LayoutArrivalContext = createContext<LayoutArrival>({ arrive: applyNow, arriveInLayoutEffect: applyNow });

export function useLayoutArrival(): LayoutArrival {
  return useContext(LayoutArrivalContext);
}

/**
 * El valor de una consulta que pinta otra librería (React Query) tal como se adoptó: lo que cambie se adopta como una
 * llegada declarada (`arriveInLayoutEffect`), antes de pintar. `same` dice si dos valores pintan lo mismo.
 */
export function useArrivedValue<T>(value: T, same: (left: T, right: T) => boolean = Object.is): T {
  const { arriveInLayoutEffect } = useLayoutArrival();
  const [shown, setShown] = useState(value);
  const changed = !same(shown, value);
  useLayoutEffect(() => {
    if (changed) {
      arriveInLayoutEffect(() => setShown(value));
    }
  }, [arriveInLayoutEffect, changed, value]);
  return changed ? shown : value;
}
