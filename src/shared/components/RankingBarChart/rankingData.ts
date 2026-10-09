export type RankingBarItem = {
  /** Único dentro del gráfico. */
  id: string;
  /** Nombre completo; el gráfico lo recorta si no cabe y lo deja entero en el título. */
  label: string;
  value: number;
  /**
   * Valor del periodo anterior. Si algún elemento lo trae (aunque sea `null`),
   * el gráfico dibuja la comparación en todas las filas.
   */
  previousValue?: number | null;
  /** Variación % respecto de `previousValue`; `null` = no calculable («—»). */
  deltaPct?: number | null;
};

export type RankedBarItem = RankingBarItem & {
  /** Posición en el ranking, desde 1. */
  rank: number;
  /** `value` ya saneado: un valor no numérico cuenta como 0. */
  value: number;
  previousValue: number | null;
};

export const DEFAULT_TOP_N = 10;

function finiteOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `topN` como entero ≥ 1; cualquier otra cosa cae al valor por defecto. */
export function normalizeTopN(topN: number | undefined) {
  return typeof topN === "number" && Number.isFinite(topN) && topN >= 1
    ? Math.trunc(topN)
    : DEFAULT_TOP_N;
}

/**
 * `value`: de mayor a menor (ranking). `none`: el orden en que llegan, para
 * categorías con orden propio (horas, días, tramos de antigüedad).
 */
export type RankingBarSort = "none" | "value";

/**
 * Ordena de mayor a menor (los empates conservan el orden de llegada) y se
 * queda con los `topN` primeros. Con `sort: "none"` conserva el orden de
 * llegada; `rank` es entonces la posición en ese orden.
 */
export function rankItems(
  items: readonly RankingBarItem[],
  topN: number = DEFAULT_TOP_N,
  sort: RankingBarSort = "value",
): RankedBarItem[] {
  return items
    .map((item, index) => ({
      index,
      item: {
        ...item,
        previousValue: finiteOrNull(item.previousValue),
        value: finiteOrZero(item.value),
      },
    }))
    .sort((first, second) =>
      sort === "none"
        ? first.index - second.index
        : second.item.value - first.item.value || first.index - second.index,
    )
    .slice(0, normalizeTopN(topN))
    .map(({ item }, position) => ({ ...item, rank: position + 1 }));
}

/** Algún elemento declara periodo anterior: se dibuja la comparación. */
export function hasComparison(items: readonly RankingBarItem[]) {
  return items.some((item) => item.previousValue !== undefined);
}

/** Recorta a `maxChars` caracteres terminando en «…». Nunca devuelve vacío. */
export function truncateLabel(label: string, maxChars: number) {
  const limit = Number.isFinite(maxChars) ? Math.max(1, Math.trunc(maxChars)) : 1;
  const characters = [...label];

  if (characters.length <= limit) {
    return label;
  }

  return `${characters.slice(0, Math.max(1, limit - 1)).join("").trimEnd()}…`;
}

const deltaFormatter = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 1 });

/**
 * Variación % con flecha y texto: `↑ 12,5 %`, `↓ 3 %`, `0 %`. Sin periodo
 * anterior comparable (`null`, `undefined`, NaN, Infinity): `—`.
 */
export function formatDeltaPct(deltaPct: number | null | undefined) {
  if (typeof deltaPct !== "number" || !Number.isFinite(deltaPct)) {
    return "—";
  }

  const amount = `${deltaFormatter.format(Math.abs(deltaPct))} %`;

  if (deltaPct > 0) {
    return `↑ ${amount}`;
  }

  return deltaPct < 0 ? `↓ ${amount}` : amount;
}

/** Lo mismo en palabras, para lectores de pantalla. */
export function describeDeltaPct(deltaPct: number | null | undefined) {
  if (typeof deltaPct !== "number" || !Number.isFinite(deltaPct)) {
    return "sin periodo anterior comparable";
  }

  const amount = `${deltaFormatter.format(Math.abs(deltaPct))} %`;

  if (deltaPct > 0) {
    return `sube ${amount}`;
  }

  return deltaPct < 0 ? `baja ${amount}` : "sin cambio";
}

export type BarScale = {
  /** Posición horizontal de un valor dentro del área de barras, en px. */
  toX: (value: number) => number;
  /** Posición del cero. */
  zeroX: number;
  hasNegative: boolean;
};

/**
 * Escala lineal que siempre incluye el 0. Con todos los valores en 0 (o sin
 * valores) todo cae en x = 0: barras sin ancho, nunca NaN.
 */
export function computeBarScale(values: readonly number[], plotWidth: number): BarScale {
  const finite = values.filter((value) => Number.isFinite(value));
  const min = Math.min(0, ...finite);
  const max = Math.max(0, ...finite);
  const span = max - min;
  const width = Number.isFinite(plotWidth) && plotWidth > 0 ? plotWidth : 0;
  const toX = (value: number) =>
    span > 0 && Number.isFinite(value) ? ((value - min) / span) * width : 0;

  return { hasNegative: min < 0, toX, zeroX: toX(0) };
}

/** Tramo horizontal de una barra: del cero al valor, hacia la derecha o la izquierda. */
export function barSpan(scale: BarScale, value: number, minWidth = 0) {
  const end = scale.toX(value);
  const width = Math.abs(end - scale.zeroX);
  const visibleWidth = value !== 0 && width > 0 ? Math.max(minWidth, width) : width;

  return {
    width: visibleWidth,
    x: value < 0 ? scale.zeroX - visibleWidth : scale.zeroX,
  };
}

type SummaryInput = {
  ariaLabel: string;
  formatValue: (value: number) => string;
  items: readonly RankedBarItem[];
  /** `false` con orden natural: la posición no es un puesto y no se lee. Por defecto `true`. */
  showRank?: boolean;
  withComparison: boolean;
};

/** Resumen para lector de pantalla: cada posición con su nombre completo y su valor. */
export function summarizeRanking({
  ariaLabel,
  formatValue,
  items,
  showRank = true,
  withComparison,
}: SummaryInput) {
  if (items.length === 0) {
    return `${ariaLabel}: sin datos.`;
  }

  const parts = items.map((item) => {
    const comparison = withComparison
      ? ` (antes ${item.previousValue === null ? "sin datos" : formatValue(item.previousValue)}, ${describeDeltaPct(item.deltaPct)})`
      : "";

    return `${showRank ? `${item.rank}. ` : ""}${item.label}: ${formatValue(item.value)}${comparison}.`;
  });

  return [`${ariaLabel}: ${items.length} ${items.length === 1 ? "elemento" : "elementos"}.`, ...parts].join(" ");
}
