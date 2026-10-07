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

/** Ajuste de un producto concreto (formulario y detalle de Productos): sin selector. */
export const LockedProduct: Story = {
  args: {
    lockedProduct: { currentStock: 12, id: "prod-drill", name: "Taladro percutor", sku: "her-tal-001" },
    trigger: (
      <Button size="sm" variant="outline">
        Ajustar stock
      </Button>
    ),
  },
};

export const CustomTrigger: Story = {
  args: {
    trigger: (
      <Button size="sm" variant="outline">
        Ajustar stock
      </Button>
    ),
  },
};
