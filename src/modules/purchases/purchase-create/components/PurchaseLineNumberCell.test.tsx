import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { PURCHASE_CELL_FLASH_MS, PurchaseLineNumberCell } from "./PurchaseLineNumberCell";

const onChange = jest.fn();
const onOuterKeyDown = jest.fn();

function Harness({ initial, integer = false }: { initial: number; integer?: boolean }) {
  const [value, setValue] = useState(initial);

  return (
    <div onKeyDown={onOuterKeyDown} role="presentation">
      <PurchaseLineNumberCell
        aria-label="Celda"
        integer={integer}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        value={value}
      />
      <output>{value}</output>
    </div>
  );
}

function cell() {
  return screen.getByLabelText<HTMLInputElement>("Celda");
}

function type(value: string) {
  fireEvent.focus(cell());
  fireEvent.change(cell(), { target: { value } });
}

beforeEach(() => {
  onChange.mockReset();
  onOuterKeyDown.mockReset();
});

describe("PurchaseLineNumberCell", () => {
  it("un campo vacío no sube al padre y al salir vuelve el último valor válido", () => {
    render(<Harness initial={5} integer />);

    type("");
    expect(cell()).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(cell());
    expect(cell()).toHaveValue("5");
    expect(cell()).not.toHaveAttribute("data-flash");
  });

  it("una cantidad con decimales avisa, no sube, y al salir vuelve la cantidad anterior", () => {
    render(<Harness initial={5} integer />);

    type("2,5");
    expect(screen.getByText("Debe ser un número entero.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(cell());
    expect(cell()).toHaveValue("5");
    expect(screen.queryByText("Debe ser un número entero.")).not.toBeInTheDocument();
  });

  it("una cantidad no baja de 1 y un costo no baja de 0", () => {
    const { unmount } = render(<Harness initial={5} integer />);

    type("0");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(cell());
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(cell()).toHaveValue("1");
    unmount();

    render(<Harness initial={5} />);
    type("0");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("un costo acepta coma decimal y redondea a 2 decimales al salir", () => {
    render(<Harness initial={1.2} />);

    type("1,355");
    // El tercer decimal no sube: el padre solo recibe valores ya redondeados.
    expect(onChange).not.toHaveBeenCalledWith(1.355);

    fireEvent.blur(cell());
    expect(onChange).toHaveBeenLastCalledWith(1.36);
    expect(cell()).toHaveValue("1.36");
    expect(screen.getByRole("status")).toHaveTextContent("1.36");
  });

  it("al confirmar un cambio la celda se resalta 1,5 s; sin cambio no", () => {
    jest.useFakeTimers();

    try {
      render(<Harness initial={5} integer />);

      fireEvent.focus(cell());
      fireEvent.blur(cell());
      expect(cell()).not.toHaveAttribute("data-flash");

      type("8");
      // Cada tecla no resalta: solo el valor confirmado al salir.
      expect(cell()).not.toHaveAttribute("data-flash");
      fireEvent.blur(cell());
      expect(cell()).toHaveAttribute("data-flash", "true");
      expect(cell()).toHaveClass("bg-primary/10", "motion-reduce:transition-none");

      act(() => {
        jest.advanceTimersByTime(PURCHASE_CELL_FLASH_MS - 1);
      });
      expect(cell()).toHaveAttribute("data-flash", "true");

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(cell()).not.toHaveAttribute("data-flash");
    } finally {
      jest.useRealTimers();
    }
  });

  it("Esc a medio escribir vuelve al valor de entrada y no deja pasar la tecla", () => {
    render(<Harness initial={5} integer />);

    type("8");
    fireEvent.keyDown(cell(), { key: "Escape" });

    expect(cell()).toHaveValue("5");
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(onOuterKeyDown).not.toHaveBeenCalled();
  });

  it("Esc con el campo vacío lo restaura sin tocar al padre", () => {
    render(<Harness initial={5} integer />);

    type("");
    fireEvent.keyDown(cell(), { key: "Escape" });

    expect(cell()).toHaveValue("5");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Esc tras un cambio confirmado vuelve al valor anterior, una sola vez", () => {
    render(<Harness initial={5} integer />);

    type("8");
    fireEvent.blur(cell());
    type("9");
    fireEvent.blur(cell());

    fireEvent.focus(cell());
    fireEvent.keyDown(cell(), { key: "Escape" });
    expect(cell()).toHaveValue("8");

    // Solo se deshace el último cambio: un segundo Esc ya no tiene nada que deshacer.
    fireEvent.keyDown(cell(), { key: "Escape" });
    expect(cell()).toHaveValue("8");
    expect(onOuterKeyDown).toHaveBeenCalledTimes(1);
  });

  it("Esc sin cambios no hace nada y la tecla sigue su curso", () => {
    render(<Harness initial={5} integer />);

    fireEvent.focus(cell());
    const notPrevented = fireEvent.keyDown(cell(), { key: "Escape" });

    expect(notPrevented).toBe(true);
    expect(cell()).toHaveValue("5");
    expect(onChange).not.toHaveBeenCalled();
    expect(onOuterKeyDown).toHaveBeenCalledTimes(1);
  });

  it("si el padre cambia el valor por fuera, la celda lo muestra", () => {
    const { rerender } = render(
      <PurchaseLineNumberCell aria-label="Celda" integer onChange={onChange} value={5} />,
    );

    type("");
    rerender(<PurchaseLineNumberCell aria-label="Celda" integer onChange={onChange} value={6} />);

    expect(cell()).toHaveValue("6");
  });
});
