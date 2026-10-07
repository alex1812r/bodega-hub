import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RememberedFiltersChip } from "./RememberedFiltersChip";

describe("RememberedFiltersChip", () => {
  it("avisa de los filtros recordados y ofrece Limpiar", async () => {
    const user = userEvent.setup();
    const onClear = jest.fn();

    render(<RememberedFiltersChip onClear={onClear} />);

    expect(screen.getByRole("status")).toHaveTextContent("Filtros recordados · Limpiar");

    await user.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("Limpiar se activa con el teclado", async () => {
    const user = userEvent.setup();
    const onClear = jest.fn();

    render(<RememberedFiltersChip onClear={onClear} />);

    await user.tab();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Limpiar" })).toHaveFocus();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
