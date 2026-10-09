/** REP-01 · picos: máximos locales, top N, separación y colocación de la etiqueta. */
import { findLocalMaxima, findPeaks, peakMinGap, placePeakLabel } from "./peaks";

describe("findLocalMaxima", () => {
  it("devuelve los puntos más altos que sus dos vecinos", () => {
    expect(findLocalMaxima([1, 5, 2, 8, 3, 4, 1])).toEqual([1, 3, 5]);
  });

  it("cuenta los extremos si superan a su único vecino", () => {
    expect(findLocalMaxima([9, 2, 1, 7])).toEqual([0, 3]);
  });

  it("una meseta cuenta una vez, en su primer punto", () => {
    expect(findLocalMaxima([1, 6, 6, 6, 2])).toEqual([1]);
  });

  it("una serie plana (todo 0 o todo igual) no tiene máximos", () => {
    expect(findLocalMaxima([0, 0, 0, 0])).toEqual([]);
    expect(findLocalMaxima([4, 4, 4])).toEqual([]);
  });

  it("un solo punto es su propio máximo; sin dato, ninguno", () => {
    expect(findLocalMaxima([12])).toEqual([0]);
    expect(findLocalMaxima([0])).toEqual([0]);
    expect(findLocalMaxima([null])).toEqual([]);
    expect(findLocalMaxima([])).toEqual([]);
  });

  it("los huecos y los valores no finitos no son máximos ni rompen el cálculo", () => {
    expect(findLocalMaxima([1, null, 5, 2, Number.NaN, 3, undefined])).toEqual([2]);
    expect(findLocalMaxima([Number.POSITIVE_INFINITY, 1, 2, 1])).toEqual([2]);
  });

  it("admite valores negativos", () => {
    expect(findLocalMaxima([-5, -1, -3])).toEqual([1]);
  });
});

describe("findPeaks", () => {
  const values = [1, 5, 2, 8, 3, 4, 1, 9, 0];

  it("devuelve los N más altos en orden de aparición", () => {
    expect(findPeaks(values, 3)).toEqual([1, 3, 7]);
    expect(findPeaks(values, 2)).toEqual([3, 7]);
    expect(findPeaks(values, 1)).toEqual([7]);
  });

  it("si hay menos máximos que N, devuelve los que hay", () => {
    expect(findPeaks([1, 3, 1], 3)).toEqual([1]);
  });

  it("0, negativo o no finito apagan los picos", () => {
    expect(findPeaks(values, 0)).toEqual([]);
    expect(findPeaks(values, -2)).toEqual([]);
    expect(findPeaks(values, Number.NaN)).toEqual([]);
  });

  it("a igual valor gana el que aparece antes", () => {
    expect(findPeaks([1, 7, 1, 7, 1, 7, 1], 2)).toEqual([1, 3]);
  });

  it("con separación mínima descarta el pico pegado a otro más alto", () => {
    // 8 (índice 3) y 9 (índice 7) quedan; 5 (índice 1) está a 2 del 8.
    expect(findPeaks(values, 3, 3)).toEqual([3, 7]);
    expect(findPeaks(values, 3, 5)).toEqual([1, 7]);
  });

  it("no se cuelga con un rango de 2 años", () => {
    const long = Array.from({ length: 730 }, (_, index) => Math.sin(index / 5) * 100 + index);

    expect(findPeaks(long, 3)).toHaveLength(3);
  });
});

describe("peakMinGap", () => {
  it("separa más cuanto más juntos quedan los puntos", () => {
    expect(peakMinGap(7, 300, 80)).toBe(2);
    expect(peakMinGap(30, 300, 80)).toBe(8);
    expect(peakMinGap(730, 300, 80)).toBe(195);
  });

  it("con un punto, sin ancho o sin etiqueta no divide por cero", () => {
    expect(peakMinGap(1, 300, 80)).toBe(1);
    expect(peakMinGap(0, 300, 80)).toBe(1);
    expect(peakMinGap(10, 0, 80)).toBe(1);
    expect(peakMinGap(10, Number.NaN, 80)).toBe(1);
    expect(peakMinGap(10, 300, 0)).toBe(1);
  });
});

describe("placePeakLabel", () => {
  const plot = { height: 240, width: 300, x: 52, y: 8 };
  const base = { fontSize: 11, plot, radius: 6, textWidth: 80 };

  it("centra la etiqueta sobre el marcador", () => {
    expect(placePeakLabel({ ...base, cx: 200, cy: 100 })).toEqual({ x: 160, y: 90 });
  });

  it("no se sale por la izquierda ni por la derecha", () => {
    expect(placePeakLabel({ ...base, cx: 55, cy: 100 }).x).toBe(52);
    expect(placePeakLabel({ ...base, cx: 350, cy: 100 }).x).toBe(272);
  });

  it("si no cabe arriba, va debajo del marcador", () => {
    expect(placePeakLabel({ ...base, cx: 200, cy: 12 }).y).toBe(31);
  });

  it("una etiqueta más ancha que el área empieza en su borde izquierdo", () => {
    expect(placePeakLabel({ ...base, cx: 200, cy: 100, textWidth: 500 }).x).toBe(52);
  });
});
