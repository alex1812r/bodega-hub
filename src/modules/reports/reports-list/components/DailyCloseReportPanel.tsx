"use client";

import { DailyClosePanel } from "./DailyClosePanel";
import {
  type ReportDateRangeFilters,
  type ReportRequestScope,
  useDailyCloseReport,
} from "../../hooks/useReports";
import { getReportQueryError } from "../reportQueryState";

type DailyCloseReportPanelProps = {
  dateFilters: ReportDateRangeFilters;
  scope?: ReportRequestScope;
};

export function DailyCloseReportPanel({ dateFilters, scope }: DailyCloseReportPanelProps) {
  const query = useDailyCloseReport(dateFilters, scope);

  return (
    <DailyClosePanel
      data={query.data}
      error={getReportQueryError(query)}
      isLoading={query.isLoading || query.isFetching}
      onRetry={() => void query.refetch()}
      periodLabel={
        dateFilters.from || dateFilters.to
          ? `${dateFilters.from ?? "…"} – ${dateFilters.to ?? "…"}`
          : "Hoy"
      }
    />
  );
}
