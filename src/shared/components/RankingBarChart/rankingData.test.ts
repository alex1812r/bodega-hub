import {
  barSpan,
  computeBarScale,
  describeDeltaPct,
  formatDeltaPct,
  hasComparison,
  normalizeTopN,
  rankItems,
  summarizeRanking,
  truncateLabel,
  type RankingBarItem,
} from "./rankingData";

function items(values: number[]): RankingBarItem[] {
  return values.map((value, index) => ({ id: `i${index}`, label: `Elemento ${index}`, value }));
}

describe("rankItems", () => {
  it("ordena de mayor a menor y numera desde 1", () => {
    const ranked = rankItems(items([5, 30, 12]));

    expect(ranked.map((item) => item.value)).toEqual([30, 12, 5]);
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("los empates conservan el orden de llegada", () => {
    expect(rankItems(items([7, 7, 7])).map((item) => item.id)).toEqual(["i0", "i1", "i2"]);
  });

  it("se queda con los topN primeros; por defecto 10", () => {
    const many = items(Array.from({ length: 25 }, (_, index) => index));

    expect(rankItems(many)).toHaveLength(10);
    expect(rankItems(many, 3).map((item) => item.value)).toEqual([24, 23, 22]);
    expect(rankItems(many, 100)).toHaveLength(25);
  });

  it("un topN inválido cae al valor por defecto", () => {
    expect(normalizeTopN(0)).toBe(10);
    expect(normalizeTopN(-4)).toBe(10);
    expect(normalizeTopN(Number.NaN)).toBe(10);
    expect(normalizeTopN(undefined)).toBe(10);
    expect(normalizeTopN(3.9)).toBe(3);
  });

  it("un valor no numérico cuenta como 0 y el anterior como null", () => {
    const [first] = rankItems([
      { id: "a", label: "A", previousValue: Number.NaN, value: Number.POSITIVE_INFINITY },
    ]);

    expect(first.value).toBe(0);
    expect(first.previousValue).toBeNull();
  });

  it("no modifica la lista recibida", () => {
    const source = items([1, 3, 2]);

    rankItems(source);

    expect(source.map((item) => item.value)).toEqual([1, 3, 2]);
  });
});

describe("hasComparison", () => {
  it("solo cuando algún elemento declara periodo anterior, aunque sea null", () => {
    expect(hasComparison(items([1, 2]))).toBe(false);
    expect(hasComparison([{ id: "a", label: "A", previousValue: null, value: 1 }])).toBe(true);
  });
});

describe("truncateLabel", () => {
  it("deja igual lo que cabe y recorta con puntos suspensivos lo que no", () => {
    expect(truncateLabel("Harina PAN", 20)).toBe("Harina PAN");
    expect(truncateLabel("Harina de maíz precocida blanca", 12)).toBe("Harina de m…");
    expect([...truncateLabel("Harina de maíz precocida blanca", 12)]).toHaveLength(12);
  });

  it("nunca devuelve vacío con límites absurdos", () => {
    expect(truncateLabel("Queso", 0)).toBe("Q…");
    expect(truncateLabel("Queso", Number.NaN)).toBe("Q…");
  });
});

describe("formatDeltaPct", () => {
  it("flecha y texto según el signo", () => {
    expect(formatDeltaPct(12.5)).toBe("↑ 12,5 %");
    expect(formatDeltaPct(-3)).toBe("↓ 3 %");
    expect(formatDeltaPct(0)).toBe("0 %");
  });

  it("sin periodo anterior comparable muestra una raya, nunca NaN ni Infinity", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDeltaPct(value)).toBe("—");
    }
  });

  it("en palabras para lectores de pantalla", () => {
    expect(describeDeltaPct(12.5)).toBe("sube 12,5 %");
    expect(describeDeltaPct(-3)).toBe("baja 3 %");
    expect(describeDeltaPct(0)).toBe("sin cambio");
    expect(describeDeltaPct(null)).toBe("sin periodo anterior comparable");
  });
});

describe("computeBarScale", () => {
  it("reparte de 0 al máximo", () => {
    const scale = computeBarScale([50, 100], 200);

    expect(scale.zeroX).toBe(0);
    expect(scale.toX(100)).toBe(200);
    expect(scale.toX(50)).toBe(100);
    expect(scale.hasNegative).toBe(false);
  });

  it("con negativos el cero queda dentro del área", () => {
    const scale = computeBarScale([-50, 150], 200);

    expect(scale.hasNegative).toBe(true);
    expect(scale.zeroX).toBe(50);
    expect(barSpan(scale, -50)).toEqual({ width: 50, x: 0 });
    expect(barSpan(scale, 150)).toEqual({ width: 150, x: 50 });
  });

  it("todo en 0, una sola fila o sin valores: nunca NaN", () => {
    for (const values of [[0, 0, 0], [0], [], [Number.NaN]]) {
      const scale = computeBarScale(values, 200);

      expect(scale.zeroX).toBe(0);
      expect(scale.toX(0)).toBe(0);
      expect(barSpan(scale, 0, 2)).toEqual({ width: 0, x: 0 });
    }

    expect(computeBarScale([40], 200).toX(40)).toBe(200);
    expect(computeBarScale([40], Number.NaN).toX(40)).toBe(0);
  });

  it("una barra distinta de 0 nunca queda más fina que el mínimo", () => {
    const scale = computeBarScale([1, 100000], 200);

    expect(barSpan(scale, 1, 2).width).toBe(2);
  });
});

describe("summarizeRanking", () => {
  const formatValue = (value: number) => `REF ${value}`;

  it("lista cada posición con su nombre completo", () => {
    expect(
      summarizeRanking({
        ariaLabel: "Top productos",
        formatValue,
        items: rankItems(items([5, 30])),
        withComparison: false,
      }),
    ).toBe("Top productos: 2 elementos. 1. Elemento 1: REF 30. 2. Elemento 0: REF 5.");
  });

  it("con comparación añade el valor anterior y la variación", () => {
    expect(
      summarizeRanking({
        ariaLabel: "Métodos de pago",
        formatValue,
        items: rankItems([
          { deltaPct: 20, id: "a", label: "Efectivo", previousValue: 100, value: 120 },
          { deltaPct: null, id: "b", label: "Zelle", previousValue: null, value: 10 },
        ]),
        withComparison: true,
      }),
    ).toBe(
      "Métodos de pago: 2 elementos. 1. Efectivo: REF 120 (antes REF 100, sube 20 %). " +
        "2. Zelle: REF 10 (antes sin datos, sin periodo anterior comparable).",
    );
  });

  it("sin elementos", () => {
    expect(
      summarizeRanking({ ariaLabel: "Top", formatValue, items: [], withComparison: false }),
    ).toBe("Top: sin datos.");
  });
});
