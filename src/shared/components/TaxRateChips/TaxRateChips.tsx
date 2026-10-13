"use client";

import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { type TaxRate, useTaxRates } from "@/shared/hooks/useTaxRates";
import { cn } from "@/shared/utils/cn";

const POPOVER_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;
const OTHER_CODE_PATTERN = /^otro-(\d+(?:\.\d+)?)$/;

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const chipSizeClassName = {
  sm: "h-6 gap-1 px-2 text-xs",
  md: "h-8 gap-1.5 px-3 text-sm",
};

const triggerToneClassName = {
  active:
    "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900",
  inactive:
    "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900",
  empty:
    "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
};

export type TaxRateChipsProps = {
  /** Alícuota de la categoría del producto: se marca "por defecto" en la lista. */
  categoryDefaultCode?: string | null;
  className?: string;
  disabled?: boolean;
  /** Solo con `rates` inyectadas: error de carga del catálogo. */
  error?: Error | null;
  /** Solo con `rates` inyectadas: catálogo en carga. */
  isLoading?: boolean;
  /** Nombre accesible del chip y de la lista. */
  label?: string;
  onChange: (code: string, rate: TaxRate) => void;
  /** Solo con `rates` inyectadas: reintenta la carga del catálogo. */
  onRetry?: () => void;
  /** Catálogo ya cargado (activas e inactivas). Sin esta prop se usa `useTaxRates`. */
  rates?: TaxRate[];
  size?: keyof typeof chipSizeClassName;
  /** Código de la alícuota elegida. */
  value: string | null;
  /** % congelado en la línea: se muestra si `value` ya no está en el catálogo. */
  valuePct?: number | null;
};

type TaxRateChipsViewProps = Omit<TaxRateChipsProps, "rates"> & {
  rates: TaxRate[];
};

/** % en formato español: coma decimal y hasta dos decimales ("16 %", "12,5 %"). */
export function formatTaxRatePct(pct: number) {
  return `${pct.toLocaleString("es-VE", { maximumFractionDigits: 2 })} %`;
}

function parseOtherCodePct(code: string) {
  const match = OTHER_CODE_PATTERN.exec(code);

  return match ? Number(match[1]) : null;
}

function buildChipText(value: string | null, pct: number | null) {
  if (value === null) {
    return "Elegir IVA";
  }

  if (pct === null) {
    return value;
  }

  return pct === 0 ? "Exento" : `IVA ${formatTaxRatePct(pct)}`;
}

type PopoverBounds = { bottom: number; left: number; right: number; top: number };

function resolveBounds(container: HTMLElement | null): PopoverBounds {
  const viewport = {
    bottom: window.innerHeight - VIEWPORT_MARGIN_PX,
    left: VIEWPORT_MARGIN_PX,
    right: window.innerWidth - VIEWPORT_MARGIN_PX,
    top: VIEWPORT_MARGIN_PX,
  };

  if (!container || container === document.body) {
    return viewport;
  }

  // Dentro de un Modal el contenido recorta lo que sobresale: el popover se
  // mantiene dentro de su caja.
  const rect = container.getBoundingClientRect();

  return {
    bottom: Math.min(viewport.bottom, rect.bottom - VIEWPORT_MARGIN_PX),
    left: Math.max(viewport.left, rect.left + VIEWPORT_MARGIN_PX),
    right: Math.min(viewport.right, rect.right - VIEWPORT_MARGIN_PX),
    top: Math.max(viewport.top, rect.top + VIEWPORT_MARGIN_PX),
  };
}

function TaxRateChipsView({
  categoryDefaultCode,
  className,
  disabled = false,
  error,
  isLoading = false,
  label = "Alícuota de IVA",
  onChange,
  onRetry,
  rates,
  size = "sm",
  value,
  valuePct,
}: TaxRateChipsViewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const popoverId = useId();

  const activeRates = rates.filter((rate) => rate.isActive);
  const selectedRate = value === null ? null : (rates.find((rate) => rate.code === value) ?? null);
  const isInactiveValue = value !== null && !selectedRate?.isActive;
  const defaultCode =
    categoryDefaultCode ?? activeRates.find((rate) => rate.isDefault)?.code ?? null;
  const displayPct =
    value === null ? null : (selectedRate?.pct ?? valuePct ?? parseOtherCodePct(value));
  const chipText = buildChipText(value, displayPct);
  const isPopoverOpen = isOpen && !disabled;
  const activeRateCount = activeRates.length;

  function closePopover({ restoreFocus }: { restoreFocus: boolean }) {
    setIsOpen(false);

    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }

  function openPopover() {
    const selectedIndex = activeRates.findIndex((rate) => rate.code === value);
    const defaultIndex = activeRates.findIndex((rate) => rate.code === defaultCode);

    // Un popover montado en `body` quedaría fuera de la trampa de foco del
    // Modal (Radix) y cerraría el diálogo al pulsarlo: se monta dentro de él.
    setPortalContainer(
      triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
    );
    setActiveIndex(Math.max(selectedIndex >= 0 ? selectedIndex : defaultIndex, 0));
    setIsOpen(true);
  }

  function selectRate(rate: TaxRate) {
    closePopover({ restoreFocus: true });

    if (rate.code !== value) {
      onChange(rate.code, rate);
    }
  }

  function focusRadio(index: number) {
    setActiveIndex(index);
    radioRefs.current[index]?.focus();
  }

  function handleRadioGroupKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      // El popover vive en un portal, fuera del orden de tabulación de la
      // página: Tab lo cierra y deja el foco en el chip.
      event.preventDefault();
      closePopover({ restoreFocus: true });
      return;
    }

    const nextIndexByKey: Record<string, number> = {
      ArrowDown: (activeIndex + 1) % activeRateCount,
      ArrowLeft: (activeIndex - 1 + activeRateCount) % activeRateCount,
      ArrowRight: (activeIndex + 1) % activeRateCount,
      ArrowUp: (activeIndex - 1 + activeRateCount) % activeRateCount,
      End: activeRateCount - 1,
      Home: 0,
    };
    const nextIndex = nextIndexByKey[event.key];

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    focusRadio(nextIndex);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" && !isPopoverOpen) {
      event.preventDefault();
      openPopover();
    }
  }

  useEffect(() => {
    if (!isPopoverOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    // En captura sobre `window`: se adelanta al Modal para que Esc cierre solo
    // el popover y no el diálogo que lo contiene.
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [isPopoverOpen]);

  useLayoutEffect(() => {
    if (!isPopoverOpen) {
      return;
    }

    function updatePosition() {
      const popover = popoverRef.current;
      const trigger = triggerRef.current?.getBoundingClientRect();

      if (!popover || !trigger) {
        return;
      }

      // Un ancestro con `transform` (el Modal centrado) pasa a ser el bloque
      // contenedor de `position: fixed`: se descuenta su origen.
      const current = popover.getBoundingClientRect();
      const originLeft = current.left - (parseFloat(popover.style.left) || 0);
      const originTop = current.top - (parseFloat(popover.style.top) || 0);
      const bounds = resolveBounds(popover.parentElement);
      const below = trigger.bottom + POPOVER_GAP_PX;
      const above = trigger.top - POPOVER_GAP_PX - current.height;
      const fitsBelow = below + current.height <= bounds.bottom;
      const top = fitsBelow || above < bounds.top ? below : above;
      const left = Math.max(
        bounds.left,
        Math.min(trigger.left, bounds.right - current.width),
      );

      popover.style.left = `${left - originLeft}px`;
      popover.style.top = `${top - originTop}px`;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isPopoverOpen, activeRateCount]);

  useEffect(() => {
    if (isPopoverOpen) {
      radioRefs.current[activeIndex]?.focus();
    }
    // Solo al abrir: después el foco lo mueven las flechas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPopoverOpen]);

  if (isLoading) {
    return (
      <span
        aria-label={`Cargando ${label}`}
        className={cn(
          "inline-block w-16 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800",
          size === "sm" ? "h-6" : "h-8",
          className,
        )}
        role="status"
      />
    );
  }

  if (error) {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center rounded-full bg-red-50 font-medium text-red-700 dark:bg-red-950 dark:text-red-300",
          chipSizeClassName[size],
          className,
        )}
        role="alert"
      >
        <AlertTriangle aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 truncate" title={error.message}>
          {error.message}
        </span>
        {onRetry ? (
          <button
            className={cn(
              "shrink-0 cursor-pointer rounded-full font-semibold underline underline-offset-2",
              focusRingClassName,
            )}
            onClick={onRetry}
            type="button"
          >
            Reintentar
          </button>
        ) : null}
      </span>
    );
  }

  const popover = isPopoverOpen ? (
    <div
      aria-label={label}
      className="pointer-events-auto fixed top-0 left-0 z-50 w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900"
      id={popoverId}
      ref={popoverRef}
      role="dialog"
    >
      {activeRateCount === 0 ? (
        <p className="px-1 text-xs text-slate-600 dark:text-slate-300">
          No hay alícuotas activas.
        </p>
      ) : (
        <div
          aria-label={label}
          className="flex flex-wrap gap-1.5"
          onKeyDown={handleRadioGroupKeyDown}
          role="radiogroup"
        >
          {activeRates.map((rate, index) => {
            const isSelected = rate.code === value;

            return (
              <button
                aria-checked={isSelected}
                className={cn(
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  focusRingClassName,
                  isSelected
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
                    : triggerToneClassName.empty,
                )}
                key={rate.code}
                onClick={() => selectRate(rate)}
                onFocus={() => setActiveIndex(index)}
                ref={(element) => {
                  radioRefs.current[index] = element;
                }}
                role="radio"
                tabIndex={index === activeIndex ? 0 : -1}
                type="button"
              >
                {isSelected ? <Check aria-hidden className="size-3 shrink-0" /> : null}
                <span>
                  {rate.label} {formatTaxRatePct(rate.pct)}
                </span>
                {rate.code === defaultCode ? (
                  <span className="rounded-full border border-current px-1.5 text-[0.6875rem] leading-4">
                    por defecto
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  return (
    <span className={cn("inline-flex max-w-full align-middle", className)}>
      <button
        aria-controls={isPopoverOpen ? popoverId : undefined}
        aria-expanded={isPopoverOpen}
        aria-haspopup="dialog"
        aria-label={`${label}: ${chipText}${isInactiveValue ? " (inactiva)" : ""}`}
        className={cn(
          "inline-flex max-w-full cursor-pointer items-center rounded-full border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          focusRingClassName,
          chipSizeClassName[size],
          triggerToneClassName[
            value === null ? "empty" : isInactiveValue ? "inactive" : "active"
          ],
        )}
        disabled={disabled}
        onClick={() => (isPopoverOpen ? closePopover({ restoreFocus: false }) : openPopover())}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className="truncate">{chipText}</span>
        {isInactiveValue ? <span className="font-normal">· inactiva</span> : null}
        <ChevronDown aria-hidden className="size-3 shrink-0" />
      </button>
      {popover && portalContainer ? createPortal(popover, portalContainer) : null}
    </span>
  );
}

function ConnectedTaxRateChips(props: Omit<TaxRateChipsProps, "rates">) {
  // Catálogo completo: hace falta el % de una alícuota desactivada para
  // mostrar las líneas antiguas; la lista solo ofrece las activas.
  const { error, isLoading, rates, refetch } = useTaxRates({ activeOnly: false });

  return (
    <TaxRateChipsView
      {...props}
      error={error}
      isLoading={isLoading}
      onRetry={() => void refetch()}
      rates={rates}
    />
  );
}

export function TaxRateChips({ rates, ...props }: TaxRateChipsProps) {
  return rates ? (
    <TaxRateChipsView {...props} rates={rates} />
  ) : (
    <ConnectedTaxRateChips {...props} />
  );
}
