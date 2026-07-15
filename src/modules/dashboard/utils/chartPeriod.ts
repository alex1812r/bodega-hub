import { getBusinessTodayIsoDate, shiftIsoDate } from "./businessDate";

export const DASHBOARD_CHART_PERIODS = [
  { days: 7, label: "7 dias" },
  { days: 14, label: "14 dias" },
  { days: 30, label: "1 mes" },
  { days: 90, label: "3 meses" },
  { days: 180, label: "6 meses" },
] as const;

export const DASHBOARD_KPI_PERIODS = [
  { days: 1, label: "Hoy" },
  ...DASHBOARD_CHART_PERIODS,
] as const;

export type DashboardChartPeriodDays =
  (typeof DASHBOARD_CHART_PERIODS)[number]["days"];

export type DashboardKpiPeriodDays = (typeof DASHBOARD_KPI_PERIODS)[number]["days"];

type PeriodOption = { days: number; label: string };

export function getDashboardDateRange(days: number) {
  const to = getBusinessTodayIsoDate();
  const from = shiftIsoDate(to, -(days - 1));

  return { from, to };
}

export function getDashboardPeriodLabel(
  days: number,
  periods: ReadonlyArray<PeriodOption>,
) {
  return periods.find((period) => period.days === days)?.label ?? `${days} dias`;
}

export function getChartDateRange(days: DashboardChartPeriodDays) {
  return getDashboardDateRange(days);
}

export function getChartPeriodLabel(days: DashboardChartPeriodDays) {
  return getDashboardPeriodLabel(days, DASHBOARD_CHART_PERIODS);
}

export function getKpiPeriodLabel(days: DashboardKpiPeriodDays) {
  return getDashboardPeriodLabel(days, DASHBOARD_KPI_PERIODS);
}
