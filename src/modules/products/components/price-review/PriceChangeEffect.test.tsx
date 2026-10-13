import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import {
  getPriceChangeDirection,
  isPriceBelowCost,
  PriceChangeEffect,
  summarizePriceChanges,
} from "./PriceChangeEffect";

/** CNF-07 · efecto común de un cambio de precio. */

describe("PriceChangeEffect · cálculo", () => {
  it("clasifica el cambio: sube, baja o no cambia", () => {
    expect(getPriceChangeDirection({ fromPriceRef: 10, toPriceRef: 11.25 })).toBe("up");
    expect(getPriceChangeDirection({ fromPriceRef: 10, toPriceRef: 9.99 })).toBe("down");
    expect(getPriceChangeDirection({ fromPriceRef: 10, toPriceRef: 10 })).toBe("same");
  });

  it("por debajo del costo es estrictamente menor; sin costo no hay comparación", () => {
    expect(isPriceBelowCost(10, 9.99)).toBe(true);
    expect(isPriceBelowCost(10, 10)).toBe(false);
    expect(isPriceBelowCost(0, 0)).toBe(false);
    expect(isPriceBelowCost(0, 5)).toBe(false);
  });

  it("resume un lote: un precio puede subir y aun así quedar bajo su costo", () => {
    expect(
      summarizePriceChanges([
        { costRef: 9, fromPriceRef: 10, toPriceRef: 11.25 },
        { costRef: 10, fromPriceRef: 14, toPriceRef: 13 },
        { costRef: 10, fromPriceRef: 13, toPriceRef: 13 },
        { costRef: 10, fromPriceRef: 7, toPriceRef: 8 },
      ]),
    ).toEqual({ belowCost: 1, down: 1, same: 1, up: 2 });
    expect(summarizePriceChanges([])).toEqual({ belowCost: 0, down: 0, same: 0, up: 0 });
  });
});

describe("PriceChangeEffect", () => {
  it("el Bs es solo presentación: REF × tasa vigente, y sin tasa válida no se pinta", () => {
    const change = { costRef: 9, fromPriceRef: 10, toPriceRef: 11.25 };
    const { rerender } = render(<PriceChangeEffect change={change} rateVes={36.5} />);

    // 10 × 36,5 = 365 y 11,25 × 36,5 = 410,625 → 410,63.
    expect(screen.getByTestId("price-change-effect")).toHaveTextContent(
      /Bs\. 365,00\s*pasa a\s*Bs\. 410,63/,
    );

    for (const rateVes of [0, null, undefined, Number.NaN]) {
      rerender(<PriceChangeEffect change={change} rateVes={rateVes} />);
      expect(screen.getByTestId("price-change-effect")).not.toHaveTextContent("Bs.");
    }
  });

  it("sin costo el semáforo dice «Sin costo» y no hay aviso de pérdida", () => {
    render(<PriceChangeEffect change={{ costRef: 0, fromPriceRef: 5, toPriceRef: 6 }} />);

    expect(screen.getAllByText("Sin costo")).toHaveLength(2);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("no pinta un motivo vacío", () => {
    render(
      <PriceChangeEffect change={{ costRef: 9, fromPriceRef: 10, toPriceRef: 11 }} reason="   " />,
    );

    expect(screen.queryByText(/Motivo/)).not.toBeInTheDocument();
  });
});
