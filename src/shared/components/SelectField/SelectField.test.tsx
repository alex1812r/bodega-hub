import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { SelectField } from "./SelectField";

describe("SelectField", () => {
  it("associates label with select", () => {
    const { getByLabelText } = render(
      <SelectField
        label="Estado"
        options={[{ label: "Activo", value: "activo" }]}
      />,
    );

    expect(getByLabelText(/estado/i)).toBeVisible();
  });
});
