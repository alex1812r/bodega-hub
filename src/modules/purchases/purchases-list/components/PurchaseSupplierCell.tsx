import { cn } from "@/shared/utils/cn";

const avatarToneClasses = [
  "text-primary",
  "text-stitch-secondary",
  "text-tertiary-container",
  "text-outline",
] as const;

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function getAvatarTone(name: string) {
  const code = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return avatarToneClasses[code % avatarToneClasses.length];
}

type PurchaseSupplierCellProps = {
  name: string;
};

export function PurchaseSupplierCell({ name }: PurchaseSupplierCellProps) {
  const initials = getInitials(name) || "?";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className={cn("purchase-supplier-avatar", getAvatarTone(name))} aria-hidden>
        {initials}
      </div>
      <span className="truncate font-medium text-foreground">{name}</span>
    </div>
  );
}
