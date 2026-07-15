import { Loader2 } from "lucide-react";

import { cn } from "@/shared/utils/cn";

type LoadingStateProps = {
  className?: string;
  description?: string;
  title?: string;
  variant?: "page" | "section" | "inline";
};

export function LoadingState({
  className,
  description,
  title = "Cargando...",
  variant = "section",
}: LoadingStateProps) {
  const isInline = variant === "inline";

  return (
    <div
      className={cn(
        "flex items-center justify-center text-slate-500 dark:text-slate-400",
        variant === "page" && "min-h-[60vh]",
        variant === "section" && "min-h-40 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900",
        isInline && "gap-2",
        !isInline && "flex-col text-center",
        className,
      )}
      role="status"
    >
      <Loader2
        aria-hidden="true"
        className={cn("h-5 w-5 animate-spin text-indigo-600", !isInline && "mb-3")}
      />
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {title}
        </p>
        {description ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
