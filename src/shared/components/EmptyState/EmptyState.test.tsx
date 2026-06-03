import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { Button } from "@/shared/components/Button";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and action", () => {
    const { getByRole, getByText } = render(
      <EmptyState
        action={<Button>Crear registro</Button>}
        title="Sin registros"
      />,
    );

    expect(getByText("Sin registros")).toBeVisible();
    expect(getByRole("button", { name: /crear registro/i })).toBeVisible();
  });
});
