"use client";

import { shiftIsoDate } from "@bodega/core/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { cn } from "@/shared/utils/cn";

import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  type DateRange,
  daysInMonth,
  formatLongIsoDate,
  isoDateParts,
  isoWeekdayIndex,
  normalizeDateRange,
  shiftIsoMonth,
  startOfIsoMonth,
  startOfIsoWeek,
} from "./dateRangePresets";

const WEEKS_SHOWN = 6;
const DAYS_PER_WEEK = 7;
const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"] as const;

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const navButtonClassName = cn(
  "inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-on-surface-variant transition-colors enabled:hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40",
  focusRingClassName,
);

export type RangeCalendarProps = {
  /** Inicio del rango ya elegido (`YYYY-MM-DD`). */
  from?: string;
  /** Fin del rango ya elegido (`YYYY-MM-DD`). */
  to?: string;
  /** Día operativo: se marca como hoy y es el mes inicial si no hay rango. */
  today: string;
  /** Primer día elegible. */
  minDate?: string;
  /** Último día elegible (p. ej. `today` para impedir días futuros). */
  maxDate?: string;
  /** Se llama al elegir el segundo día, con los extremos ya ordenados. */
  onSelectRange: (range: DateRange) => void;
  /** Enfoca el día activo al montar (calendario dentro de un popover). */
  autoFocus?: boolean;
  className?: string;
};

function clampIsoDate(isoDate: string, minDate?: string, maxDate?: string) {
  if (minDate && isoDate < minDate) {
    return minDate;
  }

  if (maxDate && isoDate > maxDate) {
    return maxDate;
  }

  return isoDate;
}

/** Rejilla fija de 6 semanas (lunes primero); `null` = hueco fuera del mes. */
function buildMonthWeeks(monthStart: string) {
  const { month, year } = isoDateParts(monthStart);
  const leading = isoWeekdayIndex(monthStart);
  const total = daysInMonth(year, month);
  const cells = Array.from({ length: WEEKS_SHOWN * DAYS_PER_WEEK }, (_, index) => {
    const offset = index - leading;

    return offset >= 0 && offset < total ? shiftIsoDate(monthStart, offset) : null;
  });

  return Array.from({ length: WEEKS_SHOWN }, (_, week) =>
    cells.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK),
  );
}

/**
 * Calendario de un mes para elegir un rango de días: primer clic = inicio,
 * segundo clic = fin (si es anterior al inicio, se intercambian).
 *
 * Teclado: flechas mueven un día o una semana, Inicio/Fin van al lunes o al
 * domingo, RePág/AvPág cambian de mes y Enter o Espacio eligen el día.
 */
export function RangeCalendar({
  autoFocus = false,
  className,
  from,
  maxDate,
  minDate,
  onSelectRange,
  to,
  today,
}: RangeCalendarProps) {
  const [focusedDay, setFocusedDay] = useState(() =>
    clampIsoDate(from ?? to ?? today, minDate, maxDate),
  );
  const [anchorDay, setAnchorDay] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const shouldFocusRef = useRef(autoFocus);

  const monthStart = startOfIsoMonth(focusedDay);
  const { month, year } = isoDateParts(monthStart);
  const monthEnd = shiftIsoDate(monthStart, daysInMonth(year, month) - 1);
  const weeks = buildMonthWeeks(monthStart);
  const canGoPrevious = !minDate || shiftIsoDate(monthStart, -1) >= minDate;
  const canGoNext = !maxDate || shiftIsoDate(monthEnd, 1) <= maxDate;

  // Con el inicio ya elegido se previsualiza el rango hasta el día bajo el
  // puntero o el foco; si no, se pinta el rango confirmado.
  const shown: Partial<DateRange> = anchorDay
    ? normalizeDateRange(anchorDay, hoveredDay ?? focusedDay)
    : { from, to };
  const rangeStart = shown.from ?? shown.to;
  const rangeEnd = shown.to ?? shown.from;

  useEffect(() => {
    if (shouldFocusRef.current) {
      shouldFocusRef.current = false;
      dayRefs.current.get(focusedDay)?.focus();
    }
  }, [focusedDay]);

  function moveFocus(target: string) {
    const next = clampIsoDate(target, minDate, maxDate);

    // Sin cambio de día no hay render que consuma la petición de foco.
    if (next !== focusedDay) {
      shouldFocusRef.current = true;
      setFocusedDay(next);
    }
  }

  function showMonth(months: number) {
    setFocusedDay(clampIsoDate(shiftIsoMonth(focusedDay, months), minDate, maxDate));
  }

  function selectDay(day: string) {
    setFocusedDay(day);

    if (anchorDay === null) {
      setAnchorDay(day);
      return;
    }

    setAnchorDay(null);
    setHoveredDay(null);
    onSelectRange(normalizeDateRange(anchorDay, day));
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const weekStart = startOfIsoWeek(focusedDay);
    const targetByKey: Record<string, string> = {
      ArrowDown: shiftIsoDate(focusedDay, DAYS_PER_WEEK),
      ArrowLeft: shiftIsoDate(focusedDay, -1),
      ArrowRight: shiftIsoDate(focusedDay, 1),
      ArrowUp: shiftIsoDate(focusedDay, -DAYS_PER_WEEK),
      End: shiftIsoDate(weekStart, DAYS_PER_WEEK - 1),
      Home: weekStart,
      PageDown: shiftIsoMonth(focusedDay, 1),
      PageUp: shiftIsoMonth(focusedDay, -1),
    };
    const target = targetByKey[event.key];

    if (target === undefined) {
      return;
    }

    event.preventDefault();
    moveFocus(target);
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          aria-label="Mes anterior"
          className={navButtonClassName}
          disabled={!canGoPrevious}
          onClick={() => showMonth(-1)}
          type="button"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        <p aria-live="polite" className="text-sm font-semibold text-on-surface first-letter:uppercase">
          {MONTH_NAMES[month - 1]} de {year}
        </p>
        <button
          aria-label="Mes siguiente"
          className={navButtonClassName}
          disabled={!canGoNext}
          onClick={() => showMonth(1)}
          type="button"
        >
          <ChevronRight aria-hidden className="size-5" />
        </button>
      </div>

      <table
        aria-label={`${MONTH_NAMES[month - 1]} de ${year}`}
        className="mt-1 w-full table-fixed border-collapse"
        onKeyDown={handleGridKeyDown}
        onPointerLeave={() => setHoveredDay(null)}
      >
        <thead>
          <tr>
            {WEEKDAY_NAMES.map((name, index) => (
              <th
                abbr={name}
                className="h-8 text-center text-xs font-medium text-on-surface-variant"
                key={name}
                scope="col"
              >
                {WEEKDAY_INITIALS[index]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((day, dayIndex) => {
                if (day === null) {
                  return <td aria-hidden className="h-10 p-0" key={dayIndex} />;
                }

                const isToday = day === today;
                const isDisabled = Boolean((minDate && day < minDate) || (maxDate && day > maxDate));
                const isStart = day === rangeStart;
                const isEnd = day === rangeEnd;
                const isEndpoint = isStart || isEnd;
                const isInRange =
                  rangeStart !== undefined &&
                  rangeEnd !== undefined &&
                  day >= rangeStart &&
                  day <= rangeEnd;

                return (
                  <td
                    className={cn(
                      "h-10 p-0",
                      isInRange && "bg-surface-container-high",
                      isStart && "rounded-l-full",
                      isEnd && "rounded-r-full",
                    )}
                    key={day}
                  >
                    <button
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${WEEKDAY_NAMES[dayIndex]}, ${formatLongIsoDate(day)}${isToday ? ", hoy" : ""}`}
                      aria-pressed={isEndpoint}
                      className={cn(
                        "relative inline-flex size-10 max-w-full cursor-pointer items-center justify-center rounded-full text-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        focusRingClassName,
                        isEndpoint
                          ? "bg-primary font-semibold text-on-primary"
                          : "text-on-surface enabled:hover:bg-surface-container-highest",
                        isToday && !isEndpoint && "border border-outline font-semibold",
                      )}
                      data-in-range={isInRange ? "true" : undefined}
                      disabled={isDisabled}
                      onClick={() => selectDay(day)}
                      onFocus={() => setFocusedDay(day)}
                      onPointerEnter={() => setHoveredDay(day)}
                      ref={(element) => {
                        if (element) {
                          dayRefs.current.set(day, element);
                        } else {
                          dayRefs.current.delete(day);
                        }
                      }}
                      tabIndex={day === focusedDay ? 0 : -1}
                      type="button"
                    >
                      {isoDateParts(day).day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p aria-live="polite" className="mt-2 text-center text-xs text-on-surface-variant">
        {anchorDay ? "Elige el día de fin." : "Elige el día de inicio."}
      </p>
    </div>
  );
}
