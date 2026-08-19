"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/shared/api/apiFetch";
import type { DailyCloseSummary } from "@/modules/reports/services/dailyCloseSummary";
import { DailyClosePanel } from "@/modules/reports/reports-list/components/DailyClosePanel";

type DashboardDailyCloseCardProps = {
  from?: string;
  fromStart?: boolean;
  periodLabel?: string;
  to?: string;
};

export function DashboardDailyCloseCard({
  from,
  fromStart,
  periodLabel,
  to,
}: DashboardDailyCloseCardProps) {
  const query = useQuery({
    queryKey: ["dashboard", "daily-close", { from, fromStart, to }] as const,
    queryFn: () =>
      apiFetch<DailyCloseSummary>("/api/dashboard/daily-close", {
        query: {
          from: fromStart ? undefined : from,
          fromStart: fromStart ? 1 : undefined,
          to,
        },
      }),
  });

  return (
    <DailyClosePanel
      data={query.data}
      isLoading={query.isLoading || query.isFetching}
      periodLabel={periodLabel}
    />
  );
}
