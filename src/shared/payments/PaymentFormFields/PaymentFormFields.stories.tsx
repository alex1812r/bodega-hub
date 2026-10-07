import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect } from "storybook/test";

import { PAYMENT_METHODS } from "@/shared/payments/paymentMethods";

import { PaymentFormFields, type PaymentFormFieldsProps } from "./PaymentFormFields";
import { type PaymentFormValues, createEmptyPaymentFormValues } from "./paymentForm";

const usageGuide = `
Campos de un pago según el método: método, monto (en la moneda del método, con su equivalencia a la
tasa recibida), banco, teléfono, referencia y notas. Es controlado y no hace peticiones.

- Estado: \`useState(() => createEmptyPaymentFormValues())\` + \`values\` / \`onChange\`.
- Antes de enviar: \`isPaymentFormValid(values)\`; activa \`showErrors\` tras el primer intento.
- Payload: \`{ ...buildPaymentFormPayload(values), saleId }\` (o \`purchaseId\`).
- \`pendingBalance\` va en Bs y \`rateVes\` es la tasa del documento. Con saldo aparecen
  "Completar saldo" y los chips 25 / 50 / 100 %, que nunca superan el saldo.
- Un monto mayor que el saldo se avisa junto al campo. Si además se pasa \`overpayToleranceVes\`
  (lo que el servidor aún acepta por encima del saldo), rebasarlo invalida el formulario:
  \`isPaymentFormValid(values, { pendingBalance, rateVes, overpayToleranceVes })\`.
- Cambiar a un método de otra moneda convierte el monto con \`rateVes\`; sin tasa lo vacía.
- El error de la API lo muestra quien usa el componente, con \`error.message\` tal cual.
`;

type StoryProps = Omit<PaymentFormFieldsProps, "onChange" | "values"> & {
  initial?: Partial<PaymentFormValues>;
};

function StatefulFields({ initial, ...props }: StoryProps) {
  const [values, setValues] = useState<PaymentFormValues>({
    ...createEmptyPaymentFormValues(),
    ...initial,
  });

  return <PaymentFormFields {...props} onChange={setValues} values={values} />;
}

const meta = {
  component: StatefulFields,
  tags: ["ai-generated"],
  args: {
    methods: PAYMENT_METHODS,
    rateVes: 510,
  },
  parameters: {
    docs: {
      description: {
        component: usageGuide,
      },
    },
  },
} satisfies Meta<typeof StatefulFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CashRef: Story = {
  args: {
    initial: { amount: "12.5", method: "efectivo_usd" },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Monto en USD\. Equivale a Bs\./)).toBeVisible();
    await expect(canvas.queryByLabelText("Referencia")).not.toBeInTheDocument();
  },
};

export const CashBs: Story = {
  args: {
    initial: { amount: "5100", method: "efectivo_ves" },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Monto en VES\. Equivale a ref 10\.00/)).toBeVisible();
  },
};

export const MobilePayment: Story = {
  args: {
    initial: {
      amount: "1500.75",
      bankName: "0134 - Banesco",
      method: "pago_movil",
      phone: "04125551234",
      referenceCode: "1234",
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Numero telefonico")).toHaveValue("555-1234");
    await expect(canvas.getByLabelText("Referencia")).toHaveValue("1234");
  },
};

export const BankTransfer: Story = {
  args: {
    initial: {
      amount: "20200",
      bankName: "0102 - Banco de Venezuela",
      method: "transferencia",
      referenceCode: "TRX-001",
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Referencia")).toHaveValue("TRX-001");
    await expect(canvas.queryByLabelText("Numero telefonico")).not.toBeInTheDocument();
  },
};

export const WithPendingBalance: Story = {
  args: {
    initial: { method: "efectivo_ves" },
    pendingBalance: 8475,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "50 % del saldo" }));
    await expect(canvas.getByLabelText("Monto")).toHaveValue("4237.5");

    await userEvent.click(canvas.getByRole("button", { name: "Completar saldo" }));
    await expect(canvas.getByLabelText("Monto")).toHaveValue("8475");
  },
};

/** Supera el saldo dentro de la holgura que el servidor acepta: aviso, se puede enviar. */
export const OverBalanceWarning: Story = {
  args: {
    initial: { amount: "8480", method: "efectivo_ves" },
    overpayToleranceVes: 10,
    pendingBalance: 8475,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      /El monto supera el saldo pendiente/,
    );
    await expect(canvas.getByLabelText("Monto")).not.toHaveAttribute("aria-invalid", "true");
  },
};

/** Supera el saldo más allá de la holgura: el servidor lo rechazaría, el campo queda inválido. */
export const OverBalanceBlocked: Story = {
  args: {
    initial: { amount: "84750", method: "efectivo_ves" },
    overpayToleranceVes: 10,
    pendingBalance: 8475,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/El monto supera el saldo pendiente/)).toBeVisible();
    await expect(canvas.getByLabelText("Monto")).toHaveAttribute("aria-invalid", "true");
  },
};

export const WithErrors: Story = {
  args: {
    initial: { method: "pago_movil" },
    pendingBalance: 8475,
    showErrors: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Indica un monto mayor a cero.")).toBeVisible();
    await expect(canvas.getByText("Usa una referencia de 4 digitos.")).toBeVisible();
  },
};

export const Mobile390: Story = {
  args: {
    initial: { amount: "1500.75", method: "pago_movil" },
    pendingBalance: 8475,
  },
  decorators: [
    (StoryComponent) => (
      <div className="max-w-[390px]">
        <StoryComponent />
      </div>
    ),
  ],
};
