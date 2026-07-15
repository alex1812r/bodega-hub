import { cn } from "@/shared/utils/cn";

type ReportsStatusBadgeProps = {
  className?: string;
};

export function ReportsStatusBadge({ className }: ReportsStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium bg-secondary-container text-on-secondary-container",
        className,
      )}
    >
      Listo
    </span>
  );
}
