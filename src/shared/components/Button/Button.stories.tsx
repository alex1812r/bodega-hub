import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Button } from "./Button";

const meta = {
  component: Button,
  tags: ["ai-generated"],
  args: {
    children: "Guardar",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: {
    children: "Cancelar",
    variant: "secondary",
  },
};

export const Danger: Story = {
  args: {
    children: "Eliminar",
    variant: "danger",
  },
};

export const Disabled: Story = {
  args: {
    children: "Guardando",
    disabled: true,
  },
};

export const CssCheck: Story = {
  args: {
    children: "Submit",
  },
  play: async ({ canvas }) => {
    const button = canvas.getByRole("button", { name: /submit/i });

    await expect(getComputedStyle(button).backgroundColor).toBe(
      "oklch(0.546 0.245 262.881)",
    );
  },
};
