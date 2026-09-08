import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { PayrollBreakdown } from "./PayrollBreakdown";

const meta = {
  args: {
    commissionRef: 180,
    grossProfitRef: 1200,
    reinvestPct: 45,
    reservePct: 20,
    warnSharePct: 40,
  },
  component: PayrollBreakdown,
  tags: ["ai-generated"],
} satisfies Meta<typeof PayrollBreakdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 15 % de la ganancia bruta: por debajo del 25 %, semaforo verde. */
export const Saludable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Saludable")).toBeVisible();
    await expect(canvas.getByText("15.00 %")).toBeVisible();
  },
};

/** 30 % de la ganancia bruta: banda ambar (25 % - umbral). */
export const Atencion: Story = {
  args: { commissionRef: 360 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Atencion")).toBeVisible();
  },
};

/** Por encima del umbral configurado: rojo. */
export const Alto: Story = {
  args: { commissionRef: 600 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Alto")).toBeVisible();
  },
};

/** El reporte de margen no devolvio ganancia bruta. */
export const SinGananciaBruta: Story = {
  args: { grossProfitRef: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Sin datos")).toBeVisible();
  },
};
