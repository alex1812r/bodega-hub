"use client";

import { Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import {
  formControlClassName,
  formControlErrorClassName,
  formHelperClassName,
  formHelperErrorClassName,
  formLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import type {
  EntityAutocompleteValue,
  EntityFetcher,
  EntityFilters,
  EntityKind,
  EntityOption,
} from "./entityAutocomplete.types";
import { entityConfig, type EntitySecondaryContext } from "./entityConfig";
import { readEntityRecents, rememberEntityRecent } from "./entityRecents";

export const ENTITY_AUTOCOMPLETE_LIMIT = 8;
export const ENTITY_AUTOCOMPLETE_DEBOUNCE_MS = 250;
export const ENTITY_AUTOCOMPLETE_MIN_QUERY_LENGTH = 2;

const FALLBACK_ERROR_MESSAGE = "No se pudo completar la búsqueda.";
const POPUP_GAP_PX = 4;
const POPUP_MAX_HEIGHT_PX = 320;
const POPUP_MIN_SPACE_BELOW_PX = 180;
const VIEWPORT_MARGIN_PX = 8;

const popupClassName =
  "pointer-events-auto fixed z-50 overflow-y-auto rounded-lg border border-border bg-surface-container-lowest text-sm shadow-lg";

export type EntityAutocompleteProps<K extends EntityKind> = {
  autoFocus?: boolean;
  disabled?: boolean;
  entity: K;
  error?: string;
  /** Búsqueda en servidor; por defecto el BFF de la entidad (`/api/products`, `/api/contacts`). */
  fetcher?: EntityFetcher<K>;
  filters?: EntityFilters<K>;
  /** Devuelve el motivo por el que la opción no puede elegirse. */
  getOptionDisabled?: (option: EntityOption<K>) => string | false | null | undefined;
  helperText?: string;
  label: string;
  onChange: (option: EntityOption<K> | null) => void;
  /** Enter sin ningún resultado para el texto escrito o leído. */
  onNotFound?: (text: string) => void;
  placeholder?: string;
  /** Separa los recientes por contexto (p. ej. por tienda o por pantalla). */
  recentsKey?: string;
  renderSecondary?: (option: EntityOption<K>, context: EntitySecondaryContext) => ReactNode;
  required?: boolean;
  value: EntityAutocompleteValue | null;
};

type SearchState<K extends EntityKind> =
  | { key: string; status: "idle" | "loading" }
  | { error: unknown; key: string; status: "error" }
  | { items: EntityOption<K>[]; key: string; status: "success" };

type PopupView = "empty" | "error" | "loading" | "none" | "recents" | "results";

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR_MESSAGE;
}

function isForbiddenError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 403
  );
}

/**
 * Buscador de productos o contactos con búsqueda en servidor.
 *
 * Los recientes son una copia guardada en el navegador: un consumidor que
 * necesite stock, precio o costo vigentes debe releer la entidad por `id`.
 */
export function EntityAutocomplete<K extends EntityKind>({
  autoFocus = false,
  disabled = false,
  entity,
  error,
  fetcher,
  filters,
  getOptionDisabled,
  helperText,
  label,
  onChange,
  onNotFound,
  placeholder,
  recentsKey,
  renderSecondary,
  required = false,
  value,
}: EntityAutocompleteProps<K>) {
  const config = entityConfig[entity];
  const inputId = useId();
  const listId = `${inputId}-list`;
  const descriptionId = `${inputId}-description`;
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const requestedKeyRef = useRef<string | null>(null);
  const pendingEnterRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [text, setText] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [recents, setRecents] = useState<EntityOption<K>[]>([]);
  const [search, setSearch] = useState<SearchState<K>>({ key: "", status: "idle" });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const hasValue = value !== null;
  const showsValueLabel = hasValue && !isDirty;
  const displayValue = showsValueLabel ? value.label : text;
  const query = showsValueLabel ? "" : text.trim();
  const debouncedQuery = useDebouncedValue(query, ENTITY_AUTOCOMPLETE_DEBOUNCE_MS);
  const activeFilters: EntityFilters<K> = filters ?? {};
  const filtersKey = JSON.stringify(activeFilters);
  const hasQuery = query.length >= ENTITY_AUTOCOMPLETE_MIN_QUERY_LENGTH;
  const description = error ?? helperText;

  function getSearchKey(searchQuery: string) {
    return `${filtersKey}\u0000${searchQuery}`;
  }

  function toVisibleOptions(options: EntityOption<K>[]) {
    return options
      .filter((option) => config.matchesFilters(option, activeFilters))
      .slice(0, ENTITY_AUTOCOMPLETE_LIMIT);
  }

  function getDisabledReason(option: EntityOption<K>) {
    return getOptionDisabled?.(option) || null;
  }

  const currentKey = getSearchKey(query);
  const isSearchCurrent = search.key === currentKey;
  const visibleRecents = toVisibleOptions(recents);

  let view: PopupView = "none";
  let options: EntityOption<K>[] = [];

  if (isOpen && !disabled) {
    if (query === "") {
      view = visibleRecents.length > 0 ? "recents" : "none";
      options = visibleRecents;
    } else if (hasQuery || isSearchCurrent) {
      if (!isSearchCurrent || search.status === "loading" || search.status === "idle") {
        view = "loading";
      } else if (search.status === "error") {
        view = "error";
      } else if (search.status === "success") {
        view = search.items.length > 0 ? "results" : "empty";
        options = search.items;
      }
    }
  }

  const firstEnabledIndex = options.findIndex((option) => !getDisabledReason(option));
  const defaultActiveIndex = view === "results" ? firstEnabledIndex : -1;
  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < options.length ? activeIndex : defaultActiveIndex;
  const activeOption = resolvedActiveIndex >= 0 ? options[resolvedActiveIndex] : undefined;
  const hasListbox = view === "recents" || view === "results";
  const isPopupVisible = view !== "none";
  const activeOptionId = activeOption ? `${listId}-option-${resolvedActiveIndex}` : undefined;

  /** Resuelve con los resultados visibles, o `null` si falló o quedó obsoleta. */
  function runSearch(searchQuery: string, exact: boolean) {
    const key = getSearchKey(searchQuery);
    const controller = new AbortController();

    abortRef.current?.abort();
    abortRef.current = controller;
    requestIdRef.current += 1;
    requestedKeyRef.current = key;

    const requestId = requestIdRef.current;
    const fetchOptions = fetcher ?? config.defaultFetcher;

    return fetchOptions({
      exact,
      filters: activeFilters,
      limit: ENTITY_AUTOCOMPLETE_LIMIT,
      query: searchQuery,
      signal: controller.signal,
    }).then(
      (items) => {
        if (requestId !== requestIdRef.current) {
          return null;
        }

        const visibleItems = toVisibleOptions(items);

        setSearch({ items: visibleItems, key, status: "success" });
        setActiveIndex(null);
        return visibleItems;
      },
      (searchError: unknown) => {
        if (requestId === requestIdRef.current) {
          setSearch({ error: searchError, key, status: "error" });
        }

        return null;
      },
    );
  }

  const searchDebounced = useEffectEvent((searchQuery: string) => {
    if (disabled || requestedKeyRef.current === getSearchKey(searchQuery)) {
      return;
    }

    void runSearch(searchQuery, false);
  });

  // `query` entra en las dependencias para cubrir el texto que vuelve a un
  // valor ya asentado (ab -> abc -> ab) después de que otra búsqueda lo pisara.
  useEffect(() => {
    if (debouncedQuery === query && hasQuery) {
      searchDebounced(query);
    }
  }, [debouncedQuery, filtersKey, hasQuery, query]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  // Con un valor elegido y el foco en el campo, escribir reemplaza la etiqueta.
  useEffect(() => {
    if (showsValueLabel && document.activeElement === inputRef.current) {
      inputRef.current?.select();
    }
  }, [showsValueLabel, value?.id]);

  useLayoutEffect(() => {
    if (!isPopupVisible) {
      return;
    }

    function updatePosition() {
      const popup = popupRef.current;
      const rect = inputRef.current?.getBoundingClientRect();

      if (!popup || !rect) {
        return;
      }

      const spaceBelow = window.innerHeight - rect.bottom - POPUP_GAP_PX - VIEWPORT_MARGIN_PX;
      const spaceAbove = rect.top - POPUP_GAP_PX - VIEWPORT_MARGIN_PX;
      const opensAbove = spaceBelow < POPUP_MIN_SPACE_BELOW_PX && spaceAbove > spaceBelow;
      const availableSpace = Math.max(opensAbove ? spaceAbove : spaceBelow, 0);

      popup.style.left = `${rect.left}px`;
      popup.style.width = `${rect.width}px`;
      popup.style.maxHeight = `${Math.min(POPUP_MAX_HEIGHT_PX, availableSpace)}px`;
      popup.style.top = opensAbove ? "" : `${rect.bottom + POPUP_GAP_PX}px`;
      popup.style.bottom = opensAbove
        ? `${window.innerHeight - rect.top + POPUP_GAP_PX}px`
        : "";
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isPopupVisible, view, options.length]);

  useEffect(() => {
    if (activeOptionId) {
      document.getElementById(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeOptionId]);

  function resetTypedText() {
    setText("");
    setIsDirty(false);
    setActiveIndex(null);
    pendingEnterRef.current = null;
  }

  function openPopup() {
    setRecents(readEntityRecents(entity, recentsKey));
    setIsOpen(true);
  }

  const closeWithEscape = useEffectEvent(() => {
    setIsOpen(false);
    setActiveIndex(null);

    if (hasValue) {
      resetTypedText();
    }
  });

  // En captura sobre `window`: el Modal (Radix) escucha Escape en `document`
  // y cerraría el diálogo entero antes de que el desplegable pudiera cerrarse.
  useEffect(() => {
    if (!isPopupVisible) {
      return;
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && event.target === inputRef.current) {
        event.stopPropagation();
        closeWithEscape();
      }
    }

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [isPopupVisible]);

  function selectOption(option: EntityOption<K>) {
    if (getDisabledReason(option)) {
      return;
    }

    rememberEntityRecent(entity, option, recentsKey);
    resetTypedText();
    setIsOpen(false);
    onChange(option);
  }

  /** Enter sobre los resultados de `enteredText`: exacto, único o resaltado. */
  function resolveEnter(items: EntityOption<K>[], enteredText: string) {
    const exactMatch = config.findExact(items, enteredText);

    if (exactMatch) {
      selectOption(exactMatch);
      return;
    }

    if (items.length === 0) {
      onNotFound?.(enteredText);
      return;
    }

    const highlighted = items.find((option) => !getDisabledReason(option));

    if (highlighted) {
      selectOption(highlighted);
    }
  }

  function moveActive(direction: 1 | -1) {
    if (options.length === 0) {
      return;
    }

    let index = resolvedActiveIndex;

    for (let step = 0; step < options.length; step += 1) {
      index =
        index < 0 && direction === -1
          ? options.length - 1
          : (index + direction + options.length) % options.length;

      if (!getDisabledReason(options[index])) {
        setActiveIndex(index);
        return;
      }
    }
  }

  function moveActiveToEdge(edge: "first" | "last") {
    const enabledIndexes = options.flatMap((option, index) =>
      getDisabledReason(option) ? [] : [index],
    );
    const target = edge === "first" ? enabledIndexes[0] : enabledIndexes.at(-1);

    if (target !== undefined) {
      setActiveIndex(target);
    }
  }

  function retrySearch() {
    setSearch({ key: currentKey, status: "loading" });
    void runSearch(query, false);
  }

  function handleEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (query === "") {
      if (activeOption) {
        event.preventDefault();
        selectOption(activeOption);
      }

      return;
    }

    // Con texto, Enter nunca envía el formulario: es el final de un escaneo.
    event.preventDefault();

    if (view === "results" && activeIndex !== null && activeOption) {
      selectOption(activeOption);
      return;
    }

    if (isSearchCurrent && search.status === "success") {
      resolveEnter(search.items, query);
      return;
    }

    // Lector de barras: la ráfaga termina antes del debounce; se busca ya.
    setIsOpen(true);
    setSearch({ key: currentKey, status: "loading" });
    pendingEnterRef.current = query;
    void runSearch(query, true).then((items) => {
      // Si el usuario siguió escribiendo, ese Enter ya no aplica.
      if (items && pendingEnterRef.current === query) {
        pendingEnterRef.current = null;
        resolveEnter(items, query);
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();

        if (!isOpen) {
          openPopup();
          return;
        }

        moveActive(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Home":
      case "End":
        if (hasListbox) {
          event.preventDefault();
          moveActiveToEdge(event.key === "Home" ? "first" : "last");
        }

        return;
      case "Enter":
        handleEnter(event);
        return;
      default:
    }
  }

  function handleTextChange(nextText: string) {
    pendingEnterRef.current = null;
    setText(nextText);
    setIsDirty(true);
    setActiveIndex(null);
    setIsOpen(true);
  }

  function handleFocus() {
    openPopup();

    if (showsValueLabel) {
      inputRef.current?.select();
    }
  }

  function handleBlur() {
    setIsOpen(false);
    setActiveIndex(null);

    if (hasValue) {
      resetTypedText();
    } else {
      setIsDirty(false);
    }
  }

  function handleClear() {
    resetTypedText();
    openPopup();
    inputRef.current?.focus();

    if (hasValue) {
      onChange(null);
    }
  }

  function renderOptionSecondary(option: EntityOption<K>) {
    const context = { isRecent: view === "recents" };

    return renderSecondary ? renderSecondary(option, context) : config.getSecondary(option, context);
  }

  const popup = isPopupVisible ? (
    <div
      className={popupClassName}
      data-testid="entity-autocomplete-popup"
      // El foco se queda en el campo: el desplegable se maneja con el teclado
      // y `aria-activedescendant`, y el clic no dispara el blur que lo cierra.
      onMouseDown={(event) => event.preventDefault()}
      ref={popupRef}
    >
      {view === "loading" ? (
        <p className="px-3 py-2 text-muted-foreground" role="status">
          Buscando...
        </p>
      ) : null}

      {view === "empty" ? (
        <p className="px-3 py-2 break-words text-muted-foreground" role="status">
          Sin resultados para “{query}”
        </p>
      ) : null}

      {view === "error" && search.status === "error" ? (
        <div className="space-y-2 px-3 py-2" role="alert">
          <p className={cn("break-words", formHelperErrorClassName, "text-sm")}>
            {getErrorMessage(search.error)}
          </p>
          {isForbiddenError(search.error) ? null : (
            <button
              className="cursor-pointer text-sm font-semibold text-primary underline-offset-2 hover:underline"
              onClick={retrySearch}
              type="button"
            >
              Reintentar
            </button>
          )}
        </div>
      ) : null}

      {hasListbox ? (
        <>
          {view === "recents" ? (
            <p className="px-3 pt-2 pb-1 text-xs font-semibold text-on-surface-variant">
              Recientes
            </p>
          ) : null}
          <ul aria-label={label} className="py-1" id={listId} role="listbox">
            {options.map((option, index) => {
              const disabledReason = getDisabledReason(option);
              const isActive = index === resolvedActiveIndex;
              const secondary = renderOptionSecondary(option);

              return (
                <li
                  aria-disabled={disabledReason ? true : undefined}
                  aria-selected={isActive}
                  className={cn(
                    "flex min-w-0 flex-col px-3 py-2",
                    disabledReason ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    isActive && "bg-surface-container-low",
                  )}
                  id={`${listId}-option-${index}`}
                  key={option.id}
                  onClick={() => selectOption(option)}
                  onMouseMove={() => {
                    if (!disabledReason && index !== resolvedActiveIndex) {
                      setActiveIndex(index);
                    }
                  }}
                  role="option"
                >
                  <span className="truncate font-medium text-foreground">{option.label}</span>
                  {secondary ? (
                    <span className="truncate text-xs text-on-surface-variant">{secondary}</span>
                  ) : null}
                  {disabledReason ? (
                    <span className="text-xs break-words text-muted-foreground">
                      {disabledReason}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  ) : null;

  const showsClearButton = !disabled && (hasValue || text !== "");

  return (
    <div className="w-full min-w-0 space-y-2">
      <label className={formLabelClassName} htmlFor={inputId}>
        {label}
        {required ? " *" : null}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-[1.125rem] -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-activedescendant={hasListbox ? activeOptionId : undefined}
          aria-autocomplete="list"
          aria-controls={hasListbox ? listId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          aria-expanded={hasListbox}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          className={cn(
            formControlClassName,
            "pl-10",
            showsClearButton && "pr-10",
            error && formControlErrorClassName,
          )}
          disabled={disabled}
          id={inputId}
          onBlur={handleBlur}
          onChange={(event) => handleTextChange(event.target.value)}
          onClick={openPopup}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? config.defaultPlaceholder}
          ref={inputRef}
          role="combobox"
          type="text"
          value={displayValue}
        />
        {showsClearButton ? (
          <button
            aria-label={`Limpiar ${label}`}
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-container-low hover:text-foreground"
            onClick={handleClear}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>

      {description ? (
        <p
          className={cn(formHelperClassName, error && formHelperErrorClassName)}
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}

      {popup ? createPortal(popup, document.body) : null}
    </div>
  );
}
