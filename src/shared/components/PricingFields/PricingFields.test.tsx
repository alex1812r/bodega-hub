import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { PricingFields, type PricingFieldsProps } from "./PricingFields";

const BADGE_TITLE = "Ganancia sobre el costo (ya con IVA)";

type HarnessProps = Partial<Omit<PricingFieldsProps, "price">> & {
  initialPrice?: number | null;
};

function Harness({ cost = 8, initialPrice = null, onPriceChange, ...props }: HarnessProps) {
  const [price, setPrice] = useState<number | null>(initialPrice);

  return (
    <PricingFields
      {...props}
      cost={cost}
      onPriceChange={(next) => {
        setPrice(next);
        onPriceChange?.(next);
      }}
      price={price}
    />
  );
}

function getPctField() {
  return screen.getByLabelText<HTMLInputElement>("Ganancia %");
}

function getPriceField() {
  return screen.getByLabelText<HTMLInputElement>("Precio REF");
}

function getBadge() {
  return screen.getByTitle(BADGE_TITLE);
}

function getChips() {
  return within(
    screen.getByRole("group", { name: "Porcentajes de ganancia recomendados" }),
  ).getAllByRole("button");
}

describe("PricingFields", () => {
  it("shows the current cost read-only and the default chips", () => {
    render(<Harness cost={8} initialPrice={10} />);

    expect(screen.getByText("Costo actual (ya con IVA)")).toBeInTheDocument();
    expect(screen.getByText("ref 8.00")).toBeInTheDocument();
    expect(getChips().map((chip) => chip.textContent)).toEqual(["12 %", "20 %", "30 %"]);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("derives the % from the initial price and shows the resulting badge", () => {
    render(<Harness cost={8} initialPrice={10} />);

    expect(getPctField()).toHaveValue("25");
    expect(getPriceField()).toHaveValue("10");
    expect(getBadge()).toHaveAttribute("data-band", "high");
    expect(getBadge()).toHaveTextContent("25 %");
  });

  it("fills the price when a chip is chosen", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();
    const onMarkupChange = jest.fn();

    render(<Harness cost={10} onMarkupChange={onMarkupChange} onPriceChange={onPriceChange} />);

    await user.click(screen.getByRole("button", { name: "20 %" }));

    expect(onPriceChange).toHaveBeenLastCalledWith(12);
    expect(onMarkupChange).toHaveBeenLastCalledWith(20);
    expect(getPriceField()).toHaveValue("12");
    expect(getPctField()).toHaveValue("20");
    expect(screen.getByRole("button", { name: "20 %" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30 %" })).toHaveAttribute("aria-pressed", "false");
    expect(getBadge()).toHaveAttribute("data-band", "mid");
  });

  it("fills the price while the % is typed, without rewriting the % field", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();

    render(<Harness cost={3.33} onPriceChange={onPriceChange} />);

    await user.type(getPctField(), "12,5");

    // 3.33 × 1.125 = 3.74625 → 3.75, que en realidad es un 12,61 %.
    expect(getPctField()).toHaveValue("12.5");
    expect(getPriceField()).toHaveValue("3.75");
    expect(onPriceChange).toHaveBeenLastCalledWith(3.75);
    expect(getBadge()).toHaveTextContent("12,61 %");
  });

  it("recalculates the % while the price is typed, without rewriting the price field", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();
    const onMarkupChange = jest.fn();

    render(
      <Harness
        cost={8}
        initialPrice={10}
        onMarkupChange={onMarkupChange}
        onPriceChange={onPriceChange}
      />,
    );

    await user.clear(getPriceField());
    await user.type(getPriceField(), "9,");

    expect(getPriceField()).toHaveValue("9.");
    expect(getPctField()).toHaveValue("12.5");

    await user.type(getPriceField(), "6");

    expect(getPriceField()).toHaveValue("9.6");
    expect(getPctField()).toHaveValue("20");
    expect(onPriceChange).toHaveBeenLastCalledWith(9.6);
    expect(onMarkupChange).toHaveBeenLastCalledWith(20);
    expect(screen.getByRole("button", { name: "20 %" })).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces a typed % with the real one once the price is edited", async () => {
    const user = userEvent.setup();

    render(<Harness cost={10} />);

    await user.type(getPctField(), "30");
    expect(getPriceField()).toHaveValue("13");

    await user.clear(getPriceField());
    await user.type(getPriceField(), "11");

    expect(getPctField()).toHaveValue("10");
    expect(getBadge()).toHaveAttribute("data-band", "low");
  });

  it("keeps the price when the % is cleared and restores the real % on blur", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();

    render(<Harness cost={8} initialPrice={10} onPriceChange={onPriceChange} />);

    await user.clear(getPctField());

    expect(getPctField()).toHaveValue("");
    expect(getPriceField()).toHaveValue("10");
    expect(onPriceChange).not.toHaveBeenCalled();

    await user.tab();

    expect(getPctField()).toHaveValue("25");
  });

  it("reports an emptied price as null and hides the badge", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();

    render(<Harness cost={8} initialPrice={10} onPriceChange={onPriceChange} />);

    await user.clear(getPriceField());

    expect(onPriceChange).toHaveBeenLastCalledWith(null);
    expect(getPctField()).toHaveValue("");
    expect(screen.queryByTitle(BADGE_TITLE)).not.toBeInTheDocument();
  });

  it("sets the price to 0 and warns when a % is typed without a cost", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();

    render(<Harness cost={0} onPriceChange={onPriceChange} />);

    expect(screen.getAllByText("Sin costo")).toHaveLength(2);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.type(getPctField(), "20");

    expect(onPriceChange).toHaveBeenLastCalledWith(0);
    expect(getPriceField()).toHaveValue("0");
    expect(getPctField()).toHaveValue("20");
    expect(screen.getByRole("status")).toHaveTextContent(/no tiene costo.*el precio queda en 0/i);
    expect(getBadge()).toHaveTextContent("Sin costo");
  });

  it("accepts a price typed without a cost and leaves the % empty", async () => {
    const user = userEvent.setup();
    const onMarkupChange = jest.fn();

    render(<Harness cost={0} onMarkupChange={onMarkupChange} />);

    await user.type(getPriceField(), "5");

    expect(getPriceField()).toHaveValue("5");
    expect(getPctField()).toHaveValue("");
    expect(onMarkupChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a red negative badge when the price is below the cost, without blocking", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();
    const onMarkupChange = jest.fn();

    render(
      <Harness cost={10} onMarkupChange={onMarkupChange} onPriceChange={onPriceChange} />,
    );

    await user.type(getPriceField(), "9");

    expect(onPriceChange).toHaveBeenLastCalledWith(9);
    expect(onMarkupChange).toHaveBeenLastCalledWith(-10);
    expect(getPriceField()).toHaveValue("9");
    expect(getPriceField()).not.toHaveAttribute("aria-invalid");
    expect(getBadge()).toHaveAttribute("data-band", "low");
    expect(getBadge()).toHaveTextContent("-10 %");
    expect(screen.getByRole("status")).toHaveTextContent("El precio está por debajo del costo.");

    // Pasar por el campo de % no altera el precio.
    await user.click(getPctField());
    await user.tab();

    expect(getPriceField()).toHaveValue("9");
    expect(onPriceChange).toHaveBeenCalledTimes(1);
  });

  it("puts the suggested % first, highlighted, and without duplicating a chip", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();

    render(<Harness cost={10} onPriceChange={onPriceChange} suggestedPct={20} />);

    expect(getChips().map((chip) => chip.textContent)).toEqual([
      "Sugerido 20 %",
      "12 %",
      "30 %",
    ]);
    expect(getChips()[0]).toHaveClass("bg-indigo-50");

    await user.click(screen.getByRole("button", { name: "Sugerido 20 %" }));

    expect(onPriceChange).toHaveBeenLastCalledWith(12);
    expect(getChips()[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("uses custom chips and thresholds", async () => {
    const user = userEvent.setup();

    render(<Harness chips={[10, 40]} cost={10} thresholds={{ low: 20, high: 40 }} />);

    expect(getChips().map((chip) => chip.textContent)).toEqual(["10 %", "40 %"]);

    await user.click(screen.getByRole("button", { name: "40 %" }));

    expect(getPriceField()).toHaveValue("14");
    expect(getBadge()).toHaveAttribute("data-band", "high");

    await user.click(screen.getByRole("button", { name: "10 %" }));

    expect(getBadge()).toHaveAttribute("data-band", "low");
  });

  it("follows a cost that changes from outside", () => {
    const { rerender } = render(<PricingFields cost={8} onPriceChange={jest.fn()} price={10} />);

    expect(getPctField()).toHaveValue("25");

    rerender(<PricingFields cost={9} onPriceChange={jest.fn()} price={10} />);

    expect(getPctField()).toHaveValue("11.11");
    expect(getBadge()).toHaveAttribute("data-band", "low");
  });

  it("disables chips and fields", async () => {
    const user = userEvent.setup();
    const onPriceChange = jest.fn();

    render(<Harness cost={8} disabled initialPrice={10} onPriceChange={onPriceChange} />);

    for (const chip of getChips()) {
      expect(chip).toBeDisabled();
    }

    expect(getPctField()).toBeDisabled();
    expect(getPriceField()).toBeDisabled();

    await user.click(getChips()[0]);

    expect(onPriceChange).not.toHaveBeenCalled();
    expect(getBadge()).toHaveTextContent("25 %");
  });

  it("shows the price error as given", () => {
    render(<Harness cost={8} error="El precio debe ser mayor a 0" initialPrice={0} />);

    expect(getPriceField()).toHaveAttribute("aria-invalid", "true");
    expect(getPriceField()).toHaveAccessibleDescription("El precio debe ser mayor a 0");
  });
});
