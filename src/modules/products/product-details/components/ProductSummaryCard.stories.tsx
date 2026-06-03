import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProductSummaryCard } from "./ProductSummaryCard";

const meta = {
  component: ProductSummaryCard,
  tags: ["ai-generated"],
  args: {
    product: {
      name: "Aceite 1L",
      sku: "ACE-1L",
      category: "Alimentos",
      priceRef: 4.2,
      costRef: 2.8,
      status: "activo",
    },
  },
} satisfies Meta<typeof ProductSummaryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
