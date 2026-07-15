type PaymentsContactCellProps = {
  name: string;
  taxId?: string;
};

export function PaymentsContactCell({ name, taxId }: PaymentsContactCellProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium text-foreground">{name}</span>
      {taxId ? (
        <span className="truncate font-mono text-xs text-on-surface-variant">{taxId}</span>
      ) : null}
    </div>
  );
}
