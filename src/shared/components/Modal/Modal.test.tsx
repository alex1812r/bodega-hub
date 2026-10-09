import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
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

// CNF-F1 · F2: el segundo clic de un doble clic sobre el disparador cae en el
// fondo recién montado y cerraba el diálogo que el primero acababa de abrir.
describe("Modal: clic fuera justo después de abrirse", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onOpenChange = jest.fn();

    render(
      <Modal
        onOpenChange={onOpenChange}
        title="Cambiar precio"
        trigger={<Button>Actualizar precio</Button>}
      >
        <p>Contenido del modal</p>
      </Modal>,
    );

    return { onOpenChange, user };
  }

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Actualizar precio" }));
    const dialog = await screen.findByRole("dialog");
    // Radix registra su escucha de «clic fuera» en un setTimeout(0).
    act(() => {
      jest.advanceTimersByTime(1);
    });

    return dialog;
  }

  function backdrop(dialog: HTMLElement) {
    const element = dialog.previousElementSibling;

    if (!(element instanceof HTMLElement)) {
      throw new Error("No se encontró el fondo del modal");
    }

    return element;
  }

  it.each([20, 120, 250])(
    "ignora el clic en el fondo que llega %i ms después de abrirse",
    async (delay) => {
      const { onOpenChange, user } = setup();
      const dialog = await open(user);

      act(() => {
        jest.advanceTimersByTime(delay);
      });
      await user.click(backdrop(dialog));
      act(() => {
        jest.advanceTimersByTime(50);
      });

      expect(screen.getByRole("dialog")).toBeVisible();
      expect(onOpenChange.mock.calls).toEqual([[true]]);
    },
  );

  it("cierra con un clic deliberado en el fondo pasada la ventana", async () => {
    const { onOpenChange, user } = setup();
    const dialog = await open(user);

    act(() => {
      jest.advanceTimersByTime(600);
    });
    await user.click(backdrop(dialog));
    act(() => {
      jest.advanceTimersByTime(50);
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("Esc cierra sin esperar a la ventana", async () => {
    const { onOpenChange, user } = setup();
    await open(user);

    await user.keyboard("{Escape}");
    act(() => {
      jest.advanceTimersByTime(50);
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("el botón de cerrar cierra sin esperar a la ventana", async () => {
    const { onOpenChange, user } = setup();
    await open(user);

    await user.click(screen.getByRole("button", { name: "Cerrar modal" }));
    act(() => {
      jest.advanceTimersByTime(50);
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});
