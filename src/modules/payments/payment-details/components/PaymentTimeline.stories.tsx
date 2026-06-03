import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PaymentTimeline } from "./PaymentTimeline";

const meta = {
  component: PaymentTimeline,
  tags: ["ai-generated"],
  args: {
    items: [
      {
        id: "TL-001",
        title: "Pago registrado",
        description: "Pago asociado a la venta V-0001.",
        timestamp: "18/05/2026 10:20 AM",
      },
      {
        id: "TL-002",
        title: "Venta actualizada",
        description: "Se actualizo el monto pagado.",
        timestamp: "18/05/2026 10:21 AM",
      },
    ],
  },
} satisfies Meta<typeof PaymentTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
