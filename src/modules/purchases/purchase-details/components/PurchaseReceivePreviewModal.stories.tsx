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

/** COM-14: una línea que se desarma al recibir, otra que podría y una cuya receta ya no está activa. */
export const WithDisassemble: Story = {
  args: {
    lines: [
      {
        canDisassemble: true,
        disassemble: {
          components: [
            {
              name: "Refresco fresa 355 ml",
              productId: "prod-fresa",
              productInactive: false,
              quantityIn: 12,
              stockAfter: 15,
              stockBefore: 3,
            },
            {
              name: "Refresco uva 355 ml",
              productId: "prod-uva",
              productInactive: true,
              quantityIn: 6,
              stockAfter: 6,
              stockBefore: 0,
            },
          ],
          packsOut: 3,
        },
        name: "Caja surtida de refrescos",
        productId: "prod-caja",
        productInactive: false,
        purchaseItemId: "item-caja",
        quantityIn: 3,
        stockAfter: 2,
        stockBefore: 2,
        unitCostRef: 9,
      },
      {
        canDisassemble: true,
        name: "Bulto de harina",
        productId: "prod-bulto",
        productInactive: false,
        purchaseItemId: "item-bulto",
        quantityIn: 2,
        stockAfter: 2,
        stockBefore: 0,
        unitCostRef: 18,
      },
      {
        disassembleUnavailable: true,
        name: "Caja de galletas",
        productId: "prod-galletas",
        productInactive: false,
        purchaseItemId: "item-galletas",
        quantityIn: 1,
        stockAfter: 1,
        stockBefore: 0,
        unitCostRef: 6,
      },
    ],
    onDisassembleChange: fn(),
  },
};

export const WithDisassembleNarrow: Story = {
  args: WithDisassemble.args,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const NarrowScreen: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
