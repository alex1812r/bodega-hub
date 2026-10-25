"use client";

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** D46-b: ventana y radio de la guarda espacial entre dos activaciones con el puntero. */
export const POINTER_GUARD_MS = 1000;
export const POINTER_GUARD_RADIUS_PX = 32;

/** D49: tras aplicar el layout pendiente, ventana en que no actúa un control cuya caja se movió. */
export const COMPACTION_GUARD_MS = 1000;

/** Controles que una activación con el puntero puede accionar. */
const CONTROL_SELECTOR =
  "button, a[href], input, select, textarea, label, [role='button'], [role='checkbox'], [role='radio'], [role='option'], [role='switch'], [role='tab']";

/** B-qa02-3: campos en que se escribe; con el teclado, el enfocado no se mueve al aplicar el layout. */
const TYPING_SELECTOR = "input, textarea, select, [contenteditable='true']";

/** Cajas cuya altura se conserva mientras el layout está pendiente (`data-layout-box="<clave>"`). */
const LAYOUT_BOX_SELECTOR = "[data-layout-box]";

/**
 * D54(a): zonas (el pie fijo) que pueden cambiar de alto con la acción aunque estén retenidas: un
 * control suyo que aparece o se mueve con el layout pendiente queda guardado desde ESE momento.
 */
const SHIFT_GUARD_SELECTOR = "[data-layout-shift-guard]";

export type PointerActivation = { x: number; y: number; at: number; control: Element };

/**
 * Activación con el puntero: un clic con `detail ≥ 1` y punto de pantalla sobre un control. Un clic
 * de teclado (`detail` 0) o sin coordenadas no tiene punto bajo el dedo que proteger. Solo desde
 * manejadores de eventos (lee el reloj).
 */
export function readPointerActivation(
  event: { detail: number; clientX: number; clientY: number; target: EventTarget | null },
): PointerActivation | null {
  if (event.detail < 1 || (event.clientX === 0 && event.clientY === 0) || !(event.target instanceof Element)) {
    return null;
  }
  const closest = event.target.closest(CONTROL_SELECTOR);
  // Una etiqueta acciona su control: el clic que el navegador reenvía al control no es otro control.
  const control = closest instanceof HTMLLabelElement ? (closest.control ?? closest) : closest;
  return control ? { x: event.clientX, y: event.clientY, at: Date.now(), control } : null;
}

/**
 * B-p11-1 (caos p11): al elegir en una lista flotante (portal, fuera del panel) la lista se cierra y
 * destapa lo que tenía debajo. Ese control no acepta un clic en el mismo punto hasta que el puntero se
 * aleje de él (más de POINTER_GUARD_RADIUS_PX) o pasen REVEAL_GUARD_MS: un doble clic/toque lento llega
 * a ~1,2 s (el del reporte), 2 s lo cubre con margen y deja aceptar un toque deliberado tras una pausa.
 */
export const REVEAL_GUARD_MS = 2000;

/** D46-b: otra activación con el puntero, en el mismo sitio y antes de `windowMs`, sobre un control distinto. */
export function isSpatialRebound(
  previous: PointerActivation | null,
  next: PointerActivation,
  windowMs: number = POINTER_GUARD_MS,
): boolean {
  return (
    previous !== null &&
    next.at - previous.at < windowMs &&
    Math.hypot(next.x - previous.x, next.y - previous.y) < POINTER_GUARD_RADIUS_PX &&
    next.control !== previous.control
  );
}

type LayoutHold<TOrder> = { order: TOrder; heights: ReadonlyMap<string, number> };

/** Control pulsado y su caja, con su posición vertical antes de la acción. */
type Anchor = { control: Element; controlTop: number; zone: Element | null; zoneTop: number };

type Position = { top: number; left: number };

function contains(rect: DOMRect, x: number, y: number) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Posición en pantalla de cada control (los del buscador están en un portal: todo el documento). */
function controlPositions(): Map<Element, Position> {
  const positions = new Map<Element, Position>();
  for (const control of document.querySelectorAll(CONTROL_SELECTOR)) {
    const { top, left } = control.getBoundingClientRect();
    positions.set(control, { top, left });
  }
  return positions;
}

/** Posición en pantalla de los controles de las zonas `[data-layout-shift-guard]` de `root`. */
function shiftGuardedPositions(root: Element): Map<Element, Position> {
  const positions = new Map<Element, Position>();
  for (const zone of root.querySelectorAll(SHIFT_GUARD_SELECTOR)) {
    for (const control of zone.querySelectorAll(CONTROL_SELECTOR)) {
      const { top, left } = control.getBoundingClientRect();
      positions.set(control, { top, left });
    }
  }
  return positions;
}

/** Controles de `now` que no estaban en `before` o cambiaron de sitio (≥ 1 px). */
function movedControls(before: ReadonlyMap<Element, Position>, now: ReadonlyMap<Element, Position>): Element[] {
  return [...now].flatMap(([control, position]) => {
    const was = before.get(control);
    return !was || Math.abs(was.top - position.top) >= 1 || Math.abs(was.left - position.left) >= 1 ? [control] : [];
  });
}

/** Marca `controls` como movidos ahora; olvida los que ya salieron de la guarda. Solo desde efectos. */
function markMoved(movedAt: Map<Element, number>, controls: readonly Element[]) {
  const now = Date.now();
  for (const [control, at] of movedAt) {
    if (now - at >= COMPACTION_GUARD_MS) {
      movedAt.delete(control);
    }
  }
  for (const control of controls) {
    movedAt.set(control, now);
  }
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

type OwnScroll = { scroller: Element; top: number };

/** B-qa02-1: caja de cada fila (`[data-layout-box^="row:"]`) de `root`, por clave. */
type RowBox = { element: Element; top: number; height: number };

function rowBoxes(root: Element): Map<string, RowBox> {
  const boxes = new Map<string, RowBox>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-layout-box^="row:"]')) {
    const { top, height } = element.getBoundingClientRect();
    boxes.set(element.dataset.layoutBox ?? "", { element, top, height });
  }
  return boxes;
}

/** Franja vertical visible del contenedor que desplaza a `element`. */
function visibleRange(element: Element): { top: number; bottom: number } {
  const scroller = scrollParent(element);
  if (scroller === document.scrollingElement || scroller === document.documentElement) {
    return { top: 0, bottom: window.innerHeight };
  }
  const { top, bottom } = scroller.getBoundingClientRect();
  return { top: Math.max(0, top), bottom: Math.min(window.innerHeight, bottom) };
}

/**
 * B-qa02-1 (D52): al aplicar el layout, la fila que sigue a la primera que encogió (o se fue) a la
 * vista, y que no cambió de alto, vuelve a su punto de pantalla: lo compactado no la saca de la vista.
 */
function anchorNextRow(root: Element, before: ReadonlyMap<string, RowBox>): OwnScroll | null {
  const view = visibleRange(root);
  const now = rowBoxes(root);
  const sorted = [...before].sort(([, left], [, right]) => left.top - right.top);
  const changed = (key: string, box: RowBox) => {
    const current = now.get(key);
    return !current || Math.abs(current.height - box.height) >= 1;
  };
  const compacted = sorted.find(([key, box]) => box.top < view.bottom && changed(key, box));
  if (!compacted) {
    return null;
  }
  const anchor = sorted.find(
    ([key, box]) =>
      box.top > compacted[1].top && box.top < view.bottom && box.top + box.height > view.top && !changed(key, box),
  );
  const current = anchor ? now.get(anchor[0]) : undefined;
  if (!anchor || !current) {
    return null;
  }
  const delta = current.top - anchor[1].top;
  return Math.abs(delta) >= 1 ? scrollBack(current.element, delta) : null;
}

/**
 * Desplaza el contenedor de `element` para devolverlo `delta` px a su sitio. Dentro de algo fijo o
 * `sticky` ya pegado (el pie) desplazar no lo devuelve y solo movería lo demás: se deshace (`null`).
 * Devuelve el desplazamiento hecho, cuyo evento `scroll` no es del usuario.
 */
function scrollBack(element: Element, delta: number): OwnScroll | null {
  const scroller = scrollParent(element);
  const top = element.getBoundingClientRect().top;
  scroller.scrollBy({ top: delta, behavior: "instant" });
  if (Math.abs(element.getBoundingClientRect().top - top) < 1) {
    scroller.scrollBy({ top: -delta, behavior: "instant" });
    return null;
  }
  return { scroller, top: scroller.scrollTop };
}

/**
 * D46-a: «layout pendiente». `holdLayout` se llama en la captura del clic, antes de que la acción
 * cambie nada: fija el orden que se está pintando y el alto actual de cada `[data-layout-box]`
 * dentro de `rootRef` (solo crecen). Mientras dura, `order` devuelve ese orden, `boxStyle` su alto
 * mínimo y, si algo encima del control pulsado cambia de alto, se compensa el desplazamiento para
 * que siga bajo el puntero. Una nueva activación lo prolonga sin cambiar el orden fijado.
 * D48(b)/D49: nunca se aplica por tiempo. Se aplica al desplazar (rueda, arrastre o barra), al usar
 * el teclado o cuando el RATÓN sale del panel completo (`rootRef`) o de la ventana; tras un toque,
 * nunca solo. Si lo aplica el teclado, el control enfocado se queda en su punto de pantalla
 * (B-qa02-3). Al aplicarlo se comparan las posiciones de los controles antes y después: durante
 * COMPACTION_GUARD_MS, `movedByCompaction` dice si un control se movió (o apareció) con ello.
 * D54(a): las zonas `[data-layout-shift-guard]` (el pie) se miden además tras cada render con el
 * layout pendiente: lo que aparece o se mueve en ellas queda guardado igual, desde ese render.
 * `onFocusLost`: al aplicarse el layout, la caja que tenía el foco se volvió a montar (cambió de
 * lista) y el foco cayó en BODY; recibe su clave.
 */
export function useLayoutHold<TOrder>(rootRef: RefObject<HTMLElement | null>, onFocusLost: (key: string) => void) {
  const [hold, setHold] = useState<LayoutHold<TOrder> | null>(null);
  const holdRef = useRef<LayoutHold<TOrder> | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  // Posiciones de los controles justo antes de aplicar el layout, y lo que se movió al aplicarlo.
  const positionsBeforeRef = useRef<Map<Element, Position> | null>(null);
  // Cuándo se movió (o apareció) cada control: al aplicar el layout o, en el pie, al cambiar con él.
  const movedAtRef = useRef(new Map<Element, number>());
  // D54(a): posiciones de los controles del pie en el último render con el layout pendiente.
  const shiftPositionsRef = useRef<Map<Element, Position> | null>(null);
  // Desplazamiento que hizo la compensación: su evento `scroll` no es del usuario.
  const ownScrollRef = useRef<OwnScroll | null>(null);
  // B-qa02-3: el teclado aplicó el layout; el control enfocado (donde se escribe) y su posición antes.
  const typingAnchorRef = useRef<{ element: Element; top: number } | null>(null);
  // B-qa02-1: cajas de las filas justo antes de aplicar el layout.
  const rowBoxesBeforeRef = useRef<Map<string, RowBox> | null>(null);
  const focusedKeyRef = useRef<string | undefined>(undefined);
  const onFocusLostRef = useRef(onFocusLost);
  useEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });

  const release = useCallback(() => {
    anchorRef.current = null;
    ownScrollRef.current = null;
    shiftPositionsRef.current = null;
    if (holdRef.current) {
      const focused = document.activeElement instanceof Element ? document.activeElement : null;
      focusedKeyRef.current = focused?.closest<HTMLElement>(LAYOUT_BOX_SELECTOR)?.dataset.layoutBox;
      positionsBeforeRef.current = controlPositions();
      rowBoxesBeforeRef.current = rootRef.current ? rowBoxes(rootRef.current) : null;
      holdRef.current = null;
      setHold(null);
    }
  }, [rootRef]);

  const holdLayout = useCallback(
    (control: Element, order: TOrder) => {
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
      shiftPositionsRef.current = shiftGuardedPositions(root);
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
    },
    [rootRef],
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
    const own = scrollBack(element, delta);
    if (own) {
      ownScrollRef.current = own;
    }
  });

  // D54(a): el pie puede cambiar con la acción (aparece la casilla de diferencia, cambia «Cargar»):
  // lo que aparece o se mueve en él queda guardado desde este render, antes de pintarse.
  useLayoutEffect(() => {
    const before = shiftPositionsRef.current;
    const root = rootRef.current;
    if (!holdRef.current || !before || !root) {
      return;
    }
    const now = shiftGuardedPositions(root);
    markMoved(movedAtRef.current, movedControls(before, now));
    shiftPositionsRef.current = now;
  });

  const holding = hold !== null;

  // D49: recién aplicado el layout (antes de pintar), lo que cambió de sitio o apareció respecto a
  // justo antes queda marcado; la guarda cuenta desde ESTE momento, no desde la activación.
  useLayoutEffect(() => {
    const before = positionsBeforeRef.current;
    if (holding || !before) {
      return;
    }
    positionsBeforeRef.current = null;
    // B-qa02-3: si lo aplicó el teclado, el control enfocado (sigue montado y con el foco) vuelve a su
    // punto de pantalla antes de comparar: lo que se escribe no salta y ese control no cuenta como movido.
    const typing = typingAnchorRef.current;
    typingAnchorRef.current = null;
    const rowsBefore = rowBoxesBeforeRef.current;
    rowBoxesBeforeRef.current = null;
    if (typing && typing.element.isConnected && document.activeElement === typing.element) {
      const delta = typing.element.getBoundingClientRect().top - typing.top;
      if (Math.abs(delta) >= 1) {
        ownScrollRef.current = scrollBack(typing.element, delta);
      }
    } else if (rowsBefore && rootRef.current) {
      // B-qa02-1: sin campo en que se escribe, la fila siguiente a la compactada no se va de la vista.
      anchorNextRow(rootRef.current, rowsBefore);
    }
    markMoved(movedAtRef.current, movedControls(before, controlPositions()));
  }, [holding, rootRef]);

  // B-p12B-2 (D49): la guarda anclada a la compactación vale también FUERA del panel (el formulario,
  // la cabecera): el recorte del desplazamiento al acortarse la página baja lo que está encima.
  useEffect(() => {
    const onActivation = (event: MouseEvent) => {
      const activation = readPointerActivation(event);
      const at = activation ? movedAtRef.current.get(activation.control) : undefined;
      if (
        activation &&
        at !== undefined &&
        Date.now() - at < COMPACTION_GUARD_MS &&
        !rootRef.current?.contains(activation.control)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("mousedown", onActivation, true);
    window.addEventListener("click", onActivation, true);
    return () => {
      window.removeEventListener("mousedown", onActivation, true);
      window.removeEventListener("click", onActivation, true);
    };
  }, [rootRef]);

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
    // Solo el ratón: un toque no deja puntero encima (y su `pointerleave` llega al levantar el dedo).
    const onPointerMove = (event: PointerEvent) => {
      const root = rootRef.current;
      if (event.pointerType === "mouse" && root && !contains(root.getBoundingClientRect(), event.clientX, event.clientY)) {
        release();
      }
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        release();
      }
    };
    const onKeyDown = () => {
      const focused = document.activeElement;
      // B-qa02-1: solo un campo en que se escribe; con el foco en una fila o un botón manda el anclaje de la fila.
      if (holdRef.current && focused instanceof Element && focused.matches(TYPING_SELECTOR) && rootRef.current?.contains(focused)) {
        typingAnchorRef.current = { element: focused, top: focused.getBoundingClientRect().top };
      }
      release();
    };
    // Desplazar (rueda, arrastre o barra), usar el teclado o sacar el ratón del panel (o de la
    // ventana) aplica el layout pendiente.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [holding, release, rootRef]);

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
    /** D49/D54(a), para manejadores: `control` se movió (layout aplicado o pie) hace menos de 1 s. */
    movedByCompaction: useCallback((control: Element) => {
      const at = movedAtRef.current.get(control);
      return at !== undefined && Date.now() - at < COMPACTION_GUARD_MS;
    }, []),
  };
}
