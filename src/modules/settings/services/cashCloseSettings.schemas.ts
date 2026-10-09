import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";

/** Tope del umbral (mismo que el check `app_settings_cash_close_diff_alert_check`, parche 20261015a). */
export const CASH_CLOSE_DIFF_ALERT_MAX = 999_999_999_999.99;
/** Sin configurar (o sin el parche) cualquier faltante pide confirmación. */
export const DEFAULT_CASH_CLOSE_DIFF_ALERT_VES = 0;

export const CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE =
  "El umbral de faltante al cerrar caja debe ser un monto en Bs igual o mayor que 0.";
export const CASH_CLOSE_DIFF_ALERT_UNAVAILABLE_MESSAGE =
  "Esta base aún no admite el umbral de faltante al cerrar caja. No se guardó ningún cambio.";

/**
 * Ajustes del cierre de caja tal como viajan en `/api/settings` (campo suelto
 * `cashCloseDiffAlertVes`) y en `/api/settings/cash-close`.
 */
export type CashCloseSettings = {
  /**
   * Faltante en Bs a partir del cual el cierre de caja pide una confirmación
   * explícita: se confirma cuando `|contado − teórico|` SUPERA este valor y la
   * diferencia es negativa. Con 0 confirma cualquier faltante.
   */
  cashCloseDiffAlertVes: number;
};

/** La columna es `numeric(14,2)`: dos decimales. */
function normalizeVesAmount(amount: number) {
  return Math.round(amount * 100) / 100;
}

/** Espejo del check del parche 20261015a: finito, 0 ≤ umbral ≤ tope, dos decimales. */
export const cashCloseDiffAlertVesSchema = z
  .number(CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE)
  .min(0, CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE)
  .max(CASH_CLOSE_DIFF_ALERT_MAX, CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE)
  .transform(normalizeVesAmount);

/**
 * Valida y normaliza el umbral; si no cumple responde 400 con el motivo en
 * español. La usan la ruta y los dos servicios (real y mock): el mock no tiene
 * el check de la base y debe rechazar lo mismo.
 */
export function parseCashCloseDiffAlertVes(value: unknown): number {
  const parsed = cashCloseDiffAlertVesSchema.safeParse(value);

  if (!parsed.success) {
    throw new ApiError(400, "BAD_REQUEST", CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE, {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

/** Lo que guarda la base (`numeric` llega como texto) o nada → número finito ≥ 0; si no, el valor por defecto. */
export function mapCashCloseDiffAlertVes(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_CASH_CLOSE_DIFF_ALERT_VES;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CASH_CLOSE_DIFF_ALERT_VES;
}
