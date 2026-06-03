import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { Button } from "./Button";

describe("Button", () => {
  it("renders its label", () => {
    const { getByRole } = render(<Button>Guardar</Button>);

    expect(getByRole("button", { name: /guardar/i })).toBeVisible();
  });

  it("supports disabled state", () => {
    const { getByRole } = render(<Button disabled>Guardando</Button>);

    expect(getByRole("button", { name: /guardando/i })).toBeDisabled();
  });
});
