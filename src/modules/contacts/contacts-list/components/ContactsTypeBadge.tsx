import type { ContactType } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

const typeConfig = {
  ambos: {
    className: "bg-tertiary-fixed-dim text-on-tertiary-fixed",
    label: "Ambos",
  },
  cliente: {
    className: "bg-primary-fixed-dim text-on-primary-fixed",
    label: "Cliente",
  },
  proveedor: {
    className: "bg-secondary-container text-on-secondary-container",
    label: "Proveedor",
  },
} as const satisfies Record<ContactType, { className: string; label: string }>;

type ContactsTypeBadgeProps = {
  type: ContactType;
};

export function ContactsTypeBadge({ type }: ContactsTypeBadgeProps) {
  const config = typeConfig[type];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[12px] font-semibold leading-none",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}
