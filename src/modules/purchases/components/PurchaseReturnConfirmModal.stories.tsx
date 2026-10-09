import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen } from "storybook/test";

import { PurchaseReturnConfirmModal } from "./PurchaseReturnConfirmModal";

const meta = {
  args: {
    onConfirm: fn(),
    onOpenChange: fn(),
    open: true,
    paymentsHref: "/payments?purchaseId=purchase-001",
    purchaseId: "purchase-001",
  },
  component: PurchaseReturnConfirmModal,
  title: "Modules/Purchases/PurchaseReturnConfirmModal",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseReturnConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Pide el efecto al API de demo. Según los pagos de la compra sembrada muestra la
 * confirmación con lo que sale del inventario o el aviso de que hay pagos por anular.
 */
export const Default: Story = {
  play: async () => {
    await expect(await screen.findByRole("dialog")).toBeInTheDocument();
  },
};

/** El rechazo del servidor al ejecutar queda dentro del modal. */
export const WithServerError: Story = {
  name: "Con error del servidor",
  args: {
    error: "No hay stock suficiente para revertir la compra",
  },
};

export const NarrowScreen: Story = {
  name: "390 px",
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
