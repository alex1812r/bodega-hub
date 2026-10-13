import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";
import type { PricingSettingsMock } from "@/shared/mocks/erp-data";
import { DEFAULT_MARGIN_THRESHOLDS, DEFAULT_MARKUP_CHIPS } from "@/shared/utils/pricing";

/** Tope de cualquier % de ganancia configurable (mismo que los checks del parche 20261009b). */
export const PRICING_PCT_MAX = 1000;
/** Máximo de chips de % recomendados (check `app_settings_markup_chips_check`). */
export const PRICING_CHIPS_MAX = 6;

/**
 * Ajustes de precios de la tienda tal como viajan en `/api/settings` (`pricing`)
 * y en `/api/settings/pricing`.
 */
export type PricingSettings = PricingSettingsMock;

export const PRICING_THRESHOLDS_ORDER_MESSAGE =
  "El % desde el que la ganancia es amarilla debe ser menor que el % desde el que es verde.";
export const PRICING_THRESHOLD_RANGE_MESSAGE = `Los umbrales de ganancia deben estar entre 0 y ${PRICING_PCT_MAX} %.`;
export const PRICING_CHIPS_COUNT_MESSAGE = `Indica entre 1 y ${PRICING_CHIPS_MAX} porcentajes recomendados.`;
export const PRICING_CHIP_RANGE_MESSAGE = `Cada porcentaje recomendado debe ser mayor que 0 y como máximo ${PRICING_PCT_MAX} %.`;
export const PRICING_CHIPS_DUPLICATED_MESSAGE = "Los porcentajes recomendados no pueden repetirse.";
export const PRICING_INVALID_MESSAGE = "Los ajustes de precios no tienen un formato válido.";

/** Los de `@bodega/core`: rojo < 15 %, verde ≥ 25 %, chips 12 / 20 / 30. Copia nueva en cada llamada. */
export function defaultPricingSettings(): PricingSettings {
  return {
    chipsPct: [...DEFAULT_MARKUP_CHIPS],
    greenFromPct: DEFAULT_MARGIN_THRESHOLDS.high,
    yellowFromPct: DEFAULT_MARGIN_THRESHOLDS.low,
  };
}

/** Las columnas son `numeric(6,2)`: dos decimales. */
export function normalizePricingPct(pct: number) {
  return Math.round(pct * 100) / 100;
}

const thresholdSchema = z
  .number(PRICING_THRESHOLD_RANGE_MESSAGE)
  .min(0, PRICING_THRESHOLD_RANGE_MESSAGE)
  .max(PRICING_PCT_MAX, PRICING_THRESHOLD_RANGE_MESSAGE)
  .transform(normalizePricingPct);

// Se redondea ANTES de comprobar el rango y los duplicados, como hace la base al
// guardar en numeric(6,2): 0,004 es 0 (fuera de rango) y 12 y 12,001 son el mismo chip.
const chipSchema = z
  .number(PRICING_CHIP_RANGE_MESSAGE)
  .transform(normalizePricingPct)
  .refine((pct) => pct > 0 && pct <= PRICING_PCT_MAX, PRICING_CHIP_RANGE_MESSAGE);

/**
 * Espejo de los checks del parche 20261009b: 0 ≤ amarillo < verde ≤ 1000 y de 1 a
 * 6 chips, cada uno > 0 y ≤ 1000, sin duplicados. Devuelve los chips ordenados.
 * Objeto estricto: un campo desconocido se rechaza en vez de ignorarse.
 */
export const pricingSettingsSchema = z
  .strictObject(
    {
      chipsPct: z
        .array(chipSchema, PRICING_CHIPS_COUNT_MESSAGE)
        .min(1, PRICING_CHIPS_COUNT_MESSAGE)
        .max(PRICING_CHIPS_MAX, PRICING_CHIPS_COUNT_MESSAGE)
        .refine((chips) => new Set(chips).size === chips.length, PRICING_CHIPS_DUPLICATED_MESSAGE),
      greenFromPct: thresholdSchema,
      yellowFromPct: thresholdSchema,
    },
    PRICING_INVALID_MESSAGE,
  )
  .refine((pricing) => pricing.yellowFromPct < pricing.greenFromPct, {
    message: PRICING_THRESHOLDS_ORDER_MESSAGE,
    path: ["greenFromPct"],
  })
  .transform(
    (pricing): PricingSettings => ({
      ...pricing,
      chipsPct: [...pricing.chipsPct].sort((first, second) => first - second),
    }),
  );

/**
 * Valida y normaliza unos ajustes de precios; si no cumplen responde 400 con el
 * motivo en español. La usan la ruta y los dos servicios (real y mock): el mock
 * no tiene los checks de la base y debe rechazar lo mismo.
 */
export function parsePricingSettings(value: unknown): PricingSettings {
  const parsed = pricingSettingsSchema.safeParse(value);

  if (!parsed.success) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      parsed.error.issues[0]?.message ?? PRICING_INVALID_MESSAGE,
      { issues: parsed.error.issues },
    );
  }

  return parsed.data;
}
