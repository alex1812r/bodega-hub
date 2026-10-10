import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import {
  getNumberInputError,
  isIntegerText,
  normalizeNumberText,
  normalizePastedNumber,
  NumberInput,
  parseNumberInput,
  sanitizeNumberText,
} from "./NumberInput";

const INTEGER_ERROR = "Debe ser un número entero.";

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

  it("rejects non numeric characters and a repeated separator", async () => {
    const user = userEvent.setup();

    render(<NumberInput label="Monto" />);

    await user.type(getField(), "1a2b.3.4x");

    expect(getField()).toHaveValue("12.34");
  });

  it("reads the last of two different typed separators as the decimal", async () => {
    const user = userEvent.setup();

    render(<NumberInput label="Monto" />);

    // Antes "12.3" + "," dejaba 12.34; con el contrato de SHR-09H el punto pasa a ser de miles.
    await user.type(getField(), "1a2b.3,4x");

    expect(getField()).toHaveValue("123.4");
  });

  describe("second separator while typing", () => {
    function PriceForm({ defaultPrice }: { defaultPrice?: number }) {
      const { control, register } = useForm<{ price: number }>({
        defaultValues: { price: defaultPrice },
      });
      const price = useWatch({ control, name: "price" });

      return (
        <>
          <NumberInput decimals={2} label="Monto" {...register("price", { valueAsNumber: true })} />
          <output>{String(price)}</output>
        </>
      );
    }

    function getFormValue() {
      // El <output> del formulario, no el aviso de miles del campo (también `status`, AUD-02).
      return screen.getAllByRole("status").find((node) => node.tagName === "OUTPUT")?.textContent;
    }

    async function placeCaret(user: ReturnType<typeof userEvent.setup>, position: number) {
      await user.click(getField());
      getField().setSelectionRange(position, position);
    }

    it("drops a comma typed before the existing dot instead of moving the decimal", async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      const onValueChange = jest.fn();

      render(
        <NumberInput
          decimals={2}
          defaultValue={1250.75}
          label="Monto"
          onChange={onChange}
          onValueChange={onValueChange}
        />,
      );

      await placeCaret(user, 1);
      await user.keyboard(",");

      expect(getField()).toHaveValue("1250.75");
      expect(getField().selectionStart).toBe(1);
      expect(getField().selectionEnd).toBe(1);
      expect(onChange.mock.lastCall?.[0].target.value).toBe("1250.75");
      expect(onValueChange).toHaveBeenLastCalledWith(1250.75);
    });

    it("keeps the form value when a comma is typed before the existing dot", async () => {
      const user = userEvent.setup();

      render(<PriceForm defaultPrice={1250.75} />);

      await placeCaret(user, 1);
      await user.keyboard(",");

      expect(getField()).toHaveValue("1250.75");
      expect(getField().selectionStart).toBe(1);
      expect(getFormValue()).toBe("1250.75");

      await user.tab();
      expect(getField()).toHaveValue("1250.75");
      expect(getFormValue()).toBe("1250.75");
    });

    it.each([
      ["1.250,75", ["1", "1.", "1.2", "1.25", "1.250", "1250.", "1250.7", "1250.75"]],
      ["1,250.75", ["1", "1.", "1.2", "1.25", "1.250", "1250.", "1250.7", "1250.75"]],
    ])("reads %s typed with a thousands separator as 1250.75", async (typed, steps) => {
      const user = userEvent.setup();

      render(<PriceForm />);
      await user.click(getField());

      for (const [index, char] of [...typed].entries()) {
        await user.keyboard(char);

        expect(getField()).toHaveValue(steps[index]);
        expect(getField().selectionStart).toBe(steps[index].length);
        // Lo que recibe el formulario es siempre lo que se ve escrito.
        expect(getFormValue()).toBe(String(Number(steps[index])));
      }

      await user.tab();
      expect(getField()).toHaveValue("1250.75");
      expect(getFormValue()).toBe("1250.75");
    });

    it.each([
      ["1.250", "."],
      ["1,250", ","],
    ])("rejects a repeated separator after typing %s", async (typed, separator) => {
      const user = userEvent.setup();

      render(<PriceForm />);
      await user.click(getField());
      await user.keyboard(typed);
      await user.keyboard(separator);

      expect(getField()).toHaveValue("1.250");
      expect(getField().selectionStart).toBe(5);
      expect(getFormValue()).toBe("1.25");

      getField().setSelectionRange(0, 0);
      await user.keyboard(separator);

      expect(getField()).toHaveValue("1.250");
      expect(getField().selectionStart).toBe(0);
      expect(getFormValue()).toBe("1.25");
    });

    it("rejects a dot typed before the dot of a value that was not typed", async () => {
      const user = userEvent.setup();

      render(<PriceForm defaultPrice={1250.75} />);

      await placeCaret(user, 1);
      await user.keyboard(".");

      expect(getField()).toHaveValue("1250.75");
      expect(getField().selectionStart).toBe(1);
      expect(getFormValue()).toBe("1250.75");
    });

    it("treats the separator as the dot it shows once the field was left", async () => {
      const user = userEvent.setup();

      render(<PriceForm />);
      await user.click(getField());
      await user.keyboard("1,25");
      await user.tab();

      await placeCaret(user, 4);
      await user.keyboard(".");

      expect(getField()).toHaveValue("1.25");
      expect(getFormValue()).toBe("1.25");
    });

    it("keeps a separator typed in the middle of an integer and marks it invalid", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      function IntegerState() {
        const [quantity, setQuantity] = useState<number | null>(125);

        return (
          <NumberInput
            decimals={0}
            label="Monto"
            onValueChange={(next) => {
              onValueChange(next);
              setQuantity(next);
            }}
            value={quantity}
          />
        );
      }

      render(<IntegerState />);

      await placeCaret(user, 1);
      await user.keyboard(",");

      // Antes el separador se descartaba y quedaba 125: ahora se ve y el campo queda invalido.
      expect(getField()).toHaveValue("1.25");
      expect(getField().selectionStart).toBe(2);
      expect(onValueChange).toHaveBeenLastCalledWith(1.25);
      expect(getField()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(INTEGER_ERROR)).toBeVisible();
    });
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

  describe("text that is not a plain number (SHR-09K)", () => {
    const modes: [string, number | undefined][] = [
      ["an integer", 0],
      ["a decimal", 2],
    ];

    describe.each(modes)("in %s field", (_mode, decimals) => {
      // Antes la letra se descartaba y los digitos se unian: pegar 1e3 dejaba 13.
      it.each(["1e3", "1E3", "1e-3", "12abc3", "3-4", "10 20", "1 0000", "Bs 1e3"])(
        "rejects pasting %s instead of joining its digits",
        async (pasted) => {
          const user = userEvent.setup();
          const onChange = jest.fn();
          const onValueChange = jest.fn();

          render(
            <NumberInput
              decimals={decimals}
              defaultValue={99}
              label="Monto"
              onChange={onChange}
              onValueChange={onValueChange}
            />,
          );

          await user.click(getField());
          await user.paste(pasted);

          expect(getField()).toHaveValue("99");
          expect(onChange).not.toHaveBeenCalled();
          expect(onValueChange).not.toHaveBeenCalled();
          expect(getField()).not.toHaveAttribute("aria-invalid");
        },
      );

      it("rejects a paste that only becomes another number next to what was already typed", async () => {
        const user = userEvent.setup();

        render(<NumberInput decimals={decimals} label="Monto" />);

        await user.type(getField(), "1");
        await user.paste("e3");

        expect(getField()).toHaveValue("1");
      });

      it("leaves an empty field empty when the paste is rejected", async () => {
        const user = userEvent.setup();

        render(<NumberInput decimals={decimals} label="Monto" />);

        await user.click(getField());
        await user.paste("1e3");

        expect(getField()).toHaveValue("");
      });

      it.each([
        ["1 000", "1000"],
        ["1 234 567", "1234567"],
        ["1 000", "1000"],
        [" 7 ", "7"],
        ["Bs 12", "12"],
        ["12 Bs", "12"],
      ])("still pastes %s as %s", async (pasted, expected) => {
        const user = userEvent.setup();

        render(<NumberInput decimals={decimals} label="Monto" />);

        await user.click(getField());
        await user.paste(pasted);

        expect(getField()).toHaveValue(expected);
      });

      it("rejects each key that is not numeric, so the field never shows text it will not send", async () => {
        const user = userEvent.setup();

        render(<NumberInput decimals={decimals} label="Monto" />);

        await user.type(getField(), "1e");

        expect(getField()).toHaveValue("1");
      });
    });

    it("still pastes thousands written with spaces and a decimal comma", async () => {
      const user = userEvent.setup();

      render(<NumberInput decimals={2} label="Monto" />);

      await user.click(getField());
      await user.paste("1 250,75");

      expect(getField()).toHaveValue("1250.75");
    });
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

  it.each([
    ["12.345", "12.35", 12.35],
    ["0.999", "1", 1],
    ["1.005", "1.01", 1.01],
    ["2.675", "2.68", 2.68],
  ])("keeps the extra decimals of %s while typing and rounds to %s on blur", async (typed, expected, value) => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onValueChange = jest.fn();

    render(<NumberInput decimals={2} label="Monto" onChange={onChange} onValueChange={onValueChange} />);

    await user.type(getField(), typed);
    expect(getField()).toHaveValue(typed);
    expect(onValueChange).toHaveBeenLastCalledWith(Number(typed));

    await user.tab();
    expect(getField()).toHaveValue(expected);
    expect(onValueChange).toHaveBeenLastCalledWith(value);
    expect(onChange.mock.lastCall?.[0].target.value).toBe(expected);
  });

  it("rounds a pasted value with extra decimals on blur", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" />);

    await user.click(getField());
    await user.paste("1.234,565");
    expect(getField()).toHaveValue("1234.565");

    await user.tab();
    expect(getField()).toHaveValue("1234.57");
  });

  it("rounds before padding the decimals", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" padDecimals />);

    await user.type(getField(), "0.999");
    await user.tab();

    expect(getField()).toHaveValue("1.00");
  });

  it("rounds before applying min and max", async () => {
    const user = userEvent.setup();

    render(<NumberInput decimals={2} label="Monto" max={10} min={0.01} />);

    await user.type(getField(), "9.999");
    await user.tab();
    expect(getField()).toHaveValue("10");

    await user.clear(getField());
    await user.type(getField(), "0.006");
    await user.tab();
    expect(getField()).toHaveValue("0.01");
  });

  describe("integer fields (decimals=0)", () => {
    it.each([
      ["2.5", 2.5],
      ["2,5", 2.5],
      ["12.7", 12.7],
    ])("keeps %s as typed instead of joining the digits, and marks the field invalid", async (typed, value) => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<NumberInput decimals={0} label="Monto" onValueChange={onValueChange} />);

      await user.type(getField(), typed);

      expect(getField()).toHaveValue(String(value));
      expect(onValueChange).toHaveBeenLastCalledWith(value);
      expect(getField()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(INTEGER_ERROR)).toBeVisible();
      expect(getField()).toHaveAccessibleDescription(INTEGER_ERROR);
    });

    it("does not round or truncate on blur or Enter: the value stays and stays invalid", async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      const onValueChange = jest.fn();

      render(<NumberInput decimals={0} label="Monto" onChange={onChange} onValueChange={onValueChange} />);

      await user.type(getField(), "2.5");
      await user.tab();

      expect(getField()).toHaveValue("2.5");
      expect(getField()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(INTEGER_ERROR)).toBeVisible();
      expect(onValueChange).toHaveBeenLastCalledWith(2.5);
      expect(onChange.mock.lastCall?.[0].target.value).toBe("2.5");

      await user.click(getField());
      await user.keyboard("{Enter}");

      expect(getField()).toHaveValue("2.5");
      expect(getField()).toHaveAttribute("aria-invalid", "true");
    });

    it("does not clamp a non integer to min or max either", async () => {
      const user = userEvent.setup();

      render(<NumberInput decimals={0} label="Monto" max={2} />);

      await user.type(getField(), "2.5");
      await user.tab();

      expect(getField()).toHaveValue("2.5");
      expect(getField()).toHaveAttribute("aria-invalid", "true");
    });

    it.each(["2.0", "2,", "2.00"])("normalizes %s to 2 on blur without any error", async (typed) => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<NumberInput decimals={0} label="Monto" onValueChange={onValueChange} />);

      await user.type(getField(), typed);
      expect(getField()).not.toHaveAttribute("aria-invalid");

      await user.tab();

      expect(getField()).toHaveValue("2");
      expect(getField()).not.toHaveAttribute("aria-invalid");
      expect(screen.queryByText(INTEGER_ERROR)).not.toBeInTheDocument();
      expect(onValueChange).toHaveBeenLastCalledWith(2);
    });

    it("clears the error as soon as the decimals are removed", async () => {
      const user = userEvent.setup();

      render(<NumberInput decimals={0} helperText="Unidades" label="Monto" />);

      await user.type(getField(), "2.5");
      expect(screen.getByText(INTEGER_ERROR)).toBeVisible();

      await user.keyboard("{Backspace}{Backspace}");

      expect(getField()).toHaveValue("2");
      expect(getField()).not.toHaveAttribute("aria-invalid");
      expect(screen.getByText("Unidades")).toBeVisible();
    });

    it("keeps a pasted decimal as pasted and invalid, without rounding it", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<NumberInput decimals={0} label="Monto" onValueChange={onValueChange} />);

      await user.click(getField());
      await user.paste("12.7");
      expect(getField()).toHaveValue("12.7");

      await user.tab();

      // Antes se redondeaba a 13.
      expect(getField()).toHaveValue("12.7");
      expect(onValueChange).toHaveBeenLastCalledWith(12.7);
      expect(getField()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(INTEGER_ERROR)).toBeVisible();
    });

    it("shows the caller error instead of its own", async () => {
      const user = userEvent.setup();

      render(<NumberInput decimals={0} error="Solo hay 2 empaque(s) en stock." label="Monto" />);

      await user.type(getField(), "2.5");

      expect(screen.getByText("Solo hay 2 empaque(s) en stock.")).toBeVisible();
      expect(screen.queryByText(INTEGER_ERROR)).not.toBeInTheDocument();
      expect(getField()).toHaveAttribute("aria-invalid", "true");
    });

    it("keeps the text and the error with a string kept in local state", async () => {
      const user = userEvent.setup();

      function StringState() {
        const [quantity, setQuantity] = useState("");

        return (
          <>
            <NumberInput
              decimals={0}
              label="Monto"
              onChange={(event) => setQuantity(event.target.value)}
              value={quantity}
            />
            <output>{quantity}</output>
          </>
        );
      }

      render(<StringState />);

      await user.type(getField(), "2.5");

      expect(getField()).toHaveValue("2.5");
      expect(screen.getByRole("status")).toHaveTextContent("2.5");
      expect(getField()).toHaveAttribute("aria-invalid", "true");

      await user.tab();

      expect(getField()).toHaveValue("2.5");
      expect(screen.getByRole("status")).toHaveTextContent("2.5");
      expect(getField()).toHaveAttribute("aria-invalid", "true");
    });

    it("hands the non integer to react-hook-form register so the form can reject it", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();

      function RegisterForm() {
        const { handleSubmit, register } = useForm<{ stock: number }>();

        return (
          <form onSubmit={handleSubmit((values) => onSubmit(values))}>
            <NumberInput decimals={0} label="Monto" {...register("stock", { valueAsNumber: true })} />
            <button type="submit">Guardar</button>
          </form>
        );
      }

      render(<RegisterForm />);

      await user.type(getField(), "2.5");
      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit).toHaveBeenLastCalledWith({ stock: 2.5 });
      expect(getField()).toHaveAttribute("aria-invalid", "true");
    });

    it("does not show a non integer value coming from the parent as if it were an integer", () => {
      render(<NumberInput decimals={0} label="Monto" onValueChange={jest.fn()} value={2.5} />);

      expect(getField()).toHaveValue("2.5");
      expect(getField()).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("rounds on Enter so a form submitted from the field gets the final value", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    function StringForm() {
      const [amount, setAmount] = useState("");

      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(amount);
          }}
        >
          <NumberInput
            decimals={2}
            label="Monto"
            onChange={(event) => setAmount(event.target.value)}
            value={amount}
          />
          <button type="submit">Guardar</button>
        </form>
      );
    }

    render(<StringForm />);

    await user.type(getField(), "12.345{Enter}");

    expect(getField()).toHaveValue("12.35");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenLastCalledWith("12.35");
  });

  it("sends the value rounded on Enter to react-hook-form register", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    function RegisterForm() {
      const { handleSubmit, register } = useForm<{ amount: number }>();

      return (
        <form onSubmit={handleSubmit((values) => onSubmit(values))}>
          <NumberInput decimals={2} label="Monto" {...register("amount", { valueAsNumber: true })} />
          <button type="submit">Guardar</button>
        </form>
      );
    }

    render(<RegisterForm />);

    await user.type(getField(), "1.005{Enter}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenLastCalledWith({ amount: 1.01 });
  });

  it("keeps the extra decimals while typing in a Controller and stores the rounded number on blur", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    function ControllerForm() {
      const { control, handleSubmit } = useForm<{ amount: number | null }>({
        defaultValues: { amount: null },
      });

      return (
        <form onSubmit={handleSubmit((values) => onSubmit(values))}>
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <NumberInput
                decimals={2}
                label="Monto"
                name={field.name}
                onBlur={field.onBlur}
                onValueChange={field.onChange}
                ref={field.ref}
                value={field.value}
              />
            )}
          />
          <button type="submit">Guardar</button>
        </form>
      );
    }

    render(<ControllerForm />);

    await user.type(getField(), "1.005");
    expect(getField()).toHaveValue("1.005");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(getField()).toHaveValue("1.01");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenLastCalledWith({ amount: 1.01 });
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
    expect(sanitizeNumberText("12,345", { decimals: 2 })).toBe("12.345");
    // Un entero conserva el separador: descartarlo uniria los digitos (2.5 -> 25).
    expect(sanitizeNumberText("12,", { decimals: 0 })).toBe("12.");
    expect(sanitizeNumberText("2.5", { decimals: 0 })).toBe("2.5");
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

  it("rounds half up on blur without floating point errors", () => {
    expect(normalizeNumberText("12.345", { decimals: 2 })).toBe("12.35");
    expect(normalizeNumberText("12.344", { decimals: 2 })).toBe("12.34");
    expect(normalizeNumberText("0.999", { decimals: 2 })).toBe("1");
    expect(normalizeNumberText("0.999", { decimals: 2, padDecimals: true })).toBe("1.00");
    expect(normalizeNumberText("1.005", { decimals: 2 })).toBe("1.01");
    expect(normalizeNumberText("2.675", { decimals: 2 })).toBe("2.68");
    expect(normalizeNumberText("99.995", { decimals: 2 })).toBe("100");
    expect(normalizeNumberText("1.2345", { decimals: 3 })).toBe("1.235");
    expect(normalizeNumberText("1.0005", { decimals: 3 })).toBe("1.001");
    expect(normalizeNumberText("12.50", { decimals: 2 })).toBe("12.50");
    expect(normalizeNumberText("12.345", {})).toBe("12.345");
    // Negativos: el medio va hacia +infinito, igual que el Math.round de roundMoney.
    expect(normalizeNumberText("-12.345", { allowNegative: true, decimals: 2 })).toBe("-12.34");
    expect(normalizeNumberText("-12.346", { allowNegative: true, decimals: 2 })).toBe("-12.35");
    expect(normalizeNumberText("-0.001", { allowNegative: true, decimals: 2 })).toBe("0");
    // El redondeo va antes de min/max.
    expect(normalizeNumberText("9.999", { decimals: 2, max: 10 })).toBe("10");
    expect(normalizeNumberText("0.004", { decimals: 2, min: 0.01 })).toBe("0.01");
  });

  it("never rounds, truncates or clamps a non integer in an integer field", () => {
    expect(normalizeNumberText("12.7", { decimals: 0 })).toBe("12.7");
    expect(normalizeNumberText("12.5", { decimals: 0 })).toBe("12.5");
    expect(normalizeNumberText("12.4", { decimals: 0 })).toBe("12.4");
    expect(normalizeNumberText("02,50", { decimals: 0 })).toBe("2.50");
    expect(normalizeNumberText("2.5", { decimals: 0, max: 2 })).toBe("2.5");
    expect(normalizeNumberText("0.5", { decimals: 0, min: 1 })).toBe("0.5");
    expect(normalizeNumberText("2.0", { decimals: 0 })).toBe("2");
    expect(normalizeNumberText("2.", { decimals: 0 })).toBe("2");
    expect(normalizeNumberText("007", { decimals: 0 })).toBe("7");
    expect(normalizeNumberText("9", { decimals: 0, max: 5 })).toBe("5");
  });

  it("tells whether a text is an integer", () => {
    expect(isIntegerText("3")).toBe(true);
    expect(isIntegerText("3.")).toBe(true);
    expect(isIntegerText("3.00")).toBe(true);
    expect(isIntegerText("3,0")).toBe(true);
    expect(isIntegerText("-3")).toBe(true);
    expect(isIntegerText("2.5")).toBe(false);
    expect(isIntegerText("2,5")).toBe(false);
    expect(isIntegerText("0.0000000000000000000001")).toBe(false);
    expect(isIntegerText("")).toBe(false);
    expect(isIntegerText(".")).toBe(false);
    expect(isIntegerText("abc")).toBe(false);
  });

  it("returns the error of a field text", () => {
    expect(getNumberInputError("2.5", { decimals: 0 })).toBe(INTEGER_ERROR);
    expect(getNumberInputError("2,5", { decimals: 0 })).toBe(INTEGER_ERROR);
    expect(getNumberInputError("3", { decimals: 0 })).toBeUndefined();
    expect(getNumberInputError("3.0", { decimals: 0 })).toBeUndefined();
    // Vacio no es un error de formato: si es obligatorio lo decide el formulario.
    expect(getNumberInputError("", { decimals: 0 })).toBeUndefined();
    expect(getNumberInputError("2.5", { decimals: 2 })).toBeUndefined();
    expect(getNumberInputError("2.5")).toBeUndefined();
  });
});

describe("NumberInput text that arrives without typing or pasting (SHR-18)", () => {
  const COMPOSITION_STEPS = ["1", "12", "12,", "12,5"];

  /** Lo que hace el navegador al soltar texto, autocompletar o dictar: cambia el valor y avisa con un solo `input`. */
  function insert(value: string, inputType: string) {
    fireEvent.input(getField(), { inputType, target: { value } });
  }

  /** Composición de un teclado IME: un `input` por paso con el texto compuesto hasta ese momento. */
  function compose(steps: string[], before = "", after = "") {
    fireEvent.compositionStart(getField());

    for (const step of steps) {
      fireEvent.compositionUpdate(getField(), { data: step });
      fireEvent.input(getField(), {
        inputType: "insertCompositionText",
        isComposing: true,
        target: { value: `${before}${step}${after}` },
      });
    }
  }

  function endComposition(data: string) {
    fireEvent.compositionEnd(getField(), { data });
  }

  function AmountForm({ defaultAmount, onSubmit }: { defaultAmount?: number; onSubmit?: (values: unknown) => void }) {
    const { control, handleSubmit, register } = useForm<{ amount: number }>({
      defaultValues: { amount: defaultAmount },
    });
    const amount = useWatch({ control, name: "amount" });

    return (
      <form onSubmit={handleSubmit((values) => onSubmit?.(values))}>
        <NumberInput decimals={2} label="Monto" {...register("amount", { valueAsNumber: true })} />
        <output>{String(amount)}</output>
        <button type="submit">Guardar</button>
      </form>
    );
  }

  function ControlledAmount({
    decimals,
    initial,
    onValueChange,
  }: {
    decimals?: number;
    initial: number | null;
    onValueChange: jest.Mock;
  }) {
    const [amount, setAmount] = useState<number | null>(initial);

    return (
      <NumberInput
        decimals={decimals}
        label="Monto"
        onValueChange={(next) => {
          onValueChange(next);
          setAmount(next);
        }}
        value={amount}
      />
    );
  }

  describe("IME composition", () => {
    it("does not rewrite the field nor report a value while the text is being composed", () => {
      const onChange = jest.fn();
      const onValueChange = jest.fn();

      render(<NumberInput label="Monto" onChange={onChange} onValueChange={onValueChange} />);

      fireEvent.compositionStart(getField());

      for (const step of COMPOSITION_STEPS) {
        fireEvent.input(getField(), {
          inputType: "insertCompositionText",
          isComposing: true,
          target: { value: step },
        });

        // Antes "12," se reescribia a "12." a media composicion y el teclado volvia a insertar todo: 1212512.5.
        expect(getField()).toHaveValue(step);
      }

      expect(onChange).not.toHaveBeenCalled();
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("reads the composed text once, when the composition ends", () => {
      const onChange = jest.fn();
      const onValueChange = jest.fn();

      render(<NumberInput label="Monto" onChange={onChange} onValueChange={onValueChange} />);

      compose(COMPOSITION_STEPS);
      endComposition("12,5");

      expect(getField()).toHaveValue("12.5");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.lastCall?.[0].target.value).toBe("12.5");
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenLastCalledWith(12.5);
    });

    it("reports composed text that needs no cleaning too", () => {
      const onValueChange = jest.fn();

      render(<NumberInput label="Monto" onValueChange={onValueChange} />);

      compose(["1", "12", "125"]);
      endComposition("125");

      expect(getField()).toHaveValue("125");
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenLastCalledWith(125);
    });

    it("keeps the composed text in a controlled field until the composition ends", () => {
      const onValueChange = jest.fn();

      render(<ControlledAmount decimals={2} initial={null} onValueChange={onValueChange} />);

      fireEvent.compositionStart(getField());

      for (const step of COMPOSITION_STEPS) {
        fireEvent.input(getField(), {
          inputType: "insertCompositionText",
          isComposing: true,
          target: { value: step },
        });
        expect(getField()).toHaveValue(step);
      }

      expect(onValueChange).not.toHaveBeenCalled();

      endComposition("12,5");

      expect(getField()).toHaveValue("12.5");
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenLastCalledWith(12.5);
    });

    it("hands react-hook-form the composed number, not the steps joined", () => {
      render(<AmountForm />);

      compose(COMPOSITION_STEPS);
      expect(screen.getByRole("status")).toHaveTextContent("undefined");

      endComposition("12,5");

      expect(getField()).toHaveValue("12.5");
      expect(screen.getByRole("status")).toHaveTextContent("12.5");
    });

    it("composes inside an existing value and leaves the caret after the composed text", () => {
      const onValueChange = jest.fn();

      render(<NumberInput defaultValue={1005} label="Monto" onValueChange={onValueChange} />);

      compose(["2", "25"], "1", "005");
      getField().setSelectionRange(3, 3);
      endComposition("25");

      expect(getField()).toHaveValue("125005");
      expect(getField().selectionStart).toBe(3);
      expect(onValueChange).toHaveBeenLastCalledWith(125005);
    });

    it("reads thousands composed with a space", () => {
      render(<NumberInput label="Monto" />);

      compose(["1", "1 ", "1 2", "1 25", "1 250"]);
      endComposition("1 250");

      expect(getField()).toHaveValue("1250");
    });

    it("goes back to the previous value when the composed text is not a number", () => {
      const onValueChange = jest.fn();

      render(<NumberInput defaultValue={7} label="Monto" onValueChange={onValueChange} />);

      compose(["1", "12", "12e", "12e3"], "7");
      endComposition("12e3");

      expect(getField()).toHaveValue("7");
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("goes back to the previous value of a controlled field when the composed text is not a number", () => {
      const onValueChange = jest.fn();

      render(<ControlledAmount initial={7} onValueChange={onValueChange} />);

      compose(["1", "12", "12e", "12e3"], "7");
      endComposition("12e3");

      expect(getField()).toHaveValue("7");
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("keeps typing normally after a composition", async () => {
      const user = userEvent.setup();

      render(<NumberInput label="Monto" />);

      compose(COMPOSITION_STEPS);
      endComposition("12,5");
      await user.type(getField(), "7", { initialSelectionStart: 4 });

      expect(getField()).toHaveValue("12.57");
    });
  });

  describe.each(["insertFromDrop", "insertReplacementText", "insertText", "insertFromYank"])(
    "several characters inserted at once (%s)",
    (inputType) => {
      // Antes solo el pegado se comprobaba: soltar 1e3 dejaba 13 y se enviaba.
      it.each(["1e3", "3-4", "10 20", "12abc3", "0x10"])("rejects %s instead of joining its digits", (text) => {
        const onChange = jest.fn();
        const onValueChange = jest.fn();

        render(<NumberInput defaultValue={99} label="Monto" onChange={onChange} onValueChange={onValueChange} />);

        insert(text, inputType);

        expect(getField()).toHaveValue("99");
        expect(onChange).not.toHaveBeenCalled();
        expect(onValueChange).not.toHaveBeenCalled();
        expect(getField()).not.toHaveAttribute("aria-invalid");
      });

      it("rejects text that only becomes another number next to what was already there", () => {
        const onValueChange = jest.fn();

        render(<NumberInput defaultValue={1} label="Monto" onValueChange={onValueChange} />);

        insert("1e3", inputType);

        expect(getField()).toHaveValue("1");
        expect(onValueChange).not.toHaveBeenCalled();
      });

      it("leaves an empty field empty", () => {
        render(<NumberInput label="Monto" />);

        insert("3-4", inputType);

        expect(getField()).toHaveValue("");
      });

      it("keeps the value of a controlled field", () => {
        const onValueChange = jest.fn();

        render(<ControlledAmount initial={99} onValueChange={onValueChange} />);

        insert("10 20", inputType);

        expect(getField()).toHaveValue("99");
        expect(onValueChange).not.toHaveBeenCalled();
      });

      it("keeps the value react-hook-form will submit", async () => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();

        render(<AmountForm defaultAmount={99} onSubmit={onSubmit} />);

        insert("1e3", inputType);

        expect(getField()).toHaveValue("99");
        expect(screen.getByRole("status")).toHaveTextContent("99");

        await user.click(screen.getByRole("button", { name: /guardar/i }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit).toHaveBeenLastCalledWith({ amount: 99 });
      });

      it.each([
        ["1.250,75", "1250.75"],
        ["1 000", "1000"],
        [" 7 ", "7"],
        ["Bs 12", "12"],
        ["12,5", "12.5"],
        ["1.234.567", "1234567"],
      ])("still reads %s as %s", (text, expected) => {
        const onValueChange = jest.fn();

        render(<NumberInput defaultValue={99} label="Monto" onValueChange={onValueChange} />);

        insert(text, inputType);

        expect(getField()).toHaveValue(expected);
        expect(onValueChange).toHaveBeenLastCalledWith(Number(expected));
      });

      it("restores the caret where the text was inserted", () => {
        render(<NumberInput defaultValue={1005} label="Monto" />);

        insert("1e3005", inputType);

        expect(getField()).toHaveValue("1005");
        expect(getField().selectionStart).toBe(1);
      });
    },
  );

  it("still ignores a single invalid character inserted at once, as when it is typed", () => {
    render(<NumberInput defaultValue={12} label="Monto" />);

    insert("1e2", "insertText");

    expect(getField()).toHaveValue("12");
  });

  it("goes back to a value set from outside, not to the last one it saw, when a drop is rejected", async () => {
    const user = userEvent.setup();

    function ResettableForm() {
      const { register, setValue } = useForm<{ amount: number }>({ defaultValues: { amount: 1 } });

      return (
        <>
          <NumberInput label="Monto" {...register("amount", { valueAsNumber: true })} />
          <button onClick={() => setValue("amount", 500)} type="button">
            Poner 500
          </button>
        </>
      );
    }

    render(<ResettableForm />);

    await user.click(screen.getByRole("button", { name: /poner 500/i }));
    expect(getField()).toHaveValue("500");

    // El navegador avisa antes de insertar; react-hook-form cambió el valor sin que el campo se enterase.
    fireEvent(getField(), new InputEvent("beforeinput", { bubbles: true, inputType: "insertFromDrop" }));
    insert("1e3500", "insertFromDrop");

    expect(getField()).toHaveValue("500");
  });

  describe("ambiguous separators", () => {
    // Antes un separador repetido se tomaba siempre por miles: 1.2.3 quedaba en 123.
    it.each(["1.2.3", "12,,5", "1,2,3", "1.23.456", "1.234.56"])("rejects pasting %s", async (pasted) => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<NumberInput defaultValue={99} label="Monto" onValueChange={onValueChange} />);

      await user.click(getField());
      await user.paste(pasted);

      expect(getField()).toHaveValue("99");
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("rejects 1.2.3 dropped on the field", () => {
      render(<NumberInput defaultValue={99} label="Monto" />);

      insert("1.2.3", "insertFromDrop");

      expect(getField()).toHaveValue("99");
    });

    it.each([
      ["1.234.567", "1234567"],
      ["1,234,567", "1234567"],
      ["1.234.567,5", "1234567.5"],
      ["Bs. 12,5", "12.5"],
    ])("still pastes %s as %s", async (pasted, expected) => {
      const user = userEvent.setup();

      render(<NumberInput label="Monto" />);

      await user.click(getField());
      await user.paste(pasted);

      expect(getField()).toHaveValue(expected);
    });
  });

  describe("more digits than a number can hold exactly", () => {
    const FIFTEEN = "123456789012345";

    // Antes 22 digitos llegaban al formulario como 1e+21 y 500 como Infinity.
    it("ignores the keys typed after the fifteenth digit", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<NumberInput label="Monto" onValueChange={onValueChange} />);

      await user.type(getField(), "1000000000000000000000");

      expect(getField()).toHaveValue("100000000000000");
      expect(onValueChange).toHaveBeenLastCalledWith(100000000000000);
      expect(onValueChange).toHaveBeenCalledTimes(15);
    });

    it("counts the decimals too", async () => {
      const user = userEvent.setup();

      render(<NumberInput label="Monto" />);

      await user.type(getField(), "1234567890.123456789");

      expect(getField()).toHaveValue("1234567890.12345");
    });

    it.each(["9".repeat(22), "9".repeat(500), `${FIFTEEN}6`])("rejects pasting %s", async (pasted) => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<NumberInput defaultValue={99} label="Monto" onValueChange={onValueChange} />);

      await user.click(getField());
      await user.paste(pasted);

      expect(getField()).toHaveValue("99");
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("accepts fifteen digits pasted or dropped", async () => {
      const user = userEvent.setup();

      render(<NumberInput label="Monto" />);

      await user.click(getField());
      await user.paste(FIFTEEN);
      expect(getField()).toHaveValue(FIFTEEN);

      insert("999999999999.999", "insertFromDrop");
      expect(getField()).toHaveValue("999999999999.999");
    });

    it("lets a longer value that came from the parent be shortened", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<ControlledAmount initial={0.1 + 0.2} onValueChange={onValueChange} />);

      expect(getField()).toHaveValue("0.30000000000000004");

      await user.click(getField());
      getField().setSelectionRange(19, 19);
      await user.keyboard("{Backspace}");

      expect(getField()).toHaveValue("0.3000000000000000");
    });

    it("still formats on blur a value that pads beyond fifteen digits", async () => {
      const user = userEvent.setup();

      render(<NumberInput decimals={2} label="Monto" padDecimals />);

      await user.type(getField(), "12345678901234");
      await user.tab();

      expect(getField()).toHaveValue("12345678901234.00");
    });
  });

  // SHR-23: el texto nuevo comparte principio y final con el valor, así que la diferencia mide un solo carácter.
  describe("a value replaced by text that shares its start and its end (SHR-23)", () => {
    const REPLACEMENTS = [
      [103, "1e3"],
      [304, "3-4"],
      [10520, "10 20"],
      [1293, "12e3"],
    ] as const;

    /** Lo que hace el navegador con una selección: avisa con `beforeinput` (el valor aún es el anterior) y después cambia el texto. */
    function replaceSelection(text: string, inputType: string, start = 0, end = getField().value.length) {
      const field = getField();
      const next = field.value.slice(0, start) + text + field.value.slice(end);

      field.setSelectionRange(start, end);
      fireEvent(field, new InputEvent("beforeinput", { bubbles: true, data: text, inputType }));
      insert(next, inputType);
    }

    describe.each(REPLACEMENTS)("%s replaced by %s", (initial, text) => {
      it("keeps the value when the field is filled without a beforeinput (fill, autofill)", () => {
        const onChange = jest.fn();
        const onValueChange = jest.fn();

        render(<NumberInput defaultValue={initial} label="Monto" onChange={onChange} onValueChange={onValueChange} />);

        insert(text, "insertReplacementText");

        expect(getField()).toHaveValue(String(initial));
        expect(onChange).not.toHaveBeenCalled();
        expect(onValueChange).not.toHaveBeenCalled();
      });

      it.each(["insertText", "insertFromDrop", "insertReplacementText"])(
        "keeps the value when the whole selection is replaced (%s)",
        (inputType) => {
          const onValueChange = jest.fn();

          render(<NumberInput defaultValue={initial} label="Monto" onValueChange={onValueChange} />);

          replaceSelection(text, inputType);

          expect(getField()).toHaveValue(String(initial));
          expect(onValueChange).not.toHaveBeenCalled();
        },
      );

      it("keeps the value when the text is composed over the whole selection", () => {
        const onValueChange = jest.fn();

        render(<NumberInput defaultValue={initial} label="Monto" onValueChange={onValueChange} />);

        compose(Array.from(text, (_, index) => text.slice(0, index + 1)));
        endComposition(text);

        expect(getField()).toHaveValue(String(initial));
        expect(onValueChange).not.toHaveBeenCalled();
      });

      it("keeps the value of a controlled field", () => {
        const onValueChange = jest.fn();

        render(<ControlledAmount initial={initial} onValueChange={onValueChange} />);

        insert(text, "insertReplacementText");

        expect(getField()).toHaveValue(String(initial));
        expect(onValueChange).not.toHaveBeenCalled();
      });
    });

    it("keeps the value react-hook-form will submit", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();

      render(<AmountForm defaultAmount={103} onSubmit={onSubmit} />);

      insert("1e3", "insertReplacementText");

      expect(getField()).toHaveValue("103");
      expect(screen.getByRole("status")).toHaveTextContent("103");

      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit).toHaveBeenLastCalledWith({ amount: 103 });
    });

    it("rejects one foreign character dropped on a selected digit", () => {
      render(<NumberInput defaultValue={103} label="Monto" />);

      replaceSelection("e", "insertFromDrop", 1, 2);

      expect(getField()).toHaveValue("103");
    });

    it("rejects a replacement that leaves separators no one can read", () => {
      render(<NumberInput defaultValue={10203} label="Monto" />);

      insert("1.2.3", "insertReplacementText");

      expect(getField()).toHaveValue("10203");
    });

    it.each([
      [103, "1.250,75", "1250.75"],
      [103, "113", "113"],
      [10520, "10 520", "10520"],
      [1293, "12,3", "12.3"],
    ])("still replaces %s by %s", (initial, text, expected) => {
      const onValueChange = jest.fn();

      render(<NumberInput defaultValue={initial} label="Monto" onValueChange={onValueChange} />);

      replaceSelection(text, "insertText");

      expect(getField()).toHaveValue(expected);
      expect(onValueChange).toHaveBeenLastCalledWith(Number(expected));
    });

    it("still replaces a selection with a typed digit", async () => {
      const user = userEvent.setup();
      const onValueChange = jest.fn();

      render(<NumberInput defaultValue={103} label="Monto" onValueChange={onValueChange} />);

      await user.type(getField(), "7", { initialSelectionEnd: 2, initialSelectionStart: 1 });

      expect(getField()).toHaveValue("173");
      expect(onValueChange).toHaveBeenLastCalledWith(173);
    });

    it("still replaces the whole value by typing over it", async () => {
      const user = userEvent.setup();

      render(<NumberInput defaultValue={103} label="Monto" />);

      await user.type(getField(), "4,5", { initialSelectionEnd: 3, initialSelectionStart: 0 });

      expect(getField()).toHaveValue("4.5");
    });

    it("still rejects a second equal separator typed over a selection, without rejecting the edit", async () => {
      const user = userEvent.setup();

      render(<NumberInput label="Monto" />);

      await user.type(getField(), "1.25");
      await user.type(getField(), ".", { initialSelectionEnd: 3, initialSelectionStart: 2 });

      expect(getField()).toHaveValue("1.5");
    });

    it("still ignores a key that is not numeric typed over a selection, as when it is typed anywhere else", async () => {
      const user = userEvent.setup();

      render(<NumberInput defaultValue={103} label="Monto" />);

      // Como Supr sobre la selección: el gesto es de una tecla y la quita quien escribe.
      await user.type(getField(), "e", { initialSelectionEnd: 2, initialSelectionStart: 1 });

      expect(getField()).toHaveValue("13");
    });

    it("still deletes characters, joining what is left", async () => {
      const user = userEvent.setup();

      render(<NumberInput defaultValue={10520} label="Monto" />);

      await user.type(getField(), "{Backspace}", { initialSelectionEnd: 3, initialSelectionStart: 2 });

      expect(getField()).toHaveValue("1020");
    });
  });
});
