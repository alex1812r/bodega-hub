"use client";

import { useCallback, useMemo, useState } from "react";
import { z } from "zod";

import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import {
  type DashboardPeriod,
  describeDashboardPeriod,
  normalizeDashboardRange,
} from "@/modules/dashboard/utils/dashboardPeriod";
import {
  DATE_RANGE_PRESETS,
  type DateRangeChange,
  type DateRangeValue,
  parseDateRangeParams,
  serializeDateRange,
} from "@/shared/components/DateRangeField";
import { listParams, useUrlListState } from "@/shared/hooks/useUrlListState";

/** Periodo del dashboard listo para pintar y para pedir datos. */
export type DashboardPeriodState = DashboardPeriod & {
  /** Recibe lo que emite `DateRangeField`. */
  setRange: (next: DateRangeChange) => void;
  /** Día operativo de hoy (fijo en mock). */
  today: string;
};

/** Parámetros de URL del dashboard (regla 15): `from`, `to` y `preset`. */
const dashboardPeriodSchema = z.object({
  from: listParams.date(),
  preset: listParams.oneOf(["", ...DATE_RANGE_PRESETS], ""),
  to: listParams.date(),
});

const DEFAULT_PERIOD_PARAMS = { from: "", preset: "", to: "" } as const;

/**
 * Periodo del dashboard en estado local, por defecto hoy. Lo usa el dashboard
 * de plataforma, que no guarda el periodo en la URL.
 */
export function useDashboardKpiPeriod(): DashboardPeriodState {
  const today = getBusinessTodayIsoDate();
  const [range, setRange] = useState<DateRangeValue>({ preset: "today" });

  return useMemo(
    () => ({
      ...describeDashboardPeriod(normalizeDashboardRange(range, today), today),
      setRange,
      today,
    }),
    [range, today],
  );
}

/**
 * Periodo del dashboard guardado en la URL (`from` / `to` / `preset`), por
 * defecto hoy: el periodo por defecto no se escribe. Usa `useUrlListState`, así
 * que la pantalla necesita su límite de Suspense (`withUrlListBoundary`).
 */
export function useDashboardUrlPeriod(): DashboardPeriodState {
  const today = getBusinessTodayIsoDate();
  const { setState, state } = useUrlListState(dashboardPeriodSchema);
  const { from, preset, to } = state;

  const setRange = useCallback(
    (next: DateRangeChange) => {
      const isDefault = normalizeDashboardRange(next, today).preset === "today";

      setState(isDefault ? DEFAULT_PERIOD_PARAMS : serializeDateRange(next));
    },
    [setState, today],
  );

  return useMemo(
    () => ({
      ...describeDashboardPeriod(
        normalizeDashboardRange(parseDateRangeParams({ from, preset, to }, today), today),
        today,
      ),
      setRange,
      today,
    }),
    [from, preset, setRange, to, today],
  );
}
