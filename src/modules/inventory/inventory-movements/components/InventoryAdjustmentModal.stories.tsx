import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/components/Button";

import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

const meta = {
  component: InventoryAdjustmentModal,
  tags: ["ai-generated"],
  title: "Modules/Inventory/InventoryAdjustmentModal",
} satisfies Meta<typeof InventoryAdjustmentModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomTrigger: Story = {
  args: {
    trigger: (
      <Button size="sm" variant="outline">
        Ajustar stock
      </Button>
    ),
  },
};
