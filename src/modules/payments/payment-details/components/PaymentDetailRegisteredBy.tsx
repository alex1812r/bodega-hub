function initialsFromName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

type PaymentDetailRegisteredByProps = {
  name?: string;
};

export function PaymentDetailRegisteredBy({ name }: PaymentDetailRegisteredByProps) {
  const displayName = name?.trim() || "Sin registrar";
  const initials = name?.trim() ? initialsFromName(displayName) : "?";

  return (
    <div className="flex flex-col gap-1 md:col-span-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        Registrado por
      </span>
      <div className="mt-1 flex items-center gap-2">
        <div
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-xs font-semibold text-on-surface"
        >
          {initials}
        </div>
        <span className="text-sm font-medium text-foreground">{displayName}</span>
      </div>
    </div>
  );
}
