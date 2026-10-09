"use client";

import { RouteErrorState } from "@/modules/reports/reports-list/components/RouteErrorState";

/**
 * Red de seguridad de `/dashboard` (REP-F8 R-05). Se pinta dentro del `AppShell`
 * que monta `layout.tsx`.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <RouteErrorState
      error={error}
      queryKey={["dashboard"]}
      retry={unstable_retry}
      title="No pudimos mostrar el dashboard"
    />
  );
}
