import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InventoryListPage } from "./page";

const meta = {
  component: InventoryListPage,
  title: "Modules/Inventory/InventoryListPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof InventoryListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
