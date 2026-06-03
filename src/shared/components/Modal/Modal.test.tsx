import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("opens from its trigger", async () => {
    const user = userEvent.setup();
    const { findByRole, getByRole } = render(
      <Modal title="Registrar pago" trigger={<Button>Abrir modal</Button>}>
        <p>Contenido del modal</p>
      </Modal>,
    );

    await user.click(getByRole("button", { name: /abrir modal/i }));

    expect(await findByRole("dialog")).toBeVisible();
  });
});
