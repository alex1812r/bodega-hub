import { formatRef, formatVesBs, roundMoney } from "@/shared/utils/currency";

export type TimeSeriesCurrency = "ref" | "ves";

export type TimeSeriesPoint = {
  /**
   * Identificador del punto en el eje X. Para un día es su día operativo de
   * Caracas ya calculado, `yyyy-mm-dd`: el gráfico no vuelve a convertir zonas
   * horarias. Para una semana o un mes, cualquier clave única (`2026-W41`,
   * `2026-10`).
   */
  key: string;
  /** Etiqueta corta del eje X. Si falta: `dd/mm` para un día, o la propia `key`. */
  label?: string;
  /** Título del tooltip. Si falta: la fecha larga en español para un día, o `label`. */
  title?: string;
  valueRef: number;
  /** Mismo valor en Bs. Sin él, el punto no se dibuja en Bs. */
  valueVes?: number | null;
  /** Nº de operaciones del punto (ventas, compras…). */
  count?: number | null;
};

export type TimeSeriesSeries = {
  /** Único dentro del gráfico. */
  id: string;
  /** Nombre en la leyenda y el tooltip. */
  name: string;
  points: readonly TimeSeriesPoint[];
  /**
   * Periodo anterior, alineado por posición: `previousPoints[i]` se compara con
   * `points[i]`. Lo que sobre al final se ignora. Vacío o ausente: no se dibuja.
   */
  previousPoints?: readonly TimeSeriesPoint[];
};

export type TimeSeriesCell = {
  current: TimeSeriesPoint | null;
  previous: TimeSeriesPoint | null;
};

/** Una posición del eje X con el punto de cada serie (por `id`). */
export type TimeSeriesRow = {
  key: string;
  label: string;
  title: string;
  cells: Map<string, TimeSeriesCell>;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Partes de una clave `yyyy-mm-dd` que sea una fecha real; si no, `null`. */
function parseIsoDay(key: string) {
  const match = ISO_DAY.exec(key);

  if (!match) {
    return null;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { date, day, month } : null;
}

// La clave ya es el día de calendario: se formatea en UTC para no desplazarla.
const dayTitleFormatter = new Intl.DateTimeFormat("es-VE", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
});

/** Etiqueta corta del eje X: `2026-10-08` → `08/10`. */
export function formatPointLabel(point: Pick<TimeSeriesPoint, "key" | "label">) {
  if (point.label) {
    return point.label;
  }

  const parsed = parseIsoDay(point.key);

  if (!parsed) {
    return point.key;
  }

  return `${String(parsed.day).padStart(2, "0")}/${String(parsed.month).padStart(2, "0")}`;
}

/** Título del tooltip: `2026-10-08` → `jueves, 8 de octubre de 2026`. */
export function formatPointTitle(point: Pick<TimeSeriesPoint, "key" | "label" | "title">) {
  if (point.title) {
    return point.title;
  }

  const parsed = parseIsoDay(point.key);

  return parsed ? dayTitleFormatter.format(parsed.date) : (point.label ?? point.key);
}

/** Valor del punto en la moneda pedida; `null` si no lo tiene o no es un número. */
export function pointValue(
  point: TimeSeriesPoint | null | undefined,
  currency: TimeSeriesCurrency,
): number | null {
  const value = currency === "ves" ? point?.valueVes : point?.valueRef;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatMoney(value: number, currency: TimeSeriesCurrency) {
  return currency === "ves" ? formatVesBs(value) : formatRef(value);
}

/** Hay al menos un punto con valor en Bs: solo entonces tiene sentido el cambio a Bs. */
export function hasVesValues(series: readonly TimeSeriesSeries[]) {
  return series.some((item) =>
    [...item.points, ...(item.previousPoints ?? [])].some(
      (point) => pointValue(point, "ves") !== null,
    ),
  );
}

/**
 * Filas del gráfico. El eje X sigue el orden de la primera serie; las claves
 * que solo traen las demás se añaden al final. El periodo anterior se alinea
 * por posición con su serie, no por clave.
 */
export function buildRows(series: readonly TimeSeriesSeries[]): TimeSeriesRow[] {
  const rows = new Map<string, TimeSeriesRow>();

  for (const item of series) {
    item.points.forEach((point, index) => {
      let row = rows.get(point.key);

      if (!row) {
        row = {
          cells: new Map(),
          key: point.key,
          label: formatPointLabel(point),
          title: formatPointTitle(point),
        };
        rows.set(point.key, row);
      }

      row.cells.set(item.id, { current: point, previous: item.previousPoints?.[index] ?? null });
    });
  }

  return [...rows.values()];
}

/** La serie tiene periodo anterior que dibujar. */
export function hasPreviousPeriod(rows: readonly TimeSeriesRow[], seriesId: string) {
  return rows.some((row) => pointValue(row.cells.get(seriesId)?.previous, "ref") !== null);
}

type SummaryInput = {
  ariaLabel: string;
  currency: TimeSeriesCurrency;
  rows: readonly TimeSeriesRow[];
  series: readonly Pick<TimeSeriesSeries, "id" | "name">[];
};

/** Resumen para lector de pantalla: rango, y total y máximo de cada serie. */
export function summarizeChart({ ariaLabel, currency, rows, series }: SummaryInput) {
  if (rows.length === 0) {
    return `${ariaLabel}: sin datos.`;
  }

  const range =
    rows.length === 1
      ? `1 punto, ${rows[0].title}`
      : `${rows.length} puntos, del ${rows[0].title} al ${rows[rows.length - 1].title}`;

  const parts = series.flatMap((item) => {
    let total = 0;
    let highest: { title: string; value: number } | null = null;

    for (const row of rows) {
      const value = pointValue(row.cells.get(item.id)?.current, currency);

      if (value === null) {
        continue;
      }

      total += value;

      if (!highest || value > highest.value) {
        highest = { title: row.title, value };
      }
    }

    return highest
      ? [
          `${item.name}: total ${formatMoney(roundMoney(total), currency)}, ` +
            `máximo ${formatMoney(highest.value, currency)} (${highest.title}).`,
        ]
      : [];
  });

  return [`${ariaLabel}: ${range}.`, ...parts].join(" ");
}
