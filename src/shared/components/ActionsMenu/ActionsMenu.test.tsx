import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";

import { ActionsMenu } from "./ActionsMenu";

describe("ActionsMenu", () => {
  it("opens menu actions", () => {
    const { getByLabelText, getByRole } = render(
      <ActionsMenu actions={[{ label: "Editar", onSelect: jest.fn() }]} />,
    );

    fireEvent.click(getByLabelText(/abrir acciones/i));

    expect(getByRole("menuitem", { name: /editar/i })).toBeVisible();
  });
});
