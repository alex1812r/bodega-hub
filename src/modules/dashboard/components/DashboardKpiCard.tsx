import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

type DashboardKpiCardVariant = "default" | "alert";

type DashboardKpiCardProps = {
  accentClassName?: string;
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  trend?: ReactNode;
  value: ReactNode;
  variant?: DashboardKpiCardVariant;
};

export function DashboardKpiCard({
  accentClassName = "bg-primary/15",
  icon: Icon,
  iconClassName = "text-primary",
  label,
  trend,
  value,
  variant = "default",
}: DashboardKpiCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-surface-container-lowest p-5 shadow-sm",
        variant === "alert" ? "border-red-300/60" : "border-border",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-4 -top-4 z-0 h-16 w-16 rounded-bl-full transition-transform group-hover:scale-110",
          accentClassName,
        )}
      />
      <div className="relative z-10">
        <div className="mb-2 flex items-start justify-between gap-2">
          <span
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              variant === "alert" ? "text-red-600" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <Icon aria-hidden className={cn("h-5 w-5 shrink-0", iconClassName)} />
        </div>
        <div className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{value}</div>
        {trend}
      </div>
    </div>
  );
}
