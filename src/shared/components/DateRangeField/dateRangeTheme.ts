/**
 * Colores de `DateRangeField` y su calendario: solo utilidades de tokens del
 * tema (`globals.css`). `dateRangeTheme.test.ts` calcula con los valores reales
 * que cada par cumple el contraste en claro y en oscuro.
 */
export const DATE_RANGE_COLOR_CLASSES = {
  /** Fondo del popover del calendario. */
  popover: "bg-surface-container-lowest",
  /**
   * Chip activo y días de inicio y fin del rango. En oscuro `--on-primary`
   * sobre `--primary` se queda en 4,47:1, así que usa el par fijo
   * `--on-primary-fixed` sobre `--primary-fixed-dim` (10:1).
   */
  selected: "bg-primary text-on-primary dark:bg-primary-fixed-dim dark:text-on-primary-fixed",
  /**
   * Banda que une los días del rango. En claro `--surface-container-high`
   * apenas se separa del blanco (1,23:1): usa `--primary-fixed-dim`.
   */
  rangeBand: "bg-primary-fixed-dim dark:bg-surface-container-high",
  /** Número de un día (también sobre la banda). */
  rangeDayText: "text-on-surface",
} as const;
