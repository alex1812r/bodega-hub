"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";
import type { DailyCloseSummary } from "@/modules/reports/services/dailyCloseSummary";
import { DailyClosePanel } from "@/modules/reports/reports-list/components/DailyClosePanel";
import {
  getReportQueryError,
  isReportQueryOffline,
} from "@/modules/reports/reports-list/reportQueryState";

import { DashboardCardBoundary } from "./DashboardCardBoundary";
import { DashboardOfflineNote } from "./DashboardOfflineNote";

type DashboardDailyCloseCardProps = {
  from?: string;
  periodLabel?: string;
  to?: string;
};

export function DashboardDailyCloseCard(props: DashboardDailyCloseCardProps) {
  return (
    <DashboardCardBoundary>
      <DailyCloseCard {...props} />
    </DashboardCardBoundary>
  );
}

function DailyCloseCard({
  from,
  periodLabel,
  to,
}: DashboardDailyCloseCardProps) {
  const query = useQuery({
    queryKey: ["dashboard", "daily-close", { from, to }] as const,
    queryFn: () =>
      apiFetch<DailyCloseSummary>("/api/dashboard/daily-close", { query: { from, to } }),
  });

  // Sin red la consulta queda en pausa: no es «cargando».
  if (isReportQueryOffline(query)) {
    return (
      <DashboardOfflineNote
        className="rounded-xl border border-dashed border-border px-4 py-6"
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <DailyClosePanel
      // `data: null` es una respuesta rota: se pinta como error, no como «cargando».
      data={query.data ?? undefined}
      error={getReportQueryError(query)}
      isLoading={query.isLoading || query.isFetching}
      onRetry={() => void query.refetch()}
      periodLabel={periodLabel}
    />
  );
}
