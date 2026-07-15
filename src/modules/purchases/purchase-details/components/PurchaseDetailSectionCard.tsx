import { type ReactNode } from "react";

type PurchaseDetailSectionCardProps = {
  children: ReactNode;
  title: string;
};

export function PurchaseDetailSectionCard({
  children,
  title,
}: PurchaseDetailSectionCardProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
      <div className="border-b border-border bg-surface-bright px-6 py-4 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}
