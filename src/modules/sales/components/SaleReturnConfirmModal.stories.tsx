import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen } from "storybook/test";

import { SaleReturnConfirmModal } from "./SaleReturnConfirmModal";

const meta = {
  args: {
    onConfirm: fn(),
    onOpenChange: fn(),
    open: true,
    paymentsHref: "/payments?saleId=sale-001",
    saleId: "sale-001",
  },
  component: SaleReturnConfirmModal,
  title: "Modules/Sales/SaleReturnConfirmModal",
  tags: ["ai-generated"],
} satisfies Meta<typeof SaleReturnConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Pide el efecto al API de demo: devolución total, con cada pago que se anula.
 * El modo demo no guarda asientos de caja ni baúl y el modal lo dice.
 */
export const Default: Story = {
  play: async () => {
    await expect(await screen.findByRole("dialog")).toBeInTheDocument();
  },
};
