"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { UrlListState } from "@/shared/hooks/useUrlListState";

/** Preferencia "Recordar filtros" en `localStorage`: `"0"` = desactivada; sin valor = activa. */
export const REMEMBER_FILTERS_PREFERENCE_KEY = "bodegahub:remember-list-filters";
/** Prefijo de las entradas de `sessionStorage` con los últimos filtros de cada lista. */
export const REMEMBERED_FILTERS_STORAGE_PREFIX = "bodegahub:list-filters:";

const MAX_REMEMBERED_LENGTH = 4000;
const DEFAULT_PAGE_FIELD = "page";

const preferenceListeners = new Set<() => void>();

function readRememberFiltersPreference() {
  try {
    return window.localStorage.getItem(REMEMBER_FILTERS_PREFERENCE_KEY) !== "0";
  } catch {
    // Storage bloqueado: vale el valor por defecto (activa).
    return true;
  }
}

function forgetAllRememberedFilters() {
  try {
    const storage = window.sessionStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));

    for (const key of keys) {
      if (key?.startsWith(REMEMBERED_FILTERS_STORAGE_PREFIX)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Storage bloqueado: no hay nada guardado que olvidar.
  }
}

/** Cambia la preferencia "Recordar filtros". Al desactivarla se olvida lo guardado. */
export function setRememberFiltersPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(REMEMBER_FILTERS_PREFERENCE_KEY, enabled ? "1" : "0");
  } catch {
    // Storage bloqueado: la preferencia no se puede guardar.
  }

  if (!enabled) {
    forgetAllRememberedFilters();
  }

  for (const listener of preferenceListeners) {
    listener();
  }
}

function subscribeToPreference(listener: () => void) {
  preferenceListeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Preferencia "Recordar filtros" (por defecto activa) y su setter, para la pantalla de ajustes. */
export function useRememberFiltersPreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribeToPreference,
    readRememberFiltersPreference,
    () => true,
  );

  return [enabled, setRememberFiltersPreference];
}

function sameValue(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  }

  return Object.is(left, right);
}

function readRemembered(listKey: string): Record<string, unknown> | null {
  try {
    const raw = window.sessionStorage.getItem(`${REMEMBERED_FILTERS_STORAGE_PREFIX}${listKey}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeRemembered(listKey: string, serialized: string | null) {
  try {
    const storageKey = `${REMEMBERED_FILTERS_STORAGE_PREFIX}${listKey}`;

    if (serialized === null || serialized.length > MAX_REMEMBERED_LENGTH) {
      window.sessionStorage.removeItem(storageKey);
    } else {
      window.sessionStorage.setItem(storageKey, serialized);
    }
  } catch {
    // Storage bloqueado o lleno: los filtros no se recuerdan.
  }
}

/** Marca "se restauraron filtros" de una lista montada; la enciende el efecto de restauración. */
function createRestoredFlag() {
  const listeners = new Set<() => void>();
  let value = false;

  return {
    get: () => value,
    set: (next: boolean) => {
      if (value !== next) {
        value = next;

        for (const listener of listeners) {
          listener();
        }
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type RememberedListFiltersOptions<TState> = {
  /** Campo de página, que nunca se recuerda. Por defecto `"page"`. */
  pageField?: keyof TState & string;
};

export type RememberedListFilters = {
  /** `true` mientras la lista muestra filtros restaurados: pinta `RememberedFiltersChip`. */
  restored: boolean;
  /** "Limpiar": vuelve a los valores por defecto (`reset()`) y olvida lo guardado. */
  clear: () => void;
  /** Valor actual de la preferencia "Recordar filtros". */
  enabled: boolean;
};

/**
 * Recuerda los últimos filtros de una lista durante la sesión de la pestaña.
 *
 * - Guarda en `sessionStorage` los campos de `listState` que difieren de su
 *   default (búsqueda, filtros, orden, tamaño de página).
 * - Al montar con la URL SIN parámetros (entrada por el menú) los restaura con
 *   `listState.setState` y `restored` pasa a `true`. Con cualquier parámetro en
 *   la URL manda la URL y no se restaura nada.
 * - La página NO se recuerda: la lista restaurada empieza en la primera. Los
 *   datos pueden haber cambiado desde la última visita y una página guardada
 *   que ya no existe dejaría la lista vacía; "Volver" desde un detalle sí
 *   conserva la página, porque viaja en `from`.
 * - Todo va detrás de la preferencia "Recordar filtros" (por defecto activa).
 *
 * `listKey` identifica la lista (p. ej. `"products"`); si los filtros dependen
 * de la tienda, incluye su id en la clave.
 *
 * @example
 * const list = useUrlListState(productsListSchema);
 * const remembered = useRememberedListFilters("products", list);
 * {remembered.restored ? <RememberedFiltersChip onClear={remembered.clear} /> : null}
 */
export function useRememberedListFilters<TState extends Record<string, unknown>>(
  listKey: string,
  listState: Pick<
    UrlListState<TState>,
    "defaults" | "isDefault" | "reset" | "searchString" | "setState" | "state"
  >,
  options: RememberedListFiltersOptions<TState> = {},
): RememberedListFilters {
  const [enabled] = useRememberFiltersPreference();
  const [restoredFlag] = useState(createRestoredFlag);
  const restored = useSyncExternalStore(restoredFlag.subscribe, restoredFlag.get, () => false);
  const pageField: string = options.pageField ?? DEFAULT_PAGE_FIELD;
  const { defaults, reset, state } = listState;
  const mountedRef = useRef(false);
  const skipSaveRef = useRef(false);
  const mountRef = useRef({ listKey, listState, pageField });

  // Filtros no por defecto del estado actual, sin la página; `null` si no hay ninguno.
  const serialized = useMemo(() => {
    const filters: Record<string, unknown> = {};

    for (const field of Object.keys(defaults)) {
      if (field !== pageField && !sameValue(state[field], defaults[field])) {
        filters[field] = state[field];
      }
    }

    return Object.keys(filters).length > 0 ? JSON.stringify(filters) : null;
  }, [defaults, pageField, state]);

  // Restauración: una sola vez, al montar.
  useEffect(() => {
    if (mountedRef.current) {
      return;
    }

    mountedRef.current = true;

    const mount = mountRef.current;

    if (!readRememberFiltersPreference() || mount.listState.searchString !== "") {
      return;
    }

    const saved = readRemembered(mount.listKey);
    const patch: Record<string, unknown> = {};

    for (const field of Object.keys(mount.listState.defaults)) {
      if (saved && field !== mount.pageField && Object.hasOwn(saved, field)) {
        patch[field] = saved[field];
      }
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    // El estado aún es el por defecto: sin esto, el guardado de este mismo
    // render borraría lo que se acaba de leer.
    skipSaveRef.current = true;
    // `setState` valida el patch contra el schema; si no vale, lo ignora entero.
    mount.listState.setState(patch as Partial<TState>);
    restoredFlag.set(true);
  }, [restoredFlag]);

  // La marca solo vale mientras la lista muestra lo restaurado. Se apaga si el
  // patch no cambió nada (guardado inservible o igual a los defaults) y cuando
  // la lista vuelve a sus defaults: un filtro manual posterior no es "recordado".
  useEffect(() => {
    if (restored && listState.isDefault) {
      restoredFlag.set(false);
    }
  }, [listState.isDefault, restored, restoredFlag]);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }

    // `enabled` vale `true` mientras se hidrata (el servidor no conoce la
    // preferencia): antes de tocar el storage se lee su valor real.
    if (enabled && readRememberFiltersPreference()) {
      writeRemembered(listKey, serialized);
    }
  }, [enabled, listKey, serialized]);

  const clear = useCallback(() => {
    restoredFlag.set(false);
    writeRemembered(listKey, null);
    reset();
  }, [listKey, reset, restoredFlag]);

  return {
    clear,
    enabled,
    restored: restored && enabled && !listState.isDefault,
  };
}
