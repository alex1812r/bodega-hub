export type YScale = {
  domain: [number, number];
  ticks: number[];
};

type YScaleOptions = {
  /** Aire sobre el valor más alto, como fracción del rango: ahí va la etiqueta del pico. */
  headroom?: number;
  /** Número aproximado de divisiones del eje. */
  tickCount?: number;
};

/** Paso «redondo» (1, 2, 2,5, 5 × 10ⁿ) igual o mayor que `raw`. */
function niceStep(raw: number) {
  const base = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / base;
  const nice = [1, 2, 2.5, 5, 10].find((candidate) => fraction <= candidate) ?? 10;

  return nice * base;
}

/**
 * Dominio y ticks del eje Y. Siempre incluye el 0, ignora los valores sin dato
 * y nunca devuelve un dominio de ancho 0: sin datos, con un solo punto en 0 o
 * con todo en 0 el eje queda en 0–1.
 */
export function computeYScale(
  values: readonly (number | null | undefined)[],
  { headroom = 0.15, tickCount = 4 }: YScaleOptions = {},
): YScale {
  let min = 0;
  let max = 0;

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  if (min === max) {
    return { domain: [0, 1], ticks: [0, 1] };
  }

  const paddedMax = max > 0 ? max + (max - min) * Math.max(0, headroom) : max;
  const step = niceStep((paddedMax - min) / Math.max(1, tickCount));
  const first = Math.floor(min / step);
  const last = Math.ceil(paddedMax / step);
  const ticks: number[] = [];

  for (let multiple = first; multiple <= last; multiple += 1) {
    // `toPrecision` quita el arrastre binario de 3 × 0,1 y similares.
    ticks.push(Number((multiple * step).toPrecision(12)));
  }

  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

const axisNumberFormatter = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 1 });

/** Valor corto para el eje Y: `950`, `1,5 mil`, `2,3 M`. La moneda la dice el control REF / Bs. */
export function formatAxisValue(value: number) {
  if (!Number.isFinite(value)) {
    return "";
  }

  const magnitude = Math.abs(value);

  if (magnitude >= 1_000_000) {
    return `${axisNumberFormatter.format(value / 1_000_000)} M`;
  }

  if (magnitude >= 1_000) {
    return `${axisNumberFormatter.format(value / 1_000)} mil`;
  }

  return axisNumberFormatter.format(value);
}
