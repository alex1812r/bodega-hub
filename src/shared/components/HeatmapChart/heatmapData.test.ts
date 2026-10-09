import { cellValue, HEAT_LEVELS, heatLevel, isLabeledColumn, maxHeatValue } from "./heatmapData";

describe("heatmapData", () => {
  it("heatLevel reparte los valores positivos en cinco pasos y deja el 0 sin nivel", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(-5, 100)).toBe(0);
    expect(heatLevel(0.01, 100)).toBe(1);
    expect(heatLevel(20, 100)).toBe(1);
    expect(heatLevel(21, 100)).toBe(2);
    expect(heatLevel(60, 100)).toBe(3);
    expect(heatLevel(100, 100)).toBe(HEAT_LEVELS);
    expect(heatLevel(150, 100)).toBe(HEAT_LEVELS);
  });

  it("nunca devuelve NaN: máximo 0, valores no numéricos o infinitos", () => {
    expect(heatLevel(0, 0)).toBe(0);
    expect(heatLevel(10, 0)).toBe(0);
    expect(heatLevel(Number.NaN, 10)).toBe(0);
    expect(heatLevel(10, Number.NaN)).toBe(0);
    expect(heatLevel(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });

  it("maxHeatValue ignora negativos y valores no numéricos", () => {
    expect(maxHeatValue([])).toBe(0);
    expect(maxHeatValue([[0, 0], [0]])).toBe(0);
    expect(maxHeatValue([[-3, 4], [Number.NaN, 9.5]])).toBe(9.5);
  });

  it("cellValue devuelve 0 en un hueco de la matriz", () => {
    expect(cellValue([[1, 2]], 0, 1)).toBe(2);
    expect(cellValue([[1, 2]], 0, 5)).toBe(0);
    expect(cellValue([[1, 2]], 3, 0)).toBe(0);
  });

  it("isLabeledColumn rotula una de cada N y tolera pasos inválidos", () => {
    expect([0, 1, 2, 3, 4, 5, 6].filter((index) => isLabeledColumn(index, 3))).toEqual([0, 3, 6]);
    expect(isLabeledColumn(1, 0)).toBe(true);
    expect(isLabeledColumn(1, Number.NaN)).toBe(true);
  });
});
