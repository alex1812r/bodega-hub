import { type LucideIcon } from "lucide-react";

import { cn } from "@/shared/utils/cn";

type PaymentDetailCardHeaderProps = {
  className?: string;
  icon?: LucideIcon;
  title: string;
};

export function PaymentDetailCardHeader({
  className,
  icon: Icon,
  title,
}: PaymentDetailCardHeaderProps) {
  return (
    <div
      className={cn(
        "border-b border-outline-variant bg-surface-bright px-6 py-4",
        className,
      )}
    >
      <h3
        className={cn(
          "text-base font-semibold text-foreground",
          Icon && "flex items-center gap-2",
        )}
      >
        {Icon ? <Icon aria-hidden className="size-5 shrink-0 text-on-surface-variant" /> : null}
        {title}
      </h3>
    </div>
  );
}
