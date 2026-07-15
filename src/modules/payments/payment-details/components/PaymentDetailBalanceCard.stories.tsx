import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaymentDetailBalanceCard } from "./PaymentDetailBalanceCard";

const meta = {
  component: PaymentDetailBalanceCard,
  tags: ["ai-generated"],
  args: {
    documentBalance: {
      href: "/sales/sale-001",
      label: "VEN-0128",
      paidVes: 3650,
      pendingVes: 850,
      totalVes: 4500,
    },
    refRateVes: 36.5,
  },
} satisfies Meta<typeof PaymentDetailBalanceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBalance: Story = {};

export const WithoutDocument: Story = {
  args: {
    documentBalance: undefined,
  },
};
