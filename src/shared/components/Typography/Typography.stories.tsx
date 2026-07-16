import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Typography } from "./Typography";

const meta = {
  component: Typography,
  tags: ["ai-generated"],
} satisfies Meta<typeof Typography>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Headings: Story = {
  render: () => (
    <div className="space-y-4">
      <Typography as="h1" variant="display">
        BodegaHub
      </Typography>
      <Typography as="h2" variant="h1">
        Ventas del dia
      </Typography>
      <Typography as="h3" variant="h2">
        Ganancia bruta
      </Typography>
    </div>
  ),
};

export const BodyText: Story = {
  render: () => (
    <div className="max-w-xl space-y-3">
      <Typography>
        La aplicacion permite registrar ventas, compras, pagos parciales e
        inventario con precios base en ref.
      </Typography>
      <Typography variant="muted">
        Cada factura conserva la tasa historica usada al momento de la venta.
      </Typography>
      <Typography variant="caption">Actualizado hace 5 minutos</Typography>
    </div>
  ),
};
