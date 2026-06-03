import { AlertTriangle } from "lucide-react";

import { Button } from "@/shared/components/Button";

type ErrorStateProps = {
  actionLabel?: string;
  description?: string;
  onRetry?: () => void;
  title: string;
};

export function ErrorState({
  actionLabel = "Reintentar",
  description,
  onRetry,
  title,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300">
        <AlertTriangle aria-hidden="true" className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-950 dark:text-slate-100">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
          {description}
        </p>
      ) : null}
      {onRetry ? (
        <Button className="mt-4" onClick={onRetry} size="sm" type="button">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
