"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Clave única de `sessionStorage` con todas las posiciones guardadas. */
export const SCROLL_POSITIONS_STORAGE_KEY = "bodegahub:scroll-positions";
/** Máximo de URL con posición guardada; al superarlo se olvidan las más antiguas. */
export const MAX_SCROLL_ENTRIES = 50;
/** Intervalo mínimo entre escrituras a `sessionStorage` mientras se hace scroll. */
export const SCROLL_SAVE_THROTTLE_MS = 150;
/**
 * Tiempo máximo, desde `ready`, durante el que se vuelve a aplicar la posición
 * guardada si el alto del contenido sigue cambiando.
 */
export const SCROLL_RESTORE_MAX_MS = 1000;

const MAX_SCROLL_KEY_LENGTH = 2000;
/** Gestos con los que el usuario toma el control del scroll y la restauración se abandona. */
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown"] as const;

type ScrollEntry = [key: string, top: number];

/**
 * Quién hace scroll: un elemento propio (ref) o la ventana. Sin indicarlo se
 * detecta: el `<main>` del `AppShell` si tiene `overflow-y: auto|scroll` (el
 * caso normal) y, si no, la ventana.
 */
export type ScrollRestorationContainer = RefObject<HTMLElement | null> | "window";

export type UseScrollRestorationOptions = {
  /** `true` cuando los datos ya están pintados: hasta entonces no se restaura ni se guarda. */
  ready: boolean;
  container?: ScrollRestorationContainer;
};

function isScrollEntry(value: unknown): value is ScrollEntry {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function readEntries(): ScrollEntry[] {
  try {
    const parsed: unknown = JSON.parse(
      window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY) ?? "[]",
    );

    return Array.isArray(parsed) ? parsed.filter(isScrollEntry) : [];
  } catch {
    // Storage bloqueado o contenido corrupto: se trabaja sin posiciones guardadas.
    return [];
  }
}

function readPosition(key: string): number | null {
  return readEntries().find(([entryKey]) => entryKey === key)?.[1] ?? null;
}

/** Guarda la posición de `key` como la más reciente. Arriba del todo (0) no ocupa sitio. */
function writePosition(key: string, top: number) {
  if (key.length > MAX_SCROLL_KEY_LENGTH) {
    return;
  }

  const entries = readEntries().filter(([entryKey]) => entryKey !== key);
  const position = Math.max(0, Math.round(top));

  if (position > 0) {
    entries.push([key, position]);
  }

  try {
    window.sessionStorage.setItem(
      SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_SCROLL_ENTRIES)),
    );
  } catch {
    // Storage bloqueado o lleno: la posición no se recuerda.
  }
}

function resolveScrollTarget(container: ScrollRestorationContainer | undefined): HTMLElement | Window {
  if (container === "window") {
    return window;
  }

  if (container) {
    return container.current ?? window;
  }

  const main = document.querySelector("main");

  if (main instanceof HTMLElement) {
    const overflowY = window.getComputedStyle(main).overflowY;

    if (overflowY === "auto" || overflowY === "scroll") {
      return main;
    }
  }

  return window;
}

function getScrollTop(target: HTMLElement | Window) {
  return target instanceof Window ? target.scrollY : target.scrollTop;
}

function getScrollHeight(target: HTMLElement | Window) {
  return target instanceof Window
    ? target.document.documentElement.scrollHeight
    : target.scrollHeight;
}

function setScrollTop(target: HTMLElement | Window, top: number) {
  if (target instanceof Window) {
    target.scrollTo(target.scrollX, top);
  } else {
    target.scrollTop = top;
  }
}

function currentLocationKey() {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Recuerda la posición de scroll de una pantalla por URL en `sessionStorage` y
 * la restaura al volver, una sola vez por visita y solo cuando `ready` pasa a
 * `true` (con los datos ya pintados, para que la página tenga su alto real).
 *
 * - `key`: la URL completa de la pantalla (ruta + query). En una lista, pasa
 *   `list.href` de `useUrlListState`. Si se omite, se usa la URL del navegador.
 * - Si tras `ready` el alto del contenido aún cambia (la tabla pasa a tarjetas,
 *   una sección crece tarde), vuelve a aplicar la posición guardada durante
 *   `SCROLL_RESTORE_MAX_MS` como mucho. Lo deja en cuanto el usuario desplaza
 *   (rueda, tacto, teclado, puntero o un scroll sin cambio de alto) y, mientras
 *   dura, no sobrescribe la posición guardada.
 * - Guarda con throttle al hacer scroll, al desmontar y en `pagehide`.
 * - Tolera `sessionStorage` bloqueado y guarda como mucho `MAX_SCROLL_ENTRIES` URL.
 * - `container`: ref del elemento que hace scroll o `"window"`. Por defecto se
 *   detecta el `<main>` del `AppShell`.
 *
 * @example
 * const list = useUrlListState(productsListSchema);
 * useScrollRestoration(list.href, { ready: !isLoading });
 */
export function useScrollRestoration(
  key: string | undefined,
  { container, ready }: UseScrollRestorationOptions,
): void {
  const [armed, setArmed] = useState(false);
  const keyRef = useRef(key);
  const restoredRef = useRef(false);

  // Una vez listos los datos, las recargas posteriores (cambio de filtro) no
  // vuelven a restaurar ni dejan de guardar.
  if (ready && !armed) {
    setArmed(true);
  }

  useLayoutEffect(() => {
    keyRef.current = key;
  });

  // Efecto de layout: su limpieza corre antes de que el contenido que se
  // desmonta desaparezca del DOM y el navegador recorte el scroll a 0.
  useLayoutEffect(() => {
    if (!armed) {
      return;
    }

    const target = resolveScrollTarget(container);
    // Al desmontar, la URL del navegador ya puede ser la de la pantalla siguiente.
    let locationKey = currentLocationKey();
    const resolveKey = () => keyRef.current ?? locationKey;

    // Posición que se está restaurando; `null` cuando no hay restauración en curso.
    let pending: number | null = null;
    let appliedTop = 0;
    let appliedHeight = 0;
    let frame: number | null = null;
    let deadline: number | null = null;

    function applyPending() {
      if (pending === null) {
        return;
      }

      setScrollTop(target, pending);
      appliedTop = getScrollTop(target);
      appliedHeight = getScrollHeight(target);
    }

    if (!restoredRef.current) {
      restoredRef.current = true;
      pending = readPosition(resolveKey());
      applyPending();
    }

    // Mientras se restaura, lo que se guardaría es la posición pedida, no la
    // que el layout a medio montar permite alcanzar.
    let lastTop = pending ?? getScrollTop(target);
    let timer: number | null = null;

    function save() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }

      writePosition(resolveKey(), lastTop);
    }

    function stopRestoring() {
      if (pending === null) {
        return;
      }

      pending = null;
      lastTop = getScrollTop(target);

      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }

      if (deadline !== null) {
        window.clearTimeout(deadline);
        deadline = null;
      }

      USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, stopRestoring, true));
    }

    function watchLayout() {
      frame = null;

      if (pending === null) {
        return;
      }

      if (getScrollHeight(target) !== appliedHeight) {
        applyPending();
      }

      frame = window.requestAnimationFrame(watchLayout);
    }

    function handleScroll() {
      if (pending !== null) {
        const top = getScrollTop(target);

        // Eco de la propia restauración.
        if (top === appliedTop) {
          return;
        }

        // El alto cambió (tabla → tarjetas, sección que crece tarde) y movió el
        // scroll: se vuelve a la posición guardada sin registrar la mala.
        if (getScrollHeight(target) !== appliedHeight) {
          applyPending();
          return;
        }

        // Mismo alto y otra posición: alguien desplazó de verdad.
        stopRestoring();
      }

      lastTop = getScrollTop(target);
      locationKey = currentLocationKey();

      if (timer === null) {
        timer = window.setTimeout(save, SCROLL_SAVE_THROTTLE_MS);
      }
    }

    if (pending !== null) {
      frame = window.requestAnimationFrame(watchLayout);
      deadline = window.setTimeout(stopRestoring, SCROLL_RESTORE_MAX_MS);
      USER_SCROLL_EVENTS.forEach((type) =>
        window.addEventListener(type, stopRestoring, { capture: true, passive: true }),
      );
    }

    target.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", save);

    return () => {
      target.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", save);
      save();
      stopRestoring();
    };
  }, [armed, container]);
}
