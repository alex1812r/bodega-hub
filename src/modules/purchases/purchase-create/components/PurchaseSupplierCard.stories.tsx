import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchaseSupplierCard } from "./PurchaseSupplierCard";

const meta = {
  component: PurchaseSupplierCard,
  title: "Modules/Purchases/PurchaseSupplierCard",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseSupplierCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
