type PaymentsContactCellProps = {
  /** Nombre del contacto. Si falta se dice "Sin contacto": nunca se pinta un id. */
  name?: string;
  taxId?: string;
};

export function PaymentsContactCell({ name, taxId }: PaymentsContactCellProps) {
  const displayName = name?.trim();

  return (
    <div className="flex min-w-0 flex-col">
      {displayName ? (
        <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
      ) : (
        <span className="truncate text-sm text-on-surface-variant">Sin contacto</span>
      )}
      {taxId ? (
        <span className="truncate font-mono text-xs text-on-surface-variant">{taxId}</span>
      ) : null}
    </div>
  );
}
