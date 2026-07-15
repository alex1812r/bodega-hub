import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

type PurchaseCreateSectionCardProps = {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
  title: string;
};

export function PurchaseCreateSectionCard({
  children,
  className,
  icon: Icon,
  title,
}: PurchaseCreateSectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-surface-container-lowest p-5 shadow-sm dark:border-slate-800",
        className,
      )}
    >
      <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
        {Icon ? <Icon aria-hidden className="size-[1.125rem] text-primary" /> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}
