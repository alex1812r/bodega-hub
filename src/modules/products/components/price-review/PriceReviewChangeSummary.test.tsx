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
  });
});
