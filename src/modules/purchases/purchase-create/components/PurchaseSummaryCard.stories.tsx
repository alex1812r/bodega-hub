import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import { PurchaseSummaryCard } from "./PurchaseSummaryCard";

// Bulto de 100 u a 1.755,33 Bs con tasa 798,3260 (caso real): el subtotal REF
// sale de convertir el monto en Bs de la linea, no de multiplicar el unitario.
const subtotalVes = 1755.33;
const subtotalRef = 2.2;
const taxVes = 280.85;
const taxRef = 0.35;

const meta = {
  args: {
    discountRef: 0,
    discountVes: 0,
    onConfirm: fn(),
    onDiscountChange: fn(),
    subtotalRef,
    subtotalVes,
    taxRef,
    taxVes,
  },
  component: PurchaseSummaryCard,
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseSummaryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Subtotal e impuesto se muestran en Bs y en REF, no solo el total.
    await expect(canvas.getByText("Bs. 1.755,33")).toBeVisible();
    await expect(canvas.getByText("ref 2.20")).toBeVisible();
    await expect(canvas.getByText("Bs. 280,85")).toBeVisible();
    await expect(canvas.getByText("ref 0.35")).toBeVisible();

    // El total en Bs suma los Bs de las lineas; no reconvierte el total REF
    // (2,55 x 798,3260 = 2.035,74 Bs, tres centimos de mas).
    await expect(canvas.getByText("Bs. 2.036,18")).toBeVisible();
    await expect(canvas.getByText("ref 2.55")).toBeVisible();
  },
};

export const WithDiscount: Story = {
  args: {
    discountRef: 0.5,
    discountVes: 399.16,
  },
};
