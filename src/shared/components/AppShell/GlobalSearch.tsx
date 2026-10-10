"use client";

import { Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useGlobalSearch } from "@/modules/search/hooks/useGlobalSearch";
import {
  GLOBAL_SEARCH_MAX_LENGTH,
  GLOBAL_SEARCH_MIN_LENGTH,
  type GlobalSearchGroup,
  globalSearchPermissions,
  type GlobalSearchResults,
} from "@/modules/search/types";
import type { Permission } from "@/shared/auth/permissions";
import {
  SCANNER_BURST_KEY_GAP_MS,
  SCANNER_FAST_KEY_GAP_MS,
} from "@/shared/components/ConfirmActionModal/useScannerBurstGuard";
import { IconButton } from "@/shared/components/IconButton";
import { useProcessGuard } from "@/shared/components/ProcessGuard";
import type { ContactType } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd } from "@/shared/utils/currency";

/**
 * Espera entre la tecla `/` y el foco. Un lector de códigos manda la tecla
 * siguiente antes de que venza: entonces `/` era parte de una lectura y el atajo
 * no actúa.
 */
export const GLOBAL_SEARCH_SHORTCUT_SETTLE_MS = SCANNER_FAST_KEY_GAP_MS + 10;

const GROUP_ORDER: readonly GlobalSearchGroup[] = ["products", "sales", "purchases", "contacts"];

const GROUP_LABELS: Record<GlobalSearchGroup, string> = {
  contacts: "Contactos",
  products: "Productos",
  purchases: "Compras",
  sales: "Ventas",
};

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  ambos: "Cliente y proveedor",
  cliente: "Cliente",
  proveedor: "Proveedor",
};

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
].join(",");

const OPEN_MODAL_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  "dialog[open]",
].join(",");

type SearchOption = {
  group: GlobalSearchGroup;
  href: string;
  /** Coincide entero con lo escrito: código de barras, SKU, número de documento o id. */
  isExact: boolean;
  /** Coincide con lo escrito por código de barras. */
  isExactBarcode: boolean;
  key: string;
  primary: string;
  secondary: string;
};

function joinParts(parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}

function buildOptions(results: GlobalSearchResults, term: string): SearchOption[] {
  const lowered = term.toLowerCase();
  const equals = (value: string | null | undefined) => (value ?? "").toLowerCase() === lowered;

  const byGroup: Record<GlobalSearchGroup, SearchOption[]> = {
    contacts: results.contacts.map((contact) => ({
      group: "contacts",
      href: `/contacts/${encodeURIComponent(contact.id)}`,
      isExact: equals(contact.id) || equals(contact.taxId),
      isExactBarcode: false,
      key: `contacts-${contact.id}`,
      primary: contact.name,
      secondary: joinParts([CONTACT_TYPE_LABELS[contact.type], contact.taxId]),
    })),
    products: results.products.map((product) => {
      const isExactBarcode = Boolean(product.barcode) && product.barcode?.trim() === term;

      return {
        group: "products",
        href: `/products/${encodeURIComponent(product.id)}`,
        isExact: isExactBarcode || equals(product.sku) || equals(product.id),
        isExactBarcode,
        key: `products-${product.id}`,
        primary: product.name,
        secondary: joinParts([`SKU ${product.sku}`, product.barcode]),
      };
    }),
    purchases: results.purchases.map((purchase) => ({
      group: "purchases",
      href: `/purchases/${encodeURIComponent(purchase.id)}`,
      isExact: equals(purchase.number) || equals(purchase.id),
      isExactBarcode: false,
      key: `purchases-${purchase.id}`,
      primary: purchase.number,
      secondary: joinParts([purchase.supplierName, formatRefUsd(purchase.totalRef)]),
    })),
    sales: results.sales.map((sale) => ({
      group: "sales",
      href: `/sales/${encodeURIComponent(sale.id)}`,
      isExact: equals(sale.number) || equals(sale.id),
      isExactBarcode: false,
      key: `sales-${sale.id}`,
      primary: sale.number,
      secondary: joinParts([sale.customerName, formatRefUsd(sale.totalRef)]),
    })),
  };

  return GROUP_ORDER.flatMap((group) => byGroup[group]);
}

/**
 * Destino de un Enter sin opción resaltada: el único producto con ese código de
 * barras o, sin él, la única coincidencia exacta. Con varias o ninguna no se
 * elige a ciegas.
 */
function findDirectHit(options: SearchOption[]): SearchOption | undefined {
  const byBarcode = options.filter((option) => option.isExactBarcode);

  if (byBarcode.length === 1) {
    return byBarcode[0];
  }

  const exact = options.filter((option) => option.isExact);

  return exact.length === 1 ? exact[0] : undefined;
}

function isEditable(node: EventTarget | null) {
  return node instanceof Element && node.closest(EDITABLE_SELECTOR) !== null;
}

function hasOpenModal() {
  return Array.from(document.querySelectorAll(OPEN_MODAL_SELECTOR)).some(
    (element) => element.closest("[hidden]") === null,
  );
}

type GlobalSearchProps = {
  className?: string;
  /** Permisos efectivos del usuario: sin ninguno de los de búsqueda no se muestra. */
  permissions: readonly Permission[];
};

/**
 * Buscador global del header: producto (código de barras, SKU, nombre), venta y
 * compra por número y contacto. `/` lo enfoca, flechas y Enter eligen, `Esc`
 * cierra y devuelve el foco. Navega con `guardedNavigate`, así que respeta el
 * guardia de un proceso a medias.
 */
export function GlobalSearch({ className, permissions }: GlobalSearchProps) {
  const canSearch = Object.values(globalSearchPermissions).some((permission) =>
    permissions.includes(permission),
  );

  return canSearch ? <GlobalSearchField className={className} /> : null;
}

function GlobalSearchField({ className }: { className?: string }) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Término con un Enter pendiente de sus resultados (lector de códigos: Enter llega antes). */
  const pendingEnterRef = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const { flush, isError, isLoading, isTooShort, results, term } = useGlobalSearch(text);
  // Sin proceso propio que proteger: solo respeta a otro guardia activo en la pantalla.
  const { guardedNavigate } = useProcessGuard({
    active: false,
    label: "Búsqueda global",
    onLeave: "discard",
  });

  const options = useMemo(() => (results ? buildOptions(results, term) : []), [results, term]);
  const activeIndex = options.findIndex((option) => option.key === activeKey);
  const showsList = isPanelOpen && options.length > 0;

  function reset() {
    pendingEnterRef.current = null;
    setText("");
    setActiveKey(null);
    setIsPanelOpen(false);
    setIsMobileOpen(false);
  }

  function goTo(option: SearchOption) {
    reset();
    inputRef.current?.blur();
    guardedNavigate(option.href);
  }

  function open() {
    const focused = document.activeElement;

    returnFocusRef.current =
      focused instanceof HTMLElement && focused !== document.body && focused !== inputRef.current
        ? focused
        : null;
    // En móvil el campo está oculto hasta abrirlo: hay que pintarlo antes de enfocarlo.
    flushSync(() => setIsMobileOpen(true));
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  function closeAndReturnFocus() {
    const target = returnFocusRef.current;

    returnFocusRef.current = null;
    reset();

    if (target?.isConnected) {
      target.focus();
    } else {
      inputRef.current?.blur();
    }
  }

  const openRef = useRef(open);
  const goToRef = useRef(goTo);

  useEffect(() => {
    openRef.current = open;
    goToRef.current = goTo;
  });

  // Enter que llegó antes que sus resultados: se resuelve cuando llegan.
  useEffect(() => {
    if (!results || pendingEnterRef.current !== term) {
      return;
    }

    pendingEnterRef.current = null;

    const hit = findDirectHit(options);

    if (hit) {
      goToRef.current(hit);
    }
  }, [options, results, term]);

  // Atajo `/` desde cualquier pantalla.
  useEffect(() => {
    let lastCharacterAt = 0;
    let settleTimer: number | null = null;

    function cancelSettle() {
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const now = Date.now();
      const sinceLastCharacter = now - lastCharacterAt;
      const isCharacter = event.key.length === 1;

      if (isCharacter) {
        lastCharacterAt = now;
      }

      // Otra tecla pegada a la `/`: era una lectura del lector, no el atajo.
      if (settleTimer !== null && (isCharacter || event.key === "Enter" || event.key === "Tab")) {
        cancelSettle();
        return;
      }

      if (event.key !== "/" || event.repeat || event.isComposing) {
        return;
      }

      // Con el foco donde se escribe (buscador del POS incluido) o con un modal abierto, `/` es texto.
      if (isEditable(event.target) || isEditable(document.activeElement) || hasOpenModal()) {
        return;
      }

      // Dentro de una ráfaga del lector: la `/` es un carácter más del código.
      if (sinceLastCharacter < SCANNER_BURST_KEY_GAP_MS) {
        return;
      }

      // Evita la búsqueda rápida del navegador; no se detiene la propagación.
      event.preventDefault();
      settleTimer = window.setTimeout(() => {
        settleTimer = null;

        if (!isEditable(document.activeElement) && !hasOpenModal()) {
          openRef.current();
        }
      }, GLOBAL_SEARCH_SHORTCUT_SETTLE_MS);
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      cancelSettle();
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  function moveActive(step: 1 | -1) {
    if (options.length === 0) {
      return;
    }

    const next =
      activeIndex === -1
        ? step === 1
          ? 0
          : options.length - 1
        : (activeIndex + step + options.length) % options.length;

    setIsPanelOpen(true);
    setActiveKey(options[next].key);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndReturnFocus();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    if (activeIndex !== -1) {
      goTo(options[activeIndex]);
      return;
    }

    if (isTooShort) {
      return;
    }

    if (!results) {
      pendingEnterRef.current = term;
      flush();
      return;
    }

    const hit = findDirectHit(options);

    if (hit) {
      goTo(hit);
    }
  }

  return (
    <div className={cn("flex min-w-0 items-center sm:max-w-md sm:flex-1", className)}>
      <IconButton
        aria-label="Abrir búsqueda"
        className="shrink-0 text-foreground hover:bg-surface-container hover:text-primary sm:hidden"
        icon={<Search className="h-5 w-5" />}
        onClick={open}
        variant="ghost"
      />

      <div
        className={cn(
          isMobileOpen
            ? "absolute inset-x-0 top-0 z-50 flex h-16 items-center gap-2 bg-surface px-4"
            : "hidden",
          "sm:relative sm:inset-auto sm:z-auto sm:flex sm:h-auto sm:w-full sm:bg-transparent sm:px-0",
        )}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-[1.125rem] -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-activedescendant={
              showsList && activeIndex !== -1 ? `${baseId}-option-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={showsList ? listId : undefined}
            aria-expanded={showsList}
            aria-keyshortcuts="/"
            aria-label="Búsqueda global"
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-border bg-surface-container-lowest pr-10 pl-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            enterKeyHint="search"
            maxLength={GLOBAL_SEARCH_MAX_LENGTH}
            onBlur={() => {
              setIsPanelOpen(false);
              setIsMobileOpen(false);
            }}
            onChange={(event) => {
              pendingEnterRef.current = null;
              setText(event.target.value);
              setActiveKey(null);
              setIsPanelOpen(true);
            }}
            onFocus={() => setIsPanelOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder="Buscar producto, factura, compra o contacto"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="text"
            value={text}
          />
          <kbd
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-border bg-surface-container px-1.5 text-xs font-medium text-muted-foreground sm:block"
          >
            /
          </kbd>
        </div>

        <IconButton
          aria-label="Cerrar búsqueda"
          className="shrink-0 text-foreground hover:bg-surface-container hover:text-primary sm:hidden"
          icon={<X className="h-5 w-5" />}
          // El foco no sale del campo antes del clic: así cerrar lo devuelve a donde estaba.
          onMouseDown={(event) => event.preventDefault()}
          onClick={closeAndReturnFocus}
          variant="ghost"
        />

        {isPanelOpen && (
          <div className="absolute inset-x-2 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface-container-lowest text-sm shadow-lg sm:inset-x-0">
            {isTooShort ? (
              <p className="px-3 py-2 text-muted-foreground" role="status">
                Escribe al menos {GLOBAL_SEARCH_MIN_LENGTH} caracteres
              </p>
            ) : isError ? (
              <p className="px-3 py-2 text-red-600 dark:text-red-400" role="alert">
                No se pudo buscar. Intenta de nuevo.
              </p>
            ) : isLoading ? (
              <p className="px-3 py-2 text-muted-foreground" role="status">
                Buscando…
              </p>
            ) : options.length === 0 ? (
              <p className="px-3 py-2 break-words text-muted-foreground" role="status">
                Sin resultados para &quot;{term}&quot;
              </p>
            ) : (
              <div aria-label="Resultados de la búsqueda" className="py-1" id={listId} role="listbox">
                {GROUP_ORDER.map((group) => {
                  const groupOptions = options.filter((option) => option.group === group);

                  if (groupOptions.length === 0) {
                    return null;
                  }

                  const labelId = `${baseId}-group-${group}`;

                  return (
                    <div aria-labelledby={labelId} key={group} role="group">
                      <p
                        className="px-3 pt-2 pb-1 text-xs font-semibold text-on-surface-variant"
                        id={labelId}
                      >
                        {GROUP_LABELS[group]}
                      </p>
                      {groupOptions.map((option) => {
                        const index = options.indexOf(option);
                        const isActive = index === activeIndex;

                        return (
                          <div
                            aria-selected={isActive}
                            className={cn(
                              "flex min-w-0 cursor-pointer flex-col px-3 py-2",
                              isActive && "bg-surface-container-low",
                            )}
                            id={`${baseId}-option-${index}`}
                            key={option.key}
                            onClick={() => goTo(option)}
                            // El clic no le quita el foco al campo: la lista no se cierra antes de elegir.
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseMove={() => {
                              if (!isActive) {
                                setActiveKey(option.key);
                              }
                            }}
                            role="option"
                          >
                            <span className="truncate font-medium text-foreground">
                              {option.primary}
                            </span>
                            {option.secondary && (
                              <span className="truncate text-xs text-on-surface-variant">
                                {option.secondary}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
