import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { ErrorState } from "./ErrorState";

const meta = {
  component: ErrorState,
  tags: ["ai-generated"],
  args: {
    description: "No se pudo completar la consulta. Intenta nuevamente.",
    title: "No pudimos cargar los datos",
  },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRetry: Story = {
  args: {
    onRetry: fn(),
  },
};

export const WithoutRetry: Story = {};
