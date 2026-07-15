import { type LucideIcon } from "lucide-react";

type SaleDetailPartyCardProps = {
  icon: LucideIcon;
  name: string;
  subtitle?: string;
  title: string;
};

export function SaleDetailPartyCard({
  icon: Icon,
  name,
  subtitle,
  title,
}: SaleDetailPartyCardProps) {
  return (
    <div className="flex gap-4 rounded border border-border bg-surface-container-lowest p-4 shadow-sm dark:border-slate-800">
      <div className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-container text-primary dark:bg-slate-800">
        <Icon aria-hidden className="size-5" />
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-on-surface-variant">{title}</h3>
        <p className="mt-1 text-base font-medium text-foreground">{name}</p>
        {subtitle ? (
          <p className="font-mono text-sm text-on-surface-variant">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
