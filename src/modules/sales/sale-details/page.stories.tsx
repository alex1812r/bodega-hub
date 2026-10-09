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

/** Productos abierta y vista previa del recibo colapsada al entrar. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      await canvas.findByRole("button", { name: /^Vista previa del recibo/ }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByRole("button", { name: /^Productos/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  },
};

/** Venta con saldo pendiente: la cabecera ofrece "Cobrar saldo", que abre el modal de cobro. */
export const WithPendingBalance: Story = {
  name: "Con saldo pendiente",
  args: { saleId: "sale-002" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("button", { name: "Cobrar saldo" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Pagos/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  },
};
