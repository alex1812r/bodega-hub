/** @jest-environment node */
/**
 * Lógica pura de los escenarios `pack.assorted_*` (PRO-12): el oráculo del reparto de costo y el catálogo de casos.
 * Sin base ni red. Los escenarios en sí corren con `npm run stock-lab:scenarios -- --suite hypotheses`.
 */
import { ASSORTED_PACK_CASES, allocateCost, weightedCost } from "./assorted-pack";
import { HYPOTHESIS_CASES } from "./hypotheses";

const sum = (parts: Record<string, number>): number => Math.round(Object.values(parts).reduce((total, value) => total + value, 0) * 10_000) / 10_000;

describe("allocateCost (reparto del valor del empaque entre componentes)", () => {
  it("un solo componente se lleva todo el valor, sea cual sea su peso", () => {
    expect(allocateCost(15.54, [{ id: "a", units: 12, weight: 7 }])).toEqual({ a: 15.54 });
  });

  it("pesos iguales: partes iguales y el residuo del redondeo al componente de mayor id", () => {
    const parts = allocateCost(0.1, [
      { id: "a", units: 2, weight: 1 },
      { id: "c", units: 2, weight: 1 },
      { id: "b", units: 2, weight: 1 },
    ]);
    expect(parts).toEqual({ a: 0.0333, b: 0.0333, c: 0.0334 });
    expect(sum(parts)).toBe(0.1);
  });

  it("pesos distintos: proporcional a unidades × peso y el residuo al de mayor peso", () => {
    const parts = allocateCost(10.01, [
      { id: "a", units: 2, weight: 1 },
      { id: "b", units: 2, weight: 3 },
      { id: "c", units: 2, weight: 0.5 },
    ]);
    expect(parts).toEqual({ a: 2.2244, b: 6.6734, c: 1.1122 });
    expect(sum(parts)).toBe(10.01);
  });

  it("los componentes con 0 unidades no reciben nada ni cuentan en el reparto", () => {
    expect(allocateCost(6, [{ id: "a", units: 6, weight: 1 }, { id: "b", units: 0, weight: 100 }])).toEqual({ a: 6 });
    expect(allocateCost(6, [{ id: "a", units: 0, weight: 1 }])).toEqual({});
  });

  it.each([
    [123456.78, [3, 1, 2], [1, 1, 1]],
    [0.01, [1, 1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6, 7]],
    [99.99, [5, 7, 11], [0.3333, 2.5, 1]],
    [0, [2, 2, 2], [1, 1, 1]],
  ])("conserva el valor (%s en %j con pesos %j)", (transferred, units, weights) => {
    const parts = allocateCost(transferred, units.map((u, i) => ({ id: `p${i}`, units: u, weight: weights[i] ?? 1 })));
    expect(sum(parts)).toBe(transferred);
    expect(Object.values(parts).every((value) => value >= 0)).toBe(true);
  });
});

describe("weightedCost (costo del componente tras la entrada)", () => {
  it("sin stock previo toma el costo de la entrada", () => {
    expect(weightedCost(0, 9.99, 12, 15.54)).toBe(1.3);
    expect(weightedCost(-3, 9.99, 7, 0.01)).toBe(0);
  });

  it("con stock previo es el promedio ponderado a 2 decimales", () => {
    // (5 × 1,33 + 15,54) / 17 = 1,3053
    expect(weightedCost(5, 1.33, 12, 15.54)).toBe(1.31);
    // (6 × 1,00 + 3,00) / 8 = 1,125 → 1,13
    expect(weightedCost(6, 1, 2, 3)).toBe(1.13);
  });
});

describe("catálogo pack.assorted_*", () => {
  const ids = ASSORTED_PACK_CASES.map((c) => c.id);

  it("ids únicos con prefijo pack.assorted_ que no chocan con los de hipótesis", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^pack\.assorted_[a-z0-9_]+$/);
    expect(HYPOTHESIS_CASES.map((c) => c.id).filter((id) => ids.includes(id))).toEqual([]);
  });

  it("cubre los escenarios del ticket PRO-12", () => {
    expect(ids).toEqual([
      "pack.assorted_recipe_222",
      "pack.assorted_real_312",
      "pack.assorted_bad_sum",
      "pack.assorted_cost_weights",
      "pack.assorted_shared_unit_parallel",
      "pack.assorted_double_submit",
      "pack.assorted_zero_packs",
      "pack.assorted_inactive_component",
    ]);
  });
});
