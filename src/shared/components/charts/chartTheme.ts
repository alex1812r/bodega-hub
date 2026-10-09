/**
 * Única fuente de colores para los gráficos. Todo sale de los tokens de
 * `src/app/globals.css` (`:root` y `.dark`), así que un gráfico cambia de tema
 * sin volver a renderizar: el navegador resuelve `var(--token)` en `stroke` /
 * `fill`.
 *
 * Ningún componente de gráfico escribe un color literal: importa de aquí.
 */

/** Referencia CSS a un token del tema, p. ej. `var(--primary)`. */
function token(name: string) {
  return `var(--${name})`;
}

/**
 * Mezcla de dos tokens. Sirve para los tonos de serie que el tema no trae como
 * token propio; al mezclar tokens, el resultado sigue cambiando con el tema.
 */
function mix(first: string, firstPercent: number, second: string) {
  return `color-mix(in srgb, ${token(first)} ${firstPercent}%, ${token(second)})`;
}

/**
 * Paleta categórica: hasta 5 series, en este orden. Cada color llega a 3:1
 * sobre `--surface` y `--surface-container-lowest` en claro y en oscuro
 * (`chartTheme.test.ts` lo calcula con los valores de `globals.css`).
 *
 * - Ámbar: `--tertiary` solo no llega a 3:1 en claro, y `--tertiary-container`
 *   no se lee en oscuro; mezclado con `--on-surface` se oscurece en claro y se
 *   aclara en oscuro.
 * - Magenta: no hay token; sale de `--error` + `--primary`. Se evita `--error`
 *   puro para que una serie no parezca un fallo.
 */
export const CHART_SERIES_COLORS = [
  token("primary"),
  token("secondary-stitch"),
  mix("tertiary", 70, "on-surface"),
  mix("error", 60, "primary"),
  token("on-surface-variant"),
] as const;

/** Máximo de series que la paleta distingue. */
export const CHART_MAX_SERIES = CHART_SERIES_COLORS.length;

/** Color de la serie `index` (0-based). Pasado el máximo, la paleta se repite. */
export function getChartSeriesColor(index: number) {
  const position = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;

  return CHART_SERIES_COLORS[position % CHART_SERIES_COLORS.length];
}

/** Ejes, rejilla, texto y cursor. */
export const CHART_COLORS = {
  /** Línea del eje y línea de cero. */
  axis: token("outline"),
  /** Texto de los ticks: AA sobre todas las superficies. */
  axisText: token("on-surface-variant"),
  /** Rejilla: separador decorativo. */
  grid: token("outline-variant"),
  /** Línea vertical que sigue al puntero. */
  cursor: token("outline"),
  /** Etiquetas de valor dibujadas sobre el gráfico (picos). */
  label: token("on-surface"),
  /** Borde de los marcadores y halo de las etiquetas: los separa de la línea que cruzan. */
  markerOutline: token("surface"),
} as const;

/** Caja del tooltip. */
export const CHART_TOOLTIP_COLORS = {
  background: token("surface-container-lowest"),
  border: token("outline-variant"),
  text: token("on-surface"),
  mutedText: token("on-surface-variant"),
} as const;

/** Tamaño de letra de ticks y etiquetas, en px. */
export const CHART_FONT_SIZE = 11;

/**
 * Serie del periodo anterior: mismo color que su serie actual, discontinua y
 * atenuada, sin marcadores.
 */
export const CHART_PREVIOUS_SERIES_STYLE = {
  strokeDasharray: "5 4",
  strokeOpacity: 0.5,
  strokeWidth: 1.5,
} as const;

/** Serie actual. */
export const CHART_SERIES_STYLE = {
  strokeWidth: 2,
  /** Radio del marcador de cada punto. */
  dotRadius: 3,
  /** Radio del marcador bajo el puntero. */
  activeDotRadius: 5,
  /** Radio del marcador de un pico. */
  peakDotRadius: 6,
} as const;
