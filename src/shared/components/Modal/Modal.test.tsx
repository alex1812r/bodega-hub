import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

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

  it("renders a static footer", () => {
    render(
      <Modal footer={<Button>Guardar</Button>} open title="Registrar pago">
        <p>Contenido del modal</p>
      </Modal>,
    );

    expect(screen.getByRole("button", { name: "Guardar" })).toBeVisible();
  });

  it("closes an uncontrolled modal through the footer close helper", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    render(
      <Modal
        footer={({ close }) => <Button onClick={close}>Cancelar</Button>}
        onOpenChange={onOpenChange}
        title="Registrar pago"
        trigger={<Button>Abrir modal</Button>}
      >
        <p>Contenido del modal</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: /abrir modal/i }));
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("asks a controlled modal to close through the footer close helper", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    render(
      <Modal
        footer={({ close }) => <Button onClick={close}>Cancelar</Button>}
        onOpenChange={onOpenChange}
        open
        title="Registrar pago"
      >
        <p>Contenido del modal</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("keeps state inside a function footer across parent re-renders", async () => {
    const user = userEvent.setup();

    function FooterCounter() {
      const [count, setCount] = useState(0);
      return <Button onClick={() => setCount((current) => current + 1)}>Pulsado {count}</Button>;
    }

    const { rerender } = render(
      <Modal footer={() => <FooterCounter />} open title="Uno">
        <p>Contenido</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Pulsado 0" }));
    rerender(
      <Modal footer={() => <FooterCounter />} open title="Dos">
        <p>Contenido</p>
      </Modal>,
    );

    expect(screen.getByRole("button", { name: "Pulsado 1" })).toBeVisible();
  });
});
