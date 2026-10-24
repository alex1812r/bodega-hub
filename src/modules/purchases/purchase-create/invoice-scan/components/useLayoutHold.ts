"use client";

import {
  type CSSProperties,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * D46-a: tras una activación con el puntero, el layout pendiente (alturas y orden) se aplica al
 * desplazar, al usar el teclado o tras este tiempo sin puntero sobre la zona de la acción.
 */
export const LAYOUT_SETTLE_MS = 1500;

/** D46-b: ventana y radio de la guarda espacial entre dos activaciones con el puntero. */
export const POINTER_GUARD_MS = 1000;
export const POINTER_GUARD_RADIUS_PX = 32;

/** Controles que una activación con el puntero puede accionar. */
const CONTROL_SELECTOR =
  "button, a[href], input, select, textarea, label, [role='button'], [role='checkbox'], [role='radio'], [role='option'], [role='switch'], [role='tab']";

/** Cajas cuya altura se conserva mientras el layout está pendiente (`data-layout-box="<clave>"`). */
const LAYOUT_BOX_SELECTOR = "[data-layout-box]";

export type PointerActivation = { x: number; y: number; at: number; control: Element };

/**
 * Activación con el puntero: un clic con `detail ≥ 1` y punto de pantalla sobre un control. Un clic
 * de teclado (`detail` 0) o sin coordenadas no tiene punto bajo el dedo que proteger. Solo desde
 * manejadores de eventos (lee el reloj).
 */
export function readPointerActivation(event: MouseEvent<Element>): PointerActivation | null {
  if (event.detail < 1 || (event.clientX === 0 && event.clientY === 0) || !(event.target instanceof Element)) {
    return null;
  }
  const closest = event.target.closest(CONTROL_SELECTOR);
  // Una etiqueta acciona su control: el clic que el navegador reenvía al control no es otro control.
  const control = closest instanceof HTMLLabelElement ? (closest.control ?? closest) : closest;
  return control ? { x: event.clientX, y: event.clientY, at: Date.now(), control } : null;
}

/** D46-b: otra activación con el puntero, en el mismo sitio y antes de 1 s, sobre un control distinto. */
export function isSpatialRebound(previous: PointerActivation | null, next: PointerActivation): boolean {
  return (
    previous !== null &&
    next.at - previous.at < POINTER_GUARD_MS &&
    Math.hypot(next.x - previous.x, next.y - previous.y) < POINTER_GUARD_RADIUS_PX &&
    next.control !== previous.control
  );
}

type LayoutHold<TOrder> = { order: TOrder; heights: ReadonlyMap<string, number> };

export type Point = { x: number; y: number };

/** Control pulsado y su caja, con su posición vertical antes de la acción. */
type Anchor = { control: Element; controlTop: number; zone: Element | null; zoneTop: number };

function contains(rect: DOMRect, point: Point) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/** Contenedor que desplaza a `element` (el documento si ninguno). */
function scrollParent(element: Element): Element {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * D46-a: «layout pendiente». `holdLayout` se llama en la captura del clic, antes de que la acción
 * cambie nada: fija el orden que se está pintando y el alto actual de cada `[data-layout-box]`
 * dentro de `rootRef` (solo crecen). Mientras dura, `order` devuelve ese orden, `boxStyle` su alto
 * mínimo y, si algo encima del control pulsado cambia de alto, se compensa el desplazamiento para
 * que siga bajo el puntero. Una nueva activación lo prolonga sin cambiar el orden fijado. `mouse`:
 * punto del ratón que activó (null si fue un toque), para saber si sigue sobre la zona.
 * `onFocusLost`: al aplicarse el layout, la caja que tenía el foco se volvió a montar (cambió de
 * lista) y el foco cayó en BODY; recibe su clave.
 */
export function useLayoutHold<TOrder>(rootRef: RefObject<HTMLElement | null>, onFocusLost: (key: string) => void) {
  const [hold, setHold] = useState<LayoutHold<TOrder> | null>(null);
  const holdRef = useRef<LayoutHold<TOrder> | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const mouseRef = useRef<Point | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // Desplazamiento que hizo la compensación: su evento `scroll` no es del usuario.
  const ownScrollRef = useRef<{ scroller: Element; top: number } | null>(null);
  const focusedKeyRef = useRef<string | undefined>(undefined);
  const onFocusLostRef = useRef(onFocusLost);
  useEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });

  const release = useCallback(() => {
    window.clearTimeout(timerRef.current);
    anchorRef.current = null;
    ownScrollRef.current = null;
    if (holdRef.current) {
      const focused = document.activeElement instanceof Element ? document.activeElement : null;
      focusedKeyRef.current = focused?.closest<HTMLElement>(LAYOUT_BOX_SELECTOR)?.dataset.layoutBox;
      holdRef.current = null;
      setHold(null);
    }
  }, []);

  const settleLater = useCallback(() => {
    window.clearTimeout(timerRef.current);
    const settle = () => {
      // Un ratón quieto sobre la zona sigue «sobre ella»; un toque no deja puntero encima.
      const zone = anchorRef.current?.zone;
      const mouse = mouseRef.current;
      if (zone?.isConnected && mouse && contains(zone.getBoundingClientRect(), mouse)) {
        timerRef.current = window.setTimeout(settle, LAYOUT_SETTLE_MS);
        return;
      }
      release();
    };
    timerRef.current = window.setTimeout(settle, LAYOUT_SETTLE_MS);
  }, [release]);

  const holdLayout = useCallback(
    (control: Element, order: TOrder, mouse: Point | null) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const heights = new Map(holdRef.current?.heights);
      for (const box of root.querySelectorAll<HTMLElement>(LAYOUT_BOX_SELECTOR)) {
        const key = box.dataset.layoutBox;
        if (key) {
          heights.set(key, Math.max(heights.get(key) ?? 0, box.getBoundingClientRect().height));
        }
      }
      const next = { order: holdRef.current?.order ?? order, heights };
      holdRef.current = next;
      if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
        // Una casilla nativa cambia en su `change`, después del clic: un render antes la devolvería a
        // su valor controlado y React no emitiría `onChange`. Se pinta tras ese `change`.
        window.addEventListener("change", () => holdRef.current === next && setHold(next), { once: true });
      } else {
        setHold(next);
      }
      // La zona es la caja más cercana al control pulsado (su fila, el encabezado o el panel).
      const zone = control.closest(LAYOUT_BOX_SELECTOR);
      anchorRef.current = {
        control,
        controlTop: control.getBoundingClientRect().top,
        zone,
        zoneTop: zone?.getBoundingClientRect().top ?? 0,
      };
      mouseRef.current = mouse;
      settleLater();
    },
    [rootRef, settleLater],
  );

  // Tras cada render con el layout pendiente, el control pulsado (o su caja, si desapareció) vuelve
  // al sitio en que estaba: lo que creció o encogió por encima no lo mueve bajo el puntero.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!holdRef.current || !anchor) {
      return;
    }
    const controlConnected = anchor.control.isConnected;
    const element = controlConnected ? anchor.control : anchor.zone?.isConnected ? anchor.zone : null;
    if (!element) {
      return;
    }
    const delta = element.getBoundingClientRect().top - (controlConnected ? anchor.controlTop : anchor.zoneTop);
    if (Math.abs(delta) < 1) {
      return;
    }
    const scroller = scrollParent(element);
    const top = element.getBoundingClientRect().top;
    scroller.scrollBy({ top: delta, behavior: "instant" });
    if (Math.abs(element.getBoundingClientRect().top - top) < 1) {
      // Dentro de algo fijo o `sticky` ya pegado (el pie): desplazar no lo devuelve, solo movería lo demás.
      scroller.scrollBy({ top: -delta, behavior: "instant" });
      return;
    }
    ownScrollRef.current = { scroller, top: scroller.scrollTop };
  });

  const holding = hold !== null;
  useEffect(() => {
    if (holding) {
      return;
    }
    const key = focusedKeyRef.current;
    focusedKeyRef.current = undefined;
    if (key && (document.activeElement === null || document.activeElement === document.body)) {
      onFocusLostRef.current(key);
    }
  }, [holding]);

  useEffect(() => {
    if (!holding) {
      return;
    }
    const onScroll = (event: Event) => {
      const own = ownScrollRef.current;
      const scroller = event.target instanceof Element ? event.target : document.scrollingElement;
      if (own && scroller === own.scroller && Math.abs(own.scroller.scrollTop - own.top) < 1) {
        return;
      }
      release();
    };
    const onPointerMove = (event: PointerEvent) => {
      mouseRef.current = event.pointerType === "mouse" ? { x: event.clientX, y: event.clientY } : null;
    };
    const onPointerLeave = () => {
      mouseRef.current = null;
    };
    // Desplazar (rueda, arrastre o barra) o usar el teclado aplica el layout pendiente.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", release, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerdown", onPointerMove, true);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", release, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerMove, true);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [holding, release]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const boxStyle = useCallback(
    (key: string): CSSProperties | undefined => {
      const height = hold?.heights.get(key);
      return height ? { minHeight: height } : undefined;
    },
    [hold],
  );

  return {
    /** Orden fijado mientras el layout está pendiente. */
    order: hold?.order,
    boxStyle,
    holdLayout,
    /** Para manejadores: el layout está pendiente ahora (el foco no debe desplazar). */
    isHolding: useCallback(() => holdRef.current !== null, []),
  };
}
