import { Inbox } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

type EmptyStateProps = {
  action?: ReactNode;
  className?: string;
  description?: string;
  icon?: ReactNode;
  title: string;
};

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {icon ?? <Inbox aria-hidden="true" className="h-5 w-5" />}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-950 dark:text-slate-100">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
