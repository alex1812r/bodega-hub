export type ReportStat = {
  /** Aclaración corta bajo la cifra. */
  hint?: string;
  label: string;
  value: string;
};

type ReportStatTilesProps = {
  /** Qué resume el bloque, para el lector de pantalla. */
  label: string;
  stats: readonly ReportStat[];
};

/** Cifras de cabecera de un reporte (todo el conjunto, no la página). */
export function ReportStatTiles({ label, stats }: ReportStatTilesProps) {
  return (
    <dl aria-label={label} className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
      {stats.map((stat) => (
        <div
          className="min-w-0 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3"
          key={stat.label}
        >
          <dt className="text-xs text-on-surface-variant">{stat.label}</dt>
          <dd className="mt-1 break-words text-lg font-semibold tabular-nums text-foreground">
            {stat.value}
          </dd>
          {stat.hint ? <dd className="text-xs text-on-surface-variant">{stat.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
