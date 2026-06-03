import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

export type InfoGridItem = {
  label: string;
  value: ReactNode;
};

type InfoGridProps = {
  className?: string;
  columns?: 2 | 3 | 4;
  items: InfoGridItem[];
};

const columnClasses = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

export function InfoGrid({ className, columns = 3, items }: InfoGridProps) {
  return (
    <dl className={cn("grid gap-4", columnClasses[columns], className)}>
      {items.map((item) => (
        <div
          className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
          key={item.label}
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {item.label}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
