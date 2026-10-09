import { Clock, type LucideIcon } from "lucide-react";

import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

type StatusConfig = {
  className: string;
  /** El estado no se distingue solo por el color: lleva icono propio. */
  Icon?: LucideIcon;
  label: string;
};

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
  // Pedido no es un estado final: borde discontinuo, icono de espera y el texto dice
  // que la mercancía no ha entrado, para que no se confunda con "Recibido".
  pedido: {
    className:
      "border-dashed border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950 dark:text-indigo-300",
    Icon: Clock,
    label: "Pedido · sin recibir",
  },
  recibido: {
    className:
      "border-stitch-secondary/20 bg-secondary-container/30 text-stitch-secondary dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    label: "Recibido",
  },
} as const satisfies Record<PurchaseStatus, StatusConfig>;

type PurchasesStatusBadgeProps = {
  status: PurchaseStatus;
};

export function PurchasesStatusBadge({ status }: PurchasesStatusBadgeProps) {
  const config: StatusConfig = statusConfig[status];
  const Icon = config.Icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-none",
        config.className,
      )}
      data-status={status}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
      {config.label}
    </span>
  );
}
