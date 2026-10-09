/** REP-01 · picos: máximos locales, top N y colocación de las etiquetas. */
import { findLocalMaxima, findPeaks, layoutPeakLabels, placePeakLabel } from "./peaks";

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

  it("dos picos vecinos siguen siendo los dos picos: no se descarta por cercanía (REP-F1)", () => {
    // 9 (índice 7), 8 (índice 3) y 7 (índice 5): el 7 queda a 2 posiciones de ambos.
    expect(findPeaks([1, 5, 2, 8, 3, 7, 1, 9, 0], 3)).toEqual([3, 5, 7]);
  });

  describe("extremos de la serie (REP-F1)", () => {
    it("un extremo bajo no es pico aunque supere a su único vecino", () => {
      // El último punto (90) sube desde 30, pero está en la mitad baja del rango.
      expect(findPeaks([10, 300, 20, 280, 40, 30, 90], 3)).toEqual([1, 3]);
      expect(findPeaks([90, 30, 300, 20, 280, 40, 10], 3)).toEqual([2, 4]);
    });

    it("un extremo alto sí es pico", () => {
      expect(findPeaks([900, 10, 20, 10, 20, 10, 950], 2)).toEqual([0, 6]);
      expect(findPeaks([1, 2, 3, 4, 5], 3)).toEqual([4]);
      expect(findPeaks([9, 2, 1, 7], 3)).toEqual([0, 3]);
    });

    it("un solo punto sigue siendo su propio pico", () => {
      expect(findPeaks([45], 3)).toEqual([0]);
    });

    it("con valores negativos el corte es la mitad del rango, no el cero", () => {
      expect(findPeaks([-10, -90, -20, -100, -80], 3)).toEqual([0, 2]);
    });
  });

  it("no se cuelga con un rango de 2 años", () => {
    const long = Array.from({ length: 730 }, (_, index) => Math.sin(index / 5) * 100 + index);

    expect(findPeaks(long, 3)).toHaveLength(3);
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

describe("layoutPeakLabels (REP-F1)", () => {
  const plot = { height: 240, width: 262, x: 52, y: 8 };
  const options = { fontSize: 11, gap: 4, plot, radius: 6 };

  function overlaps(
    first: { x: number; y: number } | null,
    second: { x: number; y: number } | null,
    width: number,
  ) {
    return (
      first !== null &&
      second !== null &&
      first.x < second.x + width &&
      second.x < first.x + width &&
      Math.abs(first.y - second.y) < options.fontSize
    );
  }

  it("sin colisión, cada etiqueta queda centrada sobre su marcador", () => {
    const layout = layoutPeakLabels(
      [
        { cx: 100, cy: 100, textWidth: 60, value: 5 },
        { cx: 250, cy: 80, textWidth: 60, value: 8 },
      ],
      options,
    );

    expect(layout).toEqual([
      { x: 70, y: 90 },
      { x: 220, y: 70 },
    ]);
  });

  it("los picos del móvil (07/03, 21/03, 28/03 en 262 px) conservan las tres etiquetas sin pisarse", () => {
    // Paso de 8,2 px entre puntos: 21/03 y 28/03 quedan a 57 px con etiquetas de 66.
    const peaks = [
      { cx: 105, cy: 90, textWidth: 66, value: 362.81 },
      { cx: 220, cy: 84, textWidth: 66, value: 376.4 },
      { cx: 277, cy: 88, textWidth: 66, value: 367.33 },
    ];
    const layout = layoutPeakLabels(peaks, options);

    expect(layout.every((position) => position !== null)).toBe(true);
    expect(overlaps(layout[0], layout[1], 66)).toBe(false);
    expect(overlaps(layout[1], layout[2], 66)).toBe(false);
    layout.forEach((position, index) => {
      // Dentro del área y todavía sobre su marcador.
      expect(position?.x).toBeGreaterThanOrEqual(plot.x);
      expect((position?.x ?? 0) + 66).toBeLessThanOrEqual(plot.x + plot.width);
      expect(position?.x).toBeLessThanOrEqual(peaks[index].cx - options.radius);
      expect((position?.x ?? 0) + 66).toBeGreaterThanOrEqual(peaks[index].cx + options.radius);
    });
  });

  it("si no caben, se queda sin etiqueta el pico más bajo (el marcador no depende de esto)", () => {
    const layout = layoutPeakLabels(
      [
        { cx: 150, cy: 90, textWidth: 66, value: 300 },
        { cx: 158, cy: 88, textWidth: 66, value: 310 },
      ],
      options,
    );

    expect(layout[0]).toBeNull();
    expect(layout[1]).not.toBeNull();
  });

  it("dos etiquetas a distinta altura no se estorban aunque compartan columna", () => {
    const layout = layoutPeakLabels(
      [
        { cx: 150, cy: 200, textWidth: 66, value: 100 },
        { cx: 158, cy: 60, textWidth: 66, value: 310 },
      ],
      options,
    );

    expect(layout.every((position) => position !== null)).toBe(true);
  });

  it("sin picos devuelve vacío", () => {
    expect(layoutPeakLabels([], options)).toEqual([]);
  });
});
