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

/**
 * D67(a): tras una acción del usuario, lo que cambia es suyo mientras el panel siga cambiando por ella (los efectos que
 * siguen a la acción pintan en tareas posteriores): el turno acaba en el primer frame sin cambios en el panel, y como
 * mucho a los USER_TURN_MS. Pasado, un cambio es una llegada asíncrona (REP16-01b: con solo la ventana fija, lo que
 * llegaba en ella, p. ej. la tasa 100 ms después de un clic, crecía sin retenerse).
 */
const USER_TURN_MS = 250;

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

/**
 * D60(c): avisos dinámicos (duplicado, tasa, IVA) que aparecen, cambian o se van sin que se toquen
 * (`[data-layout-notice]`, siempre montados), y la caja que no deben mover bajo el puntero
 * (`[data-layout-notice-anchor]`, las filas). El pie fijo no se mueve con lo de arriba.
 */
const NOTICE_SELECTOR = "[data-layout-notice]";
const NOTICE_ANCHOR_SELECTOR = "[data-layout-notice-anchor]";
const STICKY_FOOTER_SELECTOR = '[data-layout-box="footer"]';
const ROW_BOX_SELECTOR = '[data-layout-box^="row:"]';

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

/**
 * D60(c): alto de cada aviso dinámico y punto de pantalla de las filas en la última medición.
 * B-qa23-2: de cada aviso de una fila, el alto del bloque de la fila que lo contiene.
 */
type NoticeLayout = {
  /** REP15-01: ancho del panel; si cambia (giro, ventana), los avisos no se retienen ni guardan lo de debajo. */
  width: number;
  heights: ReadonlyMap<Element, number>;
  anchorTop: number;
  rowBlocks: ReadonlyMap<Element, number>;
};

/** Estilo en línea de un aviso antes de retenerlo (REP15-01: lo que encoge; D67(a): lo que crece). */
type HeldNoticeStyle = { display: string; minHeight: string; maxHeight: string; overflow: string };

/** D67(a): `notice` va antes del último control de las filas: si crece, baja controles de alguna fila. */
function movesRowControls(root: Element, notice: Element): boolean {
  const rows = root.querySelectorAll(ROW_BOX_SELECTOR);
  const controls = rows.item(rows.length - 1)?.querySelectorAll(CONTROL_SELECTOR);
  const last = controls?.item(controls.length - 1);
  return last !== null && last !== undefined && follows(notice, last);
}

/** `element` va después de `notice` en el documento, fuera de él: lo que crece `notice` lo desplaza. */
function follows(notice: Element, element: Element) {
  const position = notice.compareDocumentPosition(element);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && (position & Node.DOCUMENT_POSITION_CONTAINED_BY) === 0;
}

/**
 * B-qa23-2: hijo directo de la fila (`[data-layout-box^="row:"]`) que contiene `notice`; si cambia de
 * alto, lo que le sigue se mueve. `null` si el aviso no está en una fila.
 */
function rowBlock(notice: Element): Element | null {
  const row = notice.closest(ROW_BOX_SELECTOR);
  let block: Element | null = notice;
  while (row && block && block.parentElement !== row) {
    block = block.parentElement;
  }
  return row ? block : null;
}

/**
 * D60(c): alto de cada aviso dinámico, alto del bloque de fila de los avisos de una fila y punto de pantalla
 * de las filas (`anchor`).
 */
function measureNotices(root: Element, anchor: Element): NoticeLayout {
  const notices = [...root.querySelectorAll(NOTICE_SELECTOR)];
  return {
    width: root.getBoundingClientRect().width,
    heights: new Map(notices.map((notice) => [notice, notice.getBoundingClientRect().height] as const)),
    anchorTop: anchor.getBoundingClientRect().top,
    rowBlocks: new Map(
      notices.flatMap((notice) => {
        const block = rowBlock(notice);
        return block ? [[notice, block.getBoundingClientRect().height] as const] : [];
      }),
    ),
  };
}

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
  const start = scroller.scrollTop;
  scroller.scrollBy({ top: delta, behavior: "instant" });
  if (Math.abs(element.getBoundingClientRect().top - top) < 1) {
    // REP13-03: se vuelve a donde estaba (con el desplazamiento ya en su tope, deshacer -delta lo movería).
    scroller.scrollTop = start;
    return null;
  }
  return { scroller, top: scroller.scrollTop };
}

/**
 * Lo que aplica el layout pendiente (D49) y suelta los avisos retenidos (D65(b)): desplazar (salvo el
 * desplazamiento propio de la compensación), la rueda, arrastrar el dedo, el teclado o sacar el ratón del
 * panel o de la ventana. Devuelve cómo dejar de escuchar.
 */
function listenForRelease(root: Element, release: () => void, ownScrollRef: { current: OwnScroll | null }) {
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
    if (event.pointerType === "mouse" && !contains(root.getBoundingClientRect(), event.clientX, event.clientY)) {
      release();
    }
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === "mouse") {
      release();
    }
  };
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("wheel", release, { passive: true });
  window.addEventListener("touchmove", release, { passive: true });
  window.addEventListener("keydown", release, true);
  window.addEventListener("pointermove", onPointerMove, true);
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  return () => {
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("wheel", release);
    window.removeEventListener("touchmove", release);
    window.removeEventListener("keydown", release, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    document.documentElement.removeEventListener("pointerleave", onPointerLeave);
  };
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
 * D67(a): sin layout pendiente, lo que una llegada asíncrona cambie (un aviso que crece o encoge, el orden de las filas
 * con `retainOrder`) se retiene igual hasta desplazar, usar el teclado o sacar el ratón del panel.
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
  // D60(c): avisos dinámicos y filas en la última medición.
  const noticeLayoutRef = useRef<NoticeLayout | null>(null);
  // REP15-01 (D65(b)): avisos que encogieron solos, retenidos a su alto anterior (y el estilo en línea que tenían),
  // y cómo dejar de escuchar lo que los suelta.
  // D67(a): también los que crecieron solos, recortados a su alto anterior.
  const floorsRef = useRef(new Map<HTMLElement, HeldNoticeStyle>());
  const stopFloorsRef = useRef<(() => void) | null>(null);
  // D67(a): orden de filas retenido porque una llegada asíncrona cambió el del modelo (una fila que cambia de lista);
  // se suelta con los avisos retenidos.
  const [retainedOrder, setRetainedOrder] = useState<TOrder | null>(null);
  const retainedOrderRef = useRef<TOrder | null>(null);
  // D67(a): turno de una acción del usuario (clic, tecla, escribir): lo que cambie en él es suyo, no una llegada.
  const userTurnRef = useRef(false);
  const onFocusLostRef = useRef(onFocusLost);
  useEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });

  /**
   * REP15-01 (D65(b)): suelta los avisos retenidos (lo mismo que aplica el layout pendiente: desplazar, el teclado
   * o sacar el ratón). Lo que se mueve con ello queda guardado desde ESTE momento, y la nueva medición es la base
   * (no se compensa: lo pidió el usuario).
   */
  const releaseFloors = useCallback(() => {
    stopFloorsRef.current?.();
    stopFloorsRef.current = null;
    if (retainedOrderRef.current !== null) {
      // D67(a): las filas toman su lista y orden en el próximo render; lo que se mueva con ello queda guardado (D49).
      retainedOrderRef.current = null;
      positionsBeforeRef.current ??= controlPositions();
      setRetainedOrder(null);
    }
    const floors = floorsRef.current;
    if (floors.size === 0) {
      return;
    }
    const before = controlPositions();
    for (const [notice, style] of floors) {
      notice.style.display = style.display;
      notice.style.minHeight = style.minHeight;
      notice.style.maxHeight = style.maxHeight;
      notice.style.overflow = style.overflow;
    }
    floors.clear();
    markMoved(movedAtRef.current, movedControls(before, controlPositions()));
    const root = rootRef.current;
    const anchor = root?.querySelector(NOTICE_ANCHOR_SELECTOR);
    noticeLayoutRef.current = root && anchor ? measureNotices(root, anchor) : null;
  }, [rootRef]);

  const release = useCallback(() => {
    releaseFloors();
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
  }, [releaseFloors, rootRef]);

  /**
   * D67(a): el orden de filas del modelo cambió sin acción del usuario (una llegada asíncrona pasa una fila de lista):
   * se conserva `order`, el pintado, hasta que el usuario desplace, use el teclado o saque el ratón (con el layout
   * pendiente el orden ya está fijado). Solo desde efectos.
   */
  const retainOrder = useCallback(
    (order: TOrder) => {
      const root = rootRef.current;
      if (!root || holdRef.current || userTurnRef.current || retainedOrderRef.current !== null) {
        return;
      }
      retainedOrderRef.current = order;
      setRetainedOrder(order);
      stopFloorsRef.current ??= listenForRelease(root, releaseFloors, ownScrollRef);
    },
    [releaseFloors, rootRef],
  );

  // D67(a): una acción del usuario marca su turno (USER_TURN_MS, para lo que React pinte en efectos que siguen a la
  // acción): lo que cambie en él es suyo.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    // Hubo cambios en el panel desde el último frame del turno.
    let changed = false;
    const end = () => {
      userTurnRef.current = false;
      clearTimeout(timer);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
    };
    const watch = () => {
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (changed) {
          changed = false;
          watch();
        } else {
          end();
        }
      });
    };
    const mark = () => {
      userTurnRef.current = true;
      changed = true;
      clearTimeout(timer);
      timer = setTimeout(end, USER_TURN_MS);
      if (frame === undefined) {
        watch();
      }
    };
    const root = rootRef.current;
    const mutations = new MutationObserver(() => {
      changed = true;
    });
    if (root) {
      mutations.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
    }
    const events = ["pointerdown", "mousedown", "touchstart", "click", "keydown", "input", "change"] as const;
    for (const type of events) {
      window.addEventListener(type, mark, { capture: true, passive: true });
    }
    return () => {
      end();
      mutations.disconnect();
      for (const type of events) {
        window.removeEventListener(type, mark, { capture: true });
      }
    };
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
  const ordering = retainedOrder !== null;

  // D49: recién aplicado el layout (antes de pintar), lo que cambió de sitio o apareció respecto a
  // justo antes queda marcado; la guarda cuenta desde ESTE momento, no desde la activación.
  useLayoutEffect(() => {
    const before = positionsBeforeRef.current;
    if (holding || ordering || !before) {
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
  }, [holding, ordering, rootRef]);

  /**
   * D60(c): si un aviso dinámico cambió de alto y movió las filas, vuelven a su punto de pantalla
   * (salvo que el control pulsado con el layout pendiente esté en el aviso o encima: manda su ancla).
   * Lo que no se pudo devolver (no hay desplazamiento) queda guardado desde ESTE momento.
   * `floor` (REP15-01): retener los avisos que encogieron; solo antes de pintar y fuera de un
   * ResizeObserver (cambiar ahí el alto de lo observado es un bucle del observador).
   */
  const followNotices = useCallback((floor: boolean) => {
    const root = rootRef.current;
    const anchor = root?.querySelector(NOTICE_ANCHOR_SELECTOR);
    if (!root || !anchor) {
      noticeLayoutRef.current = null;
      return;
    }
    const previous = noticeLayoutRef.current;
    // Con otro ancho (giro, ventana) todo se recoloca: ni se retiene ni se guarda nada por ello.
    const sameWidth = previous && Math.abs(previous.width - root.getBoundingClientRect().width) < 1 ? previous : null;
    // REP15-01 (D65(b)): lo que llega tarde (tasa, duplicados, último costo) y encoge o quita un aviso sin que nadie
    // actúe no sube lo de debajo: el aviso conserva su alto hasta que el usuario desplace, use el teclado o saque el
    // ratón (con el layout pendiente, también lo que creció tras fijar las cajas). Lo que se teclea es del usuario
    // (REP16-01b: en su turno; un campo enfocado sin teclear, como el buscador abierto, no frena lo que llega).
    const focused = document.activeElement;
    const typing =
      userTurnRef.current && focused instanceof Element && focused.matches(TYPING_SELECTOR) && root.contains(focused);
    if (floor && sameWidth && !typing) {
      const keepStyle = (notice: HTMLElement) => {
        if (!floorsRef.current.has(notice)) {
          const { display, maxHeight, minHeight, overflow } = notice.style;
          floorsRef.current.set(notice, { display, maxHeight, minHeight, overflow });
        }
      };
      for (const notice of root.querySelectorAll<HTMLElement>(NOTICE_SELECTOR)) {
        const was = sameWidth.heights.get(notice);
        const height = notice.getBoundingClientRect().height;
        if (was !== undefined && was - height >= 1) {
          keepStyle(notice);
          // `empty:hidden`: el aviso que se va también conserva su sitio (y el hueco del `gap`).
          notice.style.display = "block";
          notice.style.minHeight = `${was}px`;
        } else if (was !== undefined && height - was >= 1 && !userTurnRef.current && movesRowControls(root, notice)) {
          // D67(a) (M-p17B-1): lo que crece solo (sin acción del usuario en este turno) y bajaría controles de las filas
          // se recorta a su alto anterior (el que no se veía, oculto: tampoco abre el hueco del `gap`) hasta que el
          // usuario desplace, use el teclado o saque el ratón. Lo que asome de él queda guardado desde ahora (D49).
          keepStyle(notice);
          if (was < 1) {
            notice.style.display = "none";
          } else {
            notice.style.maxHeight = `${was}px`;
            notice.style.overflow = "hidden";
          }
          markMoved(movedAtRef.current, [...notice.querySelectorAll(CONTROL_SELECTOR)]);
        }
      }
      if (floorsRef.current.size > 0 && !stopFloorsRef.current) {
        stopFloorsRef.current = listenForRelease(root, releaseFloors, ownScrollRef);
      }
    }
    const { width, heights, rowBlocks } = measureNotices(root, anchor);
    const notices = [...heights.keys()];
    const resized = (notice: Element) =>
      previous !== null && Math.abs((previous.heights.get(notice) ?? 0) - (heights.get(notice) ?? 0)) >= 1;
    const changed = notices.find((notice) => !rowBlocks.has(notice) && resized(notice));
    if (previous && changed && Math.abs(anchor.getBoundingClientRect().top - previous.anchorTop) >= 1) {
      const held = holdRef.current ? anchorRef.current?.control : undefined;
      const heldAbove = held?.isConnected === true && !follows(changed, held);
      if (!heldAbove && previous.anchorTop < visibleRange(anchor).bottom) {
        const own = scrollBack(anchor, anchor.getBoundingClientRect().top - previous.anchorTop);
        if (own) {
          ownScrollRef.current = own;
        }
      }
      // REP15-01c: con otro ancho (giro, ventana) lo que no se pudo devolver no queda guardado (D49 es de la compactación).
      if (sameWidth && Math.abs(anchor.getBoundingClientRect().top - previous.anchorTop) >= 1) {
        const moved = [...root.querySelectorAll(CONTROL_SELECTOR)].filter(
          (control) => follows(changed, control) && !control.closest(STICKY_FOOTER_SELECTOR),
        );
        markMoved(movedAtRef.current, moved);
      }
    }
    // B-qa23-2: el aviso de una fila que aparece al teclear y cambia el alto de su bloque mueve lo que le
    // sigue (el resto de la fila y las de abajo): queda guardado desde ESTE momento.
    for (const [notice, blockHeight] of rowBlocks) {
      const blockBefore = sameWidth?.rowBlocks.get(notice);
      if (blockBefore !== undefined && resized(notice) && Math.abs(blockBefore - blockHeight) >= 1) {
        const moved = [...root.querySelectorAll(CONTROL_SELECTOR)].filter(
          (control) => follows(notice, control) && !control.closest(STICKY_FOOTER_SELECTOR),
        );
        markMoved(movedAtRef.current, moved);
      }
    }
    noticeLayoutRef.current = { width, heights, anchorTop: anchor.getBoundingClientRect().top, rowBlocks };
  }, [releaseFloors, rootRef]);

  // Tras cada render del panel (antes de pintar), después del ancla del control pulsado.
  useLayoutEffect(() => followNotices(true));

  // Lo que cambia sin render del panel (el aviso de duplicado al saber si ya está en una compra), y
  // el desplazamiento del usuario, que solo renueva la medición. REP15-01: un cambio del DOM sin render
  // del panel (la cabecera) se mide en su microtarea, antes de pintar, y ahí sí se retienen los avisos.
  useEffect(() => {
    const root = rootRef.current;
    const measure = () => followNotices(false);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    // jsdom no implementa ResizeObserver.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const mutations = new MutationObserver(() => followNotices(true));
    if (root) {
      mutations.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
    }
    if (root && observer) {
      observer.observe(root);
      root.querySelectorAll(NOTICE_SELECTOR).forEach((notice) => observer.observe(notice));
    }
    return () => {
      window.removeEventListener("scroll", measure, { capture: true });
      observer?.disconnect();
      mutations.disconnect();
    };
  }, [followNotices, rootRef]);

  useEffect(() => () => stopFloorsRef.current?.(), []);

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
    /** Orden fijado mientras el layout está pendiente (D67(a): o retenido tras una llegada asíncrona). */
    order: hold?.order ?? retainedOrder ?? undefined,
    boxStyle,
    holdLayout,
    retainOrder,
    /** Para manejadores: el layout está pendiente ahora (el foco no debe desplazar). */
    isHolding: useCallback(() => holdRef.current !== null, []),
    /** D49/D54(a), para manejadores: `control` se movió (layout aplicado o pie) hace menos de 1 s. */
    movedByCompaction: useCallback((control: Element) => {
      const at = movedAtRef.current.get(control);
      return at !== undefined && Date.now() - at < COMPACTION_GUARD_MS;
    }, []),
  };
}
