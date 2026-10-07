"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type ProcessGuardLeaveMode = "draft" | "discard";

type LeaveHandler = () => void | Promise<void>;

export type UseProcessGuardOptions = {
  /** `false` desmonta el guardia por completo: ni listeners ni intercepción. */
  active: boolean;
  /** Texto adicional bajo el nombre del proceso. */
  description?: string;
  /** Nombre del proceso que muestra el modal, p. ej. "Compra a Distribuidora X · 12 líneas · REF 240,00". */
  label: string;
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
  leave: () => void;
  leaving: boolean;
  onLeave: ProcessGuardLeaveMode;
  open: boolean;
  stay: () => void;
};

export type ProcessGuardController = {
  /** Apaga este guardia hasta que `active` vuelva a pasar por `false`. */
  bypass: () => void;
  /** Estado del modal; se pinta con `<ProcessGuardModal guard={...} />`. */
  dialog: ProcessGuardDialogState;
  /** `router.push`/`replace` que pregunta antes si hay algún guardia activo. */
  guardedNavigate: (href: string, options?: GuardedNavigateOptions) => void;
  /** Pide la misma confirmación sin navegación (cerrar un modal con cambios). */
  requestLeave: (run: () => void) => void;
  /** `bypass()` y luego `run()`: la navegación que el propio proceso hace al terminar. */
  runUnguarded: (run: () => void) => void;
};

type PendingLeave =
  | { href: string; kind: "href"; replace: boolean }
  | { delta: number; kind: "traversal" }
  | { kind: "action"; run: () => void };

type GuardEntry = {
  ask: (pending: PendingLeave) => void;
  leave: () => Promise<void>;
  release: () => void;
  saveDraftSync: () => void;
};

type NavigationEntryLike = { index: number };
type NavigationLike = {
  addEventListener: (type: "currententrychange", listener: (event: Event) => void) => void;
  currentEntry: NavigationEntryLike | null;
  removeEventListener: (type: "currententrychange", listener: (event: Event) => void) => void;
};
type EntryChangeEventLike = Event & {
  from?: NavigationEntryLike;
  navigationType?: string | null;
};

/** Marca de `GuardedLink`: esos enlaces se bloquean con `onNavigate`, no con el listener global. */
export const PROCESS_GUARD_LINK_ATTRIBUTE = "data-process-guard-link";

// Pila global de guardias activos: el último registrado es el que pregunta.
const entries: GuardEntry[] = [];
let guardedPathname = "";
let restoringTraversal = false;
let lastTraverseDelta: number | null = null;

function topEntry(): GuardEntry | undefined {
  return entries[entries.length - 1];
}

function getNavigationApi(): NavigationLike | undefined {
  return (window as unknown as { navigation?: NavigationLike }).navigation;
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

function handleDocumentClick(event: MouseEvent) {
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
    anchor.hasAttribute(PROCESS_GUARD_LINK_ATTRIBUTE)
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

function handleEntryChange(event: EntryChangeEventLike) {
  const current = getNavigationApi()?.currentEntry;

  lastTraverseDelta =
    event.navigationType === "traverse" && event.from && current
      ? current.index - event.from.index
      : null;
}

function handlePopState(event: PopStateEvent) {
  if (restoringTraversal) {
    // Es la vuelta de nuestra propia restauración (u otro "atrás" mientras llega).
    if (window.location.pathname === guardedPathname) {
      restoringTraversal = false;
    }

    event.stopImmediatePropagation();
    return;
  }

  const top = topEntry();

  if (!top || window.location.pathname === guardedPathname) {
    return;
  }

  // El router de Next no llega a ver este popstate: la pantalla se queda como está.
  event.stopImmediatePropagation();

  // Sin Navigation API no se sabe el sentido: se asume "atrás".
  const delta = lastTraverseDelta || -1;

  lastTraverseDelta = null;
  restoringTraversal = true;
  window.history.go(-delta);
  top.ask({ delta, kind: "traversal" });
}

function registerEntry(entry: GuardEntry) {
  if (entries.length === 0) {
    guardedPathname = window.location.pathname;
    restoringTraversal = false;
    lastTraverseDelta = null;
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState, true);
    document.addEventListener("click", handleDocumentClick, true);
    getNavigationApi()?.addEventListener("currententrychange", handleEntryChange);
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
    window.removeEventListener("popstate", handlePopState, true);
    document.removeEventListener("click", handleDocumentClick, true);
    getNavigationApi()?.removeEventListener("currententrychange", handleEntryChange);
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

export function useProcessGuard(options: UseProcessGuardOptions): ProcessGuardController {
  const { active, description, label, onLeave } = options;
  const router = useRouter();
  const optionsRef = useRef(options);
  const routerRef = useRef(router);
  const entryRef = useRef<GuardEntry | null>(null);
  const bypassedRef = useRef(false);
  const pendingRef = useRef<PendingLeave | null>(null);
  const leavingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    optionsRef.current = options;
    routerRef.current = router;
  });

  const closeDialog = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
    setLeaving(false);
    setError(null);
  }, []);

  const bypass = useCallback(() => {
    bypassedRef.current = true;

    if (entryRef.current) {
      unregisterEntry(entryRef.current);
      entryRef.current = null;
    }

    closeDialog();
  }, [closeDialog]);

  useEffect(() => {
    if (!active) {
      bypassedRef.current = false;
      return;
    }

    if (bypassedRef.current) {
      return;
    }

    const entry: GuardEntry = {
      ask: (pending) => {
        pendingRef.current = pending;
        leavingRef.current = false;
        setLeaving(false);
        setError(null);
        setOpen(true);
      },
      leave: async () => {
        const current = optionsRef.current;

        await (current.onLeave === "draft" ? current.onSaveDraft : current.onDiscard)?.();
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
    if (!leavingRef.current) {
      closeDialog();
    }
  }, [closeDialog]);

  const leave = useCallback(() => {
    const pending = pendingRef.current;

    // `leavingRef` solo se rearma en el siguiente `ask`: doble clic = una ejecución.
    if (!pending || leavingRef.current) {
      return;
    }

    leavingRef.current = true;
    setLeaving(true);
    setError(null);

    const leavesRoute = pending.kind !== "action";
    // Al salir de la ruta se cierran todos los procesos abiertos, no solo el que pregunta.
    const leavingEntries = leavesRoute
      ? [...entries].reverse()
      : entryRef.current
        ? [entryRef.current]
        : [];

    void (async () => {
      try {
        for (const entry of leavingEntries) {
          await entry.leave();
        }
      } catch (caught) {
        leavingRef.current = false;
        setLeaving(false);
        setError(caught instanceof Error ? caught.message : String(caught));
        return;
      }

      if (leavesRoute) {
        for (const entry of leavingEntries) {
          entry.release();
        }
      }

      closeDialog();

      if (pending.kind === "href") {
        routerRef.current[pending.replace ? "replace" : "push"](pending.href);
      } else if (pending.kind === "traversal") {
        window.history.go(pending.delta);
      } else {
        pending.run();
      }
    })();
  }, [closeDialog]);

  const guardedNavigate = useCallback((href: string, navigateOptions?: GuardedNavigateOptions) => {
    const replace = navigateOptions?.replace ?? false;
    const top = topEntry();

    if (top) {
      top.ask({ href, kind: "href", replace });
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
    dialog: { description, error, label, leave, leaving, onLeave, open, stay },
    guardedNavigate,
    requestLeave,
    runUnguarded,
  };
}
