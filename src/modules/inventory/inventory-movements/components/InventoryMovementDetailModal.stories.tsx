import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InventoryMovementDetailModal } from "./InventoryMovementDetailModal";

const sampleMovement = {
  createdAt: "2026-05-18T14:30:00.000Z",
  id: "mov-002",
  product: {
    categoryId: "cat-tools",
    currentCostRef: 30,
    currentStock: 18,
    id: "prod-drill",
    isActive: true,
    minStock: 2,
    name: "Taladro inalámbrico",
    salePriceRef: 45,
    sku: "TAL-001",
  },
  productId: "prod-drill",
  quantityDelta: -1,
  reason: "Venta registrada en POS",
  saleId: "sale-001",
  stockAfter: 18,
  type: "venta" as const,
};

const meta = {
  args: {
    movement: sampleMovement,
    onOpenChange: () => undefined,
    open: true,
  },
  component: InventoryMovementDetailModal,
  tags: ["ai-generated"],
  title: "Modules/Inventory/InventoryMovementDetailModal",
} satisfies Meta<typeof InventoryMovementDetailModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SaleMovement: Story = {};

export const ManualAdjustment: Story = {
  args: {
    movement: {
      ...sampleMovement,
      id: "mov-005",
      purchaseId: undefined,
      quantityDelta: -6,
      reason: "Conteo físico",
      saleId: undefined,
      stockAfter: 0,
      type: "ajuste_salida",
    },
  },
};
