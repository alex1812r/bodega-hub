import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InventoryMovementsTable } from "./InventoryMovementsTable";

const meta = {
  component: InventoryMovementsTable,
  tags: ["ai-generated"],
    args: {
    rows: [
      {
        createdAt: "2026-05-18T14:30:00.000Z",
        id: "MOV-001",
        product: "Aceite 1L",
        productSku: "ACE-1L",
        purchaseId: "purchase-001",
        quantity: 12,
        reason: "Compra C-0001",
        stockAfter: 24,
        type: "compra",
      },
    ],
  },
} satisfies Meta<typeof InventoryMovementsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
