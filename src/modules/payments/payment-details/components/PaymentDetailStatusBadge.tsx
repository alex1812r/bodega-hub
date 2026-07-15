import { cn } from "@/shared/utils/cn";
import type { PaymentStatus } from "@/shared/mocks/erp-data";

type PaymentDetailStatusBadgeProps = {
  className?: string;
  status?: PaymentStatus;
};

export function PaymentDetailStatusBadge({
  className,
  status = "activo",
}: PaymentDetailStatusBadgeProps) {
  const isCancelled = status === "anulado";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        isCancelled
          ? "border-error/20 bg-error-container text-on-error-container"
          : "border-secondary/20 bg-secondary-container text-on-secondary-container",
        className,
      )}
    >
      {isCancelled ? "Anulado" : "Completado"}
    </span>
  );
}
