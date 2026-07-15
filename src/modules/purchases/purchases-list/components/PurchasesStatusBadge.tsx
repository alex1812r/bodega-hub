import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

const statusConfig = {
  cancelado: {
    className:
      "border-outline/80 bg-surface-container-highest text-on-surface-variant dark:border-slate-600 dark:bg-slate-800",
    label: "Cancelado",
  },
  devuelto: {
    className:
      "border-tertiary-container/20 bg-tertiary-container/20 text-tertiary-container dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    label: "Devuelto",
  },
  pedido: {
    className:
      "border-primary/20 bg-surface-variant text-primary dark:border-indigo-800 dark:bg-indigo-950/30",
    label: "Pedido",
  },
  recibido: {
    className:
      "border-stitch-secondary/20 bg-secondary-container/30 text-stitch-secondary dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    label: "Recibido",
  },
} as const satisfies Record<PurchaseStatus, { className: string; label: string }>;

type PurchasesStatusBadgeProps = {
  status: PurchaseStatus;
};

export function PurchasesStatusBadge({ status }: PurchasesStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-none",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
