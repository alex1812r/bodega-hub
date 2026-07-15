import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

type PurchaseDetailInfoCardProps = {
  children: ReactNode;
  icon: LucideIcon;
  title: string;
};

export function PurchaseDetailInfoCard({
  children,
  icon: Icon,
  title,
}: PurchaseDetailInfoCardProps) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800">
      <div className="mb-2 flex items-center gap-2 text-on-surface-variant">
        <Icon aria-hidden className="size-[1.125rem] shrink-0" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">{title}</h3>
      </div>
      {children}
    </div>
  );
}
