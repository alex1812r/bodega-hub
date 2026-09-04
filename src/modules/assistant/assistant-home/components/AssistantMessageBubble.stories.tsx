import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AssistantMessageBubble } from "./AssistantMessageBubble";

const meta = {
  component: AssistantMessageBubble,
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <ul className="max-w-3xl list-none space-y-4 p-4">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof AssistantMessageBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pregunta: Story = {
  args: {
    message: {
      id: "u1",
      role: "user",
      sources: [],
      text: "¿Cuánto se ha vendido desde ayer?",
    },
  },
};

export const RespuestaConFuente: Story = {
  args: {
    message: {
      id: "a1",
      role: "assistant",
      sources: [
        {
          input: { preset: "desde_ayer" },
          output: {
            data: {
              actual: {
                salesCount: 3,
                ticketPromedioRef: 25.83,
                totalRef: 77.5,
                totalVes: 39325,
                unitsSold: 11,
              },
            },
            ok: true,
            range: { from: "2026-05-17", to: "2026-05-18" },
            source: "ventas_periodo",
          },
          state: "output-available",
          toolName: "ventas_periodo",
        },
      ],
      text: "US$ 77,50 (Bs 39.325) en 3 ventas.\nRango usado: 17 al 18 de mayo de 2026. Ticket promedio US$ 25,83.",
    },
  },
};

export const RespuestaSinFuente: Story = {
  args: {
    message: {
      id: "a2",
      role: "assistant",
      sources: [],
      text: "No puedo responder eso: solo tengo datos de tu tienda. Puedo decirte las ventas del período, la ganancia bruta o qué productos hay que reponer.",
    },
  },
};

export const RespuestaEnProgreso: Story = {
  args: {
    message: { id: "a3", role: "assistant", sources: [], text: "" },
    pending: true,
  },
};
