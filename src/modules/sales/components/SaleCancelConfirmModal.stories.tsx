import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen } from "storybook/test";

import { SaleCancelConfirmModal } from "./SaleCancelConfirmModal";

const meta = {
  args: {
    onConfirm: fn(),
    onOpenChange: fn(),
    onUseReturn: fn(),
    open: true,
    paymentsHref: "/payments?saleId=sale-001",
    saleId: "sale-001",
  },
  component: SaleCancelConfirmModal,
  title: "Modules/Sales/SaleCancelConfirmModal",
  tags: ["ai-generated"],
} satisfies Meta<typeof SaleCancelConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Pide el efecto al API de demo. Según los pagos de la venta sembrada muestra la
 * confirmación con el stock que vuelve o el aviso de que hay pagos por anular.
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
    error: "La venta ya fue cancelada o devuelta",
  },
};
