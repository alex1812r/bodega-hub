import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PriceReviewBulkBar } from "./PriceReviewBulkBar";

function renderBar(props: Partial<React.ComponentProps<typeof PriceReviewBulkBar>> = {}) {
  const onReprice = jest.fn();
  const onTogglePage = jest.fn();

  render(
    <PriceReviewBulkBar
      chips={[12, 20, 30]}
      onReprice={onReprice}
      onTogglePage={onTogglePage}
      pageCount={10}
      selectedCount={2}
      {...props}
    />,
  );

  return { onReprice, onTogglePage };
}

describe("PriceReviewBulkBar", () => {
  it("offers the store chips and proposes the chosen % without changing anything itself", async () => {
    const user = userEvent.setup();
    const { onReprice } = renderBar();

    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reprecio al 20 %" }));

    expect(onReprice).toHaveBeenCalledTimes(1);
    expect(onReprice).toHaveBeenCalledWith(20);
  });

  it("warns and blocks the reprice above the limit of 100 products", () => {
    const { onReprice } = renderBar({ pageCount: 120, selectedCount: 103 });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Puedes cambiar hasta 100 productos a la vez. Quita 3 de la selección.",
    );
    expect(screen.getByRole("button", { name: "Reprecio al 30 %" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
    expect(onReprice).not.toHaveBeenCalled();
  });

  it("allows exactly 100 products", () => {
    renderBar({ pageCount: 100, selectedCount: 100 });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprecio al 30 %" })).toBeEnabled();
  });

  it("ignores a free % that is empty, zero or above the maximum", async () => {
    const user = userEvent.setup();
    const { onReprice } = renderBar();
    const field = screen.getByLabelText("Otro %");

    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();

    await user.type(field, "0");

    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();

    await user.clear(field);
    await user.type(field, "45{Enter}");

    expect(onReprice).toHaveBeenCalledWith(45);
  });

  it("marks the page checkbox as partial, full or empty and reports the toggle", async () => {
    const user = userEvent.setup();
    const { onTogglePage } = renderBar({ pageCount: 3, selectedCount: 1 });
    const checkbox = screen.getByRole("checkbox", { name: "Seleccionar página" });

    expect(checkbox).toBePartiallyChecked();

    await user.click(checkbox);

    expect(onTogglePage).toHaveBeenCalledWith(true);
  });

  it("has nothing to reprice with an empty selection", () => {
    renderBar({ selectedCount: 0 });

    expect(screen.getByText("0 seleccionados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprecio al 12 %" })).toBeDisabled();
  });
});
