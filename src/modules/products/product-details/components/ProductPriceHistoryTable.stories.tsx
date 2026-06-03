import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProductPriceHistoryTable } from "./ProductPriceHistoryTable";

const meta = {
  component: ProductPriceHistoryTable,
  title: "Modules/Products/ProductPriceHistoryTable",
  tags: ["ai-generated"],
  args: {
    rows: [
      {
        changedBy: "Admin",
        date: "18/05/2026",
        id: "PH-001",
        newPriceRef: 4.2,
        oldPriceRef: 3.9,
        reason: "Ajuste por reposicion",
      },
      {
        changedBy: "Almacen",
        date: "10/05/2026",
        id: "PH-002",
        newPriceRef: 3.9,
        oldPriceRef: 3.5,
        reason: "Cambio de costo",
      },
    ],
  },
} satisfies Meta<typeof ProductPriceHistoryTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    rows: [],
  },
};
