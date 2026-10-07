import { roundMoney } from "./currency";

/**
 * Ganancia = markup sobre el costo, todo en REF.
 * El costo que reciben estas funciones YA incluye el IVA: aquí no se aplica ningún impuesto.
 */

export type MarginBand = "low" | "mid" | "high";

export type MarginThresholds = {
  /** Por debajo de este % la banda es `low` (rojo). */
  low: number;
  /** Desde este % la banda es `high` (verde). */
  high: number;
};

/** Rojo < 15 %, amarillo 15–24,9 %, verde ≥ 25 %. */
export const DEFAULT_MARGIN_THRESHOLDS: MarginThresholds = { low: 15, high: 25 };

/** Chips de % de ganancia recomendados. */
export const DEFAULT_MARKUP_CHIPS: readonly number[] = [12, 20, 30];

const BAND_RANK: Record<MarginBand, number> = { low: 0, mid: 1, high: 2 };

/** 100 % expresado en centésimas de punto: el factor `1 + pct / 100` como entero. */
const PCT_SCALE = 10000;

/** Quita el ruido binario (1.15 − 1 = 0.1499…) sin alterar un % real. */
function cleanPct(value: number) {
  const cleaned = Math.round(value * 1e6) / 1e6;

  // Evita el cero negativo (−0) cuando el ruido era negativo.
  return cleaned === 0 ? 0 : cleaned;
}

/**
 * % de ganancia sobre el costo: `(price − cost) / cost × 100`.
 * Devuelve `null` si no hay % definible (costo 0, negativo o no finito, o precio no finito).
 * Un precio por debajo del costo da un % negativo.
 */
export function markupPct(cost: number, price: number): number | null {
  if (!Number.isFinite(cost) || !Number.isFinite(price) || cost <= 0) {
    return null;
  }

  return cleanPct(((price - cost) / cost) * 100);
}

/**
 * Precio que deja `pct` % de ganancia sobre el costo, redondeado a dinero.
 * Costo 0 (o cualquier valor no utilizable) da 0; nunca devuelve un precio negativo.
 *
 * Se calcula en enteros (céntimos × diezmilésimas del factor) para que un empate exacto de
 * medio céntimo suba: en coma flotante 1.02 × 1.25 da 1.27499… y se redondearía hacia abajo.
 * El costo se toma al céntimo y el % a dos decimales.
 */
export function priceFromMarkup(cost: number, pct: number): number {
  if (!Number.isFinite(cost) || !Number.isFinite(pct) || cost <= 0) {
    return 0;
  }

  const costCents = Math.round(cost * 100);
  const factor = PCT_SCALE + Math.round(pct * 100);
  const scaled = costCents * factor;

  if (!Number.isSafeInteger(scaled)) {
    // Fuera del rango entero exacto (montos astronómicos) no hay empate que proteger.
    return Math.max(0, roundMoney(cost * (1 + pct / 100)));
  }

  if (scaled <= 0) {
    return 0;
  }

  const remainder = scaled % PCT_SCALE;
  const priceCents = (scaled - remainder) / PCT_SCALE + (remainder * 2 >= PCT_SCALE ? 1 : 0);

  return priceCents / 100;
}

/** Banda del semáforo. Sin % (`null`), negativo o no finito es `low`. */
export function marginBand(
  pct: number | null,
  thresholds: MarginThresholds = DEFAULT_MARGIN_THRESHOLDS,
): MarginBand {
  if (pct === null || !Number.isFinite(pct) || pct < 0 || pct < thresholds.low) {
    return "low";
  }

  return pct < thresholds.high ? "mid" : "high";
}

/** `true` solo si la banda empeoró: high→mid, mid→low o high→low. */
export function bandDrop(prevBand: MarginBand, currentBand: MarginBand): boolean {
  return BAND_RANK[currentBand] < BAND_RANK[prevBand];
}
