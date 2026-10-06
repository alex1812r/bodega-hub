/**
 * Generador pseudoaleatorio determinista (mulberry32) para los agentes del
 * laboratorio de stock (plan stock-integrity, fase 3, STK-302).
 *
 * Misma semilla → misma secuencia, así un run se puede reproducir.
 */

export type Rng = {
  /** Número en [0, 1). */
  next(): number;
  /** Entero en [min, max], ambos inclusive. */
  int(min: number, max: number): number;
  /** Un elemento del array; lanza si está vacío. */
  pick<T>(arr: readonly T[]): T;
  /** true con probabilidad p (0 → nunca, 1 → siempre). */
  chance(p: number): boolean;
  /** Copia barajada (Fisher-Yates); no muta el original. */
  shuffle<T>(arr: readonly T[]): T[];
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) {
    throw new Error(`createRng: la semilla debe ser un número finito (recibido ${String(seed)}).`);
  }
  const next = mulberry32(Math.trunc(seed));

  const rng: Rng = {
    next,
    int(min, max) {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(arr) {
      if (arr.length === 0) {
        throw new Error("rng.pick: el array está vacío.");
      }
      return arr[rng.int(0, arr.length - 1)] as (typeof arr)[number];
    },
    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return next() < p;
    },
    shuffle(arr) {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        const tmp = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = tmp;
      }
      return out;
    },
  };

  return rng;
}
