/**
 * AUD-02 (mitigación de D26): `30.600` se sigue leyendo como 30,60 (D7), pero el
 * campo avisa, sin bloquear, de que el punto NO es de miles.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { NumberInput } from "./NumberInput";

const INTEGER_ERROR = "Debe ser un número entero.";

function getField() {
  return screen.getByLabelText<HTMLInputElement>(/monto/i);
}

function getHint() {
  return screen.queryByRole("status");
}

describe("NumberInput thousands hint (AUD-02)", () => {
  it("typing one dot followed by exactly three digits warns how it will be read, without changing the value", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(<NumberInput decimals={2} label="Monto" onValueChange={onValueChange} />);

    await user.type(getField(), "30.60");
    expect(getHint()).not.toBeInTheDocument();

    await user.type(getField(), "0");

    // D7 no cambia: un separador es el decimal.
    expect(getField()).toHaveValue("30.600");
    expect(onValueChange).toHaveBeenLastCalledWith(30.6);
    expect(getHint()).toHaveTextContent("Se leerá como 30,60. Si son 30.600 (miles), escribe 30600.");
    expect(getHint()).toHaveAttribute("aria-live", "polite");
    // No es un error: el campo sigue siendo válido y el aviso queda asociado a él.
    expect(getField()).not.toHaveAttribute("aria-invalid");
    expect(getField().getAttribute("aria-describedby")).toContain(getHint()?.id);
  });

  it.each([
    ["1.250", "Se leerá como 1,25. Si son 1.250 (miles), escribe 1250."],
    ["999.999", "Se leerá como 1000,00. Si son 999.999 (miles), escribe 999999."],
    ["-30.600", "Se leerá como -30,60. Si son -30.600 (miles), escribe -30600."],
  ])("warns for %s", async (typed, message) => {
    const user = userEvent.setup();

    render(<NumberInput allowNegative decimals={2} label="Monto" />);
    await user.type(getField(), typed);

    expect(getHint()).toHaveTextContent(message);
  });

  it("stays after leaving the field and goes away when the value changes", async () => {
    const user = userEvent.setup();

    render(
      <>
        <NumberInput decimals={2} label="Monto" padDecimals />
        <button type="button">Otro</button>
      </>,
    );

    await user.type(getField(), "30.600");
    await user.click(screen.getByRole("button", { name: "Otro" }));

    expect(getField()).toHaveValue("30.60");
    expect(getHint()).toHaveTextContent("Se leerá como 30,60.");

    // El campo se reescribió al salir: se cambia el valor con un evento directo, no con user-event.
    fireEvent.change(getField(), { target: { value: "30.61" } });

    expect(getField()).toHaveValue("30.61");
    expect(getHint()).not.toBeInTheDocument();
  });

  it("stays when Enter formats the field", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" />);

    await user.type(getField(), "30.600{Enter}");

    expect(getField()).toHaveValue("30.6");
    expect(getHint()).toHaveTextContent("Se leerá como 30,60.");
  });

  it("goes away when a digit is deleted and comes back when it is typed again", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" />);

    await user.type(getField(), "30.600");
    expect(getHint()).toBeInTheDocument();

    await user.keyboard("{Backspace}");
    expect(getField()).toHaveValue("30.60");
    expect(getHint()).not.toBeInTheDocument();

    await user.keyboard("0");
    expect(getHint()).toBeInTheDocument();

    await user.clear(getField());
    expect(getHint()).not.toBeInTheDocument();
  });

  it.each(["30,600", "30.6", "30.60", "30.6000", "30600", "0.600", "1234.567", "1.250,5"])(
    "does not warn for %s",
    async (typed) => {
      const user = userEvent.setup();

      render(<NumberInput decimals={2} label="Monto" />);
      await user.type(getField(), typed);

      expect(getHint()).not.toBeInTheDocument();
    },
  );

  it("a comma typed as the decimal stays a decimal after leaving the field and adding a digit", async () => {
    const user = userEvent.setup();

    render(
      <>
        <NumberInput decimals={3} label="Monto" />
        <button type="button">Otro</button>
      </>,
    );

    await user.type(getField(), "30,60");
    await user.click(screen.getByRole("button", { name: "Otro" }));
    await user.click(getField());
    await user.keyboard("{End}0");

    expect(getField()).toHaveValue("30.600");
    expect(getHint()).not.toBeInTheDocument();
  });

  it.each([
    ["30.600", "30.600", "Se leerá como 30,60. Si son 30.600 (miles), escribe 30600."],
    ["Bs 1.250", "1.250", "Se leerá como 1,25. Si son 1.250 (miles), escribe 1250."],
  ])("warns when %s is pasted", async (pasted, shown, message) => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" />);

    await user.click(getField());
    await user.paste(pasted);

    expect(getField()).toHaveValue(shown);
    expect(getHint()).toHaveTextContent(message);
  });

  it.each([
    // Con coma el decimal está dicho.
    ["30,600", "30.600"],
    // Con coma y punto no hay duda: el último es el decimal.
    ["1.234,500", "1234.500"],
    ["1,234.500", "1234.500"],
    ["30.60", "30.60"],
  ])("does not warn when %s is pasted", async (pasted, shown) => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" />);

    await user.click(getField());
    await user.paste(pasted);

    expect(getField()).toHaveValue(shown);
    expect(getHint()).not.toBeInTheDocument();
  });

  it("pasting the same digits with a comma over an ambiguous value removes the warning", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" />);

    await user.type(getField(), "30.600");
    expect(getHint()).toBeInTheDocument();

    getField().select();
    await user.paste("30,600");

    // Mismo texto en el campo, pero ahora el decimal se dijo con coma.
    expect(getField()).toHaveValue("30.600");
    expect(getHint()).not.toBeInTheDocument();
  });

  it("warns when pasted digits complete a typed dot", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" />);

    await user.type(getField(), "30.");
    await user.paste("600");

    expect(getField()).toHaveValue("30.600");
    expect(getHint()).toBeInTheDocument();
  });

  it("does not warn in integer fields: they already have their own validation", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={0} label="Monto" />);
    await user.type(getField(), "30.600");

    expect(getHint()).not.toBeInTheDocument();

    await user.clear(getField());
    await user.type(getField(), "1.250");
    expect(getHint()).not.toBeInTheDocument();
    expect(screen.getByText(INTEGER_ERROR)).toBeInTheDocument();
  });

  it("never warns in a disabled or read-only field, nor for a value that was not typed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <NumberInput decimals={3} label="Monto" onChange={() => undefined} readOnly value="30.600" />,
    );

    expect(getHint()).not.toBeInTheDocument();

    fireEvent.paste(getField(), { clipboardData: { getData: () => "1.250" } });
    expect(getField()).toHaveValue("30.600");
    expect(getHint()).not.toBeInTheDocument();

    rerender(
      <NumberInput decimals={3} disabled label="Monto" onChange={() => undefined} value="30.600" />,
    );
    await user.type(getField(), "1.250");
    expect(getHint()).not.toBeInTheDocument();
  });

  it("hides the warning if the field becomes read-only or disabled while it is shown", async () => {
    const user = userEvent.setup();

    function Field({ locked }: { locked: "disabled" | "readOnly" | null }) {
      const [value, setValue] = useState("");

      return (
        <NumberInput
          decimals={2}
          disabled={locked === "disabled"}
          label="Monto"
          onChange={(event) => setValue(event.target.value)}
          readOnly={locked === "readOnly"}
          value={value}
        />
      );
    }

    const { rerender } = render(<Field locked={null} />);

    await user.type(getField(), "30.600");
    expect(getHint()).toBeInTheDocument();

    rerender(<Field locked="readOnly" />);
    expect(getHint()).not.toBeInTheDocument();

    rerender(<Field locked="disabled" />);
    expect(getHint()).not.toBeInTheDocument();
  });

  it("goes away when the parent replaces the value", async () => {
    const user = userEvent.setup();

    function Field() {
      const [value, setValue] = useState<number | null>(null);

      return (
        <>
          <NumberInput decimals={2} label="Monto" onValueChange={setValue} value={value} />
          <button onClick={() => setValue(500)} type="button">
            Completar saldo
          </button>
        </>
      );
    }

    render(<Field />);

    await user.type(getField(), "30.600");
    expect(getHint()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Completar saldo" }));
    expect(getField()).toHaveValue("500");
    expect(getHint()).not.toBeInTheDocument();
  });

  it("goes away when the arrows step the value", async () => {
    const user = userEvent.setup();

    render(<NumberInput allowArrowStep decimals={3} label="Monto" step={1} />);

    await user.type(getField(), "30.600");
    expect(getHint()).toBeInTheDocument();

    await user.keyboard("{ArrowUp}");
    expect(getField()).toHaveValue("31.6");
    expect(getHint()).not.toBeInTheDocument();
  });

  it("can be turned off with thousandsHint={false}", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={3} label="Monto" thousandsHint={false} />);
    await user.type(getField(), "1.250");

    expect(getField()).toHaveValue("1.250");
    expect(getHint()).not.toBeInTheDocument();
  });

  it("shows next to the error passed by the caller without replacing it", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} error="Supera el saldo." label="Monto" />);
    await user.type(getField(), "30.600");

    expect(screen.getByText("Supera el saldo.")).toBeInTheDocument();
    expect(getHint()).toHaveTextContent("Se leerá como 30,60.");
    expect(getField()).toHaveAttribute("aria-invalid", "true");
  });

  it("reads the value the field will keep when min or max apply", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" max={20} />);
    await user.type(getField(), "30.600");

    expect(getHint()).toHaveTextContent("Se leerá como 20,00. Si son 30.600 (miles), escribe 30600.");
  });

  it("is inline by default and can be anchored to the field so it does not push the layout", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NumberInput decimals={2} label="Monto" />);

    await user.type(getField(), "30.600");
    expect(getHint()).toHaveAttribute("data-placement", "inline");
    expect(getHint()).not.toHaveClass("fixed");
    expect(getField().parentElement?.parentElement).toContainElement(getHint());
    unmount();

    render(
      <>
        <NumberInput aria-label="Monto" decimals={2} thousandsHintPlacement="floating" />
        <button type="button">Otro</button>
      </>,
    );
    await user.type(getField(), "30.600");

    expect(getHint()).toHaveTextContent("Se leerá como 30,60.");
    expect(getHint()).toHaveAttribute("data-placement", "floating");
    // Fuera del flujo del campo: en un portal y con posición fija.
    expect(getHint()).toHaveClass("fixed");
    expect(getHint()?.parentElement).toBe(document.body);
    expect(getField().getAttribute("aria-describedby")).toContain(getHint()?.id);

    // Como un tooltip: se va cuando el campo pierde el foco y el puntero, y vuelve con ellos;
    // el valor no ha cambiado.
    await user.click(screen.getByRole("button", { name: "Otro" }));
    expect(getHint()).not.toBeInTheDocument();
    expect(getField()).toHaveValue("30.6");

    await user.click(getField());
    expect(getHint()).toHaveTextContent("Se leerá como 30,60.");
  });
});
