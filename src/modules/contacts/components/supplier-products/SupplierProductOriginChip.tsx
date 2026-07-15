import type { SupplierProductPriceOrigin } from "../../types/supplierProducts";
import { cn } from "@/shared/utils/cn";

const originLabels: Record<SupplierProductPriceOrigin, string> = {
  ajuste: "Ajuste",
  compra: "Compra",
  cotizacion: "Cotización",
  vinculacion: "Vinculación",
};

type SupplierProductOriginChipProps = {
  className?: string;
  origin?: SupplierProductPriceOrigin;
};

export function SupplierProductOriginChip({ className, origin }: SupplierProductOriginChipProps) {
  if (!origin) {
    return <span className={cn("text-xs text-on-surface-variant", className)}>—</span>;
  }

  const tone =
    origin === "compra"
      ? "bg-secondary-container text-secondary"
      : origin === "cotizacion"
        ? "border border-outline-variant bg-transparent text-on-surface-variant"
        : "bg-surface-container-high text-on-surface-variant";

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
        tone,
        className,
      )}
    >
      {originLabels[origin]}
    </span>
  );
}
