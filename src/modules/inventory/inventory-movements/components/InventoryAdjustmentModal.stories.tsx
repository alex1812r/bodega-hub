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

/** Buscador de producto vacío: busca en `/api/products` por nombre, SKU o código de barras. */
export const Default: Story = {};

/** Abierto con un producto precargado (se lee por id); el usuario puede cambiarlo. */
export const PreloadedProduct: Story = {
  args: {
    defaultProductId: "prod-cable",
    trigger: (
      <Button size="sm" variant="outline">
        Ajustar stock
      </Button>
    ),
  },
};

/** Ajuste de un producto concreto (formulario y detalle de Productos): bloqueado, sin buscador. */
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
