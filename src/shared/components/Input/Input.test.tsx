import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { Input } from "./Input";

describe("Input", () => {
  it("connects the label to the input", () => {
    const { getByLabelText } = render(<Input label="Telefono" />);

    expect(getByLabelText(/telefono/i)).toBeVisible();
  });

  it("marks invalid fields when there is an error", () => {
    const { getByLabelText, getByText } = render(
      <Input error="El telefono es obligatorio." label="Telefono" />,
    );

    expect(getByLabelText(/telefono/i)).toHaveAttribute("aria-invalid", "true");
    expect(getByText(/obligatorio/i)).toBeVisible();
  });
});
