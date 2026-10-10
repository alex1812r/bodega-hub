"use client";

import { DailyClosePanel } from "./DailyClosePanel";
import {
  type ReportDateRangeFilters,
  type ReportRequestScope,
  useDailyCloseReport,
} from "../../hooks/useReports";
import { useReportPanelReady } from "../reportPanelReady";
import { getReportQueryError } from "../reportQueryState";

type DailyCloseReportPanelProps = {
  dateFilters: ReportDateRangeFilters;
  scope?: ReportRequestScope;
};

export function DailyCloseReportPanel({ dateFilters, scope }: DailyCloseReportPanelProps) {
  const query = useDailyCloseReport(dateFilters, scope);

  useReportPanelReady(!query.isLoading);

  return (
    <DailyClosePanel
      data={query.data ?? undefined}
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
