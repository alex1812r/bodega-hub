import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import type { PackDistributionValue } from "@/modules/inventory/inventory-movements/utils/packDistribution";

import {
  allowedPurchaseImpact,
  purchaseImpactCostLine,
  purchaseImpactStockLine,
  receiveImpactOf,
  rejectedPurchaseImpact,
} from "../../components/purchaseImpact.testFixtures";
import {
  buildReceiveDisassembleRequest,
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
      effect={{
        impact: receiveImpactOf(assortedOrder, buildReceiveDisassembleRequest(lines)),
        status: "ready",
      }}
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

/** Efecto de las dos líneas por defecto: la harina sube de costo y baja de banda de ganancia. */
const defaultImpact = allowedPurchaseImpact("receive", {
  costs: [
    purchaseImpactCostLine({ costRefAfter: 2.32, costRefBefore: 1.8 }),
    purchaseImpactCostLine({
      costRefAfter: 0.87,
      costRefBefore: 0.87,
      isActive: false,
      productId: "prod-malta",
      productName: "Malta Maltín 250 ml",
      sku: "MAL-250",
    }),
  ],
  stock: [
    purchaseImpactStockLine({ purchasedIn: 5, quantityDelta: 5, stockAfter: 15, stockBefore: 10 }),
    purchaseImpactStockLine({
      isActive: false,
      productId: "prod-malta",
      productName: "Malta Maltín 250 ml",
      purchasedIn: 36,
      quantityDelta: 36,
      sku: "MAL-250",
      stockAfter: 40,
      stockBefore: 4,
    }),
  ],
});

const meta = {
  args: {
    effect: { impact: defaultImpact, status: "ready" },
    salePrices: { "prod-harina": 2.6, "prod-malta": 1.2 },
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

/** El efecto aún no llegó: se ven las líneas, no hay botón de recibir. */
export const LoadingEffect: Story = {
  args: { effect: { impact: null, status: "loading" } },
};

/** El efecto no se pudo calcular: no se recibe a ciegas; «Reintentar». */
export const EffectError: Story = {
  args: {
    effect: {
      impact: null,
      message: "No pudimos conectar con el servidor.",
      onRetry: fn(),
      status: "error",
    },
  },
};

/** La RPC rechazaría la recepción: motivo tal cual y sin botón de recibir. */
export const Blocked: Story = {
  args: {
    effect: {
      impact: rejectedPurchaseImpact(
        "receive",
        "Solo se pueden recibir compras en estado pedido",
        { status: "recibido" },
      ),
      status: "blocked",
    },
  },
};

/** Tras cambiar una marca o el reparto: el efecto anterior atenuado y el botón en espera. */
export const Recalculating: Story = {
  args: { effect: { impact: defaultImpact, recalculating: true, status: "ready" } },
};

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
    effect: {
      impact: allowedPurchaseImpact("receive", {
        costs: [
          purchaseImpactCostLine({
            costRefAfter: 9,
            costRefBefore: 8.5,
            productId: "prod-caja",
            productName: "Caja surtida de refrescos",
            sku: null,
          }),
          purchaseImpactCostLine({
            costRefAfter: 0.52,
            costRefBefore: 0.6,
            productId: "prod-fresa",
            productName: "Refresco fresa 355 ml",
            sku: null,
            source: "disassemble",
          }),
        ],
        stock: [
          purchaseImpactStockLine({
            disassembledOut: 3,
            productId: "prod-caja",
            productName: "Caja surtida de refrescos",
            purchasedIn: 3,
            quantityDelta: 0,
            sku: null,
            stockAfter: 2,
            stockBefore: 2,
          }),
          purchaseImpactStockLine({
            componentsIn: 12,
            productId: "prod-fresa",
            productName: "Refresco fresa 355 ml",
            quantityDelta: 12,
            sku: null,
            stockAfter: 15,
            stockBefore: 3,
          }),
          purchaseImpactStockLine({
            componentsIn: 6,
            isActive: false,
            productId: "prod-uva",
            productName: "Refresco uva 355 ml",
            quantityDelta: 6,
            sku: null,
            stockAfter: 6,
            stockBefore: 0,
          }),
          purchaseImpactStockLine({
            productId: "prod-bulto",
            productName: "Bulto de harina",
            purchasedIn: 2,
            quantityDelta: 2,
            sku: null,
            stockAfter: 2,
            stockBefore: 0,
          }),
          purchaseImpactStockLine({
            productId: "prod-galletas",
            productName: "Caja de galletas",
            purchasedIn: 1,
            quantityDelta: 1,
            sku: null,
            stockAfter: 1,
            stockBefore: 0,
          }),
        ],
      }),
      status: "ready",
    },
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
