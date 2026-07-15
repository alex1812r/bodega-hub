import { cn } from "@/shared/utils/cn";

import type { SaleListItem } from "../../hooks/useSales";

const statusConfig = {
  borrador: {
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    label: "Borrador",
  },
  cancelada: {
    className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    label: "Cancelada",
  },
  devuelta: {
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    label: "Devuelta",
  },
  pagada: {
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    label: "Pagada",
  },
  pendiente_pago: {
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    label: "Pdte. Pago",
  },
} as const satisfies Record<
  SaleListItem["status"],
  { className: string; label: string }
>;

type SalesStatusBadgeProps = {
  status: SaleListItem["status"];
};

export function SalesStatusBadge({ status }: SalesStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-1 text-[11px] font-semibold leading-none",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
