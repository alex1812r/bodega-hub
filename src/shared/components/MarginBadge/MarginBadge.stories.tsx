import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { MarginBadge } from "./MarginBadge";

/**
 * Semáforo de ganancia (markup sobre el costo, en REF). El costo ya incluye el IVA.
 *
 * - Recibe `cost` + `price`, o el `pct` ya calculado.
 * - Rojo < 15 %, amarillo 15–24,9 %, verde ≥ 25 % (configurable con `thresholds`).
 * - `review`: la banda bajó desde el último precio fijado ("Por revisar").
 * - Sin costo no hay % que mostrar: "Sin costo" en tono neutro.
 */
const meta = {
  component: MarginBadge,
  tags: ["ai-generated"],
} satisfies Meta<typeof MarginBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

function AllStates() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MarginBadge cost={10} price={9} />
      <MarginBadge cost={10} price={11} />
      <MarginBadge cost={10} price={12} />
      <MarginBadge cost={8} price={10} />
      <MarginBadge pct={11.11} review />
      <MarginBadge pct={null} />
      <MarginBadge pct={24.99} size="md" />
    </div>
  );
}

export const Baja: Story = {
  args: { cost: 10, price: 11 },
  play: async ({ canvas }) => {
    await expect(canvas.getByTitle("Ganancia sobre el costo (ya con IVA)")).toHaveTextContent(
      "10 %",
    );
  },
};

export const Media: Story = {
  args: { cost: 10, price: 12 },
};

export const Alta: Story = {
  args: { cost: 8, price: 10 },
};

export const PrecioBajoElCosto: Story = {
  args: { cost: 10, price: 9 },
};

export const PorRevisar: Story = {
  args: { pct: 11.11, review: true },
};

export const SinCosto: Story = {
  args: { pct: null },
};

export const Mediano: Story = {
  args: { pct: 24.99, size: "md" },
};

export const UmbralesPersonalizados: Story = {
  args: { pct: 30, thresholds: { low: 20, high: 40 } },
};

export const TodosLosEstados: Story = {
  args: { pct: 25 },
  render: () => <AllStates />,
};

export const TodosLosEstadosOscuro: Story = {
  args: { pct: 25 },
  globals: { theme: "dark" },
  render: () => <AllStates />,
};

export const TodosLosEstadosEnMovil: Story = {
  args: { pct: 25 },
  decorators: [
    (Story) => (
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
  render: () => <AllStates />,
};
