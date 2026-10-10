"use client";

import { RouteError } from "@/shared/components/RouteError";

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
    <RouteError
      error={error}
      homeHref={null}
      queryKey={["dashboard"]}
      retry={unstable_retry}
      title="No pudimos mostrar el dashboard"
    />
  );
}
