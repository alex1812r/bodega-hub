import { formatRef } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";
import { toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

/** Lo que se muestra cuando una medida no se puede calcular. */
export const NO_VALUE = "—";

/** Notas de una línea de cada reporte: de dónde sale la cifra. */
export const DEAD_STOCK_NOTE =
  "Sin movimiento = días sin vender; el valor usa el costo actual (IVA incluido).";
export const STOCK_TURNOVER_NOTE =
  "Rotación = costo de lo vendido / inventario promedio (apertura y cierre) a costo actual.";
export const STOCK_ADJUSTMENTS_NOTE = "Valorizado al costo actual del producto.";

/** Unidades con separador de miles y hasta 3 decimales (productos por peso). */
export function formatUnits(value: number) {
  return value.toLocaleString("es-VE", { maximumFractionDigits: 3 });
}

/** Unidades con signo explícito: `+5`, `−3`, `0`. */
export function formatSignedUnits(value: number) {
  const units = formatUnits(Math.abs(value));

  if (value > 0) {
    return `+${units}`;
  }

  return value < 0 ? `−${units}` : units;
}

/** Importe en REF con signo explícito: `+ref 5.00`, `−ref 5.00`. */
export function formatSignedRef(value: number) {
  const amount = formatRef(Math.abs(value));

  if (value > 0) {
    return `+${amount}`;
  }

  return value < 0 ? `−${amount}` : amount;
}

/** `12.345` → `12,3 %`; `null` (no calculable) → `—`. */
export function formatPct(value: number | null) {
  return value === null
    ? NO_VALUE
    : `${value.toLocaleString("es-VE", { maximumFractionDigits: 1 })} %`;
}

/** Rotación con 2 decimales (`1,25`); `null` → `—`. */
export function formatTurnover(value: number | null) {
  return value === null
    ? NO_VALUE
    : value.toLocaleString("es-VE", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** Días de inventario redondeados a 1 decimal (`45,5`); `null` → `—`. */
export function formatDaysOfInventory(value: number | null) {
  return value === null ? NO_VALUE : value.toLocaleString("es-VE", { maximumFractionDigits: 1 });
}

/** `1 día` / `45 días`. */
export function formatDaysCount(days: number) {
  return `${days} ${days === 1 ? "día" : "días"}`;
}

/** Instante → su día operativo de Caracas, `dd/mm/aaaa`. */
export function formatCaracasDay(instant: string) {
  return formatDate(toCaracasDateKey(instant));
}
