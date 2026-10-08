import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { SaleDetailsPage } from "./page";

const meta = {
  component: SaleDetailsPage,
  title: "Modules/Sales/SaleDetailsPage",
  tags: ["ai-generated"],
} satisfies Meta<typeof SaleDetailsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Venta con saldo pendiente: la cabecera ofrece "Cobrar saldo", que abre el modal de cobro. */
export const WithPendingBalance: Story = {
  name: "Con saldo pendiente",
  args: { saleId: "sale-002" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("button", { name: "Cobrar saldo" }),
    ).toBeInTheDocument();
  },
};
