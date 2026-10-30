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

/** D49: tras compactar (o un cambio de layout sin acción), ventana en que no actúa un control cuya caja se movió. */
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

/** B-qa02-3: campos en que se escribe; lo que se teclea en ellos es del usuario (no se retiene). */
const TYPING_SELECTOR = "input, textarea, select, [contenteditable='true']";

/** Cajas cuya altura se conserva mientras el layout está retenido (`data-layout-box="<clave>"`). */
const LAYOUT_BOX_SELECTOR = "[data-layout-box]";

/**
 * D54(a): zonas (el pie fijo) que pueden cambiar de alto con la acción aunque estén retenidas: un
 * control suyo que aparece o se mueve con el layout retenido queda guardado desde ESE momento.
 */
const SHIFT_GUARD_SELECTOR = "[data-layout-shift-guard]";

/**
 * REP17-01 (D70(a)): zonas (la cabecera, el aviso tras las filas) en que un control que aparece o se mueve sin acción del
 * usuario (una llegada asíncrona) queda guardado desde ESE momento (D49), aunque nada se retenga.
 */
const ARRIVAL_GUARD_SELECTOR = "[data-layout-arrival-guard]";

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

function noticeStyle(notice: HTMLElement): HeldNoticeStyle {
  const { display, maxHeight, minHeight, overflow } = notice.style;
  return { display, maxHeight, minHeight, overflow };
}

function applyNoticeStyle(notice: HTMLElement, style: HeldNoticeStyle) {
  notice.style.display = style.display;
  notice.style.minHeight = style.minHeight;
  notice.style.maxHeight = style.maxHeight;
  notice.style.overflow = style.overflow;
}

/** Devuelve a cada aviso retenido el estilo en línea que tenía y los olvida. */
function restoreNotices(floors: Map<HTMLElement, HeldNoticeStyle>) {
  for (const [notice, style] of floors) {
    applyNoticeStyle(notice, style);
  }
  floors.clear();
}

/**
 * D72(b): hay espacio retenido si alguna caja con alto fijado (`heights`) o algún aviso retenido mediría otra cosa sin lo
 * que lo retiene. Se prueba sin pintar: se quita y se repone el estilo en línea.
 */
function retainsSpace(
  root: Element,
  heights: ReadonlyMap<string, number> | undefined,
  floors: ReadonlyMap<HTMLElement, HeldNoticeStyle>,
): boolean {
  const boxes = heights
    ? [...root.querySelectorAll<HTMLElement>(LAYOUT_BOX_SELECTOR)].filter((box) => heights.has(box.dataset.layoutBox ?? ""))
    : [];
  const held = [...boxes, ...floors.keys()];
  if (held.length === 0) {
    return false;
  }
  // El anclaje de desplazamiento del navegador podría seguir lo que se quita y se repone: se deja donde estaba.
  const scrollTops = new Map(
    [scrollParent(root), document.scrollingElement ?? document.documentElement].map((scroller) => [scroller, scroller.scrollTop] as const),
  );
  const before = held.map((element) => element.getBoundingClientRect().height);
  const kept = new Map([...floors.keys()].map((notice) => [notice, noticeStyle(notice)] as const));
  const minHeights = boxes.map((box) => box.style.minHeight);
  floors.forEach((style, notice) => applyNoticeStyle(notice, style));
  boxes.forEach((box) => {
    box.style.minHeight = "";
  });
  const retains = held.some((element, index) => Math.abs(element.getBoundingClientRect().height - (before[index] ?? 0)) >= 1);
  kept.forEach((style, notice) => applyNoticeStyle(notice, style));
  boxes.forEach((box, index) => {
    box.style.minHeight = minHeights[index] ?? "";
  });
  scrollTops.forEach((top, scroller) => {
    if (Math.abs(scroller.scrollTop - top) >= 1) {
      scroller.scrollTop = top;
    }
  });
  return retains;
}

/** Declaraciones de un atributo `style`, en orden fijo (reponer un estilo puede cambiar el orden en que se serializa). */
function styleDeclarations(style: string | null) {
  return (style ?? "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .sort()
    .join(";");
}

/** Los cambios dejan el DOM distinto: lo que solo quita y repone estilos en línea (`retainsSpace`) no cuenta. */
function changesDom(records: readonly MutationRecord[]): boolean {
  const first = new Map<Node, string | null>();
  for (const record of records) {
    if (record.type !== "attributes" || record.attributeName !== "style") {
      return true;
    }
    if (!first.has(record.target)) {
      first.set(record.target, record.oldValue);
    }
  }
  return [...first].some(
    ([target, old]) => !(target instanceof Element) || styleDeclarations(target.getAttribute("style")) !== styleDeclarations(old),
  );
}

const PANEL_MUTATIONS: MutationObserverInit = {
  attributes: true,
  attributeOldValue: true,
  characterData: true,
  childList: true,
  subtree: true,
};

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

/**
 * Posición vertical de `element` en el contenido (su `top` en pantalla más lo desplazado por sus contenedores): desplazar
 * no la cambia; lo que crece o encoge encima, sí.
 */
function contentTop(element: Element): number {
  let top = element.getBoundingClientRect().top;
  for (let node = element.parentElement; node; node = node.parentElement) {
    top += node.scrollTop;
  }
  return top;
}

/** Control pulsado y su caja, con su posición en el contenido (`contentTop`) antes de la acción. */
type Anchor = { control: Element; controlTop: number; zone: Element | null; zoneTop: number };

type Position = { top: number; left: number };

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

/** Posición de los controles de las zonas `[data-layout-arrival-guard]` respecto a `root` (desplazar no la cambia). */
function arrivalGuardedPositions(root: Element): Map<Element, Position> {
  const origin = root.getBoundingClientRect();
  const positions = new Map<Element, Position>();
  for (const zone of root.querySelectorAll(ARRIVAL_GUARD_SELECTOR)) {
    for (const control of zone.querySelectorAll(CONTROL_SELECTOR)) {
      const { top, left } = control.getBoundingClientRect();
      positions.set(control, { top: top - origin.top, left: left - origin.left });
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
 * Desplaza el contenedor de `element` para devolverlo `delta` px a su sitio. Dentro de algo fijo o
 * `sticky` ya pegado (el pie) desplazar no lo devuelve y solo movería lo demás: se deshace.
 */
function scrollBack(element: Element, delta: number) {
  const scroller = scrollParent(element);
  const top = element.getBoundingClientRect().top;
  const start = scroller.scrollTop;
  scroller.scrollBy({ top: delta, behavior: "instant" });
  if (Math.abs(element.getBoundingClientRect().top - top) < 1) {
    // REP13-03: se vuelve a donde estaba (con el desplazamiento ya en su tope, deshacer -delta lo movería).
    scroller.scrollTop = start;
  }
}

/**
 * D46-a: «layout retenido». `holdLayout` se llama en la captura del clic, antes de que la acción
 * cambie nada: fija el orden que se está pintando y el alto actual de cada `[data-layout-box]`
 * dentro de `rootRef` (solo crecen). Mientras dura, `order` devuelve ese orden, `boxStyle` su alto
 * mínimo y, si algo encima del control pulsado cambia de alto, se compensa el desplazamiento para
 * que siga en su sitio. Una nueva activación lo prolonga sin cambiar el orden fijado.
 * D67(a): sin acción del usuario, lo que una llegada asíncrona cambie (un aviso que crece o encoge, el orden de las filas
 * con `retainOrder`) se retiene igual.
 * D72: NADA suelta lo retenido de forma automática (ni desplazar, ni la rueda, ni el dedo, ni el teclado, ni sacar el
 * puntero, ni el tiempo): lo suelta `compact` (el botón «Compactar lista», que solo se ofrece con `retainsSpace`) y, sin
 * guardar nada (B-p17B-3: el reflujo lo provoca el usuario y mueve todo), el cambio de ancho del panel (girar, ventana).
 * Al compactar se comparan las posiciones de los controles antes y después: durante COMPACTION_GUARD_MS,
 * `movedByCompaction` dice si un control se movió (o apareció) con ello (D49).
 * D54(a): las zonas `[data-layout-shift-guard]` (el pie) se miden además tras cada render con el
 * layout retenido: lo que aparece o se mueve en ellas queda guardado igual, desde ese render.
 * `onFocusLost`: al soltarse el layout, la caja que tenía el foco se volvió a montar (cambió de
 * lista) y el foco cayó en BODY; recibe su clave.
 */
export function useLayoutHold<TOrder>(rootRef: RefObject<HTMLElement | null>, onFocusLost: (key: string) => void) {
  const [hold, setHold] = useState<LayoutHold<TOrder> | null>(null);
  const holdRef = useRef<LayoutHold<TOrder> | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  // Hubo una tecla desde la última activación con el puntero: lo que sigue ya no es de esa activación.
  const keyedRef = useRef(false);
  // Posiciones de los controles justo antes de compactar.
  const positionsBeforeRef = useRef<Map<Element, Position> | null>(null);
  // Cuándo se movió (o apareció) cada control: al compactar, en el pie con el layout retenido o por una llegada.
  const movedAtRef = useRef(new Map<Element, number>());
  // D54(a): posiciones de los controles del pie en el último render con el layout retenido.
  const shiftPositionsRef = useRef<Map<Element, Position> | null>(null);
  const focusedKeyRef = useRef<string | undefined>(undefined);
  // D60(c): avisos dinámicos y filas en la última medición.
  const noticeLayoutRef = useRef<NoticeLayout | null>(null);
  // REP17-01: controles de las zonas `[data-layout-arrival-guard]` en la última medición.
  const arrivalPositionsRef = useRef<Map<Element, Position> | null>(null);
  // REP15-01 (D65(b)): avisos que encogieron solos, retenidos a su alto anterior (y el estilo en línea que tenían).
  // D67(a): también los que crecieron solos, recortados a su alto anterior.
  const floorsRef = useRef(new Map<HTMLElement, HeldNoticeStyle>());
  // D67(a): orden de filas retenido porque una llegada asíncrona cambió el del modelo (una fila que cambia de lista).
  const [retainedOrder, setRetainedOrder] = useState<TOrder | null>(null);
  const retainedOrderRef = useRef<TOrder | null>(null);
  // D67(a): turno de una acción del usuario (clic, tecla, escribir): lo que cambie en él es suyo, no una llegada.
  const userTurnRef = useRef(false);
  // D72(b): hay espacio retenido (se ofrece «Compactar lista»), y cuántas veces se compactó (el render que lo pinta).
  const [retains, setRetains] = useState(false);
  const [compactions, setCompactions] = useState(0);
  const onFocusLostRef = useRef(onFocusLost);
  useEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });

  /** Suelta todo lo retenido (cajas, orden y avisos). Devuelve si hace falta un render sin ello (layout u orden). */
  const dropRetained = useCallback(() => {
    restoreNotices(floorsRef.current);
    anchorRef.current = null;
    shiftPositionsRef.current = null;
    const rerender = holdRef.current !== null || retainedOrderRef.current !== null;
    if (retainedOrderRef.current !== null) {
      retainedOrderRef.current = null;
      setRetainedOrder(null);
    }
    if (holdRef.current) {
      const focused = document.activeElement instanceof Element ? document.activeElement : null;
      focusedKeyRef.current = focused?.closest<HTMLElement>(LAYOUT_BOX_SELECTOR)?.dataset.layoutBox;
      holdRef.current = null;
      setHold(null);
    }
    setRetains(false);
    return rerender;
  }, []);

  /**
   * REP16-03 (B-p17B-3): con otro ancho (giro, ventana, menú) todo se recoloca y lo retenido dejaría huecos: se suelta
   * todo, sin guardar nada como movido (N7): tras girar el usuario apunta sobre lo nuevo.
   */
  const releaseForWidth = useCallback(() => {
    movedAtRef.current.clear();
    return dropRetained();
  }, [dropRetained]);

  /**
   * D72(b): «Compactar lista». Suelta todo lo retenido; lo que se mueve con ello queda guardado desde ESTE momento (D49)
   * y la nueva medición de los avisos es la base (no se vuelven a retener al soltarse).
   */
  const compact = useCallback(() => {
    positionsBeforeRef.current = controlPositions();
    dropRetained();
    const root = rootRef.current;
    const notices = root?.querySelector(NOTICE_ANCHOR_SELECTOR);
    noticeLayoutRef.current = root && notices ? measureNotices(root, notices) : null;
    setCompactions((count) => count + 1);
  }, [dropRetained, rootRef]);

  /**
   * D67(a): el orden de filas del modelo cambió sin acción del usuario (una llegada asíncrona pasa una fila de lista):
   * se conserva `order`, el pintado (con el layout retenido el orden ya está fijado). Solo desde efectos.
   */
  const retainOrder = useCallback(
    (order: TOrder) => {
      if (!rootRef.current || holdRef.current || userTurnRef.current || retainedOrderRef.current !== null) {
        return;
      }
      retainedOrderRef.current = order;
      setRetainedOrder(order);
    },
    [rootRef],
  );

  // D67(a): una acción del usuario marca su turno (USER_TURN_MS, para lo que React pinte en efectos que siguen a la
  // acción): lo que cambie en él es suyo. Una tecla, además, cierra lo que era de la última activación con el puntero.
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
    const mark = (event: Event) => {
      if (event.type === "keydown") {
        keyedRef.current = true;
        anchorRef.current = null;
      }
      userTurnRef.current = true;
      changed = true;
      clearTimeout(timer);
      timer = setTimeout(end, USER_TURN_MS);
      if (frame === undefined) {
        watch();
      }
    };
    const root = rootRef.current;
    const mutations = new MutationObserver((records) => {
      changed ||= changesDom(records);
    });
    if (root) {
      mutations.observe(root, PANEL_MUTATIONS);
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
      keyedRef.current = false;
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
        controlTop: contentTop(control),
        zone,
        zoneTop: zone ? contentTop(zone) : 0,
      };
    },
    [rootRef],
  );

  // Tras cada render con el layout retenido, el control pulsado (o su caja, si desapareció) vuelve a su sitio: lo que
  // creció por encima no lo mueve bajo el puntero. Desplazar no cuenta (`contentTop`); la nueva posición es la base.
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
    const delta = contentTop(element) - (controlConnected ? anchor.controlTop : anchor.zoneTop);
    if (Math.abs(delta) < 1) {
      return;
    }
    scrollBack(element, delta);
    anchorRef.current = {
      ...anchor,
      controlTop: controlConnected ? contentTop(anchor.control) : anchor.controlTop,
      zoneTop: anchor.zone?.isConnected ? contentTop(anchor.zone) : anchor.zoneTop,
    };
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

  // D49: recién compactado (antes de pintar), lo que cambió de sitio o apareció respecto a justo antes queda marcado; la
  // guarda cuenta desde ESTE momento.
  useLayoutEffect(() => {
    const before = positionsBeforeRef.current;
    if (!before) {
      return;
    }
    positionsBeforeRef.current = null;
    markMoved(movedAtRef.current, movedControls(before, controlPositions()));
  }, [compactions]);

  /**
   * D60(c): si un aviso dinámico cambió de alto y movió las filas, vuelven a su punto de pantalla
   * (salvo que el control pulsado con el layout retenido esté en el aviso o encima: manda su ancla).
   * Lo que no se pudo devolver (no hay desplazamiento) queda guardado desde ESTE momento.
   * `floor` (REP15-01): retener los avisos que cambiaron solos y medir si hay algo retenido (D72(b)); solo antes de
   * pintar y fuera de un ResizeObserver (cambiar ahí el alto de lo observado es un bucle del observador).
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
    // REP16-03: la base es el render ya sin lo retenido (si no, al soltarse las cajas parecería una llegada).
    if (previous && !sameWidth && releaseForWidth()) {
      noticeLayoutRef.current = null;
      return;
    }
    // REP15-01 (D65(b)): lo que llega tarde (tasa, duplicados, último costo) y encoge o quita un aviso sin que nadie
    // actúe no sube lo de debajo: el aviso conserva su alto (D72: hasta «Compactar lista»; con el layout retenido,
    // también lo que creció tras fijar las cajas). Lo que se teclea es del usuario (REP16-01b: en su turno; un campo
    // enfocado sin teclear, como el buscador abierto, no frena lo que llega).
    const focused = document.activeElement;
    const typing =
      userTurnRef.current && focused instanceof Element && focused.matches(TYPING_SELECTOR) && root.contains(focused);
    if (floor && sameWidth && !typing) {
      const keepStyle = (notice: HTMLElement) => {
        if (!floorsRef.current.has(notice)) {
          floorsRef.current.set(notice, noticeStyle(notice));
        }
      };
      for (const notice of root.querySelectorAll<HTMLElement>(NOTICE_SELECTOR)) {
        const was = sameWidth.heights.get(notice);
        const height = notice.getBoundingClientRect().height;
        if (was !== undefined && was - height >= 1) {
          keepStyle(notice);
          // `empty:hidden`: el aviso que se va también conserva su sitio (y el hueco del `gap`); el que solo encoge conserva
          // su `display` (la rejilla que apila las reservas del aviso de tasa o de duplicado).
          if (getComputedStyle(notice).display === "none") {
            notice.style.display = "block";
          }
          notice.style.minHeight = `${was}px`;
        } else if (was !== undefined && height - was >= 1 && !userTurnRef.current && movesRowControls(root, notice)) {
          // D67(a) (M-p17B-1): lo que crece solo (sin acción del usuario en este turno) y bajaría controles de las filas
          // se recorta a su alto anterior (el que no se veía, oculto: tampoco abre el hueco del `gap`). Lo que asome de
          // él queda guardado desde ahora (D49).
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
        scrollBack(anchor, anchor.getBoundingClientRect().top - previous.anchorTop);
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
    // REP17-01 (D70(a)): lo que aparece o se mueve en la cabecera o en el aviso tras las filas sin acción del usuario
    // (con el mismo ancho) queda guardado desde ahora: un toque que llega justo después no lo acciona.
    const arrivals = arrivalGuardedPositions(root);
    if (sameWidth && arrivalPositionsRef.current && !userTurnRef.current) {
      markMoved(movedAtRef.current, movedControls(arrivalPositionsRef.current, arrivals));
    }
    arrivalPositionsRef.current = arrivals;
    noticeLayoutRef.current = { width, heights, anchorTop: anchor.getBoundingClientRect().top, rowBlocks };
    if (floor) {
      setRetains(retainsSpace(root, holdRef.current?.heights, floorsRef.current));
    }
  }, [releaseForWidth, rootRef]);

  // Tras cada render del panel (antes de pintar), después del ancla del control pulsado.
  useLayoutEffect(() => followNotices(true));

  // Lo que cambia sin render del panel (el aviso de duplicado al saber si ya está en una compra), y
  // el desplazamiento del usuario, que solo renueva la medición (y, D54(a), la base del pie, que se mueve al desplazar si
  // no está pegado). REP15-01: un cambio del DOM sin render del panel (la cabecera) se mide en su microtarea, antes de
  // pintar, y ahí sí se retienen los avisos.
  useEffect(() => {
    const root = rootRef.current;
    const measure = () => followNotices(false);
    const onScroll = () => {
      measure();
      if (root && holdRef.current) {
        shiftPositionsRef.current = shiftGuardedPositions(root);
      }
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // jsdom no implementa ResizeObserver.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const mutations = new MutationObserver((records) => {
      if (changesDom(records)) {
        followNotices(true);
      }
    });
    if (root) {
      mutations.observe(root, PANEL_MUTATIONS);
    }
    if (root && observer) {
      observer.observe(root);
      root.querySelectorAll(NOTICE_SELECTOR).forEach((notice) => observer.observe(notice));
    }
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      observer?.disconnect();
      mutations.disconnect();
    };
  }, [followNotices, rootRef]);

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

  const boxStyle = useCallback(
    (key: string): CSSProperties | undefined => {
      const height = hold?.heights.get(key);
      return height ? { minHeight: height } : undefined;
    },
    [hold],
  );

  return {
    /** Orden fijado mientras el layout está retenido (D67(a): o retenido tras una llegada asíncrona). */
    order: hold?.order ?? retainedOrder ?? undefined,
    boxStyle,
    holdLayout,
    retainOrder,
    /** D72(b): hay espacio retenido (cajas con alto fijado o avisos) que `compact` soltaría. */
    retainsSpace: retains,
    /** D72(b): «Compactar lista», el único gesto que suelta lo retenido (además del cambio de ancho). */
    compact,
    /**
     * Para manejadores: la acción en curso es de una activación con el puntero con el layout retenido (sin tecla desde
     * ella): el foco no debe desplazar.
     */
    isPointerHolding: useCallback(() => holdRef.current !== null && !keyedRef.current, []),
    /** D49/D54(a), para manejadores: `control` se movió (compactación, pie o llegada) hace menos de 1 s. */
    movedByCompaction: useCallback((control: Element) => {
      const at = movedAtRef.current.get(control);
      return at !== undefined && Date.now() - at < COMPACTION_GUARD_MS;
    }, []),
  };
}
