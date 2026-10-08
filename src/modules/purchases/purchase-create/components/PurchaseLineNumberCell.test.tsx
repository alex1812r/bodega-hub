import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import type { PurchaseLineScan } from "../utils/purchaseLineScan";
import { PURCHASE_CELL_FLASH_MS, PurchaseLineNumberCell } from "./PurchaseLineNumberCell";

const onChange = jest.fn();
const onOuterKeyDown = jest.fn();

/** El primer código que propone el escaneo recibido: el corte que sugiere el tiempo. */
function firstCandidate(onScan: jest.Mock) {
  const [scan] = onScan.mock.calls[0] as [PurchaseLineScan];

  return scan.candidates[0];
}

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

  describe("lector USB sobre una celda entera (COM-12b)", () => {
    const onScan = jest.fn();

    function renderScanCell(integer: boolean) {
      onScan.mockReset();
      render(
        <PurchaseLineNumberCell
          aria-label="Celda"
          integer={integer}
          onChange={onChange}
          onScan={onScan}
          value={3}
        />,
      );
    }

    it("Enter con 8 o más dígitos no es una cantidad: la celda vuelve a su valor y el texto sale como escaneo", () => {
      renderScanCell(true);

      type("7591234567890");
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyDown(cell(), { key: "Enter" });

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(firstCandidate(onScan)).toBe("7591234567890");
      expect(cell()).toHaveValue("3");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("con 7 dígitos sigue siendo una cantidad y Enter no escanea", () => {
      renderScanCell(true);

      type("1234567");
      fireEvent.keyDown(cell(), { key: "Enter" });

      expect(onChange).toHaveBeenLastCalledWith(1234567);
      expect(onScan).not.toHaveBeenCalled();
    });

    it("8 dígitos y salir sin Enter: vuelve el valor anterior, sin escaneo y sin resaltar", () => {
      renderScanCell(true);

      type("12345678");
      fireEvent.blur(cell());

      expect(cell()).toHaveValue("3");
      expect(cell()).not.toHaveAttribute("data-flash");
      expect(onChange).not.toHaveBeenCalled();
      expect(onScan).not.toHaveBeenCalled();
    });

    it("un costo de 8 dígitos enteros tampoco es un costo (COM-F6): no sube y Enter lo da como escaneo", () => {
      renderScanCell(false);

      type("12345678");
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyDown(cell(), { key: "Enter" });

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(firstCandidate(onScan)).toBe("12345678");
      expect(cell()).toHaveValue("3");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("un costo de 7 dígitos, o con decimales, sigue siendo un costo", () => {
      renderScanCell(false);

      type("1234567");
      fireEvent.keyDown(cell(), { key: "Enter" });
      expect(onChange).toHaveBeenLastCalledWith(1234567);

      type("12345678,5");
      fireEvent.keyDown(cell(), { key: "Enter" });
      expect(onChange).toHaveBeenLastCalledWith(12345678.5);
      expect(onScan).not.toHaveBeenCalled();
    });
  });

  describe("ráfaga del lector separada por el tiempo entre teclas (COM-F3)", () => {
    const onScan = jest.fn();
    const CODE = "7598765432101";

    function ScanHarness({ initial }: { initial: number }) {
      const [value, setValue] = useState(initial);

      return (
        <>
          <PurchaseLineNumberCell
            aria-label="Celda"
            integer
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            onScan={onScan}
            value={value}
          />
          <output>{value}</output>
        </>
      );
    }

    /** Teclea carácter a carácter dejando pasar `gapMs` antes de cada tecla. */
    async function press(keys: string[], gapMs: number) {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime, delay: null });

      for (const key of keys) {
        act(() => {
          jest.advanceTimersByTime(gapMs);
        });
        await user.keyboard(key);
      }
    }

    /** El lector: 4 ms por tecla y Enter al final. */
    function scan(code: string) {
      return press([...code.split(""), "{Enter}"], 4);
    }

    function focusCell() {
      act(() => cell().focus());
    }

    beforeEach(() => {
      onScan.mockReset();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("cantidad tecleada despacio y luego un escaneo: queda la cantidad y sale solo el código", async () => {
      render(<ScanHarness initial={1} />);

      focusCell();
      await press(["2"], 300);
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      await scan(CODE);

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(firstCandidate(onScan)).toBe(CODE);
      expect(screen.getByRole("status")).toHaveTextContent(/^2$/);
      expect(cell()).toHaveValue("2");
    });

    it("solo el escaneo sobre el valor seleccionado: la cantidad no cambia", async () => {
      render(<ScanHarness initial={3} />);

      focusCell();
      await scan(CODE);

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(firstCandidate(onScan)).toBe(CODE);
      expect(screen.getByRole("status")).toHaveTextContent(/^3$/);
      expect(cell()).toHaveValue("3");
    });

    it("escaneo detrás de un valor que ya estaba y no se seleccionó: sale el código limpio", async () => {
      render(<ScanHarness initial={1} />);

      focusCell();
      act(() => cell().setSelectionRange(1, 1));
      await scan(CODE);

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(firstCandidate(onScan)).toBe(CODE);
      expect(screen.getByRole("status")).toHaveTextContent(/^1$/);
      expect(cell()).toHaveValue("1");
    });

    it("un código que empieza por el mismo dígito que la cantidad seleccionada sale entero", async () => {
      render(<ScanHarness initial={7} />);

      focusCell();
      await scan(CODE);

      expect(firstCandidate(onScan)).toBe(CODE);
      expect(screen.getByRole("status")).toHaveTextContent(/^7$/);
    });

    it("sin tiempos que separen (todo tecleado a mano) vale el texto completo y la cantidad anterior", async () => {
      render(<ScanHarness initial={3} />);

      focusCell();
      await press([..."212345678".split(""), "{Enter}"], 120);

      expect(onScan).toHaveBeenCalledTimes(1);
      expect(firstCandidate(onScan)).toBe("212345678");
      expect(screen.getByRole("status")).toHaveTextContent(/^3$/);
    });

    it("con más de 6 dígitos el valor no sube en vivo: se confirma al salir", async () => {
      render(<ScanHarness initial={3} />);

      focusCell();
      await press("1234567".split(""), 120);

      expect(onChange).toHaveBeenLastCalledWith(123456);
      expect(cell()).toHaveValue("1234567");

      fireEvent.blur(cell());
      expect(onChange).toHaveBeenLastCalledWith(1234567);
      expect(cell()).toHaveValue("1234567");
    });
  });
});
