import { type ReactNode } from "react";

type SaleDetailSectionCardProps = {
  badge?: ReactNode;
  children: ReactNode;
  title: string;
};

export function SaleDetailSectionCard({
  badge,
  children,
  title,
}: SaleDetailSectionCardProps) {
  return (
    <section className="overflow-hidden rounded border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-border bg-surface-bright px-4 py-3 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}
