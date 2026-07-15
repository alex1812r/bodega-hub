import { cn } from "@/shared/utils/cn";

type ContactsStatusBadgeProps = {
  isActive: boolean;
};

export function ContactsStatusBadge({ isActive }: ContactsStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        isActive
          ? "border-secondary-container bg-secondary-container/30 text-secondary-stitch"
          : "border-outline-variant bg-surface-variant text-on-surface-variant",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isActive ? "bg-secondary-stitch" : "bg-outline",
        )}
      />
      {isActive ? "Activo" : "Inactivo"}
    </span>
  );
}
