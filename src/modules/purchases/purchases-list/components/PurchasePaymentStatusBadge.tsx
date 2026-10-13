import { cn } from "@/shared/utils/cn";

import type { PurchasePaymentStatus } from "../utils/purchaseBalance";

// Mismos colores que la etiqueta de la tarjeta "Estado de pago" del detalle de compra.
const paymentStatusConfig = {
  pagada: {
    className:
      "border-stitch-secondary/20 bg-secondary-container/30 text-stitch-secondary dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    label: "Pagada",
  },
  parcial: {
    className:
      "border-tertiary-container/20 bg-tertiary-container/20 text-tertiary-container dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    label: "Parcial",
  },
  pendiente: {
    className:
      "border-primary/20 bg-surface-variant text-primary dark:border-indigo-800 dark:bg-indigo-950/30",
    label: "Pendiente",
  },
} as const satisfies Record<PurchasePaymentStatus, { className: string; label: string }>;

type PurchasePaymentStatusBadgeProps = {
  status: PurchasePaymentStatus;
};

export function PurchasePaymentStatusBadge({ status }: PurchasePaymentStatusBadgeProps) {
  const config = paymentStatusConfig[status];

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
