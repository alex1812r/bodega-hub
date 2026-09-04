"use client";

import { cn } from "@/shared/utils/cn";

import type { AssistantUsage } from "../../types";

export function AssistantUsageBadge({ usage }: { usage: AssistantUsage | undefined }) {
  if (!usage) {
    return null;
  }

  const reached = usage.used >= usage.limit;

  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs tabular-nums",
        reached
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          : "border-border bg-surface-container-low text-slate-600 dark:text-slate-300",
      )}
      title="Consultas usadas hoy (se reinicia a medianoche, hora de Caracas)"
    >
      {usage.used}/{usage.limit} consultas hoy
    </span>
  );
}
