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
    // Con tope: un nombre largo se recorta en vez de ensanchar la tabla. El avatar
    // (decorativo) solo aparece cuando la tarjeta de la tabla tiene ancho de sobra.
    <div className="flex min-w-0 max-w-36 items-center gap-2 @6xl:max-w-52">
      <span aria-hidden className="hidden shrink-0 @6xl:block">
        <span className={cn("purchase-supplier-avatar", getAvatarTone(name))}>{initials}</span>
      </span>
      <span className="truncate font-medium text-foreground" title={name}>
        {name}
      </span>
    </div>
  );
}
