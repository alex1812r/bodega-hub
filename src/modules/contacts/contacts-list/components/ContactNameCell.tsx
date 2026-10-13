import Link from "next/link";

import { cn } from "@/shared/utils/cn";

const avatarToneClasses = [
  "bg-primary-container text-on-primary-container",
  "bg-surface-variant text-on-surface-variant",
  "bg-tertiary-container text-on-tertiary-container",
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

type ContactNameCellProps = {
  /** Perfil del contacto (con `returnTo`): el nombre es el enlace que lo abre. */
  href: string;
  name: string;
};

export function ContactNameCell({ href, name }: ContactNameCellProps) {
  const initials = getInitials(name) || "?";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          getAvatarTone(name),
        )}
      >
        {initials}
      </div>
      <Link
        className="truncate rounded-md font-medium text-on-surface hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={href}
      >
        {name}
      </Link>
    </div>
  );
}
