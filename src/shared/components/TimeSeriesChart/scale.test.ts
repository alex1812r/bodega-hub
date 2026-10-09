/** REP-01 · eje Y: dominio estable, sin NaN ni ancho 0, y ticks cortos. */
import { computeYScale, formatAxisValue } from "./scale";

function expectSaneScale(values: (number | null | undefined)[]) {
  const scale = computeYScale(values);

  expect(scale.domain.every(Number.isFinite)).toBe(true);
  expect(scale.ticks.every(Number.isFinite)).toBe(true);
  expect(scale.domain[1]).toBeGreaterThan(scale.domain[0]);
  expect(scale.ticks[0]).toBe(scale.domain[0]);
  expect(scale.ticks[scale.ticks.length - 1]).toBe(scale.domain[1]);

  return scale;
}

describe("computeYScale", () => {
  it("parte de 0 y deja aire sobre el máximo para la etiqueta del pico", () => {
    const scale = expectSaneScale([120, 80, 200]);

    expect(scale.domain[0]).toBe(0);
    expect(scale.domain[1]).toBeGreaterThanOrEqual(230);
    expect(scale.ticks).toEqual([0, 100, 200, 300]);
  });

  it("un solo punto da un eje normal", () => {
    const scale = expectSaneScale([45]);

    expect(scale.domain[0]).toBe(0);
    expect(scale.domain[1]).toBeGreaterThan(45);
  });

  it("todo en 0, un solo 0 o sin datos: eje fijo 0–1", () => {
    expect(computeYScale([0, 0, 0])).toEqual({ domain: [0, 1], ticks: [0, 1] });
    expect(computeYScale([0])).toEqual({ domain: [0, 1], ticks: [0, 1] });
    expect(computeYScale([])).toEqual({ domain: [0, 1], ticks: [0, 1] });
    expect(computeYScale([null, undefined, Number.NaN])).toEqual({ domain: [0, 1], ticks: [0, 1] });
  });

  it("ignora los valores sin dato y los no finitos", () => {
    const scale = expectSaneScale([null, 50, Number.POSITIVE_INFINITY, undefined]);

    expect(scale.domain[1]).toBeLessThan(200);
  });

  it("incluye los negativos (ganancia bruta en pérdida)", () => {
    const scale = expectSaneScale([-30, 40, 10]);

    expect(scale.domain[0]).toBeLessThanOrEqual(-30);
    expect(scale.ticks).toContain(0);
  });

  it("solo negativos: el eje termina en 0", () => {
    const scale = expectSaneScale([-10, -40]);

    expect(scale.domain[1]).toBe(0);
    expect(scale.domain[0]).toBeLessThanOrEqual(-40);
  });

  it("no arrastra decimales binarios en los ticks", () => {
    expect(computeYScale([0.25]).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("valores enormes en Bs y minúsculos siguen dando pocos ticks", () => {
    expect(expectSaneScale([4_812_345_678.9]).ticks.length).toBeLessThanOrEqual(7);
    expect(expectSaneScale([0.004]).ticks.length).toBeLessThanOrEqual(7);
  });
});

describe("formatAxisValue", () => {
  it("abrevia miles y millones", () => {
    expect(formatAxisValue(0)).toBe("0");
    expect(formatAxisValue(950)).toBe("950");
    expect(formatAxisValue(0.5)).toBe("0,5");
    expect(formatAxisValue(1500)).toBe("1,5 mil");
    expect(formatAxisValue(25_000)).toBe("25 mil");
    expect(formatAxisValue(2_300_000)).toBe("2,3 M");
    expect(formatAxisValue(-1200)).toBe("-1,2 mil");
  });

  it("no pinta NaN", () => {
    expect(formatAxisValue(Number.NaN)).toBe("");
    expect(formatAxisValue(Number.POSITIVE_INFINITY)).toBe("");
  });
});
