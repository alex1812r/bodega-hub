import { isMockDataSource } from "@/lib/api/dataSourceUi";

/** Fecha operativa del negocio (mock fija; produccion usa hoy). */
export function getBusinessTodayIsoDate() {
  if (isMockDataSource()) {
    return "2026-05-18";
  }

  return new Date().toISOString().slice(0, 10);
}

export function shiftIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00`);

  date.setDate(date.getDate() + days);

  return date.toISOString().slice(0, 10);
}
