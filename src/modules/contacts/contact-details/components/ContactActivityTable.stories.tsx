import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ContactActivityTable } from "./ContactActivityTable";

const meta = {
  component: ContactActivityTable,
  title: "Modules/Contacts/ContactActivityTable",
  tags: ["ai-generated"],
  args: {
    rows: [
      {
        amountVes: 7650,
        date: "18/05/2026",
        id: "ACT-001",
        reference: "V-0002",
        type: "venta",
      },
      {
        amountVes: 3000,
        date: "17/05/2026",
        id: "ACT-002",
        reference: "PG-002",
        type: "pago",
      },
    ],
  },
} satisfies Meta<typeof ContactActivityTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    rows: [],
  },
};
