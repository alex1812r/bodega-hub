"use client";

import { useLayoutEffect } from "react";

/**
 * Avisa a quien monta este componente de que sus datos ya están pintados. Sirve
 * a las pantallas con `useScrollRestoration` cuya lista vive en un hijo (la
 * sublista de una pestaña): el hijo llama aquí y la pantalla usa el aviso como
 * `ready`.
 *
 * Efecto de layout: el aviso llega antes de pintar, así la pantalla restaura el
 * scroll en el mismo fotograma en que aparecen las filas. `onReady` debe ser
 * estable (un `setState` o un `useCallback`) e idempotente.
 *
 * @example
 * const [listReady, setListReady] = useState(false);
 * useScrollRestoration(url, { ready: listReady });
 * // en el hijo: useReportReady(!query.isLoading, onReady);
 */
export function useReportReady(ready: boolean, onReady: (() => void) | undefined): void {
  useLayoutEffect(() => {
    if (ready) {
      onReady?.();
    }
  }, [onReady, ready]);
}
