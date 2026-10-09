import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import type { PackDistributionValue } from "@/modules/inventory/inventory-movements/utils/packDistribution";

import {
  buildReceivePreview,
  findReceiveDistributionError,
  parseReceiveDistribution,
  type ReceivePreviewPurchase,
} from "../utils/buildReceivePreview";
import { PurchaseReceivePreviewModal } from "./PurchaseReceivePreviewModal";

/** Pedido de 3 cajas surtidas (2 Cola + 2 Manzana + 2 Naranja) marcadas «Desarmar al recibir». */
const assortedOrder: ReceivePreviewPurchase = {
  items: [
    {
      disassembleOnReceive: true,
      id: "item-surtida",
      packRecipe: {
        components: [
          { currentStock: 4, isActive: true, name: "Refresco cola 355 ml", unitProductId: "prod-cola", unitsPerPack: 2 },
          { currentStock: 0, isActive: true, name: "Refresco manzana 355 ml", unitProductId: "prod-manzana", unitsPerPack: 2 },
          { currentStock: 1, isActive: false, name: "Refresco naranja 355 ml", unitProductId: "prod-naranja", unitsPerPack: 2 },
        ],
        conversionId: "rec-surtida",
        totalUnits: 6,
      },
      product: { currentStock: 0, isActive: true, name: "Caja surtida de refrescos" },
      productId: "prod-surtida",
      purchaseId: "pur-1",
      quantity: 3,
      subtotalRef: 36,
      subtotalVes: 18000,
      unitCostRef: 12,
      unitCostVes: 6000,
    },
  ],
};

/** El modal con el estado que le da la página: marcas y reparto tecleado, y los efectos recalculados. */
function AdjustableDistribution({ initial }: { initial: PackDistributionValue }) {
  const [disassemble, setDisassemble] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, PackDistributionValue>>({
    "item-surtida": initial,
  });
  const [blocked, setBlocked] = useState(false);
  const lines = buildReceivePreview(assortedOrder, {
    disassemble,
    distribution: parseReceiveDistribution(assortedOrder, values),
  });
  const distributionError = findReceiveDistributionError(lines);

  return (
    <PurchaseReceivePreviewModal
      distributionValues={values}
      error={blocked ? distributionError : null}
      lines={lines}
      onConfirm={() => setBlocked(Boolean(distributionError))}
      onDisassembleChange={(itemId, next) => setDisassemble((current) => ({ ...current, [itemId]: next }))}
      onDistributionChange={(itemId, value) => setValues((current) => ({ ...current, [itemId]: value }))}
      onOpenChange={() => undefined}
      open
      purchaseNumber="C-20261008-000004"
    />
  );
}

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
              unitsPerPack: 4,
            },
            {
              name: "Refresco uva 355 ml",
              productId: "prod-uva",
              productInactive: true,
              quantityIn: 6,
              stockAfter: 6,
              stockBefore: 0,
              unitsPerPack: 2,
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

/**
 * COM-14: surtido que se desarma. «Ajustar reparto» abre el control de reparto de
 * Inventario; aquí una caja va 3-1-2 (7 / 5 / 6) y los efectos lo reflejan.
 */
export const WithAdjustedDistribution: Story = {
  render: () => (
    <AdjustableDistribution initial={{ "prod-cola": "7", "prod-manzana": "5", "prod-naranja": "6" }} />
  ),
};

/** El reparto no suma las 18 unidades: el control lo dice y «Recibir mercancía» no envía nada. */
export const WithInvalidDistribution: Story = {
  render: () => (
    <AdjustableDistribution initial={{ "prod-cola": "7", "prod-manzana": "5", "prod-naranja": "5" }} />
  ),
};

export const WithAdjustedDistributionNarrow: Story = {
  ...WithAdjustedDistribution,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const WithDisassembleNarrow: Story = {
  args: WithDisassemble.args,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const NarrowScreen: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
