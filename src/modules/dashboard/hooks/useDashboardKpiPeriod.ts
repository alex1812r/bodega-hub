"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { z } from "zod";

import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import {
  DASHBOARD_PLATFORM_PRESETS,
  DASHBOARD_STORE_PRESETS,
  type DashboardPeriod,
  describeDashboardPeriod,
  normalizeDashboardRange,
} from "@/modules/dashboard/utils/dashboardPeriod";
import { sanitizeUrlRange } from "@/modules/reports/reports-list/urlDateRange";
import {
  type AnyDateRangePreset,
  type DateRangeChange,
  parseDateRangeParams,
  serializeDateRange,
} from "@/shared/components/DateRangeField";
import { listParams, useUrlListState } from "@/shared/hooks/useUrlListState";

/** Periodo del dashboard listo para pintar y para pedir datos. */
export type DashboardPeriodState = DashboardPeriod & {
  /** Chips de periodo de esta pantalla, en orden. */
  presets: readonly AnyDateRangePreset[];
  /** Recibe lo que emite `DateRangeField`. */
  setRange: (next: DateRangeChange<AnyDateRangePreset>) => void;
  /** Día operativo de hoy (fijo en mock). */
  today: string;
  /**
   * La URL traía un rango invertido, con el año fuera de rango o mal formado:
   * se descartó (el periodo es el de por defecto, hoy) y hay que avisarlo.
   */
  urlRangeWasInvalid: boolean;
};

/** Qué periodos ofrece la pantalla: los de tienda, o los de plataforma (con los extendidos). */
export type DashboardPeriodVariant = "platform" | "store";

/**
 * Parámetros de URL del dashboard (regla 15): `from`, `to` y `preset`. Un
 * `preset` que la pantalla no ofrece no pasa el schema y el periodo es hoy.
 */
function createPeriodSchema(presets: readonly AnyDateRangePreset[]) {
  return z.object({
    from: listParams.date(),
    preset: listParams.oneOf(["", ...presets], ""),
    to: listParams.date(),
  });
}

const PERIOD_CONFIG = {
  platform: {
    presets: DASHBOARD_PLATFORM_PRESETS,
    schema: createPeriodSchema(DASHBOARD_PLATFORM_PRESETS),
  },
  store: {
    presets: DASHBOARD_STORE_PRESETS,
    schema: createPeriodSchema(DASHBOARD_STORE_PRESETS),
  },
} as const;

const DEFAULT_PERIOD_PARAMS = { from: "", preset: "", to: "" } as const;

/**
 * Periodo del dashboard guardado en la URL (`from` / `to` / `preset`), por
 * defecto hoy: el periodo por defecto no se escribe. Usa `useUrlListState`, así
 * que la pantalla necesita su límite de Suspense (`withUrlListBoundary`).
 *
 * `variant` elige los periodos: `"store"` (por defecto) los de siempre;
 * `"platform"` añade 14 días, 3 meses, 6 meses y "Desde el inicio".
 */
export function useDashboardUrlPeriod(
  variant: DashboardPeriodVariant = "store",
): DashboardPeriodState {
  const today = getBusinessTodayIsoDate();
  const { presets, schema } = PERIOD_CONFIG[variant];
  const { setState, state } = useUrlListState(schema);
  const { from, preset, to } = state;
  // Un rango de la URL que no se puede usar no llega a pedirse al servidor.
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");
  const urlRange = useMemo(
    () => sanitizeUrlRange({ from, to }, { from: rawFrom, to: rawTo }, today),
    [from, rawFrom, rawTo, to, today],
  );

  const setRange = useCallback(
    (next: DateRangeChange<AnyDateRangePreset>) => {
      const isDefault = normalizeDashboardRange(next, today).preset === "today";

      setState(isDefault ? DEFAULT_PERIOD_PARAMS : serializeDateRange(next));
    },
    [setState, today],
  );

  return useMemo(
    () => ({
      ...describeDashboardPeriod(
        normalizeDashboardRange(
          parseDateRangeParams<AnyDateRangePreset>(
            { from: urlRange.from, preset, to: urlRange.to },
            today,
            presets,
          ),
          today,
        ),
        today,
      ),
      presets,
      setRange,
      today,
      urlRangeWasInvalid: urlRange.wasInvalid,
    }),
    [preset, presets, setRange, today, urlRange],
  );
}
