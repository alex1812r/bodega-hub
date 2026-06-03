import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InventoryMovementsPage } from "./page";

const meta = {
  component: InventoryMovementsPage,
  title: "Modules/Inventory/InventoryMovementsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof InventoryMovementsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
