import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";

import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("renders retry action when onRetry exists", () => {
    const onRetry = jest.fn();
    const { getByRole, getByText } = render(
      <ErrorState onRetry={onRetry} title="No pudimos cargar los datos" />,
    );

    fireEvent.click(getByRole("button", { name: /reintentar/i }));

    expect(getByText(/no pudimos cargar los datos/i)).toBeVisible();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
