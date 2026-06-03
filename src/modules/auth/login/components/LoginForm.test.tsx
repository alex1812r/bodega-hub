import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  it("renders email and password fields", () => {
    const { getByLabelText, getByRole } = render(
      <LoginForm onSubmit={jest.fn()} />,
    );

    expect(getByLabelText(/correo/i)).toBeVisible();
    expect(getByLabelText(/clave/i)).toBeVisible();
    expect(getByRole("button", { name: /iniciar sesion/i })).toBeVisible();
  });

  it("shows submit state", () => {
    const { getByRole } = render(
      <LoginForm isSubmitting onSubmit={jest.fn()} />,
    );

    expect(getByRole("button", { name: /entrando/i })).toBeDisabled();
  });
});
