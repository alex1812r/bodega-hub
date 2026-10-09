/** Valor de un punto en la serie; `null` / `undefined` / no finito = sin dato. */
type SeriesValue = number | null | undefined;

function readValue(values: readonly SeriesValue[], index: number) {
  const value = values[index];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Índices de los máximos locales: puntos más altos que sus vecinos. Una meseta
 * (varios puntos seguidos con el mismo valor) cuenta una sola vez, en su primer
 * punto. Los extremos de la serie cuentan si superan a su único vecino. Una
 * serie plana no tiene máximos; una serie de un solo punto, ese punto.
 */
export function findLocalMaxima(values: readonly SeriesValue[]): number[] {
  if (values.length === 1) {
    return readValue(values, 0) === null ? [] : [0];
  }

  const maxima: number[] = [];
  let start = 0;

  while (start < values.length) {
    const value = readValue(values, start);

    if (value === null) {
      start += 1;
      continue;
    }

    let end = start;

    while (end + 1 < values.length && readValue(values, end + 1) === value) {
      end += 1;
    }

    const left = start > 0 ? readValue(values, start - 1) : null;
    const right = end < values.length - 1 ? readValue(values, end + 1) : null;
    const risesFromLeft = left === null || value > left;
    const fallsToRight = right === null || value > right;

    if (risesFromLeft && fallsToRight && (left !== null || right !== null)) {
      maxima.push(start);
    }

    start = end + 1;
  }

  return maxima;
}

/**
 * Los `count` máximos locales más altos, devueltos en orden de aparición.
 * `count` ≤ 0 los apaga. Con `minGap` > 1 se descartan los que quedan a menos
 * de `minGap` posiciones de otro más alto, para que sus etiquetas no se pisen.
 * A igual valor gana el que aparece antes.
 */
export function findPeaks(values: readonly SeriesValue[], count: number, minGap = 1): number[] {
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }

  const limit = Math.floor(count);
  const gap = Number.isFinite(minGap) ? Math.max(1, Math.ceil(minGap)) : 1;
  const candidates = findLocalMaxima(values).sort(
    (first, second) =>
      (readValue(values, second) ?? 0) - (readValue(values, first) ?? 0) || first - second,
  );
  const selected: number[] = [];

  for (const candidate of candidates) {
    if (selected.length >= limit) {
      break;
    }

    if (selected.every((index) => Math.abs(index - candidate) >= gap)) {
      selected.push(candidate);
    }
  }

  return selected.sort((first, second) => first - second);
}

/**
 * Separación mínima entre picos, en puntos, para que dos etiquetas de
 * `labelWidth` px no se solapen en un área de `plotWidth` px.
 */
export function peakMinGap(pointCount: number, plotWidth: number, labelWidth: number) {
  if (pointCount <= 1 || !(plotWidth > 0) || !(labelWidth > 0)) {
    return 1;
  }

  const step = plotWidth / (pointCount - 1);

  return Math.max(1, Math.ceil(labelWidth / step));
}

type PlotBox = { x: number; y: number; width: number; height: number };

type PeakLabelInput = {
  /** Centro del marcador. */
  cx: number;
  cy: number;
  /** Radio del marcador. */
  radius: number;
  textWidth: number;
  fontSize: number;
  plot: PlotBox;
};

/**
 * Posición de la etiqueta de un pico (`x` = borde izquierdo del texto, `y` =
 * línea base). Va centrada sobre el marcador; si se saldría por un lado se
 * desliza hacia dentro, y si no cabe arriba se dibuja debajo.
 */
export function placePeakLabel({ cx, cy, fontSize, plot, radius, textWidth }: PeakLabelInput) {
  const maxLeft = Math.max(plot.x, plot.x + plot.width - textWidth);
  const x = Math.min(Math.max(cx - textWidth / 2, plot.x), maxLeft);
  const above = cy - radius - 4;
  const y = above - fontSize < plot.y ? cy + radius + fontSize + 2 : above;

  return { x, y };
}
