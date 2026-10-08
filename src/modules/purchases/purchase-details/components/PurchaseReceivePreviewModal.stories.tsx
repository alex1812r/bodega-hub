import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { PurchaseReceivePreviewModal } from "./PurchaseReceivePreviewModal";

const meta = {
  args: {
    lines: [
      {
        name: "Harina PAN 1 kg",
        productId: "prod-harina",
        productInactive: false,
        quantityIn: 5,
        stockAfter: 15,
        stockBefore: 10,
        unitCostRef: 2,
      },
      {
        name: "Malta Maltín 250 ml",
        packCount: 3,
        packLabel: "caja",
        productId: "prod-malta",
        productInactive: true,
        quantityIn: 36,
        stockAfter: 40,
        stockBefore: 4,
        unitCostRef: 0.75,
        unitsPerPack: 12,
      },
    ],
    onConfirm: fn(),
    onOpenChange: fn(),
    open: true,
    purchaseNumber: "C-20261008-000003",
  },
  component: PurchaseReceivePreviewModal,
  tags: ["ai-generated"],
  title: "Modules/Purchases/PurchaseReceivePreviewModal",
} satisfies Meta<typeof PurchaseReceivePreviewModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Receiving: Story = { args: { isPending: true } };

export const NarrowScreen: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
