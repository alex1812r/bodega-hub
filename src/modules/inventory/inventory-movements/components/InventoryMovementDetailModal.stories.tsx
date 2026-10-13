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
  documentKind: "venta" as const,
  documentNumber: "V-0042",
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

/** Venta: el número enlaza al detalle de la venta. */
export const SaleMovement: Story = {
  args: { returnTo: "/inventory/movements?type=venta" },
};

/** Sin venta, compra ni conversión: el documento es "Ajuste manual". Saldo negativo resaltado. */
export const ManualAdjustment: Story = {
  args: {
    movement: {
      ...sampleMovement,
      documentKind: null,
      documentNumber: null,
      id: "mov-005",
      quantityDelta: -6,
      reason: "Conteo físico",
      saleId: undefined,
      stockAfter: -2,
      type: "ajuste_salida",
    },
  },
};

export const PackConversion: Story = {
  args: {
    movement: {
      ...sampleMovement,
      conversionId: "conv-001",
      documentKind: "conversion",
      documentNumber: null,
      id: "mov-006",
      quantityDelta: 24,
      reason: "Apertura de bulto",
      saleId: undefined,
      stockAfter: 42,
      type: "conversion_entrada",
    },
  },
};
