import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Input } from "./Input";

const meta = {
  component: Input,
  tags: ["ai-generated"],
  args: {
    label: "Nombre del cliente",
    placeholder: "Ej. Maria Perez",
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHelperText: Story = {
  args: {
    helperText: "Usa el nombre completo del cliente.",
  },
};

export const WithError: Story = {
  args: {
    error: "El nombre es obligatorio.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText(/nombre del cliente/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: "Cliente bloqueado",
  },
};
