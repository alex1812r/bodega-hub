import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { describePriceReviewChange, PriceReviewChangeSummary } from "./PriceReviewChangeSummary";

const change = {
  currentCostRef: 9,
  currentMarginPct: 11.11,
  previousCostRef: 8,
  previousMarginPct: 25,
};

describe("PriceReviewChangeSummary", () => {
  it("describes the drop in one sentence", () => {
    expect(describePriceReviewChange(change)).toBe(
      "La ganancia bajó de 25 % a 11,11 % al subir el costo de ref 8.00 a ref 9.00",
    );
  });

  it("shows cost and margin before and after, with the sentence for screen readers", () => {
    const { container } = render(<PriceReviewChangeSummary change={change} />);

    expect(container).toHaveTextContent(/Costo\s*ref 8\.00\s*ref 9\.00/);
    expect(container).toHaveTextContent(/Ganancia\s*25 %\s*11,11 %/);
    expect(screen.getByText(describePriceReviewChange(change))).toHaveClass("sr-only");
    // Sin `showBands` va en texto: no ensancha la tabla de la lista.
    expect(container.querySelector("[data-band]")).toBeNull();
  });

  // PRO-F6: 11,11 % (rojo) y 17,65 % (amarillo) no pueden verse iguales.
  it.each([
    [11.11, "low", "11,11 %"],
    [17.65, "mid", "17,65 %"],
  ])("with showBands paints the previous and the current %% (%p) with their band", (pct, band, text) => {
    const shown = { ...change, currentMarginPct: pct };
    const { container } = render(<PriceReviewChangeSummary change={shown} showBands />);
    const [previous, current] = Array.from(container.querySelectorAll("[data-band]"));

    expect(previous).toHaveAttribute("data-band", "high");
    expect(previous).toHaveTextContent("25 %");
    expect(current).toHaveAttribute("data-band", band);
    expect(current).toHaveTextContent(text);
    expect(container).toHaveTextContent(/Costo\s*ref 8\.00\s*ref 9\.00/);
    expect(screen.getByText(describePriceReviewChange(shown))).toHaveClass("sr-only");
  });

  it("with showBands uses the thresholds it is given", () => {
    const { container } = render(
      <PriceReviewChangeSummary change={change} showBands thresholds={{ high: 30, low: 12 }} />,
    );
    const [previous, current] = Array.from(container.querySelectorAll("[data-band]"));

    expect(previous).toHaveAttribute("data-band", "mid");
    expect(current).toHaveAttribute("data-band", "low");
  });
});
