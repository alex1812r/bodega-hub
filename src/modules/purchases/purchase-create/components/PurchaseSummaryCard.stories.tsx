import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { PurchaseSummaryCard } from "./PurchaseSummaryCard";

// Bulto de 100 u a 1.755,33 Bs con tasa 798,3260 (caso real): el subtotal REF
// sale de convertir el monto en Bs de la linea, no de multiplicar el unitario.
const subtotalVes = 1755.33;
const subtotalRef = 2.2;
const taxVes = 280.85;
const taxRef = 0.35;
const generalBreakdown = {
  baseRef: subtotalRef,
  baseVes: subtotalVes,
  key: "general",
  label: "General 16 %",
  rate: 16,
  taxRef,
  taxVes,
};

const meta = {
  args: {
    costCurrency: "ves",
    discountRef: 0,
    discountVes: 0,
    onConfirm: fn(),
    onCostCurrencyChange: fn(),
    onDiscountChange: fn(),
    subtotalRef,
    subtotalVes,
    taxBreakdown: [generalBreakdown],
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

    // Base e IVA de la alícuota se muestran en Bs y en REF, no solo el total.
    await expect(canvas.getByText("Base General 16 %")).toBeVisible();
    await expect(canvas.getByText("IVA General 16 %")).toBeVisible();
    await expect(canvas.getAllByText("Bs. 1.755,33")).toHaveLength(2);
    await expect(canvas.getAllByText("ref 2.20")).toHaveLength(2);
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

/** Compra con líneas exentas y gravadas: una base y un IVA por cada alícuota presente. */
export const TwoTaxRates: Story = {
  args: {
    subtotalRef: 30,
    subtotalVes: 15300,
    taxBreakdown: [
      { baseRef: 6, baseVes: 3060, key: "exento", label: "Exento 0 %", rate: 0, taxRef: 0, taxVes: 0 },
      {
        baseRef: 24,
        baseVes: 12240,
        key: "general",
        label: "General 16 %",
        rate: 16,
        taxRef: 3.84,
        taxVes: 1958.4,
      },
    ],
    taxRef: 3.84,
    taxVes: 1958.4,
  },
  name: "Dos alícuotas",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const breakdown = within(canvas.getByRole("group", { name: "Desglose de IVA por alícuota" }));

    await expect(breakdown.getByText("Base Exento 0 %")).toBeVisible();
    await expect(breakdown.getByText("IVA General 16 %")).toBeVisible();
    await expect(canvas.getByText("Bs. 17.258,40")).toBeVisible();
  },
};

/** Compra sin líneas: no hay desglose, solo subtotal, descuento y total. */
export const WithoutLines: Story = {
  args: { subtotalRef: 0, subtotalVes: 0, taxBreakdown: [], taxRef: 0, taxVes: 0 },
  name: "Sin líneas",
};

/** Compra capturada en REF: el monto principal de cada fila es el REF y los Bs quedan debajo. */
export const CostsInRef: Story = {
  args: {
    costCurrency: "ref",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("button", { name: "REF" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Bs" }));
    await expect(args.onCostCurrencyChange).toHaveBeenCalledWith("ves");
  },
};
