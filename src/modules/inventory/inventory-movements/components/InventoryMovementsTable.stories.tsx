import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InventoryMovementsTable } from "./InventoryMovementsTable";

const meta = {
  component: InventoryMovementsTable,
  tags: ["ai-generated"],
  args: {
    rows: [
      {
        id: "MOV-001",
        date: "18/05/2026",
        product: "Aceite 1L",
        type: "compra",
        quantity: 12,
        reason: "Compra C-0001",
        stockAfter: 24,
      },
    ],
  },
} satisfies Meta<typeof InventoryMovementsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
