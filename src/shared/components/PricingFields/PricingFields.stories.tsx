import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn } from "storybook/test";

import { PricingFields, type PricingFieldsProps } from "./PricingFields";

const usageGuide = `
Campos de precio con ganancia (markup sobre el costo, en REF). El costo **ya incluye el IVA**: aquí no
se aplica ningún impuesto.

- Controlado: \`price\` (\`number | null\`) + \`onPriceChange\`. El % no se guarda: se deriva de costo y precio.
- Chip o % escrito → completa el precio (\`roundMoney\`). Editar el precio → recalcula el %.
- El campo que se está tecleando no se reescribe; el otro sí.
- \`suggestedPct\` (por ejemplo, el de la categoría) aparece como primer chip, destacado.
- \`onMarkupChange\` recibe el % resultante de cada cambio (útil para prellenar "Ajuste de margen a X %").
- Sin costo, un % deja el precio en 0 y se avisa. Un precio bajo el costo no se bloquea: semáforo rojo
  con % negativo y aviso.
`;

const meta = {
  component: PricingFields,
  tags: ["ai-generated"],
  args: {
    cost: 8,
    onPriceChange: fn(),
    price: 10,
  },
  parameters: {
    docs: {
      description: {
        component: usageGuide,
      },
    },
  },
  render: (args) => <ControlledPricingFields {...args} />,
} satisfies Meta<typeof PricingFields>;

export default meta;
type Story = StoryObj<typeof meta>;

function ControlledPricingFields({ onPriceChange, price: initialPrice, ...props }: PricingFieldsProps) {
  const [price, setPrice] = useState(initialPrice);

  return (
    <div className="max-w-md">
      <PricingFields
        {...props}
        onPriceChange={(next) => {
          setPrice(next);
          onPriceChange(next);
        }}
        price={price}
      />
    </div>
  );
}

export const Basic: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "20 %" }));

    await expect(canvas.getByLabelText("Precio REF")).toHaveValue("9.6");
    await expect(canvas.getByLabelText("Ganancia %")).toHaveValue("20");
  },
};

export const SinPrecio: Story = {
  args: { price: null },
};

export const GananciaMedia: Story = {
  args: { cost: 10, price: 12 },
};

export const GananciaBaja: Story = {
  args: { cost: 10, price: 11 },
};

export const ConSugerido: Story = {
  args: { cost: 10, price: 11.8, suggestedPct: 18 },
};

export const ChipsYUmbralesPersonalizados: Story = {
  args: { chips: [10, 25, 40, 60], cost: 10, price: 13, thresholds: { low: 20, high: 40 } },
};

export const SinCosto: Story = {
  args: { cost: 0, price: null },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("Ganancia %"), "20");

    await expect(canvas.getByLabelText("Precio REF")).toHaveValue("0");
    await expect(canvas.getByRole("status")).toBeVisible();
  },
};

export const PrecioBajoElCosto: Story = {
  args: { cost: 10, price: 9 },
};

export const ConError: Story = {
  args: { cost: 8, error: "El precio debe ser mayor a 0", price: 0 },
};

export const Deshabilitado: Story = {
  args: { disabled: true },
};

export const Oscuro: Story = {
  args: { cost: 10, price: 9, suggestedPct: 18 },
  globals: { theme: "dark" },
};

export const EnMovil: Story = {
  args: { cost: 1234.56, price: 1543.2, suggestedPct: 18 },
  decorators: [
    (Story) => (
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
};
