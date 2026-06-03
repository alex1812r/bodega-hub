import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("associates label with textarea", () => {
    const { getByLabelText } = render(<Textarea label="Notas" />);

    expect(getByLabelText(/notas/i)).toBeVisible();
  });
});
