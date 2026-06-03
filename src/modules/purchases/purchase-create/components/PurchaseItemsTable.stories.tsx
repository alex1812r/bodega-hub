import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PurchaseItemsTable } from "./PurchaseItemsTable";

const meta = {
  component: PurchaseItemsTable,
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseItemsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
