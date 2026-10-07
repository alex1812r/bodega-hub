"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type ProcessGuardLeaveMode = "draft" | "discard";

type LeaveHandler = () => void | Promise<void>;

export type UseProcessGuardOptions = {
  /** `false`: no se intercepta nada ni se toca el historial. */
  active: boolean;
  /** Texto adicional bajo el nombre del proceso. */
  description?: string;
  /** Nombre del proceso que muestra el modal, p. ej. "Compra a Distribuidora X · 12 líneas · REF 240,00". */
  label: string;
  /**
   * Milisegundos que "Salir" espera a `onSaveDraft`/`onDiscard` antes de ofrecer
   * seguir aquí o salir sin esperarlo. Por defecto `PROCESS_GUARD_LEAVE_TIMEOUT_MS`.
   */
  leaveTimeoutMs?: number;
  onDiscard?: LeaveHandler;
  /** `draft`: al salir se llama a `onSaveDraft`. `discard`: se llama a `onDiscard`. */
  onLeave: ProcessGuardLeaveMode;
  onSaveDraft?: LeaveHandler;
};

export type GuardedNavigateOptions = {
  replace?: boolean;
};

export type ProcessGuardDialogState = {
  description?: string;
  error: string | null;
  label: string;
  /** "Salir" y "Reintentar": ejecuta `onSaveDraft`/`onDiscard` y, si no fallan, sale. */
  leave: () => void;
  /**
   * Salida tras un fallo (`error`) o con la salida atascada (`stalled`): sale sin
   * llamar a `onSaveDraft` ni a `onDiscard` y sin esperar al que siga en curso.
   */
  leaveWithoutSaving: () => void;
  /** Hay una salida en curso: el modal queda bloqueado hasta que termina, falla o se atasca. */
  leaving: boolean;
  onLeave: ProcessGuardLeaveMode;
  open: boolean;
  /**
   * La salida en curso superó `leaveTimeoutMs` y el manejador sigue sin terminar:
   * `stay` y `leaveWithoutSaving` vuelven a funcionar; `leave` no.
   */
  stalled: boolean;
  stay: () => void;
};

export type ProcessGuardController = {
  /** Apaga este guardia hasta que `active` vuelva a pasar por `false`. */
  bypass: () => void;
  /** Estado del modal; se pinta con `<ProcessGuardModal guard={...} />`. */
  dialog: ProcessGuardDialogState;
  /**
   * `router.push`/`replace` que pregunta antes si hay algún guardia activo y el
   * destino sale de la ruta (misma regla que los enlaces: query y `#` de la
   * misma página no preguntan).
   */
  guardedNavigate: (href: string, options?: GuardedNavigateOptions) => void;
  /** Pide la misma confirmación sin navegación (cerrar un modal con cambios). */
  requestLeave: (run: () => void) => void;
  /** `bypass()` y luego `run()`: la navegación que el propio proceso hace al terminar. */
  runUnguarded: (run: () => void) => void;
};

type PendingLeave =
  | { href: string; kind: "href"; replace: boolean }
  | { kind: "traversal" }
  | { kind: "action"; run: () => void };

type GuardEntry = {
  ask: (pending: PendingLeave) => void;
  leave: () => Promise<void>;
  release: () => void;
  saveDraftSync: () => void;
};

/** Espera por defecto de "Salir" antes de dar la salida por atascada. */
export const PROCESS_GUARD_LEAVE_TIMEOUT_MS = 10_000;

/** Marca de `GuardedLink`: esos enlaces se bloquean con `onNavigate`, no con el listener global. */
export const PROCESS_GUARD_LINK_ATTRIBUTE = "data-process-guard-link";

// Pila global de guardias activos: el último registrado es el que pregunta.
const entries: GuardEntry[] = [];

/*
 * ATRÁS / ADELANTE del navegador: entrada centinela.
 *
 * El `popstate` de Next se registra antes que cualquier listener nuestro y React
 * pinta la ruta anterior de forma síncrona dentro de ese evento, así que un
 * "atrás" que cambia de ruta desmonta el guardia antes de que pueda reaccionar.
 * Por eso, al activarse el primer guardia se duplica la entrada actual:
 *
 *   [anterior, proceso]  →  [anterior, proceso (gemela), proceso (centinela)]
 *
 * Las dos son la misma pantalla: para el router no hay cambio de ruta. ATRÁS
 * aterriza en la gemela (nada se desmonta) y el guardia vuelve con ADELANTE al
 * centinela que ya existe y abre el modal. No se crea otra entrada: el centinela
 * es el que recibe los `replace` de la pantalla (filtros, pestañas), así que al
 * volver a él la URL es la vigente, y Chromium no tiene entradas nuevas sin
 * gesto del usuario que saltarse. "Salir" retrocede de una vez hasta la entrada
 * anterior al proceso. ADELANTE no puede salir del proceso: empujar el
 * centinela descarta las entradas que hubiera por delante.
 *
 * Un salto que pasa por encima de la gemela (dos ATRÁS antes de que la página
 * atienda el primero, `history.go(-2)`, menú del historial) no deja nada que
 * atrapar con `popstate`. Se cancela antes de que ocurra con el evento
 * `navigate` de la Navigation API; ver `handleNavigate`.
 *
 * El par no se retira al terminar el proceso (un `history.back()` espontáneo
 * haría que Next descartase la navegación que tuviera en curso). En su lugar,
 * un `popstate` que retrocede del centinela a la gemela sin guardia activo
 * sigue retrocediendo solo: el usuario pulsa ATRÁS una vez y sale a la primera.
 */
const HISTORY_MARKER_KEY = "__processGuard";
const HISTORY_LISTENER_KEY = "__processGuardPopStateListener";

type HistoryMarker = "sentinel" | "twin";
type HistoryListenerHost = {
  [HISTORY_LISTENER_KEY]?: (event: PopStateEvent) => void;
};

/** Lo que se usa de la Navigation API (aún sin tipos en `lib.dom` de este TypeScript). */
type TraversalEvent = Event & {
  destination: { index: number; sameDocument: boolean };
  navigationType: string;
};
type NavigationHost = {
  navigation?: {
    addEventListener: (type: "navigate", listener: (event: TraversalEvent) => void) => void;
    currentEntry: { index: number } | null;
    removeEventListener: (type: "navigate", listener: (event: TraversalEvent) => void) => void;
  };
};

/** Marca de la entrada en la que estábamos antes del último `popstate`. */
let previousMarker: HistoryMarker | null = null;
/** Hay un "Salir" retrocediendo: las gemelas que encuentre se atraviesan. */
let leavingBack = false;
/** Modo de scroll que tenía la entrada del proceso antes de convertirla en gemela. */
let sentinelScrollRestoration: ScrollRestoration = "auto";
/** Posición de la gemela en el historial; `null` sin Navigation API o sin guardia activo. */
let twinIndex: number | null = null;
/** Parche de `history.replaceState` y la función que sustituye; `null` si no está puesto. */
let replaceStatePatch: { original: History["replaceState"]; patched: History["replaceState"] } | null =
  null;

function topEntry(): GuardEntry | undefined {
  return entries[entries.length - 1];
}

function readHistoryMarker(state: unknown): HistoryMarker | null {
  const marker =
    typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)[HISTORY_MARKER_KEY]
      : null;

  return marker === "sentinel" || marker === "twin" ? marker : null;
}

function withHistoryMarker(marker: HistoryMarker): Record<string, unknown> {
  const state: unknown = window.history.state;

  // Se conserva el estado de Next (`__NA`, árbol): su parche de `pushState` lo deja pasar tal cual.
  return {
    ...(typeof state === "object" && state !== null ? state : {}),
    [HISTORY_MARKER_KEY]: marker,
  };
}

function handlePopState(event: PopStateEvent) {
  const marker = readHistoryMarker(event.state);
  const steppedBackFromSentinel = previousMarker === "sentinel";

  previousMarker = marker;

  if (marker !== "twin") {
    leavingBack = false;
    return;
  }

  const top = topEntry();

  if (top) {
    // ATRÁS desde el proceso: seguimos en su pantalla. Se vuelve al centinela y se pregunta.
    window.history.forward();
    top.ask({ kind: "traversal" });
    return;
  }

  if (leavingBack || steppedBackFromSentinel) {
    // Gemela de un proceso ya cerrado: es la misma pantalla, se atraviesa.
    leavingBack = true;
    window.history.back();
  }
}

/**
 * Salto que pasaría por encima de la gemela con un guardia activo. El evento
 * llega antes de que el historial se mueva: si el navegador deja cancelarlo, se
 * cancela y se pregunta. Si no (ATRÁS de la barra sin que el usuario haya
 * tocado la página desde la última cancelación) se guarda el borrador, igual
 * que en `beforeunload`. Salir a otro documento ya lo cubre `beforeunload`.
 */
function handleNavigate(event: TraversalEvent) {
  const top = topEntry();

  if (
    !top ||
    twinIndex === null ||
    event.navigationType !== "traverse" ||
    !event.destination.sameDocument ||
    event.destination.index < 0 ||
    event.destination.index >= twinIndex
  ) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
    top.ask({ kind: "traversal" });
    window.setTimeout(settleOnSentinel, 0);
    return;
  }

  for (const entry of [...entries].reverse()) {
    entry.saveDraftSync();
  }
}

/**
 * Tras cancelar un salto, un paso dentro del par que acaba en el centinela.
 * Chromium descarta el ADELANTE que estuviera pendiente al cancelar (quedaríamos
 * en la gemela) y, si el salto lo pidió la página, ignora después cualquier
 * `history.go` al mismo destino, incluido el de "Salir", hasta que hay otro
 * movimiento. Desde el centinela el paso es un ATRÁS a la gemela, que rebota.
 */
function settleOnSentinel() {
  const marker = topEntry() ? readHistoryMarker(window.history.state) : null;

  if (marker === "sentinel") {
    window.history.back();
  } else if (marker === "twin") {
    window.history.forward();
  }
}

/**
 * Next reescribe el estado de la entrada actual (`replaceState`) cada vez que
 * cambia el estado del router (refresh, query, prefetch en dev) y solo conserva
 * las claves ajenas tras un atrás/adelante; la query superficial de la app
 * (`replaceState(null, "", "?tab=2")`) tampoco las trae. Sin esto la marca del
 * centinela se pierde y el par ya no se reconoce al volver a él o al recargar.
 * El parche solo existe mientras hay algún guardia activo.
 */
function keepMarkerOnReplace() {
  if (replaceStatePatch) {
    return;
  }

  const replaceState = window.history.replaceState;

  function replaceStateKeepingMarker(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    const marker = readHistoryMarker(window.history.state);
    const staysOnRoute =
      !url || new URL(url, window.location.href).pathname === window.location.pathname;
    const keepsMarker =
      marker !== null &&
      staysOnRoute &&
      (data === null ||
        data === undefined ||
        (typeof data === "object" && !(HISTORY_MARKER_KEY in data)));

    return replaceState.call(
      this,
      keepsMarker ? { ...data, [HISTORY_MARKER_KEY]: marker } : data,
      unused,
      url,
    );
  }

  replaceStatePatch = { original: replaceState, patched: replaceStateKeepingMarker };
  window.history.replaceState = replaceStateKeepingMarker;
}

function stopKeepingMarkerOnReplace() {
  // Si otro código parcheó encima del nuestro, retirarlo rompería su cadena: se deja.
  if (!replaceStatePatch || window.history.replaceState !== replaceStatePatch.patched) {
    return;
  }

  window.history.replaceState = replaceStatePatch.original;
  replaceStatePatch = null;
}

/**
 * El listener vive mientras exista la página: es lo que evita el "atrás muerto"
 * del par gemela/centinela cuando el proceso ya terminó. Solo reacciona a
 * entradas marcadas por el guardia.
 */
function listenToHistory() {
  const host = window as unknown as HistoryListenerHost;
  const current = host[HISTORY_LISTENER_KEY];

  if (current === handlePopState) {
    return;
  }

  // Fast Refresh reevalúa el módulo: se retira el listener de la copia anterior.
  if (current) {
    window.removeEventListener("popstate", current);
  }

  host[HISTORY_LISTENER_KEY] = handlePopState;
  previousMarker = readHistoryMarker(window.history.state);
  leavingBack = false;
  window.addEventListener("popstate", handlePopState);
}

/** Deja el historial como [..., gemela, centinela (actual)]. No hace nada si ya lo está. */
function armSentinel() {
  listenToHistory();

  const marker = readHistoryMarker(window.history.state);

  if (marker !== "sentinel") {
    if (marker !== "twin") {
      // "manual": al volver a la gemela el navegador no recoloca el scroll del formulario.
      sentinelScrollRestoration = window.history.scrollRestoration;
      window.history.scrollRestoration = "manual";
      window.history.replaceState(withHistoryMarker("twin"), "", window.location.href);
    }

    window.history.pushState(withHistoryMarker("sentinel"), "", window.location.href);
    // La entrada nueva hereda el modo "manual" de la gemela; el centinela recupera el original.
    window.history.scrollRestoration = sentinelScrollRestoration;
    previousMarker = "sentinel";
  }

  const navigation = (window as unknown as NavigationHost).navigation;
  const sentinelIndex = navigation?.currentEntry?.index;

  keepMarkerOnReplace();
  twinIndex = sentinelIndex === undefined ? null : sentinelIndex - 1;
  navigation?.addEventListener("navigate", handleNavigate);
}

/** Retira lo que solo hace falta con un guardia activo. El par y su `popstate` se quedan. */
function disarmSentinel() {
  stopKeepingMarkerOnReplace();
  twinIndex = null;
  (window as unknown as NavigationHost).navigation?.removeEventListener("navigate", handleNavigate);
}

/** Completa el "Salir" de un ATRÁS: retrocede hasta la entrada anterior al proceso. */
function leaveBack() {
  leavingBack = true;
  window.history.go(readHistoryMarker(window.history.state) === "sentinel" ? -2 : -1);
}

/** Sale de la ruta protegida: otro `pathname` del mismo origen. Query y `#` de la misma página no cuentan. */
function resolveGuardedHref(href: string): string | null {
  let url: URL;

  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }

  if (url.origin !== window.location.origin || url.pathname === window.location.pathname) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Chrome/Edge antiguos solo muestran el aviso si además se asigna returnValue.
  event.returnValue = "";

  for (const entry of [...entries].reverse()) {
    entry.saveDraftSync();
  }
}

function interceptAnchorClick(event: MouseEvent, guardedLinks: boolean) {
  const top = topEntry();

  if (
    !top ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  ) {
    return;
  }

  const anchor = event.target.closest("a[href]");

  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.hasAttribute("download") ||
    anchor.hasAttribute(PROCESS_GUARD_LINK_ATTRIBUTE) !== guardedLinks
  ) {
    return;
  }

  const target = anchor.getAttribute("target");

  if (target && target !== "_self") {
    return;
  }

  const href = resolveGuardedHref(anchor.href);

  if (href === null) {
    return;
  }

  // `next/link` no navega si el clic ya llega con `defaultPrevented`.
  event.preventDefault();
  top.ask({ href, kind: "href", replace: false });
}

/** Enlaces normales: en captura, antes de que `next/link` gestione el clic. */
function handleDocumentClick(event: MouseEvent) {
  interceptAnchorClick(event, false);
}

/**
 * Red de `GuardedLink`: `next/link` cancela el clic antes de llamar a
 * `onNavigate`. Si llega aquí sin cancelar es que no lo gestionó (no hay App
 * Router, p. ej. Storybook) y el navegador saldría de la página sin preguntar.
 */
function handleUnhandledGuardedLinkClick(event: MouseEvent) {
  interceptAnchorClick(event, true);
}

function registerEntry(entry: GuardEntry) {
  if (entries.length === 0) {
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("click", handleUnhandledGuardedLinkClick);
    armSentinel();
  }

  entries.push(entry);
}

function unregisterEntry(entry: GuardEntry) {
  const index = entries.indexOf(entry);

  if (index === -1) {
    return;
  }

  entries.splice(index, 1);

  if (entries.length === 0) {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    document.removeEventListener("click", handleDocumentClick, true);
    document.removeEventListener("click", handleUnhandledGuardedLinkClick);
    disarmSentinel();
  }
}

/**
 * Para `GuardedLink` (`onNavigate` de `next/link`): si hay un guardia activo y
 * el enlace sale de la ruta, abre el modal y devuelve `true` para que el
 * enlace haga `preventDefault()`.
 */
export function interceptProcessGuardNavigation(href: string, replace = false): boolean {
  const top = topEntry();
  const guardedHref = top ? resolveGuardedHref(href) : null;

  if (!top || guardedHref === null) {
    return false;
  }

  top.ask({ href: guardedHref, kind: "href", replace });
  return true;
}

/**
 * Guardia de un proceso sin terminar. Mientras `active` es `true` pregunta con
 * el modal del tema antes de salir de la ruta por:
 * - clic en un enlace interno (`<a>`, `next/link`, `GuardedLink`);
 * - ATRÁS del navegador (entrada centinela, ver arriba);
 * - `guardedNavigate` y `requestLeave`.
 * Cerrar o recargar la pestaña y los enlaces externos muestran el aviso nativo
 * (`beforeunload`).
 *
 * NO se intercepta la navegación programática: `router.push`, `router.replace`,
 * `redirect` ni `window.location` salen de la pantalla sin preguntar. Dentro de
 * una pantalla protegida hay que navegar con `guardedNavigate(href)` y, cuando
 * es el propio proceso el que termina (guardar, confirmar), con
 * `runUnguarded(() => router.push(href))`. `router.back()` sí pregunta, porque
 * retrocede a la entrada gemela igual que el botón ATRÁS.
 *
 * "Salir" espera a `onSaveDraft`/`onDiscard`. Mientras tanto el modal queda
 * bloqueado y cualquier otro intento de salida (ATRÁS, enlace, Esc) se ignora:
 * el manejador se llama una vez y se sale una vez, al destino confirmado. Si
 * el manejador falla no se sale: el modal muestra `error.message` y ofrece
 * reintentar (`dialog.leave`) o salir sin volver a llamarlo
 * (`dialog.leaveWithoutSaving`). Con varios guardias, reintentar solo repite
 * los manejadores que fallaron o no llegaron a ejecutarse.
 *
 * Si el manejador no ha terminado pasados `leaveTimeoutMs`, la salida se da por
 * atascada (`dialog.stalled`): el modal deja seguir aquí o salir sin esperarlo.
 * El manejador no se cancela ni se lanza otro en paralelo: si el usuario se
 * quedó, lo que tarde en terminar ya no lo saca de la pantalla, y un "Salir"
 * posterior espera a ese mismo manejador mientras siga en curso (guarda lo que
 * había cuando se lanzó).
 *
 * Límites conocidos (los pone el navegador; la mitigación es `beforeunload` y
 * el borrador de `onSaveDraft`):
 * - Chromium salta, al pulsar ATRÁS, las entradas que una página añade sin que
 *   el usuario haya interactuado con ella. El par se crea al activarse el
 *   guardia y después no se añade ninguna más: ATRÁS queda protegido desde la
 *   primera interacción (la misma condición que pone a `beforeunload`).
 * - Un salto de varias entradas de golpe (dos ATRÁS antes de que la página
 *   atienda el primero, menú del historial, `history.go(-2)`) pasa por encima
 *   de la gemela. Se cancela y pregunta solo donde hay Navigation API
 *   (Chromium; Firefox y Safari recientes). El navegador deja cancelar un
 *   ATRÁS de su barra una vez por cada interacción del usuario con la página:
 *   si no lo permite, con `onLeave: "draft"` se llama a `onSaveDraft` (sin
 *   esperar, como en `beforeunload`) y se sale sin modal; con `"discard"` los
 *   cambios se pierden. Sin Navigation API el salto sale sin preguntar ni
 *   guardar.
 * - Si el ATRÁS acaba fuera de la app (otro documento) solo hay aviso nativo.
 * - Terminado el proceso, el par sigue en el historial. Si la pantalla
 *   reescribe después su entrada (refresh, filtros) y se recarga, el par ya no
 *   se reconoce y salir cuesta un ATRÁS más.
 */
export function useProcessGuard(options: UseProcessGuardOptions): ProcessGuardController {
  const { active, description, label, onLeave } = options;
  const router = useRouter();
  const optionsRef = useRef(options);
  const routerRef = useRef(router);
  const entryRef = useRef<GuardEntry | null>(null);
  const bypassedRef = useRef(false);
  const pendingRef = useRef<PendingLeave | null>(null);
  const leavingRef = useRef(false);
  /** Número de la salida vigente: una salida abandonada lo encuentra cambiado al terminar. */
  const attemptRef = useRef(0);
  const stalledRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);
  /** Guardias cuyo manejador ya terminó bien para la salida que se está confirmando. */
  const handledEntriesRef = useRef(new Set<GuardEntry>());
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    optionsRef.current = options;
    routerRef.current = router;
  });

  const closeDialog = useCallback(() => {
    pendingRef.current = null;
    handledEntriesRef.current.clear();
    setOpen(false);
    setLeaving(false);
    setStalled(false);
    setError(null);
  }, []);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  /** La salida en curso deja de bloquear: terminó, falló o el usuario dejó de esperarla. */
  const endAttempt = useCallback(() => {
    clearStallTimer();
    leavingRef.current = false;
    stalledRef.current = false;
  }, [clearStallTimer]);

  useEffect(() => clearStallTimer, [clearStallTimer]);

  const bypass = useCallback(() => {
    bypassedRef.current = true;

    if (entryRef.current) {
      unregisterEntry(entryRef.current);
      entryRef.current = null;
    }

    closeDialog();
  }, [closeDialog]);

  useEffect(() => {
    // Tras recargar, el par gemela/centinela sigue en el historial aunque el guardia arranque inactivo.
    if (readHistoryMarker(window.history.state)) {
      listenToHistory();
    }
  }, []);

  useEffect(() => {
    if (!active) {
      bypassedRef.current = false;
      return;
    }

    if (bypassedRef.current) {
      return;
    }

    let running: Promise<void> | null = null;
    const entry: GuardEntry = {
      ask: (pending) => {
        // Con una salida en curso manda la que ya se confirmó: otro ATRÁS o enlace no la sustituye ni desbloquea el modal.
        if (leavingRef.current) {
          return;
        }

        pendingRef.current = pending;
        handledEntriesRef.current.clear();
        setLeaving(false);
        setError(null);
        setOpen(true);
      },
      leave: () => {
        // Un manejador que sigue en curso (salida atascada y abandonada) no se lanza otra vez: se espera al mismo.
        if (!running) {
          running = (async () => {
            const current = optionsRef.current;

            await (current.onLeave === "draft" ? current.onSaveDraft : current.onDiscard)?.();
          })().finally(() => {
            running = null;
          });
        }

        return running;
      },
      release: bypass,
      saveDraftSync: () => {
        const current = optionsRef.current;

        if (current.onLeave !== "draft") {
          return;
        }

        try {
          // El aviso nativo no espera: un guardado asíncrono puede no terminar.
          Promise.resolve(current.onSaveDraft?.()).catch(() => undefined);
        } catch {
          // Un fallo al guardar no debe impedir el aviso de `beforeunload`.
        }
      },
    };

    entryRef.current = entry;
    registerEntry(entry);

    return () => {
      unregisterEntry(entry);

      if (entryRef.current === entry) {
        entryRef.current = null;
      }

      closeDialog();
    };
  }, [active, bypass, closeDialog]);

  const stay = useCallback(() => {
    // Con una salida en curso solo se puede seguir aquí cuando ya se dio por atascada.
    if (leavingRef.current && !stalledRef.current) {
      return;
    }

    // Si el manejador termina después, ya no saca de la pantalla.
    attemptRef.current += 1;
    endAttempt();
    closeDialog();
  }, [closeDialog, endAttempt]);

  const runLeave = useCallback((runHandlers: boolean) => {
    const pending = pendingRef.current;

    // Doble clic = una ejecución: en curso lo impide `leavingRef`; ya terminada, no queda `pending`.
    // Atascada, lo único que se admite es salir sin esperarla.
    if (!pending || (leavingRef.current && (runHandlers || !stalledRef.current))) {
      return;
    }

    endAttempt();
    attemptRef.current += 1;

    const attempt = attemptRef.current;

    leavingRef.current = true;
    setLeaving(true);
    setStalled(false);
    setError(null);

    if (runHandlers) {
      stallTimerRef.current = window.setTimeout(() => {
        stallTimerRef.current = null;
        stalledRef.current = true;
        setStalled(true);
      }, optionsRef.current.leaveTimeoutMs ?? PROCESS_GUARD_LEAVE_TIMEOUT_MS);
    }

    const leavesRoute = pending.kind !== "action";
    // Al salir de la ruta se cierran todos los procesos abiertos, no solo el que pregunta.
    const leavingEntries = leavesRoute
      ? [...entries].reverse()
      : entryRef.current
        ? [entryRef.current]
        : [];

    void (async () => {
      if (runHandlers) {
        try {
          for (const entry of leavingEntries) {
            // Reintento: el que ya terminó bien no se repite.
            if (handledEntriesRef.current.has(entry)) {
              continue;
            }

            await entry.leave();

            // El usuario dejó de esperar esta salida: ni sigue con los demás guardias ni sale.
            if (attemptRef.current !== attempt) {
              return;
            }

            handledEntriesRef.current.add(entry);
          }
        } catch (caught) {
          if (attemptRef.current !== attempt) {
            return;
          }

          endAttempt();
          setLeaving(false);
          setStalled(false);
          setError(caught instanceof Error ? caught.message : String(caught));
          return;
        }
      }

      endAttempt();

      if (leavesRoute) {
        for (const entry of leavingEntries) {
          entry.release();
        }
      }

      closeDialog();

      if (pending.kind === "href") {
        routerRef.current[pending.replace ? "replace" : "push"](pending.href);
      } else if (pending.kind === "traversal") {
        leaveBack();
      } else {
        pending.run();
      }
    })();
  }, [closeDialog, endAttempt]);

  const leave = useCallback(() => runLeave(true), [runLeave]);
  const leaveWithoutSaving = useCallback(() => runLeave(false), [runLeave]);

  const guardedNavigate = useCallback((href: string, navigateOptions?: GuardedNavigateOptions) => {
    const replace = navigateOptions?.replace ?? false;
    const top = topEntry();
    const guardedHref = top ? resolveGuardedHref(href) : null;

    if (top && guardedHref !== null) {
      top.ask({ href: guardedHref, kind: "href", replace });
      return;
    }

    routerRef.current[replace ? "replace" : "push"](href);
  }, []);

  const requestLeave = useCallback((run: () => void) => {
    const top = topEntry();

    // Sin cambios propios no hay nada que confirmar, aunque otro guardia siga activo.
    if (!entryRef.current || !top) {
      run();
      return;
    }

    top.ask({ kind: "action", run });
  }, []);

  const runUnguarded = useCallback(
    (run: () => void) => {
      bypass();
      run();
    },
    [bypass],
  );

  return {
    bypass,
    dialog: {
      description,
      error,
      label,
      leave,
      leaveWithoutSaving,
      leaving,
      onLeave,
      open,
      stalled,
      stay,
    },
    guardedNavigate,
    requestLeave,
    runUnguarded,
  };
}
