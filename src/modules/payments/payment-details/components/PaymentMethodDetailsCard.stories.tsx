import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaymentMethodDetailsCard } from "./PaymentMethodDetailsCard";

const meta = {
  component: PaymentMethodDetailsCard,
  tags: ["ai-generated"],
  args: {
    payment: {
      method: "pago_movil",
      currency: "VES",
      amountRef: 20,
      amountVes: 10200,
      bankName: "Banco Venezuela",
      phone: "0412-0000000",
      referenceCode: "1234",
    },
  },
} satisfies Meta<typeof PaymentMethodDetailsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PagoMovil: Story = {};

export const Transferencia: Story = {
  args: {
    payment: {
      method: "transferencia",
      currency: "VES",
      amountRef: 50,
      amountVes: 25500,
      bankName: "Banesco",
      referenceCode: "TRX-998877",
    },
  },
};

export const EfectivoVes: Story = {
  args: {
    payment: {
      method: "efectivo_ves",
      currency: "VES",
      amountRef: 10,
      amountVes: 5100,
    },
  },
};

export const EfectivoUsd: Story = {
  args: {
    payment: {
      method: "efectivo_usd",
      currency: "USD",
      amountRef: 12,
      amountVes: 6120,
    },
  },
};
