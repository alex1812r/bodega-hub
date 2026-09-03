import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AssistantEmptyState,
  PLATFORM_SUGGESTIONS,
  STORE_SUGGESTIONS,
} from "./AssistantEmptyState";

const meta = {
  component: AssistantEmptyState,
  tags: ["ai-generated"],
  args: {
    onPick: () => {},
    suggestions: STORE_SUGGESTIONS,
  },
} satisfies Meta<typeof AssistantEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tienda: Story = {};

export const Plataforma: Story = {
  args: { suggestions: PLATFORM_SUGGESTIONS },
};

export const LimiteAlcanzado: Story = {
  args: { disabled: true },
};
