import { cn } from "@/shared/utils/cn";

type SupplierProductStatusBadgeProps = {
  className?: string;
  isActive?: boolean;
};

export function SupplierProductStatusBadge({ className, isActive = true }: SupplierProductStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        isActive
          ? "bg-secondary-container text-secondary"
          : "border border-outline-variant text-on-surface-variant",
        className,
      )}
    >
      {isActive ? "Activo" : "Inactivo"}
    </span>
  );
}
