import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

type ProductDetailSectionCardProps = {
  accent?: boolean;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  title: ReactNode;
};

export function ProductDetailSectionCard({
  accent = false,
  children,
  className,
  headerAction,
  title,
}: ProductDetailSectionCardProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800",
        className,
      )}
    >
      {accent ? (
        <div
          aria-hidden
          className="absolute top-0 left-0 h-full w-1 bg-primary"
        />
      ) : null}
      {headerAction ? (
        <div className="flex items-center justify-between border-b border-border bg-surface-bright px-5 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {headerAction}
        </div>
      ) : (
        <div className="border-b border-border bg-surface-bright px-5 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        </div>
      )}
      <div className={cn(accent && "pl-1")}>{children}</div>
    </section>
  );
}
