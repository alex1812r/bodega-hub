import { cn } from "@/shared/utils/cn";

type ProductsStatusBadgeProps = {
  isActive: boolean;
};

export function ProductsStatusBadge({ isActive }: ProductsStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none",
        isActive
          ? "bg-secondary-container text-on-secondary-container"
          : "bg-error-container text-on-error-container",
      )}
    >
      {isActive ? "Activo" : "Inactivo"}
    </span>
  );
}
