import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaymentDetailInfoCard } from "./PaymentDetailInfoCard";

const meta = {
  component: PaymentDetailInfoCard,
  tags: ["ai-generated"],
  args: {
    amountRef: 100,
    amountVes: 3650,
    bankName: "Banco de Venezuela",
    createdAt: "2023-10-24T14:45:00.000Z",
    currency: "VES",
    linkedDocument: {
      href: "/sales/sale-001",
      label: "VEN-0128",
    },
    method: "pago_movil",
    notes: "Pago parcial de factura de venta VEN-0128",
    phone: "0414-1234567",
    referenceCode: "998821",
    refRateVes: 36.5,
  },
} satisfies Meta<typeof PaymentDetailInfoCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
