import { getCaracasIsoDate } from "@bodega/core/dates";

import {
  type AnyDateRangePreset,
  DATE_RANGE_PRESETS,
  isAnyDateRangePreset,
  isValidIsoDate,
  resolveDateRangePresetBounds,
  type DateRangeChange,
  type DateRangePreset,
  type DateRangeValue,
} from "./dateRangePresets";

type ParamValue = string | readonly string[] | null | undefined;

/** `URLSearchParams`, el `ReadonlyURLSearchParams` de Next o cualquier cosa con `get`. */
type SearchParamsLike = { get: (name: string) => string | null };

/** Registro con las tres claves: `searchParams` de una página o el `state` de `useUrlListState`. */
export type DateRangeParamsRecord = { from?: ParamValue; to?: ParamValue; preset?: ParamValue };

/** Los tres parámetros como texto; cadena vacía = no se escribe en la URL. */
export type DateRangeParams<TPreset extends AnyDateRangePreset = DateRangePreset> = {
  from: string;
  to: string;
  preset: TPreset | "";
};

function isSearchParamsLike(source: SearchParamsLike | DateRangeParamsRecord): source is SearchParamsLike {
  return "get" in source && typeof source.get === "function";
}

function readParam(source: SearchParamsLike | DateRangeParamsRecord, name: "from" | "preset" | "to") {
  if (isSearchParamsLike(source)) {
    return source.get(name);
  }

  const value = source[name];

  return typeof value === "string" ? value : (value?.[0] ?? null);
}

/**
 * Parámetros `from` / `to` / `preset` → rango efectivo. Nunca lanza.
 *
 * - Con `from` o `to` válidos mandan ellos. El `preset` solo se conserva si su
 *   rango de hoy es ese mismo; si no, el rango es `custom`.
 * - `preset` relativo sin fechas: el rango se calcula con `today` (un enlace
 *   guardado con `?preset=this_month` sigue siendo "este mes").
 * - `preset=all_time` sin fechas: sin `from` (desde el inicio) y `to` = `today`.
 * - Fecha mal formada: se ignora. `from` posterior a `to`: se descartan ambas.
 * - `presets` son los que admite el consumidor (por defecto, los ocho de
 *   siempre): un `preset` fuera de esa lista se ignora, como uno desconocido.
 */
export function parseDateRangeParams<TPreset extends AnyDateRangePreset = DateRangePreset>(
  source: SearchParamsLike | DateRangeParamsRecord,
  today: string = getCaracasIsoDate(),
  presets: readonly AnyDateRangePreset[] = DATE_RANGE_PRESETS,
): DateRangeChange<TPreset | "custom"> {
  const rawFrom = readParam(source, "from");
  const rawTo = readParam(source, "to");
  const rawPreset = readParam(source, "preset");
  const preset = presets.find((candidate): candidate is TPreset => candidate === rawPreset);
  let from = isValidIsoDate(rawFrom) ? rawFrom : undefined;
  let to = isValidIsoDate(rawTo) ? rawTo : undefined;

  if (from && to && from > to) {
    from = undefined;
    to = undefined;
  }

  const presetRange =
    preset && preset !== "custom" ? resolveDateRangePresetBounds(preset, today) : undefined;

  if (from || to) {
    const matchesPreset = presetRange?.from === from && presetRange?.to === to;

    return { from, preset: matchesPreset ? preset : "custom", to };
  }

  if (presetRange) {
    return { ...presetRange, preset };
  }

  return { from: undefined, preset: undefined, to: undefined };
}

/**
 * Rango → patch de `from` / `to` / `preset` para `useUrlListState().setState`.
 *
 * - Preset relativo: solo `preset`; las fechas no se escriben para que el
 *   enlace siga siendo relativo al día en que se abra.
 * - Rango personalizado: `from` / `to`, sin `preset`.
 * - Sin rango: las tres cadenas vacías.
 */
export function serializeDateRange<TPreset extends AnyDateRangePreset = DateRangePreset>(
  value: DateRangeValue<TPreset>,
): DateRangeParams<TPreset> {
  if (value.preset && value.preset !== "custom" && isAnyDateRangePreset(value.preset)) {
    return { from: "", preset: value.preset, to: "" };
  }

  let from = isValidIsoDate(value.from) ? value.from : "";
  let to = isValidIsoDate(value.to) ? value.to : "";

  if (from && to && from > to) {
    from = "";
    to = "";
  }

  return { from, preset: "", to };
}
