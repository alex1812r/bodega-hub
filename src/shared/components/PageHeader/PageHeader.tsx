import { type ReactNode } from "react";

import { Typography } from "@/shared/components/Typography";
import { cn } from "@/shared/utils/cn";

type PageHeaderProps = {
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
  description?: string;
  title: ReactNode;
};

export function PageHeader({
  actions,
  badge,
  className,
  description,
  title,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-4 sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="min-w-0">
        {badge ? <div className="mb-1">{badge}</div> : null}
        {typeof title === "string" ? (
          <Typography as="h1" variant="h1">
            {title}
          </Typography>
        ) : (
          title
        )}
        {description ? (
          <Typography className="mt-2 max-w-2xl" variant="muted">
            {description}
          </Typography>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
