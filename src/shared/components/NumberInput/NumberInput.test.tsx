import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import {
  normalizeNumberText,
  normalizePastedNumber,
  NumberInput,
  parseNumberInput,
  sanitizeNumberText,
} from "./NumberInput";

function getField() {
  return screen.getByLabelText<HTMLInputElement>(/monto/i);
}

describe("NumberInput", () => {
  it("renders a text field with a decimal keyboard, never type=number", () => {
    render(<NumberInput label="Monto" />);

    expect(getField()).toHaveAttribute("type", "text");
    expect(getField()).toHaveAttribute("inputmode", "decimal");
  });

  it("uses the numeric keyboard for integers", () => {
    render(<NumberInput decimals={0} label="Monto" />);

    expect(getField()).toHaveAttribute("type", "text");
    expect(getField()).toHaveAttribute("inputmode", "numeric");
  });

  it("accepts comma and dot as decimal separator and keeps a dot in the DOM", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(<NumberInput label="Monto" onValueChange={onValueChange} />);

    await user.type(getField(), "12,5");
    expect(getField()).toHaveValue("12.5");
    expect(onValueChange).toHaveBeenLastCalledWith(12.5);

    await user.clear(getField());
    expect(onValueChange).toHaveBeenLastCalledWith(null);

    await user.type(getField(), "7.25");
    expect(getField()).toHaveValue("7.25");
    expect(onValueChange).toHaveBeenLastCalledWith(7.25);
  });

  it("rejects non numeric characters and a second separator", async () => {
    const user = userEvent.setup();

    render(<NumberInput label="Monto" />);

    await user.type(getField(), "1a2b.3,4x");

    expect(getField()).toHaveValue("12.34");
  });

  it("rejects the minus sign unless allowNegative is set", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NumberInput label="Monto" />);

    await user.type(getField(), "-5");
    expect(getField()).toHaveValue("5");
    unmount();

    render(<NumberInput allowNegative label="Monto" />);
    await user.type(getField(), "-8.5");
    expect(getField()).toHaveValue("-8.5");
    expect(getField()).toHaveAttribute("inputmode", "text");
  });

  it.each([
    ["1.234,50", "1234.50"],
    ["1,234.50", "1234.50"],
    ["1.234.567", "1234567"],
    ["Bs 12,5", "12.5"],
    ["1.234", "1.234"],
  ])("pastes %s as %s", async (pasted, expected) => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(<NumberInput label="Monto" onValueChange={onValueChange} />);

    await user.click(getField());
    await user.paste(pasted);

    expect(getField()).toHaveValue(expected);
    expect(onValueChange).toHaveBeenLastCalledWith(Number(expected));
  });

  it("replaces the selected content when pasting over an existing value", async () => {
    const user = userEvent.setup();

    render(<NumberInput defaultValue={99} label="Monto" />);

    await user.click(getField());
    await user.paste("1.234,50");

    expect(getField()).toHaveValue("1234.50");
  });

  it("applies min and max when leaving the field", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(<NumberInput label="Monto" max={100} min="1" onValueChange={onValueChange} />);

    await user.type(getField(), "150");
    expect(getField()).toHaveValue("150");

    await user.tab();
    expect(getField()).toHaveValue("100");
    expect(onValueChange).toHaveBeenLastCalledWith(100);

    await user.type(getField(), "0.5");
    await user.tab();
    expect(getField()).toHaveValue("1");
    expect(onValueChange).toHaveBeenLastCalledWith(1);
  });

  it("trims extra decimals", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NumberInput decimals={2} label="Monto" />);

    await user.type(getField(), "1,239");
    expect(getField()).toHaveValue("1.23");
    unmount();

    // Entero: al escribir se rechaza el separador; al pegar se descartan los decimales.
    render(<NumberInput decimals={0} label="Monto" />);
    await user.type(getField(), "12.7");
    expect(getField()).toHaveValue("127");
    await user.clear(getField());
    await user.paste("12,7");
    expect(getField()).toHaveValue("12");
  });

  it("formats on blur without touching a value that was already valid", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(<NumberInput decimals={2} label="Monto" max={100} min={0} onChange={onChange} />);

    await user.type(getField(), "12.50");
    onChange.mockClear();
    await user.tab();

    expect(getField()).toHaveValue("12.50");
    expect(onChange).not.toHaveBeenCalled();

    await user.type(getField(), "007.");
    await user.tab();

    expect(getField()).toHaveValue("7");
    expect(onChange).toHaveBeenCalled();
  });

  it("pads decimals on blur when asked", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" padDecimals />);

    await user.type(getField(), "12,5");
    await user.tab();

    expect(getField()).toHaveValue("12.50");
  });

  it("selects the whole content on focus", async () => {
    const user = userEvent.setup();

    render(<NumberInput defaultValue={123.5} label="Monto" />);

    await user.tab();

    expect(getField()).toHaveFocus();
    expect(getField().selectionStart).toBe(0);
    expect(getField().selectionEnd).toBe(5);
  });

  it("ignores the wheel when focused and never hijacks page scroll", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(<NumberInput defaultValue={10} label="Monto" onValueChange={onValueChange} step={1} />);

    // Sin foco: el evento sigue su curso (fireEvent devuelve false si alguien hizo preventDefault).
    expect(fireEvent.wheel(getField(), { deltaY: 120 })).toBe(true);
    expect(getField()).toHaveValue("10");

    await user.click(getField());
    expect(getField()).toHaveFocus();

    expect(fireEvent.wheel(getField(), { deltaY: 120 })).toBe(true);
    expect(fireEvent.wheel(getField(), { deltaY: -120 })).toBe(true);
    expect(getField()).toHaveValue("10");
    expect(getField()).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("ignores the arrow keys unless allowArrowStep and step are set", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<NumberInput defaultValue={10} label="Monto" step={1} />);

    await user.click(getField());
    await user.keyboard("{ArrowUp}{ArrowDown}{ArrowDown}");
    expect(getField()).toHaveValue("10");

    rerender(<NumberInput allowArrowStep defaultValue={10} label="Monto" max={11} step="0.5" />);
    await user.keyboard("{ArrowUp}");
    expect(getField()).toHaveValue("10.5");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(getField()).toHaveValue("11");
    await user.keyboard("{ArrowDown}");
    expect(getField()).toHaveValue("10.5");
  });

  it("does not step below zero when negatives are not allowed", async () => {
    const user = userEvent.setup();

    render(<NumberInput allowArrowStep defaultValue={1} label="Monto" step={2} />);

    await user.click(getField());
    await user.keyboard("{ArrowDown}");

    expect(getField()).toHaveValue("0");
  });

  it("works with react-hook-form register and valueAsNumber", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    function RegisterForm() {
      const { handleSubmit, register } = useForm<{ amount: number; stock: number | null }>({
        defaultValues: { amount: 3.5, stock: null },
      });

      return (
        <form onSubmit={handleSubmit((values) => onSubmit(values))}>
          <NumberInput decimals={2} label="Monto" {...register("amount", { valueAsNumber: true })} />
          <NumberInput
            decimals={0}
            label="Existencia"
            {...register("stock", { setValueAs: parseNumberInput })}
          />
          <button type="submit">Guardar</button>
        </form>
      );
    }

    render(<RegisterForm />);

    expect(getField()).toHaveValue("3.5");

    await user.type(getField(), "12,5");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(onSubmit).toHaveBeenLastCalledWith({ amount: 12.5, stock: null });

    await user.type(screen.getByLabelText(/existencia/i), "40");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(onSubmit).toHaveBeenLastCalledWith({ amount: 12.5, stock: 40 });
  });

  it("sends the value clamped on blur to react-hook-form", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    function RegisterForm() {
      const { handleSubmit, register } = useForm<{ amount: number }>();

      return (
        <form onSubmit={handleSubmit((values) => onSubmit(values))}>
          <NumberInput label="Monto" max={100} {...register("amount", { valueAsNumber: true })} />
          <button type="submit">Guardar</button>
        </form>
      );
    }

    render(<RegisterForm />);

    await user.type(getField(), "250");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(getField()).toHaveValue("100");
    expect(onSubmit).toHaveBeenLastCalledWith({ amount: 100 });
  });

  it("works with react-hook-form Controller", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    function ControllerForm() {
      const { control, handleSubmit } = useForm<{ amount: number | null }>({
        defaultValues: { amount: 2 },
      });

      return (
        <form onSubmit={handleSubmit((values) => onSubmit(values))}>
          <Controller
            control={control}
            name="amount"
            render={({ field, fieldState }) => (
              <NumberInput
                decimals={2}
                error={fieldState.error?.message}
                label="Monto"
                name={field.name}
                onBlur={field.onBlur}
                onValueChange={field.onChange}
                ref={field.ref}
                value={field.value}
              />
            )}
            rules={{ required: "El monto es obligatorio." }}
          />
          <button type="submit">Guardar</button>
        </form>
      );
    }

    render(<ControllerForm />);

    expect(getField()).toHaveValue("2");

    await user.type(getField(), "1,05");
    expect(getField()).toHaveValue("1.05");
    await user.click(screen.getByRole("button", { name: /guardar/i }));
    expect(onSubmit).toHaveBeenLastCalledWith({ amount: 1.05 });

    await user.clear(getField());
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(await screen.findByText("El monto es obligatorio.")).toBeVisible();
    expect(getField()).toHaveFocus();
  });

  it("keeps what is being typed when the parent stores numbers", async () => {
    const user = userEvent.setup();

    function NumericState() {
      const [amount, setAmount] = useState(3);

      return (
        <>
          <NumberInput
            label="Monto"
            onChange={(event) => setAmount(Number(event.target.value) || 0)}
            value={amount}
          />
          <output>{amount}</output>
          <button onClick={() => setAmount(9)} type="button">
            Poner 9
          </button>
        </>
      );
    }

    render(<NumericState />);

    expect(getField()).toHaveValue("3");

    await user.type(getField(), "1.");
    expect(getField()).toHaveValue("1.");

    await user.keyboard("05");
    expect(getField()).toHaveValue("1.05");
    expect(screen.getByRole("status")).toHaveTextContent("1.05");

    await user.click(screen.getByRole("button", { name: /poner 9/i }));
    expect(getField()).toHaveValue("9");
  });

  it("works with a string kept in local state", async () => {
    const user = userEvent.setup();

    function StringState() {
      const [amount, setAmount] = useState("4,5");

      return (
        <>
          <NumberInput
            label="Monto"
            min="0"
            onChange={(event) => setAmount(event.target.value)}
            step="0.01"
            value={amount}
          />
          <output>{amount}</output>
        </>
      );
    }

    render(<StringState />);

    expect(getField()).toHaveValue("4.5");

    await user.type(getField(), "20,");
    await user.tab();

    expect(getField()).toHaveValue("20");
    expect(screen.getByRole("status")).toHaveTextContent("20");
  });

  it("can be disabled", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(<NumberInput defaultValue={5} disabled label="Monto" onValueChange={onValueChange} />);

    await user.type(getField(), "9");

    expect(getField()).toBeDisabled();
    expect(getField()).toHaveValue("5");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("does not change a read-only value on typing, pasting, stepping or blur", async () => {
    const user = userEvent.setup();
    const onValueChange = jest.fn();

    render(
      <NumberInput
        allowArrowStep
        defaultValue={500}
        label="Monto"
        max={100}
        onValueChange={onValueChange}
        readOnly
        step={1}
      />,
    );

    await user.click(getField());
    await user.keyboard("9{ArrowUp}");
    await user.paste("12");
    await user.tab();

    expect(getField()).toHaveAttribute("readonly");
    expect(getField()).toHaveValue("500");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("shows the error and marks the field as invalid", () => {
    render(<NumberInput error="El monto es obligatorio." helperText="En bolívares" label="Monto" />);

    expect(getField()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("El monto es obligatorio.")).toBeVisible();
    expect(getField()).toHaveAccessibleDescription("El monto es obligatorio.");
  });

  it("forwards the ref to the input element", () => {
    const ref = { current: null as HTMLInputElement | null };

    render(<NumberInput label="Monto" ref={ref} />);

    expect(ref.current).toBe(getField());
  });
});

describe("NumberInput helpers", () => {
  it("parses field text into a number or null", () => {
    expect(parseNumberInput("12.5")).toBe(12.5);
    expect(parseNumberInput("12,5")).toBe(12.5);
    expect(parseNumberInput("1.")).toBe(1);
    expect(parseNumberInput(".5")).toBe(0.5);
    expect(parseNumberInput(7)).toBe(7);
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("-")).toBeNull();
    expect(parseNumberInput(".")).toBeNull();
    expect(parseNumberInput(Number.NaN)).toBeNull();
    expect(parseNumberInput(undefined)).toBeNull();
  });

  it("sanitizes typed text", () => {
    expect(sanitizeNumberText("12,345", { decimals: 2 })).toBe("12.34");
    expect(sanitizeNumberText("-3", {})).toBe("3");
    expect(sanitizeNumberText("-3", { allowNegative: true })).toBe("-3");
    expect(sanitizeNumberText("3-4", { allowNegative: true })).toBe("34");
    expect(sanitizeNumberText("1.", {})).toBe("1.");
  });

  it("resolves thousands and decimal separators of pasted text", () => {
    expect(normalizePastedNumber("1.234,50")).toBe("1234.50");
    expect(normalizePastedNumber("1,234.50")).toBe("1234.50");
    expect(normalizePastedNumber("1.234.567,5")).toBe("1234567.5");
    expect(normalizePastedNumber("1,234,567")).toBe("1234567");
    expect(normalizePastedNumber("$ 45,9")).toBe("45.9");
  });

  it("normalizes on blur", () => {
    expect(normalizeNumberText("", {})).toBe("");
    expect(normalizeNumberText(".", {})).toBe("");
    expect(normalizeNumberText(".5", {})).toBe("0.5");
    expect(normalizeNumberText("0012", {})).toBe("12");
    expect(normalizeNumberText("-0", { allowNegative: true })).toBe("0");
    expect(normalizeNumberText("-7.10", { allowNegative: true, min: -5 })).toBe("-5");
    expect(normalizeNumberText("3", { decimals: 2, padDecimals: true })).toBe("3.00");
    expect(normalizeNumberText("250", { decimals: 2, max: 99.5, padDecimals: true })).toBe("99.50");
  });
});
