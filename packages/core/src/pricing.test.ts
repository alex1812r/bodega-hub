import { amountWithTax } from "./currency";
import {
  bandDrop,
  DEFAULT_MARGIN_THRESHOLDS,
  DEFAULT_MARKUP_CHIPS,
  marginBand,
  type MarginBand,
  markupPct,
  priceFromMarkup,
} from "./pricing";

describe("pricing defaults", () => {
  it("exports the default thresholds and recommended chips", () => {
    expect(DEFAULT_MARGIN_THRESHOLDS).toEqual({ low: 15, high: 25 });
    expect(DEFAULT_MARKUP_CHIPS).toEqual([12, 20, 30]);
  });
});

describe("markupPct", () => {
  it("returns the markup over the cost", () => {
    expect(markupPct(8, 10)).toBe(25);
    expect(markupPct(10, 12)).toBe(20);
    expect(markupPct(10, 10)).toBe(0);
  });

  it("returns null when the cost is zero", () => {
    expect(markupPct(0, 10)).toBeNull();
    expect(markupPct(0, 0)).toBeNull();
  });

  it("returns null for a negative cost", () => {
    expect(markupPct(-5, 10)).toBeNull();
  });

  it("returns null for non finite values", () => {
    expect(markupPct(Number.NaN, 10)).toBeNull();
    expect(markupPct(Number.POSITIVE_INFINITY, 10)).toBeNull();
    expect(markupPct(10, Number.NaN)).toBeNull();
    expect(markupPct(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns a negative markup when the price is below the cost", () => {
    expect(markupPct(10, 9)).toBe(-10);
    expect(markupPct(10, 0)).toBe(-100);
  });

  it("removes binary noise so exact thresholds are not missed", () => {
    // (1.15 − 1) / 1 × 100 = 14.999999999999991 sin limpiar.
    expect(markupPct(1, 1.15)).toBe(15);
    expect(markupPct(0.1 + 0.2, 0.3)).toBe(0);
    expect(markupPct(0.1, 0.1 + 0.2)).toBe(200);
    expect(markupPct(0.3, 0.1 + 0.2 + 0.06)).toBe(20);
  });

  it("does not apply any tax: the cost already includes it", () => {
    const costExempt = amountWithTax(10, 0);
    const costGeneral = amountWithTax(10, 16);

    expect(costExempt).toBe(10);
    expect(costGeneral).toBe(11.6);
    expect(markupPct(costExempt, 12.5)).toBe(25);
    expect(markupPct(costGeneral, 14.5)).toBe(25);
    expect(priceFromMarkup(costGeneral, 25)).toBe(14.5);
  });
});

describe("priceFromMarkup", () => {
  it("applies the markup and rounds to money", () => {
    expect(priceFromMarkup(8, 25)).toBe(10);
    expect(priceFromMarkup(9, 25)).toBe(11.25);
    expect(priceFromMarkup(3.33, 20)).toBe(4);
    expect(priceFromMarkup(10, 0)).toBe(10);
  });

  it("returns 0 when the cost is zero", () => {
    expect(priceFromMarkup(0, 20)).toBe(0);
    expect(priceFromMarkup(0, 0)).toBe(0);
  });

  it("returns 0 for unusable values", () => {
    expect(priceFromMarkup(-5, 20)).toBe(0);
    expect(priceFromMarkup(Number.NaN, 20)).toBe(0);
    expect(priceFromMarkup(Number.POSITIVE_INFINITY, 20)).toBe(0);
    expect(priceFromMarkup(10, Number.NaN)).toBe(0);
    expect(priceFromMarkup(10, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("accepts a negative markup but never returns a negative price", () => {
    expect(priceFromMarkup(10, -10)).toBe(9);
    expect(priceFromMarkup(10, -100)).toBe(0);
    expect(priceFromMarkup(10, -150)).toBe(0);
  });

  it("rounds a cost carrying binary noise", () => {
    expect(priceFromMarkup(0.1 + 0.2, 10)).toBe(0.33);
    expect(priceFromMarkup(0.1 + 0.2, 0)).toBe(0.3);
  });

  it("rounds an exact half cent up instead of losing it to binary noise", () => {
    // 1.02 × 1.25 = 1.275 exacto; en coma flotante queda 1.2749999999999999.
    expect(priceFromMarkup(1.02, 25)).toBe(1.28);
    // 0.35 × 1.30 = 0.455 exacto.
    expect(priceFromMarkup(0.35, 30)).toBe(0.46);
    expect(priceFromMarkup(0.18, 25)).toBe(0.23);
    expect(priceFromMarkup(1.88, 12.5)).toBe(2.12);
  });

  it("matches exact integer half-up rounding across a sweep of costs and markups", () => {
    // [pct, pct en centésimas]: el esperado se calcula solo con enteros (BigInt).
    const pcts: Array<[number, number]> = [
      [5, 500],
      [12, 1200],
      [12.5, 1250],
      [20, 2000],
      [25, 2500],
      [30, 3000],
      [33.33, 3333],
    ];
    const scale = BigInt(10000);
    const half = BigInt(5000);
    const mismatches: string[] = [];

    for (let cents = 1; cents <= 5000; cents += 1) {
      for (const [pct, pctHundredths] of pcts) {
        const exactCents = Number(
          (BigInt(cents) * (scale + BigInt(pctHundredths)) + half) / scale,
        );
        const got = priceFromMarkup(cents / 100, pct);

        if (got !== exactCents / 100) {
          mismatches.push(`${cents / 100} @ ${pct} % → ${got} (exacto ${exactCents / 100})`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("round-trips with markupPct within the rounding error of one cent", () => {
    const costs = [0.05, 0.3, 1, 3.33, 8, 9.99, 12.5, 149.9, 1234.56];
    const pcts = [0, 12, 15, 20, 24.99, 25, 30, 33.33, 100];

    for (const cost of costs) {
      for (const pct of pcts) {
        const price = priceFromMarkup(cost, pct);
        const back = markupPct(cost, price);

        expect(back).not.toBeNull();
        // Medio céntimo de redondeo en el precio equivale a 0.5 / costo puntos de %.
        expect(Math.abs((back ?? 0) - pct)).toBeLessThanOrEqual(0.5 / cost + 1e-6);
      }
    }
  });

  it("round-trips exactly when the price needs no rounding", () => {
    expect(markupPct(8, priceFromMarkup(8, 25))).toBe(25);
    expect(markupPct(10, priceFromMarkup(10, 12))).toBe(12);
    expect(markupPct(20, priceFromMarkup(20, 30))).toBe(30);
  });
});

describe("marginBand", () => {
  it("uses the default thresholds at their exact edges", () => {
    expect(marginBand(0)).toBe("low");
    expect(marginBand(14.99)).toBe("low");
    expect(marginBand(15)).toBe("mid");
    expect(marginBand(24.99)).toBe("mid");
    expect(marginBand(25)).toBe("high");
    expect(marginBand(300)).toBe("high");
  });

  it("is low without a markup, with a negative one or a non finite one", () => {
    expect(marginBand(null)).toBe("low");
    expect(marginBand(-0.01)).toBe("low");
    expect(marginBand(-50)).toBe("low");
    expect(marginBand(Number.NaN)).toBe("low");
    expect(marginBand(Number.POSITIVE_INFINITY)).toBe("low");
  });

  it("honours custom thresholds", () => {
    const thresholds = { low: 10, high: 40 };

    expect(marginBand(9.99, thresholds)).toBe("low");
    expect(marginBand(10, thresholds)).toBe("mid");
    expect(marginBand(39.99, thresholds)).toBe("mid");
    expect(marginBand(40, thresholds)).toBe("high");
  });

  it("keeps a negative markup low even with a zero threshold", () => {
    expect(marginBand(-1, { low: 0, high: 10 })).toBe("low");
    expect(marginBand(0, { low: 0, high: 10 })).toBe("mid");
  });

  it("keeps an exact threshold markup in its band for any cost in cents", () => {
    expect(markupPct(0.8, 1)).toBe(25);
    expect(marginBand(markupPct(0.8, 1))).toBe("high");
    expect(markupPct(1, 1.15)).toBe(15);
    expect(marginBand(markupPct(1, 1.15))).toBe("mid");

    const offBand: string[] = [];

    // Costos donde el 15 % y el 25 % dan un precio exacto en céntimos (múltiplos de 0.20).
    for (let cents = 20; cents <= 300000; cents += 20) {
      const cost = cents / 100;
      const at15 = marginBand(markupPct(cost, (cents * 115) / 100 / 100));
      const at25 = marginBand(markupPct(cost, (cents * 125) / 100 / 100));

      if (at15 !== "mid" || at25 !== "high") {
        offBand.push(`${cost}: 15 % → ${at15}, 25 % → ${at25}`);
      }
    }

    expect(offBand).toEqual([]);
  });

  it("classifies a price computed from the threshold markup in that band", () => {
    expect(marginBand(markupPct(1, 1.15))).toBe("mid");
    expect(marginBand(markupPct(8, priceFromMarkup(8, 25)))).toBe("high");
    expect(marginBand(markupPct(10, 9))).toBe("low");
    expect(marginBand(markupPct(0, 9))).toBe("low");
  });
});

describe("bandDrop", () => {
  const cases: Array<[MarginBand, MarginBand, boolean]> = [
    ["high", "mid", true],
    ["mid", "low", true],
    ["high", "low", true],
    ["high", "high", false],
    ["mid", "mid", false],
    ["low", "low", false],
    ["low", "mid", false],
    ["mid", "high", false],
    ["low", "high", false],
  ];

  it.each(cases)("%s → %s is %s", (prev, current, expected) => {
    expect(bandDrop(prev, current)).toBe(expected);
  });
});
