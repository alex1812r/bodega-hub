import { isMockDataSource } from "@/lib/api/dataSourceUi";
import { getCaracasIsoDate, shiftIsoDate as shiftCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

/** Fecha operativa del negocio (mock fija; produccion usa hoy en America/Caracas). */
export function getBusinessTodayIsoDate() {
  if (isMockDataSource()) {
    return "2026-05-18";
  }

  return getCaracasIsoDate();
}

export function shiftIsoDate(isoDate: string, days: number) {
  return shiftCaracasIsoDate(isoDate, days);
}
