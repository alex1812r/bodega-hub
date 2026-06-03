import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

const meta = {
  component: InventoryAdjustmentModal,
  tags: ["ai-generated"],
} satisfies Meta<typeof InventoryAdjustmentModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
