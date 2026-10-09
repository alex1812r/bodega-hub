/** Niveles de intensidad con dato (el 0 es «sin valor» y no cuenta). */
export const HEAT_LEVELS = 5;

/**
 * Opacidad del color de la serie en cada nivel, del 0 (sin valor: no se pinta)
 * al 5 (el máximo). Un solo tono en escala secuencial: más opaco = más valor,
 * en claro y en oscuro, porque el fondo de la celda es la superficie del tema.
 */
export const HEAT_LEVEL_OPACITY = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

function finiteOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Valor de la celda ya saneado: lo que no es un número finito cuenta como 0. */
export function cellValue(values: readonly (readonly number[])[], row: number, column: number) {
  return finiteOrZero(values[row]?.[column]);
}

/** Mayor valor positivo de la matriz; 0 si no hay ninguno. */
export function maxHeatValue(values: readonly (readonly number[])[]) {
  let max = 0;

  for (const row of values) {
    for (const value of row) {
      max = Math.max(max, finiteOrZero(value));
    }
  }

  return max;
}

/**
 * Nivel de 0 a `HEAT_LEVELS`. 0 = sin valor (0, negativo o no numérico, o una
 * matriz toda en 0); cualquier valor positivo llega al menos al nivel 1.
 */
export function heatLevel(value: number, max: number) {
  const safeValue = finiteOrZero(value);
  const safeMax = finiteOrZero(max);

  if (safeValue <= 0 || safeMax <= 0) {
    return 0;
  }

  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((safeValue / safeMax) * HEAT_LEVELS)));
}

/** Se rotula una de cada `every` columnas, empezando por la primera. */
export function isLabeledColumn(index: number, every: number) {
  const step = Number.isFinite(every) && every >= 1 ? Math.trunc(every) : 1;

  return index % step === 0;
}
