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
 * Un extremo (de la serie o de un tramo con datos) solo tiene un vecino:
 * superarlo no basta para ser un pico (el último día de un mes flojo «sube»
 * respecto al anterior). Cuenta solo si además está en la mitad alta del rango
 * de valores de la serie. `index` es el primer punto de su meseta.
 */
function isRelevantMaximum(values: readonly SeriesValue[], index: number) {
  const value = readValue(values, index);
  let end = index;

  while (end + 1 < values.length && readValue(values, end + 1) === value) {
    end += 1;
  }

  if (readValue(values, index - 1) !== null && readValue(values, end + 1) !== null) {
    return true;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let position = 0; position < values.length; position += 1) {
    const other = readValue(values, position);

    if (other !== null) {
      min = Math.min(min, other);
      max = Math.max(max, other);
    }
  }

  return value !== null && value >= (min + max) / 2;
}

/**
 * Los `count` máximos locales más altos, devueltos en orden de aparición.
 * `count` ≤ 0 los apaga. A igual valor gana el que aparece antes.
 *
 * Depende solo de los datos, nunca del ancho del gráfico: si las etiquetas de
 * dos picos no caben, eso lo resuelve `layoutPeakLabels`.
 */
export function findPeaks(values: readonly SeriesValue[], count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }

  return findLocalMaxima(values)
    .filter((index) => isRelevantMaximum(values, index))
    .sort(
      (first, second) =>
        (readValue(values, second) ?? 0) - (readValue(values, first) ?? 0) || first - second,
    )
    .slice(0, Math.floor(count))
    .sort((first, second) => first - second);
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

export type PeakLabelRequest = {
  /** Centro del marcador. */
  cx: number;
  cy: number;
  textWidth: number;
  /** Valor del pico: si dos etiquetas no caben, se queda la del más alto. */
  value: number;
};

type PeakLabelLayoutOptions = {
  fontSize: number;
  /** Separación horizontal mínima entre dos etiquetas, en px. */
  gap: number;
  plot: PlotBox;
  /** Radio del marcador. */
  radius: number;
};

type LabelSlot = {
  /** Posición preferida (centrada) y límites entre los que la etiqueta sigue sobre su marcador. */
  preferred: number;
  min: number;
  max: number;
  width: number;
  y: number;
  left: number;
};

/**
 * Posición de las etiquetas de los picos de una serie, dados en orden de
 * aparición; `null` = ese pico se queda solo con su marcador.
 *
 * Dos etiquetas que se pisarían se apartan hacia los lados, sin dejar de cubrir
 * su marcador ni salirse del área. Si aun así no caben, pierde la etiqueta el
 * pico más bajo. Qué puntos son pico no cambia.
 */
export function layoutPeakLabels(
  peaks: readonly PeakLabelRequest[],
  { fontSize, gap, plot, radius }: PeakLabelLayoutOptions,
): ({ x: number; y: number } | null)[] {
  const slots: LabelSlot[] = peaks.map(({ cx, cy, textWidth }) => {
    const { x, y } = placePeakLabel({ cx, cy, fontSize, plot, radius, textWidth });
    const maxLeft = Math.max(plot.x, plot.x + plot.width - textWidth);
    const clamp = (left: number) => Math.min(Math.max(left, plot.x), maxLeft);

    return {
      left: x,
      max: Math.max(x, clamp(cx - radius)),
      min: Math.min(x, clamp(cx + radius - textWidth)),
      preferred: x,
      width: textWidth,
      y,
    };
  });
  const sameRow = (first: LabelSlot, second: LabelSlot) => Math.abs(first.y - second.y) < fontSize;
  const collide = (first: LabelSlot, second: LabelSlot) =>
    sameRow(first, second) &&
    first.left < second.left + second.width + gap &&
    second.left < first.left + first.width + gap;
  let shown = slots.map((_, index) => index).sort((a, b) => peaks[a].cx - peaks[b].cx);

  while (shown.length > 0) {
    // De izquierda a derecha cada etiqueta se aparta de la anterior; de vuelta,
    // la anterior cede lo que a la siguiente le faltó.
    shown.forEach((index, order) => {
      const slot = slots[index];
      const previous = order > 0 ? slots[shown[order - 1]] : null;
      const floor =
        previous && sameRow(previous, slot) ? previous.left + previous.width + gap : slot.min;

      slot.left = Math.min(slot.max, Math.max(slot.preferred, floor));
    });

    for (let order = shown.length - 2; order >= 0; order -= 1) {
      const slot = slots[shown[order]];
      const next = slots[shown[order + 1]];

      if (sameRow(slot, next)) {
        slot.left = Math.max(slot.min, Math.min(slot.left, next.left - gap - slot.width));
      }
    }

    const colliding = shown.filter((index) =>
      shown.some((other) => other !== index && collide(slots[index], slots[other])),
    );

    if (colliding.length === 0) {
      break;
    }

    const lowest = colliding.reduce((worst, index) =>
      peaks[index].value < peaks[worst].value ? index : worst,
    );

    shown = shown.filter((index) => index !== lowest);
  }

  return slots.map((slot, index) => (shown.includes(index) ? { x: slot.left, y: slot.y } : null));
}
