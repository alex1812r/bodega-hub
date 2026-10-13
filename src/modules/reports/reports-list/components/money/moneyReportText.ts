import { formatRef, formatVesBs } from "@/shared/utils/currency";

import type { AgingBucket, CashCloseCurrency, CashCloseDifferenceRow } from "../../../services/moneyReports";

/** Días de la semana, lunes (`dow` 1) primero: rótulo corto y nombre completo. */
export const WEEKDAYS = [
  { label: "Lun", name: "lunes" },
  { label: "Mar", name: "martes" },
  { label: "Mié", name: "miércoles" },
  { label: "Jue", name: "jueves" },
  { label: "Vie", name: "viernes" },
  { label: "Sáb", name: "sábado" },
  { label: "Dom", name: "domingo" },
] as const;

/** `18` → `18:00`. */
export function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function formatSalesCount(count: number) {
  return `${count} ${count === 1 ? "venta" : "ventas"}`;
}

export function formatDocumentsCount(count: number) {
  return `${count} ${count === 1 ? "documento" : "documentos"}`;
}

/**
 * Posición del valor más alto (por `totalRef`; a igualdad, más ventas y luego
 * la primera). `null` si no hubo ninguna venta: no hay pico que destacar.
 */
export function findPeakIndex(items: readonly { salesCount: number; totalRef: number }[]) {
  let peak: number | null = null;

  items.forEach((item, index) => {
    if (item.salesCount <= 0 && item.totalRef <= 0) {
      return;
    }

    const best = peak === null ? null : items[peak]!;

    if (
      best === null ||
      item.totalRef > best.totalRef ||
      (item.totalRef === best.totalRef && item.salesCount > best.salesCount)
    ) {
      peak = index;
    }
  });

  return peak;
}

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  "0-7": "0 a 7 días",
  "8-30": "8 a 30 días",
  "30+": "Más de 30 días",
};

export const CASH_CLOSE_CURRENCY_LABELS: Record<CashCloseCurrency, string> = {
  ref: "REF",
  ves: "Bs",
};

export function formatCashAmount(value: number, currency: CashCloseCurrency) {
  return currency === "ves" ? formatVesBs(value) : formatRef(value);
}

export const CASH_CLOSE_REASON_LABELS: Record<
  NonNullable<CashCloseDifferenceRow["closedReason"]>,
  string
> = {
  end_of_day: "Fin de día",
  manual: "Manual",
  max_24h: "24 h",
};

export type CashDifferenceKind = "faltante" | "sin diferencia" | "sobrante";

/** Contado − esperado: positivo = sobrante, negativo = faltante. */
export function cashDifferenceKind(difference: number): CashDifferenceKind {
  if (difference > 0) {
    return "sobrante";
  }

  return difference < 0 ? "faltante" : "sin diferencia";
}

/** Importe con signo explícito: `+Bs 5,00`, `−Bs 5,00`, `Bs 0,00`. */
export function formatSignedCashAmount(value: number, currency: CashCloseCurrency) {
  const amount = formatCashAmount(Math.abs(value), currency);

  if (value > 0) {
    return `+${amount}`;
  }

  return value < 0 ? `−${amount}` : amount;
}
