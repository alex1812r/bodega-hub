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
import {
  entityConfig,
  type EntityOptionSource,
  type EntitySecondaryContext,
} from "./entityConfig";
import { readEntityRecents, rememberEntityRecent } from "./entityRecents";

export const ENTITY_AUTOCOMPLETE_LIMIT = 8;
export const ENTITY_AUTOCOMPLETE_DEBOUNCE_MS = 250;
export const ENTITY_AUTOCOMPLETE_MIN_QUERY_LENGTH = 2;

const FALLBACK_ERROR_MESSAGE = "No se pudo completar la búsqueda.";
const POPUP_GAP_PX = 4;
const POPUP_MAX_HEIGHT_PX = 320;
const POPUP_MIN_SPACE_BELOW_PX = 180;
const VIEWPORT_MARGIN_PX = 8;

// `right-auto m-0 p-0` anulan los estilos de navegador de `[popover]`.
const popupClassName =
  "pointer-events-auto fixed right-auto z-50 m-0 overflow-y-auto rounded-lg border border-border bg-surface-container-lowest p-0 text-sm shadow-lg";

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
  /**
   * Enter sin ningún resultado para el texto escrito o leído. También recibe
   * el código de un escaneo que no terminó en una elección (sin coincidencia
   * exacta o con error de búsqueda) cuando el campo ya está en otro escaneo y
   * no puede mostrarlo, o cuando lo estaba mostrando y el siguiente escaneo lo
   * reemplaza sin que el usuario haya elegido, limpiado ni editado el texto.
   */
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

type ScanOutcome<K extends EntityKind> = { error: unknown } | { items: EntityOption<K>[] };

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
  const abortRef = useRef<AbortController | null>(null);
  // Cambia cada vez que el campo pasa a otra cosa: un escaneo que responde
  // con otro valor ya no puede tocar el texto ni el desplegable.
  const fieldEpochRef = useRef(0);
  // Valor de `fieldEpochRef` cuando llegaron los resultados a la vista: si el
  // texto cambió después, el usuario no ha podido verlos para ese texto.
  const resultsEpochRef = useRef(0);
  // Código de un escaneo devuelto al campo sin avisar (con su lista o su
  // error) mientras el usuario no haya hecho nada con él: si el siguiente
  // escaneo lo reemplaza, se avisa con `onNotFound`.
  const shownScanRef = useRef<string | null>(null);
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scanControllersRef = useRef(new Set<AbortController>());
  const callbacksRef = useRef({ onChange, onNotFound });

  const [text, setText] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [recents, setRecents] = useState<EntityOption<K>[]>([]);
  const [search, setSearch] = useState<SearchState<K>>({ key: "", status: "idle" });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [pendingScans, setPendingScans] = useState(0);
  const [restoredScans, setRestoredScans] = useState(0);

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

  function toVisibleOptions(options: EntityOption<K>[], source: EntityOptionSource) {
    return options
      .filter((option) => config.matchesFilters(option, activeFilters, source))
      .slice(0, ENTITY_AUTOCOMPLETE_LIMIT);
  }

  function getDisabledReason(option: EntityOption<K>) {
    return getOptionDisabled?.(option) || null;
  }

  const currentKey = getSearchKey(query);
  const isSearchCurrent = search.key === currentKey;
  const visibleRecents = toVisibleOptions(recents, "recents");

  let view: PopupView = "none";
  let options: EntityOption<K>[] = [];

  if (isOpen && !disabled) {
    if (query === "" && pendingScans > 0) {
      view = "loading";
    } else if (query === "") {
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

        const visibleItems = toVisibleOptions(items, "results");

        setSearch({ items: visibleItems, key, status: "success" });
        setActiveIndex(null);
        resultsEpochRef.current = fieldEpochRef.current;
        shownScanRef.current = null;
        return visibleItems;
      },
      (searchError: unknown) => {
        if (requestId === requestIdRef.current) {
          setSearch({ error: searchError, key, status: "error" });
          shownScanRef.current = null;
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

  useEffect(() => {
    const scanControllers = scanControllersRef.current;

    return () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
      scanControllers.forEach((controller) => controller.abort());
    };
  }, []);

  // Un escaneo lento avisa con los callbacks del render vigente, no con los
  // del render en el que se pulsó Enter.
  useLayoutEffect(() => {
    callbacksRef.current = { onChange, onNotFound };
  });

  // El texto de un escaneo sin resolver vuelve seleccionado: el siguiente
  // escaneo lo reemplaza en vez de escribirse a continuación. En el mismo
  // commit que el texto: entre ambos no cabe la primera tecla de ese escaneo.
  useLayoutEffect(() => {
    if (restoredScans > 0) {
      inputRef.current?.select();
    }
  }, [restoredScans]);

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

      // Dentro de un diálogo se sube a la capa superior del navegador: sigue
      // siendo descendiente del diálogo, pero ni su `overflow` lo recorta ni
      // su `translate` cambia el origen de `position: fixed`.
      if (
        popup.parentElement !== document.body &&
        typeof popup.showPopover === "function" &&
        !popup.matches(":popover-open")
      ) {
        popup.setAttribute("popover", "manual");
        popup.showPopover();
      }

      const left = rect.left;
      const top = rect.bottom + POPUP_GAP_PX;
      const bottom = window.innerHeight - rect.top + POPUP_GAP_PX;

      popup.style.left = `${left}px`;
      popup.style.width = `${rect.width}px`;
      popup.style.maxHeight = `${Math.min(POPUP_MAX_HEIGHT_PX, availableSpace)}px`;
      // `auto` explícito: `[popover]` trae `inset: 0` del navegador.
      popup.style.top = opensAbove ? "auto" : `${top}px`;
      popup.style.bottom = opensAbove ? `${bottom}px` : "auto";

      // Sin capa superior (navegador sin Popover API), un diálogo con
      // `translate` o `transform` es el bloque contenedor de `fixed`: se mide
      // el desfase real y se compensa.
      const placed = popup.getBoundingClientRect();
      const shiftLeft = placed.left - left;
      const shiftY = opensAbove ? placed.bottom - (rect.top - POPUP_GAP_PX) : placed.top - top;

      if (Math.abs(shiftLeft) >= 1) {
        popup.style.left = `${left - shiftLeft}px`;
      }

      if (Math.abs(shiftY) >= 1) {
        if (opensAbove) {
          popup.style.bottom = `${bottom + shiftY}px`;
        } else {
          popup.style.top = `${top - shiftY}px`;
        }
      }
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
    fieldEpochRef.current += 1;
  }

  function showPopup() {
    // Montado en `body`, el bloqueo de scroll del Modal (Radix) cancela la
    // rueda y el arrastre táctil sobre la lista: dentro de un diálogo el
    // desplegable se monta en él.
    setPortalContainer(
      inputRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
    );
    setIsOpen(true);
  }

  function openPopup() {
    setRecents(readEntityRecents(entity, recentsKey));
    showPopup();
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

  /**
   * Una elección explícita del usuario (opción resaltada, clic o limpiar) gana
   * a los escaneos que aún no respondieron: se descartan sin avisar.
   */
  function cancelPendingScans() {
    scanControllersRef.current.forEach((controller) => controller.abort());
    scanControllersRef.current.clear();
    setPendingScans(0);
  }

  function selectOption(option: EntityOption<K>, isUserChoice: boolean) {
    if (getDisabledReason(option)) {
      return;
    }

    if (isUserChoice) {
      cancelPendingScans();
    }

    shownScanRef.current = null;
    rememberEntityRecent(entity, option, recentsKey);
    resetTypedText();
    setIsOpen(false);
    onChange(option);
  }

  /**
   * Enter sobre los resultados ya cargados de `enteredText`: elige la
   * coincidencia exacta de código. La opción resaltada solo se elige si el
   * usuario ya tenía la lista a la vista para ese texto; si no (lista cerrada,
   * o texto reescrito por otro escaneo del mismo código), la lista se abre
   * para que decida: una coincidencia a medias no se elige a ciegas.
   */
  function resolveEnter(
    items: EntityOption<K>[],
    enteredText: string,
    wasListVisible: boolean,
  ) {
    const exactMatch = config.findExact(items, enteredText);

    if (exactMatch) {
      selectOption(exactMatch, false);
      return;
    }

    if (items.length === 0) {
      onNotFound?.(enteredText);
      return;
    }

    if (!wasListVisible) {
      showPopup();
      return;
    }

    const highlighted = items.find((option) => !getDisabledReason(option));

    if (highlighted) {
      selectOption(highlighted, true);
    }
  }

  /**
   * Cierra un escaneo: elige la coincidencia exacta de código o, sin ella,
   * devuelve el texto al campo con sus resultados (o su error). Si el campo ya
   * está en otro escaneo, avisa con `onNotFound` y el código de este; si vuelve
   * al campo sin avisar, queda anotado por si el siguiente escaneo lo reemplaza.
   */
  function settleScan(code: string, outcome: ScanOutcome<K>, isFieldUnchanged: boolean) {
    const callbacks = callbacksRef.current;
    const exactMatch = "items" in outcome ? config.findExact(outcome.items, code) : undefined;

    if (exactMatch && !getDisabledReason(exactMatch)) {
      rememberEntityRecent(entity, exactMatch, recentsKey);

      if (isFieldUnchanged) {
        resetTypedText();
        setIsOpen(false);
      }

      callbacks.onChange(exactMatch);
      return;
    }

    const canShowInField = isFieldUnchanged && document.activeElement === inputRef.current;
    const hasNoResults = "items" in outcome && outcome.items.length === 0;

    if (canShowInField) {
      const key = getSearchKey(code);

      abortRef.current?.abort();
      requestIdRef.current += 1;
      requestedKeyRef.current = key;
      setSearch(
        "items" in outcome
          ? { items: outcome.items, key, status: "success" }
          : { error: outcome.error, key, status: "error" },
      );
      setText(code);
      setIsDirty(true);
      setActiveIndex(null);
      resultsEpochRef.current = fieldEpochRef.current;
      showPopup();
      setRestoredScans((count) => count + 1);
      shownScanRef.current = hasNoResults ? null : code;
    }

    if (!canShowInField || hasNoResults) {
      callbacks.onNotFound?.(code);
    }
  }

  /**
   * Lector de barras: la ráfaga termina antes del debounce. Cada Enter captura
   * su texto, libera el campo para el siguiente escaneo y busca ya, con su
   * propia petición; las respuestas se atienden en el orden de los Enter.
   * Teclear o borrar después no lo cancela; elegir una opción o limpiar, sí.
   *
   * Si reemplaza a un escaneo anterior que seguía a la vista en el campo sin
   * que el usuario decidiera nada, ese código se avisa con `onNotFound`; repetir
   * el mismo código no avisa: este escaneo decide por los dos.
   */
  function startScan(code: string) {
    const controller = new AbortController();
    const fetchOptions = fetcher ?? config.defaultFetcher;
    const replacedScan = shownScanRef.current;

    shownScanRef.current = null;

    if (replacedScan !== null && replacedScan !== code) {
      onNotFound?.(replacedScan);
    }

    resetTypedText();
    showPopup();
    setPendingScans((count) => count + 1);
    scanControllersRef.current.add(controller);

    const epoch = fieldEpochRef.current;
    const previousScans = scanQueueRef.current;
    const turn = fetchOptions({
      exact: true,
      filters: activeFilters,
      limit: ENTITY_AUTOCOMPLETE_LIMIT,
      query: code,
      signal: controller.signal,
    })
      .then(
        (items): ScanOutcome<K> => ({ items: toVisibleOptions(items, "results") }),
        (error: unknown): ScanOutcome<K> => ({ error }),
      )
      .then((outcome) => previousScans.then(() => outcome));

    void turn.then((outcome) => {
      scanControllersRef.current.delete(controller);

      // Desmontado o descartado por una elección del usuario: no se avisa.
      if (controller.signal.aborted) {
        return;
      }

      setPendingScans((count) => count - 1);
      settleScan(code, outcome, epoch === fieldEpochRef.current);
    });
    scanQueueRef.current = turn.then(() => undefined);
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
        selectOption(activeOption, true);
      } else if (pendingScans > 0) {
        // El campo está vacío porque hay escaneos sin responder: un Enter
        // repetido (sufijo CR LF del lector) tampoco envía el formulario.
        event.preventDefault();
      }

      return;
    }

    // Con texto, Enter nunca envía el formulario: es el final de un escaneo.
    event.preventDefault();

    if (view === "results" && activeIndex !== null && activeOption) {
      selectOption(activeOption, true);
      return;
    }

    if (isSearchCurrent && search.status === "success") {
      resolveEnter(
        search.items,
        query,
        view === "results" && resultsEpochRef.current === fieldEpochRef.current,
      );
      return;
    }

    startScan(query);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { selectionEnd, selectionStart, value: fieldText } = event.currentTarget;

    // El lector escribe sobre el texto seleccionado de un escaneo devuelto al
    // campo y lo reemplaza entero. Una tecla con la selección deshecha es el
    // usuario corrigiéndolo a mano: ya lo vio y no se avisará por él.
    if (
      event.key !== "Enter" &&
      shownScanRef.current === fieldText &&
      (selectionStart !== 0 || selectionEnd !== fieldText.length)
    ) {
      shownScanRef.current = null;
    }

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
    if (nextText === "") {
      shownScanRef.current = null;
    }

    fieldEpochRef.current += 1;
    setText(nextText);
    setIsDirty(true);
    setActiveIndex(null);
    showPopup();
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
    shownScanRef.current = null;
    cancelPendingScans();
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
                  onClick={() => selectOption(option, true)}
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

      {popup && portalContainer ? createPortal(popup, portalContainer) : null}
    </div>
  );
}
