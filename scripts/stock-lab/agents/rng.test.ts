import { createRng } from "./rng";

describe("createRng", () => {
  it("misma semilla produce la misma secuencia de 20 números", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("semillas distintas producen secuencias distintas", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("int(min, max) es inclusivo en ambos extremos y nunca se sale del rango", () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.int(3, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it("int acepta min === max y argumentos invertidos", () => {
    const rng = createRng(3);
    expect(rng.int(5, 5)).toBe(5);
    const value = rng.int(9, 2);
    expect(value).toBeGreaterThanOrEqual(2);
    expect(value).toBeLessThanOrEqual(9);
  });

  it("pick cubre todos los elementos y lanza con array vacío", () => {
    const rng = createRng(11);
    const items = ["a", "b", "c", "d"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(rng.pick(items));
    }
    expect([...seen].sort()).toEqual([...items]);
    expect(() => rng.pick([])).toThrow("vacío");
  });

  it("chance respeta los extremos y es determinista", () => {
    const rng = createRng(5);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    const a = createRng(9);
    const b = createRng(9);
    const seqA = Array.from({ length: 50 }, () => a.chance(0.5));
    const seqB = Array.from({ length: 50 }, () => b.chance(0.5));
    expect(seqA).toEqual(seqB);
    expect(seqA).toContain(true);
    expect(seqA).toContain(false);
  });

  it("shuffle devuelve una permutación sin mutar el original", () => {
    const rng = createRng(21);
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(original);
    expect(original).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(original);
    expect(createRng(21).shuffle(original)).toEqual(shuffled);
  });
});
