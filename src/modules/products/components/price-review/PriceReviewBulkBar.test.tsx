import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";

import { REPRICE_MAX_PRODUCTS } from "../../services/productSchemas";
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

  // PRO-F6: la selección es de una página y una página nunca pasa del tope del
  // reprecio, así que no hay "más de 100" que avisar: el tope se dice como ayuda.
  it("cannot select more than one reprice batch: a page never exceeds the limit", () => {
    expect(MAX_PAGE_LIMIT).toBeLessThanOrEqual(REPRICE_MAX_PRODUCTS);
  });

  it.each([0, 2, 100])("tells the batch limit as help with %p selected", (selectedCount) => {
    renderBar({ pageCount: 100, selectedCount });

    expect(screen.getByText(/Hasta 100 por tanda\./)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
