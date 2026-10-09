import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, within } from "storybook/test";

import { DEFAULT_MARGIN_THRESHOLDS } from "@/shared/utils/pricing";

import { createPackDraftItem, createUnitDraftItem, type PurchaseDraftItem, type PurchaseWebLine } from "../types";
import {
  buildPurchaseConfirmEffect,
  type PurchaseConfirmInput,
} from "../utils/purchaseConfirmEffect";
import { PurchaseConfirmModalView } from "./PurchaseConfirmModal";

const RATE = 510;

function webLine(item: PurchaseDraftItem, disassemble?: boolean): PurchaseWebLine {
  return {
    changes: [],
    ...(disassemble === undefined ? {} : { disassemble }),
    edited: false,
    editedMark: false,
    item,
    locked: false,
    tax: { categoryCode: null, code: "general", label: "General", manual: false, rate: item.taxRate },
  };
}

function unitLine(productId: string, quantity: number, unitCostRef: number, taxRate = 0) {
  return webLine(
    createUnitDraftItem({
      costCurrency: "ref",
      id: `line-${productId}`,
      productId,
      quantity,
      rateVes: RATE,
      taxRate,
      unitCostRef,
    }),
  );
}

const NAMES: Record<string, string> = {
  "prod-cable": "Cable HDMI 2 m",
  "prod-harina": "Harina PAN 1 kg",
  "prod-refresco": "Refresco Cola 355 ml",
  "prod-surtido": "Caja surtida de refrescos",
};

const input: PurchaseConfirmInput = {
  discountRef: 0,
  facts: {
    products: new Map([
      ["prod-cable", { currentCostRef: 1, link: "none", salePriceRef: 2 }],
      ["prod-harina", { currentCostRef: 1.16, link: "active", salePriceRef: 3 }],
      ["prod-refresco", { currentCostRef: 1, link: "active", salePriceRef: 3 }],
      ["prod-surtido", { currentCostRef: 9, link: "active", salePriceRef: 15 }],
    ]),
    thresholds: DEFAULT_MARGIN_THRESHOLDS,
  },
  getProductName: (productId) => NAMES[productId] ?? `Producto ${productId}`,
  lines: [
    unitLine("prod-cable", 3, 1.7),
    unitLine("prod-harina", 10, 1, 16),
    webLine(
      createPackDraftItem({
        costCurrency: "ref",
        id: "line-refresco",
        packCostRef: 12,
        packCount: 2,
        packLabel: "Caja",
        productId: "prod-refresco",
        rateVes: RATE,
        taxRate: 16,
        unitsPerPack: 12,
      }),
    ),
    { ...unitLine("prod-surtido", 2, 10), disassemble: true },
  ],
  payment: {
    amount: 5000,
    bankName: undefined,
    currency: "VES",
    method: "efectivo_ves",
    notes: undefined,
    phone: undefined,
    referenceCode: undefined,
  },
  rateVes: RATE,
  recipes: [
    {
      components: [
        { name: "Refresco Cola 355 ml", unitsPerPack: 8 },
        { name: "Refresco Naranja 355 ml", unitsPerPack: 4 },
      ],
      packProduct: { id: "prod-surtido" },
    },
  ],
  status: "recibido",
  supplierName: "Distribuidora Demo, C.A.",
};

const meta = {
  args: {
    effect: buildPurchaseConfirmEffect(input),
    factsStatus: "ready",
    onConfirm: fn(),
    onOpenChange: fn(),
    open: true,
  },
  component: PurchaseConfirmModalView,
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseConfirmModalView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Compra recibida con pago en efectivo: costos antes → después, banda que baja y vínculo nuevo. */
export const Recibido: Story = {
  play: async () => {
    const dialog = within(await screen.findByRole("dialog"));

    await expect(dialog.getByText("Distribuidora Demo, C.A.")).toBeVisible();
    await expect(dialog.getByText("2 × Caja de 12 = 24 und")).toBeInTheDocument();
    await expect(dialog.getByText("Vínculos nuevos")).toBeVisible();
  },
};

/** Pedido: el inventario no cambia hasta recibir y no hay costos. */
export const Pedido: Story = {
  args: { effect: buildPurchaseConfirmEffect({ ...input, payment: null, status: "pedido" }) },
  play: async () => {
    const dialog = within(await screen.findByRole("dialog"));

    await expect(dialog.getByText(/El inventario NO cambia hasta recibir/)).toBeVisible();
    await expect(dialog.queryByText("Costo (con IVA)")).not.toBeInTheDocument();
  },
};

/** 50 líneas: el resumen queda arriba y la lista hace scroll dentro del modal. */
export const CincuentaLineas: Story = {
  args: {
    effect: buildPurchaseConfirmEffect({
      ...input,
      facts: null,
      lines: Array.from({ length: 50 }, (_, index) => unitLine(`${index + 1}`, index + 1, 1.25, 16)),
    }),
  },
};

/** Aún consultando el costo actual y los vínculos. */
export const Consultando: Story = {
  args: { effect: buildPurchaseConfirmEffect({ ...input, facts: null }), factsStatus: "loading" },
};

/** La consulta falló: se dice, y las cifras de la compra siguen ahí. */
export const SinConsulta: Story = {
  args: { effect: buildPurchaseConfirmEffect({ ...input, facts: null }), factsStatus: "error" },
};
