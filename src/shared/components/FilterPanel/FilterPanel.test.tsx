import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";

import { Input } from "@/shared/components/Input";

import { FilterPanel } from "./FilterPanel";

describe("FilterPanel", () => {
  it("toggles filter content", () => {
    const { getByLabelText, queryByLabelText } = render(
      <FilterPanel>
        <Input label="Producto" />
      </FilterPanel>,
    );

    expect(queryByLabelText(/producto/i)).not.toBeInTheDocument();

    fireEvent.click(getByLabelText(/mostrar filtros/i));

    expect(getByLabelText(/producto/i)).toBeVisible();
  });
});
