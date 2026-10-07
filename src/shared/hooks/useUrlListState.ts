"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { z } from "zod";

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, MIN_PAGE_LIMIT } from "@/lib/api/pagination";
import type { SortOrder } from "@/lib/api/sorting";

/** Debounce de los campos de texto antes de escribir la URL. */
export const URL_LIST_DEBOUNCE_MS = 300;
/** Tiempo que se sigue reconociendo el eco tardío de una escritura propia ya adelantada. */
export const URL_LIST_ECHO_TTL_MS = 3000;
/** Página más alta que se acepta desde la URL. */
export const MAX_URL_PAGE = 100_000;
/** Un valor de parámetro más largo que esto se considera corrupto. */
export const MAX_URL_PARAM_LENGTH = 500;
/** Máximo de valores repetidos que se leen para un campo de tipo lista. */
export const MAX_URL_PARAM_VALUES = 50;

const DEFAULT_TEXT_FIELD = "search";
const DEFAULT_PAGE_FIELD = "page";
const NUMERIC_PARAM = /^-?\d{1,15}(\.\d{1,6})?$/;
const YMD_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Carácter con el que `URLSearchParams` sustituye un `%` mal codificado. */
const REPLACEMENT_CHARACTER = "�";

export type UrlListShape = Readonly<Record<string, z.ZodType>>;

type LooseState = Record<string, unknown>;

function isValidYmd(value: string) {
  const match = YMD_PARAM.exec(value);

  if (!match) {
    return false;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Piezas Zod para declarar el schema de una lista. Todas traen valor por
 * defecto (obligatorio para `useUrlListState`) y validan lo que llega de la URL.
 * No uses `z.coerce`: el hook ya convierte el texto de la URL a número/booleano.
 */
export const listParams = {
  /** Texto libre (búsqueda). Decláralo en `textFields` para que lleve debounce. */
  text: (maxLength = 200) => z.string().max(maxLength).default(""),
  /** Filtro de valores cerrados, p. ej. `listParams.oneOf(["all", "active"], "all")`. */
  oneOf: <const TValues extends readonly [string, ...string[]]>(
    values: TValues,
    defaultValue: TValues[number],
  ) => z.enum(values).default(defaultValue),
  /** Varios valores cerrados: `?estado=a&estado=b`. */
  manyOf: <const TValues extends readonly [string, ...string[]]>(values: TValues) =>
    z.array(z.enum(values)).max(values.length).default([]),
  boolean: (defaultValue = false) => z.boolean().default(defaultValue),
  number: (config: { min?: number; max?: number; defaultValue: number }) =>
    z
      .number()
      .min(config.min ?? Number.MIN_SAFE_INTEGER)
      .max(config.max ?? Number.MAX_SAFE_INTEGER)
      .default(config.defaultValue),
  /** Fecha `YYYY-MM-DD` real; cadena vacía = sin filtro. */
  date: () =>
    z
      .string()
      .refine((value) => value === "" || isValidYmd(value))
      .default(""),
  /** Columna de orden: solo las permitidas. */
  sort: <const TColumns extends readonly [string, ...string[]]>(
    columns: TColumns,
    defaultColumn: TColumns[number],
  ) => z.enum(columns).default(defaultColumn),
  dir: (defaultOrder: SortOrder = "asc") => z.enum(["asc", "desc"]).default(defaultOrder),
  /** Página base 1. */
  page: () => z.number().int().min(1).max(MAX_URL_PAGE).default(1),
  /** Tamaño de página: por debajo del mínimo → default; por encima del máximo → se acota. */
  limit: (defaultLimit = DEFAULT_PAGE_LIMIT) =>
    z
      .number()
      .int()
      .min(MIN_PAGE_LIMIT)
      .transform((value) => Math.min(value, MAX_PAGE_LIMIT))
      .default(defaultLimit),
};

function sameValue(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  }

  return Object.is(left, right);
}

/** Valor tipado → textos de la URL. `null`, `undefined` y lista vacía no se escriben. */
function encodeValue(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap(encodeValue);
  }

  return [];
}

/**
 * Textos de la URL → candidatos tipados, en orden de preferencia. El schema del
 * campo decide cuál vale; si ninguno vale, el campo cae a su default.
 */
function decodeCandidates(raws: readonly string[]): unknown[] {
  const isCorrupt =
    raws.length > MAX_URL_PARAM_VALUES ||
    raws.some((raw) => raw.length > MAX_URL_PARAM_LENGTH || raw.includes(REPLACEMENT_CHARACTER));

  if (isCorrupt) {
    return [];
  }

  const allNumeric = raws.every((raw) => NUMERIC_PARAM.test(raw));
  const lists: unknown[] = allNumeric ? [[...raws], raws.map(Number)] : [[...raws]];

  if (raws.length !== 1) {
    return lists;
  }

  const [raw] = raws;
  const scalars: unknown[] = [raw];

  if (allNumeric) {
    scalars.push(Number(raw));
  }

  if (raw === "true" || raw === "false") {
    scalars.push(raw === "true");
  }

  return [...scalars, ...lists];
}

function safeParseField(field: z.ZodType, value: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    const result = field.safeParse(value);

    return result.success ? { ok: true, value: result.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function createListModel(shape: UrlListShape) {
  const keys = Object.keys(shape);
  const defaults: LooseState = {};

  for (const key of keys) {
    const parsed = safeParseField(shape[key], undefined);

    if (!parsed.ok) {
      throw new Error(
        `useUrlListState: el campo "${key}" necesita un valor por defecto (.default(...)) o ser opcional.`,
      );
    }

    defaults[key] = parsed.value;
  }

  function entries(state: LooseState): [string, string[]][] {
    return keys.flatMap((key): [string, string[]][] =>
      sameValue(state[key], defaults[key]) ? [] : [[key, encodeValue(state[key])]],
    );
  }

  return {
    defaults,
    keys,
    /** Lectura tolerante campo a campo: lo inválido cae a su default. */
    parse(params: URLSearchParams): LooseState {
      const state: LooseState = {};

      for (const key of keys) {
        state[key] = defaults[key];

        const raws = params.getAll(key);

        if (raws.length === 0) {
          continue;
        }

        for (const candidate of decodeCandidates(raws)) {
          const parsed = safeParseField(shape[key], candidate);

          if (parsed.ok) {
            state[key] = parsed.value;
            break;
          }
        }
      }

      return state;
    },
    /** Huella de los parámetros propios, para reconocer la URL que escribió el hook. */
    ownedKey(state: LooseState) {
      return JSON.stringify(entries(state));
    },
    /** Query resultante: conserva los parámetros ajenos y reescribe solo los propios. */
    buildQuery(currentQuery: string, state: LooseState) {
      const params = new URLSearchParams(currentQuery);

      for (const key of keys) {
        params.delete(key);
      }

      for (const [key, values] of entries(state)) {
        for (const value of values) {
          params.append(key, value);
        }
      }

      return params.toString();
    },
    /** Aplica un patch validado. Un patch con algún valor inválido se ignora entero. */
    applyPatch(state: LooseState, patch: LooseState, pageKey: string) {
      const next: LooseState = { ...state };
      const changed: string[] = [];

      for (const key of Object.keys(patch)) {
        if (!keys.includes(key)) {
          continue;
        }

        const parsed = safeParseField(shape[key], patch[key]);

        if (!parsed.ok) {
          return { changed: [], next: state };
        }

        if (!sameValue(parsed.value, state[key])) {
          next[key] = parsed.value;
          changed.push(key);
        }
      }

      if (changed.length > 0 && keys.includes(pageKey) && !Object.hasOwn(patch, pageKey)) {
        next[pageKey] = defaults[pageKey];
      }

      return { changed, next };
    },
    isDefault(state: LooseState) {
      return keys.every((key) => sameValue(state[key], defaults[key]));
    },
  };
}

type ListModel = ReturnType<typeof createListModel>;

export type UrlListStateOf<TShape extends UrlListShape> = z.output<z.ZodObject<TShape>>;

export type UrlListStateOptions<TState> = {
  /**
   * Campos de texto con debounce: el estado cambia al instante y la URL se
   * escribe tras `debounceMs`. Por defecto `["search"]` si el schema lo tiene.
   */
  textFields?: readonly (keyof TState & string)[];
  /** Por defecto 300 ms. */
  debounceMs?: number;
  /** Campo de página (base 1) que vuelve a su default al cambiar cualquier otro. Por defecto `"page"`. */
  pageField?: keyof TState & string;
};

export type UrlListState<TState> = {
  /** Estado actual. Refleja lo tecleado al instante, aunque la URL aún no se haya escrito. */
  state: TState;
  /** Valores por defecto del schema (los que no aparecen en la URL). */
  defaults: TState;
  /**
   * Cambia uno o varios campos. Si el patch no trae `page`, la página vuelve a 1.
   * `undefined` devuelve el campo a su default. Un valor que el schema rechaza
   * anula el patch entero.
   */
  setState: (patch: Partial<TState>) => void;
  setField: <TKey extends keyof TState>(key: TKey, value: TState[TKey]) => void;
  /** Vuelve a los defaults y quita de la URL solo los parámetros del schema. */
  reset: () => void;
  /** `true` si ningún campo difiere de su default. */
  isDefault: boolean;
  /** Query del estado actual con `?` (o `""`), incluidos los parámetros ajenos. */
  searchString: string;
  /** `pathname + searchString`: la URL exacta de la lista, para "Volver". */
  href: string;
};

/**
 * Estado local de la lista y registro de las escrituras propias, fuera de React.
 *
 * Vive en un almacén externo (y no en `useState`) a propósito: reconciliar con
 * la URL llamando a un `setState` durante el render deja ese valor en la cola
 * del hook aunque React descarte el render (una transición del router
 * interrumpida por una tecla), y la siguiente actualización urgente lo toma
 * como base. Así se perdían teclas y filtros en listas con render pesado.
 */
type ListSnapshot = {
  state: LooseState;
  /** Huella de los parámetros propios que la URL ya confirmó. */
  confirmed: string;
  /** Huellas de las escrituras propias emitidas y aún sin confirmar, en orden. */
  inFlight: readonly string[];
  /** Escrituras propias que una posterior adelantó: su eco puede llegar tarde. */
  superseded: readonly string[];
};

function createListStore(initial: ListSnapshot) {
  const listeners = new Set<() => void>();
  let snapshot = initial;

  return {
    get: () => snapshot,
    set: (next: ListSnapshot) => {
      if (next !== snapshot) {
        snapshot = next;

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

/**
 * Decide qué hacer con la URL que entrega Next. Función pura e idempotente: se
 * usa igual al derivar el estado en el render y al consolidarlo tras el commit.
 *
 * - Misma huella que la confirmada (o solo cambió un parámetro ajeno): nada.
 * - Coincide con una escritura en camino, sea o no la última: es un eco. Se da
 *   por confirmada, las anteriores pasan a `superseded` y el estado local NO se
 *   toca (puede llevar texto tecleado después o un filtro más reciente).
 * - Coincide con una escritura adelantada: eco tardío, se ignora.
 * - No coincide con ninguna escritura propia: navegación externa (atrás/adelante,
 *   enlace). Manda la URL, también si hay escrituras en camino o texto en
 *   debounce: quien navega después de teclear quiere la URL a la que va.
 */
function reconcileWithUrl(
  model: ListModel,
  snapshot: ListSnapshot,
  urlOwnedKey: string,
  urlState: LooseState,
): ListSnapshot {
  if (urlOwnedKey === snapshot.confirmed) {
    return snapshot;
  }

  const echoIndex = snapshot.inFlight.indexOf(urlOwnedKey);

  if (echoIndex >= 0) {
    return {
      confirmed: urlOwnedKey,
      inFlight: snapshot.inFlight.slice(echoIndex + 1),
      state: snapshot.state,
      superseded: [...snapshot.superseded, ...snapshot.inFlight.slice(0, echoIndex)],
    };
  }

  if (snapshot.superseded.includes(urlOwnedKey)) {
    return snapshot;
  }

  return {
    confirmed: urlOwnedKey,
    inFlight: [],
    state: model.ownedKey(snapshot.state) === urlOwnedKey ? snapshot.state : urlState,
    superseded: [],
  };
}

/**
 * Estado de una lista (búsqueda, filtros, orden, página, tamaño) guardado en
 * los parámetros de la URL. Regla 15 del plan ux-mejoras.
 *
 * - El schema es un `z.object` cuyos campos tienen default (usa `listParams`).
 *   Decláralo FUERA del componente: su identidad debe ser estable.
 * - Los valores por defecto no se escriben en la URL.
 * - Lectura tolerante: un parámetro inválido cae a su default sin afectar al
 *   resto; los parámetros que no son del schema (`tab`, `from`, …) se conservan.
 * - Escribe con `router.replace(url, { scroll: false })`. Los `textFields` se
 *   escriben con debounce; el resto, al instante.
 * - Si la URL cambia por fuera (atrás/adelante, enlace), el estado la sigue.
 * - Mientras una escritura propia está en camino manda el estado local: la URL
 *   que llega se compara con el registro de escrituras propias
 *   (`reconcileWithUrl`) y un eco nunca pisa lo tecleado o filtrado después.
 *
 * Suspense: el hook usa `useSearchParams`, que en una ruta prerenderizada exige
 * un límite de `<Suspense>` por encima del componente (si falta, falla el
 * build). Envuelve la pantalla con `withUrlListBoundary(Pantalla)` o con
 * `<UrlListBoundary>`; `useUrlListState` no puede llamarse en el mismo
 * componente que pinta el límite.
 *
 * @example
 * const productsListSchema = z.object({
 *   search: listParams.text(),
 *   status: listParams.oneOf(["all", "active", "inactive"], "all"),
 *   sort: listParams.sort(["name", "price"], "name"),
 *   dir: listParams.dir(),
 *   page: listParams.page(),
 *   limit: listParams.limit(),
 * });
 *
 * function ProductsList() {
 *   const list = useUrlListState(productsListSchema);
 *   const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
 *   const { handleSort, sortBy, sortOrder } = useUrlSortState(list);
 *   return <Input value={list.state.search} onChange={(e) => list.setField("search", e.target.value)} />;
 * }
 *
 * export const ProductsListPage = withUrlListBoundary(ProductsList);
 */
export function useUrlListState<TShape extends UrlListShape>(
  schema: z.ZodObject<TShape>,
  options: UrlListStateOptions<UrlListStateOf<TShape>> = {},
): UrlListState<UrlListStateOf<TShape>> {
  type TState = UrlListStateOf<TShape>;

  const router = useRouter();
  const pathname = usePathname();
  const urlKey = useSearchParams().toString();
  const model: ListModel = useMemo(() => createListModel(schema.shape), [schema]);
  const urlState = useMemo(() => model.parse(new URLSearchParams(urlKey)), [model, urlKey]);
  const urlOwnedKey = model.ownedKey(urlState);
  const [store] = useState(() =>
    createListStore({ confirmed: urlOwnedKey, inFlight: [], state: urlState, superseded: [] }),
  );
  const stored = useSyncExternalStore(store.subscribe, store.get, store.get);
  // Derivado, sin escribir nada durante el render: un render que React descarte
  // no deja rastro. El efecto de más abajo lo consolida solo si llega a pantalla.
  const current = useMemo(
    () => reconcileWithUrl(model, stored, urlOwnedKey, urlState),
    [model, stored, urlOwnedKey, urlState],
  );

  const textFields: readonly string[] = options.textFields ?? [DEFAULT_TEXT_FIELD];
  const environment = {
    debounceMs: options.debounceMs ?? URL_LIST_DEBOUNCE_MS,
    model,
    pageField: options.pageField ?? DEFAULT_PAGE_FIELD,
    pathname,
    router,
    textFields,
    urlKey,
  };
  const environmentRef = useRef(environment);
  /** Última query pedida al router (o la de la URL si no hay escrituras en camino). */
  const targetQueryRef = useRef(urlKey);
  const timerRef = useRef<number | null>(null);
  const forgetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    environmentRef.current = environment;
  });

  // Consolida la URL de este commit antes de que pueda llegar otro evento.
  useLayoutEffect(() => {
    const next = reconcileWithUrl(model, store.get(), urlOwnedKey, urlState);

    store.set(next);

    if (next.inFlight.length === 0) {
      targetQueryRef.current = urlKey;
    }
  }, [model, store, urlKey, urlOwnedKey, urlState]);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Al desmontar no se escribe lo pendiente: un `replace` tardío devolvería al
  // usuario a la lista que acaba de abandonar.
  useEffect(
    () => () => {
      cancelTimer();

      if (forgetTimerRef.current !== null) {
        window.clearTimeout(forgetTimerRef.current);
        forgetTimerRef.current = null;
      }
    },
    [cancelTimer],
  );

  const flush = useCallback(() => {
    cancelTimer();

    const env = environmentRef.current;
    const snapshot = store.get();
    // Estado local completo + parámetros ajenos de la última URL en pantalla.
    const query = env.model.buildQuery(env.urlKey, snapshot.state);

    if (query === targetQueryRef.current) {
      return;
    }

    const ownedKey = env.model.ownedKey(snapshot.state);
    const lastKey = snapshot.inFlight[snapshot.inFlight.length - 1] ?? snapshot.confirmed;

    targetQueryRef.current = query;

    if (lastKey !== ownedKey) {
      store.set({ ...snapshot, inFlight: [...snapshot.inFlight, ownedKey] });
    }

    // El eco tardío de una escritura adelantada solo se espera un rato: pasado
    // el plazo, una URL con esa huella vuelve a ser una navegación externa.
    if (forgetTimerRef.current !== null) {
      window.clearTimeout(forgetTimerRef.current);
    }

    forgetTimerRef.current = window.setTimeout(() => {
      const latest = store.get();

      forgetTimerRef.current = null;

      if (latest.superseded.length > 0) {
        store.set({ ...latest, superseded: [] });
      }
    }, URL_LIST_ECHO_TTL_MS);

    env.router.replace(query ? `${env.pathname}?${query}` : env.pathname, { scroll: false });
  }, [cancelTimer, store]);

  const setState = useCallback(
    (patch: Partial<TState>) => {
      const env = environmentRef.current;
      const snapshot = store.get();
      const { changed, next } = env.model.applyPatch(snapshot.state, patch, env.pageField);

      if (changed.length === 0) {
        return;
      }

      store.set({ ...snapshot, state: next });

      if (changed.every((key) => env.textFields.includes(key))) {
        cancelTimer();
        timerRef.current = window.setTimeout(flush, env.debounceMs);
      } else {
        flush();
      }
    },
    [cancelTimer, flush, store],
  );

  const setField = useCallback(
    <TKey extends keyof TState>(key: TKey, value: TState[TKey]) => {
      const patch: Partial<TState> = {};

      patch[key] = value;
      setState(patch);
    },
    [setState],
  );

  const reset = useCallback(() => {
    const { defaults } = environmentRef.current.model;

    store.set({ ...store.get(), state: defaults });
    flush();
  }, [flush, store]);

  const query = model.buildQuery(urlKey, current.state);
  const searchString = query ? `?${query}` : "";

  return {
    defaults: model.defaults as TState,
    href: `${pathname}${searchString}`,
    isDefault: model.isDefault(current.state),
    reset,
    searchString,
    setField,
    setState,
    state: current.state as TState,
  };
}

type UrlListBoundaryProps = {
  children: ReactNode;
  /** Lo que se pinta mientras no se conoce la URL (prerender). Por defecto, nada. */
  fallback?: ReactNode;
};

/** Límite de Suspense que exige `useSearchParams` por encima de quien usa `useUrlListState`. */
export function UrlListBoundary({ children, fallback = null }: UrlListBoundaryProps) {
  return createElement(Suspense, { fallback }, children);
}

/**
 * Envuelve una pantalla que usa `useUrlListState` en su límite de Suspense:
 * `export const ProductsListPage = withUrlListBoundary(ProductsList);`
 */
export function withUrlListBoundary<TProps extends object>(
  Component: ComponentType<TProps>,
  fallback: ReactNode = null,
) {
  function UrlListScreen(props: TProps) {
    return createElement(Suspense, { fallback }, createElement(Component, props));
  }

  UrlListScreen.displayName = `withUrlListBoundary(${Component.displayName ?? Component.name ?? "Component"})`;

  return UrlListScreen;
}
