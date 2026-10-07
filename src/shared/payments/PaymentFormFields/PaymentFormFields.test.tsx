import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { PAYMENT_METHODS } from "@/shared/payments/paymentMethods";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { VENEZUELAN_BANKS } from "@/shared/venezuela/banks";

import { PaymentFormFields, type PaymentFormFieldsProps } from "./PaymentFormFields";
import {
  type PaymentFormValues,
  amountForPendingShare,
  buildPaymentFormPayload,
  createEmptyPaymentFormValues,
  isPaymentFormValid,
  validatePaymentForm,
} from "./paymentForm";

const BANK = VENEZUELAN_BANKS[0];

type HarnessProps = Partial<Omit<PaymentFormFieldsProps, "onChange" | "values">> & {
  initial?: Partial<PaymentFormValues>;
  onValues?: (values: PaymentFormValues) => void;
};

function Harness({ initial, methods = PAYMENT_METHODS, onValues, ...props }: HarnessProps) {
  const [values, setValues] = useState<PaymentFormValues>({
    ...createEmptyPaymentFormValues(),
    ...initial,
  });

  return (
    <PaymentFormFields
      {...props}
      methods={methods}
      onChange={(next) => {
        setValues(next);
        onValues?.(next);
      }}
      values={values}
    />
  );
}

function amountField() {
  return screen.getByLabelText("Monto");
}

describe("PaymentFormFields", () => {
  describe("campos por metodo", () => {
    const cases: Array<{
      bank: boolean;
      method: PaymentMethod;
      phone: boolean;
      reference: boolean;
    }> = [
      { bank: false, method: "efectivo_ves", phone: false, reference: false },
      { bank: false, method: "efectivo_usd", phone: false, reference: false },
      { bank: true, method: "pago_movil", phone: true, reference: true },
      { bank: false, method: "punto_venta", phone: false, reference: true },
      { bank: true, method: "transferencia", phone: false, reference: true },
    ];

    it.each(cases)("$method muestra solo sus campos", ({ bank, method, phone, reference }) => {
      render(<Harness initial={{ method }} />);

      expect(screen.getByLabelText("Metodo")).toHaveValue(method);
      expect(amountField()).toBeInTheDocument();
      expect(screen.getByLabelText("Notas")).toBeInTheDocument();
      expect(screen.queryByLabelText("Banco") !== null).toBe(bank);
      expect(screen.queryByLabelText("Numero telefonico") !== null).toBe(phone);
      expect(screen.queryByLabelText("Referencia") !== null).toBe(reference);
    });

    it("ofrece solo los metodos recibidos", () => {
      render(<Harness methods={["efectivo_ves", "pago_movil"]} />);

      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Efectivo VES",
        "Pago movil",
      ]);
    });

    it("al cambiar de metodo limpia banco, telefono y referencia y conserva monto y notas", async () => {
      const user = userEvent.setup();
      const onValues = jest.fn();

      render(
        <Harness
          initial={{
            amount: "100",
            bankName: BANK.label,
            method: "pago_movil",
            notes: "Nota",
            phone: "04125551234",
            referenceCode: "1234",
          }}
          onValues={onValues}
        />,
      );

      await user.selectOptions(screen.getByLabelText("Metodo"), "transferencia");

      expect(onValues).toHaveBeenLastCalledWith({
        amount: "100",
        bankName: "",
        method: "transferencia",
        notes: "Nota",
        phone: "",
        referenceCode: "",
      });
    });

    it("el monto es un campo de texto numerico, no type=number", async () => {
      const user = userEvent.setup();
      const onValues = jest.fn();

      render(<Harness onValues={onValues} />);
      await user.type(amountField(), "12,345");

      expect(amountField()).toHaveAttribute("type", "text");
      // Mientras se teclea se conservan los decimales de mas, ya con punto decimal.
      expect(amountField()).toHaveValue("12.345");

      await user.tab();

      expect(amountField()).toHaveValue("12.35");
      expect(onValues).toHaveBeenLastCalledWith(expect.objectContaining({ amount: "12.35" }));
    });

    it("Enter en el monto lo redondea antes de que se envie el formulario", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();

      function FormHarness() {
        const [values, setValues] = useState<PaymentFormValues>(createEmptyPaymentFormValues());

        return (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(buildPaymentFormPayload(values));
            }}
          >
            <PaymentFormFields methods={PAYMENT_METHODS} onChange={setValues} values={values} />
            <button type="submit">Registrar</button>
          </form>
        );
      }

      render(<FormHarness />);
      await user.type(amountField(), "12,345{Enter}");

      expect(amountField()).toHaveValue("12.35");
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 12.35 }));
    });
  });

  describe("equivalencia REF y Bs", () => {
    it("muestra en vivo el equivalente en Bs de un monto en REF", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ method: "efectivo_usd" }} rateVes={510} />);

      expect(screen.getByText("Monto en USD.")).toBeInTheDocument();

      await user.type(amountField(), "12.5");

      expect(
        screen.getByText(`Monto en USD. Equivale a ${formatVesBs(6375)}.`),
      ).toBeInTheDocument();

      await user.type(amountField(), "5");

      expect(
        screen.getByText(`Monto en USD. Equivale a ${formatVesBs(6400.5)}.`),
      ).toBeInTheDocument();
    });

    it("muestra en vivo el equivalente en REF de un monto en Bs", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ method: "pago_movil" }} rateVes={510} />);
      await user.type(amountField(), "1000");

      expect(
        screen.getByText(`Monto en VES. Equivale a ${formatRefUsd(1.96)}.`),
      ).toBeInTheDocument();
    });

    it("sin tasa solo indica la moneda", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ method: "efectivo_ves" }} />);
      await user.type(amountField(), "1000");

      expect(screen.getByText("Monto en VES.")).toBeInTheDocument();
      expect(screen.queryByText(/Equivale a/)).not.toBeInTheDocument();
    });
  });

  describe("saldo pendiente", () => {
    it("sin pendingBalance no hay boton ni chips", () => {
      render(<Harness rateVes={510} />);

      expect(screen.queryByRole("button", { name: "Completar saldo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /% del saldo/ })).not.toBeInTheDocument();
    });

    it("con saldo en cero tampoco se muestran", () => {
      render(<Harness pendingBalance={0} rateVes={510} />);

      expect(screen.queryByRole("button", { name: "Completar saldo" })).not.toBeInTheDocument();
    });

    it("Completar saldo pone el saldo en Bs para un metodo en Bs", async () => {
      const user = userEvent.setup();

      render(<Harness pendingBalance={8475.5} rateVes={510} />);
      await user.click(screen.getByRole("button", { name: "Completar saldo" }));

      expect(amountField()).toHaveValue("8475.5");
    });

    it("Completar saldo convierte a REF sin superar el saldo", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ method: "efectivo_usd" }} pendingBalance={100} rateVes={510} />);
      await user.click(screen.getByRole("button", { name: "Completar saldo" }));

      // 100 / 510 = 0.196 → roundMoney daria 0.20 (Bs 102, mas que el saldo).
      expect(amountField()).toHaveValue("0.19");
    });

    it("los chips 25, 50 y 100 calculan con roundMoney", async () => {
      const user = userEvent.setup();

      render(<Harness pendingBalance={10.03} rateVes={510} />);

      await user.click(screen.getByRole("button", { name: "25 % del saldo" }));
      expect(amountField()).toHaveValue(String(roundMoney(10.03 * 0.25)));

      await user.click(screen.getByRole("button", { name: "50 % del saldo" }));
      expect(amountField()).toHaveValue(String(roundMoney(10.03 * 0.5)));

      await user.click(screen.getByRole("button", { name: "100 % del saldo" }));
      expect(amountField()).toHaveValue("10.03");
    });

    it("en REF sin tasa los atajos quedan deshabilitados", () => {
      render(<Harness initial={{ method: "efectivo_usd" }} pendingBalance={100} />);

      expect(screen.getByRole("button", { name: "Completar saldo" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "25 % del saldo" })).toBeDisabled();
    });

    it("ningun porcentaje supera el saldo, tampoco convertido a REF", () => {
      const rates = [36.5, 510, 498.37];

      for (let cents = 1; cents <= 3000; cents += 7) {
        const balance = cents / 100;

        for (const percent of [25, 50, 100]) {
          const ves = amountForPendingShare("efectivo_ves", balance, percent);

          if (ves !== null) {
            expect(ves).toBeLessThanOrEqual(balance);
            expect(ves).toBe(roundMoney(ves));
          }

          for (const rate of rates) {
            const ref = amountForPendingShare("efectivo_usd", balance * rate, percent, rate);

            if (ref !== null) {
              expect(roundMoney(ref * rate)).toBeLessThanOrEqual(roundMoney(balance * rate));
            }
          }
        }
      }
    });

    it("25 % + 25 % + 50 % en abonos sucesivos nunca supera el saldo", () => {
      for (let cents = 1; cents <= 5000; cents += 1) {
        const balance = cents / 100;
        let pending = balance;
        let paid = 0;

        // Cada abono recalcula sobre el saldo que queda, como hace el documento.
        for (const percent of [25, 25, 50]) {
          const share = amountForPendingShare("efectivo_ves", balance, percent) ?? 0;
          const amount = Math.min(
            share,
            amountForPendingShare("efectivo_ves", pending, 100) ?? 0,
          );

          paid = roundMoney(paid + amount);
          pending = roundMoney(pending - amount);
        }

        expect(paid).toBeLessThanOrEqual(balance);
        expect(pending).toBeGreaterThanOrEqual(0);
      }
    });

    // SHR-03F: en oscuro `--primary` no llega a 4.5:1 como color de texto de 12 px,
    // y `ring-primary/30` no llega a 3:1 como anillo de foco.
    it("los atajos no usan text-primary sin variante dark ni el anillo translucido", () => {
      render(<Harness pendingBalance={8475.5} rateVes={510} />);

      const shortcuts = [
        screen.getByRole("button", { name: "Completar saldo" }),
        screen.getByRole("button", { name: "50 % del saldo" }),
      ];

      for (const shortcut of shortcuts) {
        const classes = shortcut.className.split(/\s+/);
        const primaryText = classes.filter((name) => name.endsWith("text-primary"));

        expect(primaryText.filter((name) => !name.startsWith("dark:"))).toEqual([]);
        expect(classes.filter((name) => name.includes("ring-primary/30"))).toEqual([]);
        expect(classes.some((name) => name.endsWith("text-indigo-300") && name.startsWith("dark:"))).toBe(
          true,
        );
        expect(shortcut).toHaveClass(
          "focus-visible:ring-2",
          "focus-visible:ring-ring",
          "focus-visible:ring-offset-2",
        );
      }
    });

    it("no devuelve monto si no hay saldo, porcentaje o tasa", () => {
      expect(amountForPendingShare("efectivo_ves", undefined, 100)).toBeNull();
      expect(amountForPendingShare("efectivo_ves", 0, 100)).toBeNull();
      expect(amountForPendingShare("efectivo_ves", -5, 100)).toBeNull();
      expect(amountForPendingShare("efectivo_usd", 100, 100)).toBeNull();
      expect(amountForPendingShare("efectivo_usd", 100, 100, 0)).toBeNull();
      expect(amountForPendingShare("efectivo_usd", 1, 25, 510)).toBeNull();
    });
  });

  describe("SHR-19 M3: cambio de moneda", () => {
    it("de Bs a USD convierte el monto con la tasa en vez de reinterpretar la cifra", async () => {
      const user = userEvent.setup();

      render(<Harness pendingBalance={30600} rateVes={510} />);
      await user.click(screen.getByRole("button", { name: "Completar saldo" }));
      expect(amountField()).toHaveValue("30600");

      await user.selectOptions(screen.getByLabelText("Metodo"), "efectivo_usd");

      expect(amountField()).toHaveValue("60");
      expect(screen.queryByText(/supera el saldo pendiente/)).not.toBeInTheDocument();
    });

    it("de USD a Bs convierte el monto con la tasa", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ amount: "12.5", method: "efectivo_usd" }} rateVes={510} />);
      await user.selectOptions(screen.getByLabelText("Metodo"), "pago_movil");

      expect(amountField()).toHaveValue("6375");
    });

    it("usa el mismo redondeo que la equivalencia en vivo", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ amount: "1000", method: "efectivo_ves" }} rateVes={510} />);
      await user.selectOptions(screen.getByLabelText("Metodo"), "efectivo_usd");

      expect(amountField()).toHaveValue(String(roundMoney(1000 / 510)));
    });

    it("sin tasa vacia el monto al cambiar de moneda", async () => {
      const user = userEvent.setup();
      const onValues = jest.fn();

      render(<Harness initial={{ amount: "30600" }} onValues={onValues} />);
      await user.selectOptions(screen.getByLabelText("Metodo"), "efectivo_usd");

      expect(amountField()).toHaveValue("");
      expect(onValues).toHaveBeenLastCalledWith(
        expect.objectContaining({ amount: "", method: "efectivo_usd" }),
      );
    });

    it("entre metodos de la misma moneda el monto no cambia", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ amount: "100.5", method: "efectivo_ves" }} rateVes={510} />);
      await user.selectOptions(screen.getByLabelText("Metodo"), "punto_venta");

      expect(amountField()).toHaveValue("100.5");
    });
  });

  describe("SHR-19 M3: monto mayor que el saldo", () => {
    const overpayMessage = `El monto supera el saldo pendiente (${formatVesBs(30600)}).`;

    it("avisa junto al campo sin esperar al envio y sin bloquear si no hay holgura definida", async () => {
      const user = userEvent.setup();

      render(<Harness pendingBalance={30600} rateVes={510} />);
      await user.type(amountField(), "30600");
      expect(screen.queryByText(overpayMessage)).not.toBeInTheDocument();

      await user.type(amountField(), ".01");

      expect(screen.getByRole("status")).toHaveTextContent(overpayMessage);
      expect(amountField()).not.toHaveAttribute("aria-invalid", "true");
      expect(
        isPaymentFormValid(
          { ...createEmptyPaymentFormValues(), amount: "30600.01" },
          { pendingBalance: 30600, rateVes: 510 },
        ),
      ).toBe(true);
    });

    it("compara en Bs un monto en USD", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ method: "efectivo_usd" }} pendingBalance={30600} rateVes={510} />);
      await user.type(amountField(), "60");
      expect(screen.queryByText(overpayMessage)).not.toBeInTheDocument();

      await user.type(amountField(), ".01");

      expect(screen.getByRole("status")).toHaveTextContent(overpayMessage);
    });

    it("dentro de la holgura del servidor avisa y deja enviar; por encima marca el campo y bloquea", async () => {
      const user = userEvent.setup();
      const balance = { overpayToleranceVes: 10, pendingBalance: 30600, rateVes: 510 };

      render(<Harness {...balance} />);
      await user.type(amountField(), "30610");

      expect(screen.getByRole("status")).toHaveTextContent(overpayMessage);
      expect(amountField()).not.toHaveAttribute("aria-invalid", "true");
      expect(
        isPaymentFormValid({ ...createEmptyPaymentFormValues(), amount: "30610" }, balance),
      ).toBe(true);

      await user.type(amountField(), ".01");

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByText(overpayMessage)).toBeInTheDocument();
      expect(amountField()).toHaveAttribute("aria-invalid", "true");
      expect(
        validatePaymentForm({ ...createEmptyPaymentFormValues(), amount: "30610.01" }, balance),
      ).toEqual({ amount: overpayMessage });
    });

    it("sin saldo conocido, o en USD sin tasa, no avisa ni bloquea", async () => {
      const user = userEvent.setup();

      render(<Harness initial={{ method: "efectivo_usd" }} pendingBalance={30600} />);
      await user.type(amountField(), "99999");

      expect(screen.queryByText(/supera el saldo pendiente/)).not.toBeInTheDocument();
      expect(
        isPaymentFormValid(
          { ...createEmptyPaymentFormValues("efectivo_usd"), amount: "99999" },
          { overpayToleranceVes: 10, pendingBalance: 30600 },
        ),
      ).toBe(true);
      expect(
        isPaymentFormValid(
          { ...createEmptyPaymentFormValues(), amount: "99999" },
          { overpayToleranceVes: 10 },
        ),
      ).toBe(true);
    });
  });

  describe("validaciones", () => {
    it("no muestra errores hasta que se piden", () => {
      render(<Harness initial={{ method: "pago_movil" }} />);

      expect(screen.queryByText("Indica un monto mayor a cero.")).not.toBeInTheDocument();
      expect(screen.queryByText("Indica el banco.")).not.toBeInTheDocument();
    });

    it("pago movil exige monto, banco, telefono y referencia de 4 digitos", () => {
      render(<Harness initial={{ method: "pago_movil" }} showErrors />);

      expect(screen.getByText("Indica un monto mayor a cero.")).toBeInTheDocument();
      expect(screen.getByText("Indica el banco.")).toBeInTheDocument();
      expect(screen.getByText("Indica el telefono.")).toBeInTheDocument();
      expect(screen.getByText("Usa una referencia de 4 digitos.")).toBeInTheDocument();
      expect(amountField()).toHaveAttribute("aria-invalid", "true");
    });

    it("distingue dato ausente de dato invalido", () => {
      expect(
        validatePaymentForm({
          amount: "10",
          bankName: "Banco inventado",
          method: "pago_movil",
          notes: "",
          phone: "0412555",
          referenceCode: "12345",
        }),
      ).toEqual({
        bankName: "Selecciona un banco de la lista.",
        phone: "Telefono invalido (ej. 0412 555-1234).",
        referenceCode: "Usa una referencia de 4 digitos.",
      });
    });

    it("transferencia exige banco y referencia, no telefono", () => {
      expect(
        validatePaymentForm({ ...createEmptyPaymentFormValues("transferencia"), amount: "10" }),
      ).toEqual({
        bankName: "Indica el banco.",
        referenceCode: "Indica la referencia.",
      });
    });

    it("punto de venta exige solo la referencia", () => {
      expect(
        validatePaymentForm({ ...createEmptyPaymentFormValues("punto_venta"), amount: "10" }),
      ).toEqual({ referenceCode: "Indica la referencia." });
    });

    it("efectivo solo exige un monto mayor a cero", () => {
      expect(isPaymentFormValid({ ...createEmptyPaymentFormValues("efectivo_usd"), amount: "0" })).toBe(
        false,
      );
      expect(isPaymentFormValid({ ...createEmptyPaymentFormValues("efectivo_usd"), amount: "0.01" })).toBe(
        true,
      );
      expect(isPaymentFormValid({ ...createEmptyPaymentFormValues("efectivo_ves"), amount: "5" })).toBe(
        true,
      );
    });
  });

  describe("payload", () => {
    it("recorta textos, omite vacios y asigna la moneda del metodo", () => {
      expect(
        buildPaymentFormPayload({
          amount: "1500.75",
          bankName: ` ${BANK.label} `,
          method: "pago_movil",
          notes: "   ",
          phone: "04125551234",
          referenceCode: " 1234 ",
        }),
      ).toEqual({
        amount: 1500.75,
        bankName: BANK.label,
        currency: "VES",
        method: "pago_movil",
        notes: undefined,
        phone: "04125551234",
        referenceCode: "1234",
      });
      expect(
        buildPaymentFormPayload({ ...createEmptyPaymentFormValues("efectivo_usd"), amount: "12.5" }),
      ).toMatchObject({ amount: 12.5, currency: "USD", method: "efectivo_usd" });
    });
  });
});
