import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { formatMarkupPct, MARGIN_BADGE_TITLE, MarginBadge } from "./MarginBadge";

function getBadge() {
  return screen.getByTitle(MARGIN_BADGE_TITLE);
}

describe("formatMarkupPct", () => {
  it("uses a decimal comma and at most two decimals", () => {
    expect(formatMarkupPct(25)).toBe("25 %");
    expect(formatMarkupPct(24.99)).toBe("24,99 %");
    expect(formatMarkupPct(12.5)).toBe("12,5 %");
    expect(formatMarkupPct(20.12012)).toBe("20,12 %");
    expect(formatMarkupPct(-10)).toBe("-10 %");
  });
});

describe("MarginBadge", () => {
  it("shows a low margin in the danger tone with its band named in text", () => {
    render(<MarginBadge cost={10} price={11} />);

    expect(getBadge()).toHaveAttribute("data-band", "low");
    expect(getBadge()).toHaveClass("bg-red-50", "text-red-700");
    expect(getBadge()).toHaveTextContent("Ganancia baja:");
    expect(getBadge()).toHaveTextContent("10 %");
  });

  it("shows a mid margin in the warning tone", () => {
    render(<MarginBadge cost={10} price={12} />);

    expect(getBadge()).toHaveAttribute("data-band", "mid");
    expect(getBadge()).toHaveClass("bg-amber-50", "text-amber-700");
    expect(getBadge()).toHaveTextContent("Ganancia media:");
    expect(getBadge()).toHaveTextContent("20 %");
  });

  it("shows a high margin in the success tone", () => {
    render(<MarginBadge cost={8} price={10} />);

    expect(getBadge()).toHaveAttribute("data-band", "high");
    expect(getBadge()).toHaveClass("bg-emerald-50", "text-emerald-700");
    expect(getBadge()).toHaveTextContent("Ganancia alta:");
    expect(getBadge()).toHaveTextContent("25 %");
  });

  it("classifies the default edges", () => {
    const { rerender } = render(<MarginBadge pct={14.99} />);

    expect(getBadge()).toHaveAttribute("data-band", "low");
    expect(getBadge()).toHaveTextContent("14,99 %");

    rerender(<MarginBadge pct={15} />);
    expect(getBadge()).toHaveAttribute("data-band", "mid");

    rerender(<MarginBadge pct={24.99} />);
    expect(getBadge()).toHaveAttribute("data-band", "mid");

    rerender(<MarginBadge pct={25} />);
    expect(getBadge()).toHaveAttribute("data-band", "high");
  });

  it("honours custom thresholds", () => {
    render(<MarginBadge pct={30} thresholds={{ low: 20, high: 40 }} />);

    expect(getBadge()).toHaveAttribute("data-band", "mid");
  });

  it("shows a negative markup in the danger tone when the price is below the cost", () => {
    render(<MarginBadge cost={10} price={9} />);

    expect(getBadge()).toHaveAttribute("data-band", "low");
    expect(getBadge()).toHaveTextContent("-10 %");
  });

  it("adds the warning icon and 'Por revisar' in the review variant", () => {
    const { container } = render(<MarginBadge pct={11} review />);

    expect(getBadge()).toHaveTextContent("Por revisar");
    expect(getBadge()).toHaveTextContent("11 %");
    expect(getBadge()).toHaveAttribute("data-band", "low");
    expect(container.querySelector("svg.lucide-triangle-alert")).toBeInTheDocument();
  });

  it("does not show 'Por revisar' by default", () => {
    render(<MarginBadge pct={11} />);

    expect(screen.queryByText(/por revisar/i)).not.toBeInTheDocument();
  });

  it("shows a neutral 'Sin costo' when there is no markup", () => {
    const { rerender } = render(<MarginBadge pct={null} />);

    expect(getBadge()).toHaveTextContent("Sin costo");
    expect(getBadge()).not.toHaveAttribute("data-band");
    expect(getBadge()).toHaveClass("bg-slate-100");

    rerender(<MarginBadge cost={0} price={10} review />);
    expect(getBadge()).toHaveTextContent("Sin costo");
    expect(getBadge()).not.toHaveTextContent("Por revisar");
  });

  it("explains the figure in an accessible title and hides the decorative icon", () => {
    const { container } = render(<MarginBadge pct={25} />);

    expect(getBadge()).toHaveAttribute("title", "Ganancia sobre el costo (ya con IVA)");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("supports the md size", () => {
    render(<MarginBadge pct={25} size="md" />);

    expect(getBadge()).toHaveClass("text-sm");
  });
});
