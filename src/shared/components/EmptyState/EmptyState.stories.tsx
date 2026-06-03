import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/components/Button";

import { EmptyState } from "./EmptyState";

const meta = {
  component: EmptyState,
  tags: ["ai-generated"],
  args: {
    description: "Aun no hay datos registrados para mostrar en esta seccion.",
    title: "Sin registros",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    action: <Button size="sm">Crear registro</Button>,
  },
};
