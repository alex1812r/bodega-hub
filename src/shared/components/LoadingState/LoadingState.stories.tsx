import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LoadingState } from "./LoadingState";

const meta = {
  component: LoadingState,
  tags: ["ai-generated"],
  args: {
    description: "Estamos preparando la informacion del modulo.",
    title: "Cargando datos",
  },
} satisfies Meta<typeof LoadingState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Page: Story = {
  args: {
    variant: "page",
  },
};

export const Section: Story = {};

export const Inline: Story = {
  args: {
    description: undefined,
    title: "Actualizando",
    variant: "inline",
  },
};
