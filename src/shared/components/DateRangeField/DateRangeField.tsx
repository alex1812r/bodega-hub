"use client";

import { getCaracasIsoDate } from "@bodega/core/dates";
import { CalendarDays, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/shared/utils/cn";

import {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_LABELS,
  type DateRange,
  type DateRangeChange,
  type DateRangePreset,
  type DateRangeValue,
  findMatchingRelativePreset,
  formatDateRangeLabel,
  resolveDateRangePreset,
} from "./dateRangePresets";
import { DATE_RANGE_COLOR_CLASSES } from "./dateRangeTheme";
import { parseDateRangeParams } from "./dateRangeUrl";
import { RangeCalendar } from "./RangeCalendar";

const POPOVER_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;
const DEFAULT_LABEL = "Rango de fechas";

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const chipSizeClassName = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-3.5 text-sm",
};

export type DateRangeFieldProps = {
  /** Rango actual. Con solo `preset` relativo (sin fechas) se resuelve con `today`. */
  value: DateRangeValue;
  /** Rango elegido: `from` / `to` en `YYYY-MM-DD`, ambos incluidos. */
  onChange: (next: DateRangeChange) => void;
  /** Día operativo `YYYY-MM-DD`. Por defecto, hoy en Caracas. */
  today?: string;
  /** Chips que se muestran, en este orden. Por defecto, todos. */
  presets?: readonly DateRangePreset[];
  /** Primer día elegible en el calendario. */
  minDate?: string;
  /** Último día elegible en el calendario (p. ej. `today` para impedir días futuros). */
  maxDate?: string;
  /** Muestra el botón que deja el campo sin rango. */
  clearable?: boolean;
  /** Etiqueta visible. Sin ella el grupo se anuncia como "Rango de fechas". */
  label?: string;
  disabled?: boolean;
  size?: keyof typeof chipSizeClassName;
  className?: string;
};

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

/**
 * Filtro de rango de fechas en día operativo Caracas: chips de preset (un clic
 * emite el rango ya calculado) y "Personalizado" con calendario propio.
 *
 * Es controlado y no toca la URL: para guardarlo en ella usa
 * `parseDateRangeParams` y `serializeDateRange` con `useUrlListState`.
 */
export function DateRangeField({
  className,
  clearable = false,
  disabled = false,
  label,
  maxDate,
  minDate,
  onChange,
  presets = DATE_RANGE_PRESETS,
  size = "md",
  today,
  value,
}: DateRangeFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const customChipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const popoverId = useId();

  const businessToday = today ?? getCaracasIsoDate();
  const effective = parseDateRangeParams(value, businessToday);
  const activePreset =
    value.preset === undefined
      ? (findMatchingRelativePreset(effective.from, effective.to, businessToday, presets) ??
        effective.preset)
      : effective.preset;
  const hasRange = effective.from !== undefined || effective.to !== undefined;
  const isCalendarOpen = isOpen && !disabled && presets.includes("custom");

  function closeCalendar({ restoreFocus }: { restoreFocus: boolean }) {
    setIsOpen(false);

    if (restoreFocus) {
      customChipRef.current?.focus();
    }
  }

  function openCalendar() {
    // Un popover montado en `body` quedaría fuera de la trampa de foco del
    // Modal (Radix) y cerraría el diálogo al pulsarlo: se monta dentro de él.
    setPortalContainer(
      customChipRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
    );
    setIsOpen(true);
  }

  function handleChipClick(preset: DateRangePreset) {
    if (preset === "custom") {
      if (isCalendarOpen) {
        closeCalendar({ restoreFocus: false });
      } else {
        openCalendar();
      }

      return;
    }

    setIsOpen(false);
    onChange({ ...resolveDateRangePreset(preset, businessToday), preset });
  }

  function handleSelectRange(range: DateRange) {
    closeCalendar({ restoreFocus: true });
    onChange({ ...range, preset: "custom" });
  }

  function handleClear() {
    setIsOpen(false);
    onChange({ from: undefined, preset: undefined, to: undefined });
  }

  // El popover vive en un portal, fuera del orden de tabulación de la página:
  // Tab da la vuelta dentro de él.
  function handlePopoverKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ).filter((button) => button.tabIndex >= 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  useEffect(() => {
    if (!isCalendarOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (!customChipRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    // En captura sobre `window`: se adelanta al Modal para que Esc cierre solo
    // el calendario y no el diálogo que lo contiene.
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      customChipRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [isCalendarOpen]);

  useLayoutEffect(() => {
    if (!isCalendarOpen) {
      return;
    }

    function updatePosition() {
      const popover = popoverRef.current;
      const trigger = customChipRef.current?.getBoundingClientRect();

      if (!popover || !trigger) {
        return;
      }

      // Se mide sin el límite de alto de la pasada anterior.
      popover.style.maxHeight = "";

      // Un ancestro con `transform` (el Modal centrado) pasa a ser el bloque
      // contenedor de `position: fixed`: se descuenta su origen.
      const current = popover.getBoundingClientRect();
      const originLeft = current.left - (parseFloat(popover.style.left) || 0);
      const originTop = current.top - (parseFloat(popover.style.top) || 0);
      const bounds = resolveBounds(popover.parentElement);
      const below = trigger.bottom + POPOVER_GAP_PX;
      const spaceBelow = bounds.bottom - below;
      const spaceAbove = trigger.top - POPOVER_GAP_PX - bounds.top;
      const left = Math.max(bounds.left, Math.min(trigger.left, bounds.right - current.width));
      let height = current.height;
      let placeBelow = true;

      if (height > spaceBelow) {
        placeBelow = height > spaceAbove && spaceBelow >= spaceAbove;

        // No cabe entero en ningún lado (móvil apaisado): se queda en el hueco
        // mayor, con su alto limitado a él y scroll interno.
        if (height > spaceAbove) {
          height = Math.max(0, placeBelow ? spaceBelow : spaceAbove);
          popover.style.maxHeight = `${height}px`;
        }
      }

      const top = placeBelow ? below : trigger.top - POPOVER_GAP_PX - height;

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
  }, [isCalendarOpen]);

  const popover = isCalendarOpen ? (
    <div
      aria-label="Elegir rango personalizado"
      className={cn(
        "pointer-events-auto fixed top-0 left-0 z-50 w-[min(20rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-xl border border-outline-variant p-3 shadow-lg",
        DATE_RANGE_COLOR_CLASSES.popover,
      )}
      id={popoverId}
      onKeyDown={handlePopoverKeyDown}
      ref={popoverRef}
      role="dialog"
    >
      <RangeCalendar
        autoFocus
        from={effective.from}
        maxDate={maxDate}
        minDate={minDate}
        onSelectRange={handleSelectRange}
        to={effective.to}
        today={businessToday}
      />
    </div>
  ) : null;

  return (
    <div
      aria-label={label ? undefined : DEFAULT_LABEL}
      aria-labelledby={label ? labelId : undefined}
      className={cn("flex min-w-0 max-w-full flex-col gap-1.5", className)}
      role="group"
    >
      {label ? (
        <span className="text-sm font-medium text-on-surface" id={labelId}>
          {label}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {presets.map((preset) => {
          const isActive = preset === activePreset;
          const isCustom = preset === "custom";

          return (
            <button
              aria-controls={isCustom && isCalendarOpen ? popoverId : undefined}
              aria-expanded={isCustom ? isCalendarOpen : undefined}
              aria-haspopup={isCustom ? "dialog" : undefined}
              aria-pressed={isActive}
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                focusRingClassName,
                chipSizeClassName[size],
                isActive
                  ? cn(
                      "border-primary dark:border-primary-fixed-dim",
                      DATE_RANGE_COLOR_CLASSES.selected,
                    )
                  : "border-outline bg-surface-container-lowest text-on-surface enabled:hover:bg-surface-container-low",
              )}
              disabled={disabled}
              key={preset}
              onClick={() => handleChipClick(preset)}
              ref={isCustom ? customChipRef : undefined}
              type="button"
            >
              {isCustom ? <CalendarDays aria-hidden className="size-4 shrink-0" /> : null}
              {DATE_RANGE_PRESET_LABELS[preset]}
            </button>
          );
        })}
        <span className="inline-flex min-w-0 items-center gap-1">
          <span
            aria-live="polite"
            className={cn(
              "text-sm tabular-nums",
              hasRange ? "font-medium text-on-surface" : "text-on-surface-variant",
            )}
            data-testid="date-range-label"
          >
            {formatDateRangeLabel(effective.from, effective.to)}
          </span>
          {clearable && hasRange ? (
            <button
              aria-label="Quitar rango de fechas"
              className={cn(
                "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-on-surface-variant transition-colors enabled:hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50",
                focusRingClassName,
              )}
              disabled={disabled}
              onClick={handleClear}
              type="button"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </span>
      </div>
      {popover && portalContainer ? createPortal(popover, portalContainer) : null}
    </div>
  );
}
