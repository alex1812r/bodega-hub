import { cn } from "@/shared/utils/cn";

type ProgressBarProps = {
  className?: string;
  label?: string;
  max?: number;
  value: number;
};

export function ProgressBar({ className, label, max = 100, value }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const percentage = Math.min(100, Math.round((value / safeMax) * 100));

  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600 dark:text-slate-400">{label}</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{percentage}%</span>
        </div>
      ) : null}
      <div
        aria-valuemax={safeMax}
        aria-valuemin={0}
        aria-valuenow={value}
        className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
