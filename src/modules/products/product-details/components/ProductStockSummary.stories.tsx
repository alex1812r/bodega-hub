import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProductStockSummary } from "./ProductStockSummary";

const meta = {
  component: ProductStockSummary,
  title: "Modules/Products/ProductStockSummary",
  tags: ["ai-generated"],
  args: {
    stock: {
      lastMovement: "Compra C-0001",
      minimumStock: 8,
      stock: 24,
    },
  },
} satisfies Meta<typeof ProductStockSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {};

export const LowStock: Story = {
  args: {
    stock: {
      lastMovement: "Venta V-0002",
      minimumStock: 10,
      stock: 3,
    },
  },
};

export const OutOfStock: Story = {
  args: {
    stock: {
      lastMovement: "Venta V-0003",
      minimumStock: 6,
      stock: 0,
    },
  },
};
